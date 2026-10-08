import {
  base64ToBytes,
  bytesToBase64,
  createVaultVerifier,
  deriveMasterKey,
  isCryptoAvailable,
  randomBytes,
  verifyVault
} from './crypto-utils.js';
import {
  AUTH_VAULT_STORE,
  SETTINGS_STORE,
  getById,
  getSetting,
  initStorage,
  put,
  reencryptSensitiveData
} from './storage.js';

export const VAULT_ID = 'vault';
export const VAULT_VERSION = 1;
export const MIN_MASTER_PASSWORD_LENGTH = 8;
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_DURATION_MS = 30000;
export const DEFAULT_AUTO_LOCK_MINUTES = 5;

const MAX_AUTO_LOCK_MINUTES = 10080;
const MAX_TIMER_DELAY = 2147483647;

let masterKey = null;
let initialized = false;
let initializationPromise;
let vaultExists = false;
let autoLockMinutes = DEFAULT_AUTO_LOCK_MINUTES;
let autoLockTimer;
let autoLockGeneration = 0;
let lastActivityAt = 0;
let lastActivityTouchAt = 0;
let failedAttempts = 0;
let lockoutUntil = 0;
let stateGeneration = 0;
let mutationQueue = Promise.resolve();
let activityListenersInstalled = false;

export class AuthError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
    if (options.retryAfterMs !== undefined) {
      this.retryAfterMs = options.retryAfterMs;
    }
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertPassword(value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new AuthError('AUTH_INVALID_PASSWORD', 'A password is required');
  }
  return value;
}

function ensureCrypto() {
  if (!isCryptoAvailable()) {
    throw new AuthError('AUTH_CRYPTO_UNAVAILABLE', 'Web Crypto API is unavailable');
  }
}

function normalizeError(error, fallbackCode = 'AUTH_ERROR') {
  if (error instanceof AuthError) {
    return error;
  }
  if (error && typeof error === 'object') {
    if (error.code === 'INDEXEDDB_UNAVAILABLE') {
      return new AuthError('AUTH_STORAGE_UNAVAILABLE', 'Secure browser storage is unavailable', { cause: error });
    }
    if (error.code === 'CRYPTO_UNAVAILABLE' || error.code === 'AUTH_CRYPTO_UNAVAILABLE') {
      return new AuthError('AUTH_CRYPTO_UNAVAILABLE', 'Web Crypto API is unavailable', { cause: error });
    }
    if (error.code === 'STORAGE_CONFLICT') {
      return new AuthError('AUTH_STORAGE_CONFLICT', 'The secure data changed during the operation', { cause: error });
    }
    if (error.code === 'SENSITIVE_DATA_DECRYPTION_FAILED' || error.code === 'SENSITIVE_DATA_ENCRYPTION_FAILED') {
      return new AuthError('AUTH_REENCRYPTION_FAILED', 'Sensitive data could not be re-encrypted', { cause: error });
    }
    if (typeof error.code === 'string' && error.code.startsWith('AUTH_')) {
      return new AuthError(error.code, 'The authentication operation failed', { cause: error });
    }
  }
  return new AuthError(fallbackCode, 'The authentication operation failed', { cause: error });
}

function normalizeAutoLockMinutes(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    return DEFAULT_AUTO_LOCK_MINUTES;
  }
  return Math.min(number, MAX_AUTO_LOCK_MINUTES);
}

function readVaultRecord(record) {
  if (!isObject(record) || record.id !== VAULT_ID || record.version !== VAULT_VERSION || typeof record.salt !== 'string' || (!isObject(record.verificationHash) && typeof record.verificationHash !== 'string') || !Number.isInteger(record.iterations) || record.iterations < 310000 || typeof record.updatedAt !== 'string') {
    throw new AuthError('AUTH_INVALID_VAULT', 'The local vault is invalid');
  }
  let salt;
  try {
    salt = base64ToBytes(record.salt);
  } catch (error) {
    throw new AuthError('AUTH_INVALID_VAULT', 'The local vault is invalid', { cause: error });
  }
  if (salt.byteLength !== 16) {
    throw new AuthError('AUTH_INVALID_VAULT', 'The local vault is invalid');
  }
  return { record, salt };
}

function enqueueMutation(operation) {
  const result = mutationQueue.then(operation, operation);
  mutationQueue = result.catch(() => undefined);
  return result;
}

function resetFailures() {
  failedAttempts = 0;
  lockoutUntil = 0;
}

function recordFailedAttempt() {
  failedAttempts += 1;
  if (failedAttempts >= MAX_FAILED_ATTEMPTS) {
    lockoutUntil = Date.now() + LOCKOUT_DURATION_MS;
  }
}

function assertNotLockedOut() {
  if (lockoutUntil > Date.now()) {
    throw new AuthError('AUTH_LOCKOUT', 'Too many failed attempts', { retryAfterMs: lockoutUntil - Date.now() });
  }
  if (lockoutUntil !== 0) {
    lockoutUntil = 0;
    failedAttempts = 0;
  }
}

async function readVault() {
  await ensureInitialized();
  const record = await getById(AUTH_VAULT_STORE, VAULT_ID);
  vaultExists = Boolean(record);
  return record;
}

async function refreshAutoLockSetting() {
  const value = await getSetting('autoLockMinutes');
  autoLockMinutes = normalizeAutoLockMinutes(value);
  return autoLockMinutes;
}

function activityHandler() {
  const now = Date.now();
  if (now - lastActivityTouchAt < 500) {
    return;
  }
  touchActivity(now);
}

function installActivityListeners() {
  const documentApi = globalThis.document;
  if (!documentApi || typeof documentApi.addEventListener !== 'function' || activityListenersInstalled) {
    return;
  }
  for (const eventName of ['pointerdown', 'pointermove', 'keydown', 'touchstart', 'scroll']) {
    documentApi.addEventListener(eventName, activityHandler, { passive: true });
  }
  activityListenersInstalled = true;
}

function removeActivityListeners() {
  const documentApi = globalThis.document;
  if (!documentApi || typeof documentApi.removeEventListener !== 'function' || !activityListenersInstalled) {
    return;
  }
  for (const eventName of ['pointerdown', 'pointermove', 'keydown', 'touchstart', 'scroll']) {
    documentApi.removeEventListener(eventName, activityHandler);
  }
  activityListenersInstalled = false;
}

function scheduleAutoLock(generation) {
  if (!masterKey || autoLockMinutes <= 0 || generation !== autoLockGeneration) {
    return;
  }
  const elapsed = Date.now() - lastActivityAt;
  const remaining = Math.max(0, autoLockMinutes * 60000 - elapsed);
  if (remaining === 0) {
    queueMicrotask(() => {
      if (generation === autoLockGeneration && masterKey && Date.now() - lastActivityAt >= autoLockMinutes * 60000) {
        lockVault();
      }
    });
    return;
  }
  autoLockTimer = setTimeout(() => {
    autoLockTimer = undefined;
    if (generation === autoLockGeneration && masterKey) {
      if (Date.now() - lastActivityAt >= autoLockMinutes * 60000) {
        lockVault();
      } else {
        scheduleAutoLock(generation);
      }
    }
  }, Math.min(Math.ceil(remaining), MAX_TIMER_DELAY));
  if (autoLockTimer && typeof autoLockTimer.unref === 'function') {
    autoLockTimer.unref();
  }
}

export function touchActivity(timestamp = Date.now()) {
  if (!masterKey) {
    return false;
  }
  const now = Number.isFinite(Number(timestamp)) ? Number(timestamp) : Date.now();
  lastActivityAt = now;
  lastActivityTouchAt = now;
  if (autoLockTimer !== undefined) {
    clearTimeout(autoLockTimer);
    autoLockTimer = undefined;
  }
  const generation = autoLockGeneration;
  scheduleAutoLock(generation);
  return true;
}

export function stopAutoLock() {
  autoLockGeneration += 1;
  if (autoLockTimer !== undefined) {
    clearTimeout(autoLockTimer);
    autoLockTimer = undefined;
  }
  removeActivityListeners();
}

export async function startAutoLock() {
  await ensureInitialized();
  stopAutoLock();
  if (!masterKey) {
    return false;
  }
  await refreshAutoLockSetting();
  if (autoLockMinutes <= 0) {
    return false;
  }
  lastActivityAt = Date.now();
  lastActivityTouchAt = lastActivityAt;
  installActivityListeners();
  const generation = autoLockGeneration;
  scheduleAutoLock(generation);
  return true;
}

export async function initAuth() {
  if (initialized) {
    return { hasVault: vaultExists, isUnlocked: isUnlocked(), autoLockMinutes };
  }
  if (initializationPromise) {
    return initializationPromise;
  }
  ensureCrypto();
  initializationPromise = (async () => {
    try {
      await initStorage();
      const record = await getById(AUTH_VAULT_STORE, VAULT_ID);
      vaultExists = Boolean(record);
      await refreshAutoLockSetting();
      initialized = true;
      if (masterKey) {
        await startAutoLock();
      }
      return { hasVault: vaultExists, isUnlocked: isUnlocked(), autoLockMinutes };
    } catch (error) {
      throw normalizeError(error, 'AUTH_INIT_FAILED');
    }
  })();
  try {
    return await initializationPromise;
  } catch (error) {
    initializationPromise = undefined;
    throw normalizeError(error, 'AUTH_INIT_FAILED');
  }
}

async function ensureInitialized() {
  if (!initialized) {
    await initAuth();
  }
}

export function hasVault() {
  return initialized && vaultExists;
}

export function isUnlocked() {
  return masterKey !== null;
}

export function getMasterKey() {
  return masterKey;
}

export async function getAutoLockMinutes() {
  await ensureInitialized();
  await refreshAutoLockSetting();
  return autoLockMinutes;
}

function dispatchAuthEvent(name) {
  const eventApi = globalThis.CustomEvent;
  if (typeof eventApi === 'function' && typeof globalThis.dispatchEvent === 'function') {
    globalThis.dispatchEvent(new eventApi(name));
  }
}

export function lockVault() {
  masterKey = null;
  stateGeneration += 1;
  stopAutoLock();
  resetFailures();
  lastActivityAt = 0;
  dispatchAuthEvent('hsa-auth-locked');
  return true;
}

export function resetAuthStateAfterDeletion() {
  masterKey = null;
  vaultExists = false;
  initialized = true;
  stateGeneration += 1;
  stopAutoLock();
  resetFailures();
  lastActivityAt = 0;
  dispatchAuthEvent('hsa-auth-locked');
  return true;
}

function passwordChecks(password) {
  const characters = Array.from(password);
  const lower = /\p{Ll}/u.test(password);
  const upper = /\p{Lu}/u.test(password);
  const number = /\p{N}/u.test(password);
  const symbol = /[^\p{L}\p{N}\s]/u.test(password);
  const otherLetter = /\p{L}/u.test(password) && !lower && !upper;
  const common = new Set(['password', 'password123', '12345678', '123456789', 'qwerty123', 'qwerty123456', 'admin123', 'welcome1', 'letmein1']);
  return {
    length: characters.length >= MIN_MASTER_PASSWORD_LENGTH,
    lowercase: lower,
    uppercase: upper,
    number,
    symbol,
    otherLetter,
    uncommon: !common.has(password.toLowerCase())
  };
}

export function estimatePasswordStrength(password) {
  if (typeof password !== 'string' || password.length === 0) {
    return { score: 0, percent: 0, label: 'veryWeak', checks: { length: false, lowercase: false, uppercase: false, number: false, symbol: false, uncommon: true } };
  }
  const checks = passwordChecks(password);
  const categories = [checks.lowercase || checks.otherLetter, checks.uppercase, checks.number, checks.symbol].filter(Boolean).length;
  const lengthScore = Math.min(3, Math.floor(Array.from(password).length / 6));
  let score = Math.min(4, lengthScore + Math.max(0, categories - 1));
  if (!checks.uncommon) {
    score = Math.min(score, 1);
  }
  if (Array.from(password).length < MIN_MASTER_PASSWORD_LENGTH) {
    score = Math.min(score, 1);
  }
  const labels = ['veryWeak', 'weak', 'fair', 'good', 'strong'];
  return {
    score,
    percent: score * 25,
    label: labels[score],
    checks
  };
}

export function validateMasterPasswordStrength(password) {
  if (typeof password !== 'string' || password.length === 0) {
    return { valid: false, isValid: false, score: 0, label: 'veryWeak', errors: ['AUTH_PASSWORD_REQUIRED'] };
  }
  const estimate = estimatePasswordStrength(password);
  const checks = estimate.checks;
  const errors = [];
  if (!checks.length) {
    errors.push('AUTH_PASSWORD_TOO_SHORT');
  }
  const categories = [checks.lowercase || checks.otherLetter, checks.uppercase, checks.number, checks.symbol].filter(Boolean).length;
  if (categories < 2) {
    errors.push('AUTH_PASSWORD_COMPLEXITY');
  }
  if (!checks.uncommon) {
    errors.push('AUTH_PASSWORD_COMMON');
  }
  const valid = errors.length === 0;
  return {
    valid,
    isValid: valid,
    score: estimate.score,
    label: estimate.label,
    errors
  };
}

export function createVault(password) {
  assertPassword(password);
  const validation = validateMasterPasswordStrength(password);
  if (!validation.valid) {
    throw new AuthError('AUTH_PASSWORD_WEAK', 'The master password does not meet the security requirements');
  }
  return enqueueMutation(async () => {
    await ensureInitialized();
    const existing = await getById(AUTH_VAULT_STORE, VAULT_ID);
    if (existing) {
      throw new AuthError('AUTH_VAULT_ALREADY_EXISTS', 'A vault already exists');
    }
    const operationGeneration = stateGeneration;
    const salt = randomBytes(16);
    const key = await deriveMasterKey(password, salt);
    const verifier = await createVaultVerifier(key);
    const vault = {
      id: VAULT_ID,
      salt: bytesToBase64(salt),
      verificationHash: JSON.stringify(verifier),
      iterations: 310000,
      version: VAULT_VERSION,
      updatedAt: new Date().toISOString()
    };
    await put(AUTH_VAULT_STORE, vault);
    if (operationGeneration !== stateGeneration) {
      throw new AuthError('AUTH_OPERATION_CANCELLED', 'The authentication operation was cancelled');
    }
    masterKey = key;
    vaultExists = true;
    resetFailures();
    lastActivityAt = Date.now();
    await startAutoLock();
    return { ...vault };
  }).catch((error) => {
    throw normalizeError(error, 'AUTH_CREATE_FAILED');
  });
}

export function unlockVault(password) {
  assertPassword(password);
  return enqueueMutation(async () => {
    await ensureInitialized();
    assertNotLockedOut();
    const record = await readVault();
    if (!record) {
      throw new AuthError('AUTH_VAULT_NOT_FOUND', 'No vault exists');
    }
    const { record: vault, salt } = readVaultRecord(record);
    const operationGeneration = stateGeneration;
    let key;
    try {
      key = await deriveMasterKey(password, salt, vault.iterations);
    } catch (error) {
      throw normalizeError(error, 'AUTH_INVALID_PASSWORD');
    }
    if (!await verifyVault(vault.verificationHash, key)) {
      recordFailedAttempt();
      throw new AuthError('AUTH_INVALID_PASSWORD', 'The master password is incorrect');
    }
    if (operationGeneration !== stateGeneration) {
      throw new AuthError('AUTH_OPERATION_CANCELLED', 'The authentication operation was cancelled');
    }
    masterKey = key;
    vaultExists = true;
    resetFailures();
    lastActivityAt = Date.now();
    await startAutoLock();
    return true;
  }).catch((error) => {
    throw normalizeError(error, 'AUTH_UNLOCK_FAILED');
  });
}

export function changeMasterPassword(currentPassword, newPassword) {
  assertPassword(currentPassword);
  assertPassword(newPassword);
  const validation = validateMasterPasswordStrength(newPassword);
  if (!validation.valid) {
    throw new AuthError('AUTH_PASSWORD_WEAK', 'The new master password does not meet the security requirements');
  }
  if (currentPassword === newPassword) {
    throw new AuthError('AUTH_PASSWORD_SAME', 'The new master password must be different');
  }
  return enqueueMutation(async () => {
    await ensureInitialized();
    if (!masterKey) {
      throw new AuthError('AUTH_LOCKED', 'The vault is locked');
    }
    assertNotLockedOut();
    const record = await readVault();
    if (!record) {
      throw new AuthError('AUTH_VAULT_NOT_FOUND', 'No vault exists');
    }
    const { record: vault, salt } = readVaultRecord(record);
    let currentKey;
    try {
      currentKey = await deriveMasterKey(currentPassword, salt, vault.iterations);
    } catch (error) {
      throw normalizeError(error, 'AUTH_INVALID_PASSWORD');
    }
    if (!await verifyVault(vault.verificationHash, currentKey)) {
      recordFailedAttempt();
      throw new AuthError('AUTH_INVALID_PASSWORD', 'The current master password is incorrect');
    }
    const operationGeneration = stateGeneration;
    const nextIterations = Math.max(310000, vault.iterations);
    const newSalt = randomBytes(16);
    const newKey = await deriveMasterKey(newPassword, newSalt, nextIterations);
    const newVerifier = await createVaultVerifier(newKey);
    const nextVault = {
      id: VAULT_ID,
      salt: bytesToBase64(newSalt),
      verificationHash: JSON.stringify(newVerifier),
      iterations: nextIterations,
      version: VAULT_VERSION,
      updatedAt: new Date().toISOString()
    };
    stopAutoLock();
    try {
      await reencryptSensitiveData(currentKey, newKey, { vault: nextVault, expectedVault: vault });
      if (operationGeneration !== stateGeneration) {
        const persisted = await getById(AUTH_VAULT_STORE, VAULT_ID);
        const committed = isObject(persisted)
          && persisted.salt === nextVault.salt
          && persisted.verificationHash === nextVault.verificationHash
          && persisted.updatedAt === nextVault.updatedAt;
        if (!committed) {
          throw new AuthError('AUTH_OPERATION_CANCELLED', 'The authentication operation was cancelled');
        }
        masterKey = null;
        vaultExists = true;
        return true;
      }
      masterKey = newKey;
      resetFailures();
      await startAutoLock();
      return true;
    } catch (error) {
      if (masterKey) {
        await startAutoLock().catch(() => undefined);
      }
      throw normalizeError(error, 'AUTH_CHANGE_FAILED');
    }
  }).catch((error) => {
    throw normalizeError(error, 'AUTH_CHANGE_FAILED');
  });
}

export function getAuthState() {
  return {
    initialized,
    hasVault: hasVault(),
    isUnlocked: isUnlocked(),
    failedAttempts,
    lockoutUntil
  };
}

export { SETTINGS_STORE };
