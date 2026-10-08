import { decryptText, encryptText, isCryptoAvailable } from './crypto-utils.js';

export const DB_NAME = 'HSA Notes DB';
export const DB_VERSION = 1;
export const API_KEY_STORE = 'apiKeys';
export const CREDENTIAL_STORE = 'credentials';
export const NOTES_STORE = 'notes';
export const SETTINGS_STORE = 'settings';
export const AUTH_VAULT_STORE = 'authVault';
export const API_KEYS_STORE = API_KEY_STORE;
export const CREDENTIALS_STORE = CREDENTIAL_STORE;
export const NOTE_STORE = NOTES_STORE;
export const AUTH_STORE = AUTH_VAULT_STORE;
export const STORE_NAMES = Object.freeze([
  API_KEY_STORE,
  CREDENTIAL_STORE,
  NOTES_STORE,
  SETTINGS_STORE,
  AUTH_VAULT_STORE
]);
const BACKUP_STORE_NAMES = Object.freeze(STORE_NAMES.filter((storeName) => storeName !== AUTH_VAULT_STORE));
export const SENSITIVE_FIELDS = Object.freeze({
  [API_KEY_STORE]: Object.freeze(['keyValue']),
  [CREDENTIAL_STORE]: Object.freeze(['username', 'password']),
  [NOTES_STORE]: Object.freeze(['contentHtml'])
});

const INDEX_DEFINITIONS = Object.freeze({
  [API_KEY_STORE]: Object.freeze([
    ['title', 'title', false],
    ['category', 'category', false],
    ['tags', 'tags', true],
    ['isFavorite', 'isFavorite', false],
    ['isArchived', 'isArchived', false],
    ['updatedAt', 'updatedAt', false]
  ]),
  [CREDENTIAL_STORE]: Object.freeze([
    ['siteName', 'siteName', false],
    ['category', 'category', false],
    ['isFavorite', 'isFavorite', false],
    ['isArchived', 'isArchived', false],
    ['updatedAt', 'updatedAt', false]
  ]),
  [NOTES_STORE]: Object.freeze([
    ['title', 'title', false],
    ['folder', 'folder', false],
    ['tags', 'tags', true],
    ['isPinned', 'isPinned', false],
    ['isArchived', 'isArchived', false],
    ['updatedAt', 'updatedAt', false]
  ])
});

let databasePromise;
let settingsMutationQueue = Promise.resolve();

export class StorageError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = 'StorageError';
    this.code = code;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertStoreName(storeName) {
  if (!STORE_NAMES.includes(storeName)) {
    throw new StorageError('UNKNOWN_STORE', `Unknown object store: ${String(storeName)}`);
  }
  return storeName;
}

function assertCryptoAvailable() {
  if (!isCryptoAvailable()) {
    throw new StorageError('CRYPTO_UNAVAILABLE', 'Web Crypto API is required for secure storage');
  }
}

function indexedDbApi() {
  const api = globalThis.indexedDB;
  if (!api || typeof api.open !== 'function') {
    throw new StorageError('INDEXEDDB_UNAVAILABLE', 'IndexedDB is unavailable');
  }
  return api;
}

function normalizeError(error, fallbackCode = 'STORAGE_ERROR') {
  if (error instanceof StorageError) {
    return error;
  }
  if (error && typeof error === 'object' && typeof error.name === 'string') {
    if (error.name === 'QuotaExceededError') {
      return new StorageError('QUOTA_EXCEEDED', 'The storage quota has been exceeded', error);
    }
    if (error.name === 'AbortError') {
      return new StorageError('TRANSACTION_ABORTED', 'The storage transaction was aborted', error);
    }
    if (error.name === 'VersionError') {
      return new StorageError('VERSION_ERROR', 'The database version is not supported', error);
    }
  }
  return new StorageError(fallbackCode, 'The storage operation failed', error);
}

function upgradeDatabase(database, upgradeTransaction) {
  for (const storeName of STORE_NAMES) {
    if (!database.objectStoreNames.contains(storeName)) {
      database.createObjectStore(storeName, { keyPath: 'id' });
    }
  }
  for (const [storeName, definitions] of Object.entries(INDEX_DEFINITIONS)) {
    const objectStore = upgradeTransaction.objectStore(storeName);
    for (const [name, keyPath, multiEntry] of definitions) {
      if (!objectStore.indexNames.contains(name)) {
        objectStore.createIndex(name, keyPath, { unique: false, multiEntry });
      }
    }
  }
}

function openDatabase() {
  if (databasePromise) {
    return databasePromise;
  }
  const api = indexedDbApi();
  assertCryptoAvailable();
  let managedPromise;
  const rawPromise = new Promise((resolve, reject) => {
    let request;
    let settled = false;
    const resolveOnce = (value) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    const rejectOnce = (error) => {
      if (!settled) {
        settled = true;
        reject(normalizeError(error, 'DATABASE_OPEN_FAILED'));
      }
    };
    try {
      request = api.open(DB_NAME, DB_VERSION);
    } catch (error) {
      rejectOnce(error);
      return;
    }
    request.onupgradeneeded = () => {
      try {
        upgradeDatabase(request.result, request.transaction);
      } catch (error) {
        try {
          request.transaction?.abort();
        } catch (abortError) {
          rejectOnce(abortError);
        }
        rejectOnce(error);
      }
    };
    request.onblocked = () => rejectOnce(new StorageError('DATABASE_BLOCKED', 'The database is blocked by another connection'));
    request.onerror = () => rejectOnce(request.error || new Error('IndexedDB open failed'));
    request.onsuccess = () => {
      const database = request.result;
      if (settled) {
        database.close();
        return;
      }
      database.onversionchange = () => {
        database.close();
        if (databasePromise === managedPromise) {
          databasePromise = undefined;
        }
      };
      resolveOnce(database);
    };
  });
  managedPromise = rawPromise.catch((error) => {
    if (databasePromise === managedPromise) {
      databasePromise = undefined;
    }
    throw normalizeError(error);
  });
  databasePromise = managedPromise;
  return managedPromise;
}

export async function initStorage() {
  const database = await openDatabase();
  const existing = await getById(SETTINGS_STORE, 'app');
  if (!existing) {
    await put(SETTINGS_STORE, defaultSettings());
  }
  return database;
}

export function requestToPromise(request) {
  if (!request || typeof request !== 'object') {
    return Promise.reject(new StorageError('INVALID_REQUEST', 'An IndexedDB request is required'));
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const succeed = () => {
      if (!settled) {
        settled = true;
        resolve(request.result);
      }
    };
    const fail = (error) => {
      if (!settled) {
        settled = true;
        reject(normalizeError(error, 'REQUEST_FAILED'));
      }
    };
    if (typeof request.addEventListener === 'function') {
      request.addEventListener('success', succeed, { once: true });
      request.addEventListener('error', () => fail(request.error), { once: true });
      request.addEventListener('abort', () => fail(request.error || new Error('The request was aborted')), { once: true });
    } else {
      request.onsuccess = succeed;
      request.onerror = () => fail(request.error);
      request.onabort = () => fail(request.error || new Error('The request was aborted'));
    }
  });
}

export function transactionDone(transaction) {
  if (!transaction || typeof transaction !== 'object') {
    return Promise.reject(new StorageError('INVALID_TRANSACTION', 'An IndexedDB transaction is required'));
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const succeed = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    const fail = (error) => {
      if (!settled) {
        settled = true;
        reject(normalizeError(error, 'TRANSACTION_FAILED'));
      }
    };
    if (typeof transaction.addEventListener === 'function') {
      transaction.addEventListener('complete', succeed, { once: true });
      transaction.addEventListener('error', () => fail(transaction.error), { once: true });
      transaction.addEventListener('abort', () => fail(transaction.error || new Error('The transaction was aborted')), { once: true });
    } else {
      transaction.oncomplete = succeed;
      transaction.onerror = () => fail(transaction.error);
      transaction.onabort = () => fail(transaction.error || new Error('The transaction was aborted'));
    }
  });
}

export async function withTransaction(storeNames, mode, callback) {
  let transactionMode = mode;
  let operation = callback;
  if (typeof transactionMode === 'function') {
    operation = transactionMode;
    transactionMode = 'readonly';
  }
  if (typeof operation !== 'function') {
    throw new StorageError('INVALID_TRANSACTION_CALLBACK', 'A transaction callback is required');
  }
  const names = (Array.isArray(storeNames) ? storeNames : [storeNames]).map(assertStoreName);
  if (names.length === 0) {
    throw new StorageError('INVALID_TRANSACTION', 'At least one object store is required');
  }
  if (!['readonly', 'readwrite', 'versionchange'].includes(transactionMode)) {
    throw new StorageError('INVALID_TRANSACTION_MODE', 'The transaction mode is invalid');
  }
  const database = await openDatabase();
  let transaction;
  try {
    transaction = database.transaction(names, transactionMode);
  } catch (error) {
    throw normalizeError(error, 'TRANSACTION_START_FAILED');
  }
  const completion = transactionDone(transaction);
  try {
    const result = await operation(transaction);
    await completion;
    return result;
  } catch (error) {
    try {
      transaction.abort();
    } catch {
      await completion.catch(() => undefined);
    }
    await completion.catch(() => undefined);
    throw error instanceof StorageError ? error : normalizeError(error, 'TRANSACTION_FAILED');
  }
}

export const runTransaction = withTransaction;
export const request = requestToPromise;
export const transaction = withTransaction;

function validateRecord(record, storeName) {
  if (!isObject(record)) {
    throw new StorageError('INVALID_RECORD', `A record for ${storeName} must be an object`);
  }
  if (record.id === undefined || record.id === null || record.id === '') {
    throw new StorageError('INVALID_RECORD_ID', `A record for ${storeName} must have an id`);
  }
  return record;
}

export async function getAll(storeName) {
  const name = assertStoreName(storeName);
  return withTransaction(name, 'readonly', (transaction) => requestToPromise(transaction.objectStore(name).getAll()));
}

export async function getById(storeName, id) {
  const name = assertStoreName(storeName);
  if (id === undefined || id === null || id === '') {
    throw new StorageError('INVALID_RECORD_ID', 'A record id is required');
  }
  return withTransaction(name, 'readonly', (transaction) => requestToPromise(transaction.objectStore(name).get(id)));
}

export async function put(storeName, record) {
  const name = assertStoreName(storeName);
  const value = validateRecord(record, name);
  await withTransaction(name, 'readwrite', (transaction) => requestToPromise(transaction.objectStore(name).put(value)));
  return value;
}

export async function remove(storeName, id) {
  const name = assertStoreName(storeName);
  if (id === undefined || id === null || id === '') {
    throw new StorageError('INVALID_RECORD_ID', 'A record id is required');
  }
  await withTransaction(name, 'readwrite', (transaction) => requestToPromise(transaction.objectStore(name).delete(id)));
  return id;
}

export async function clearStore(storeName) {
  const name = assertStoreName(storeName);
  await withTransaction(name, 'readwrite', (transaction) => requestToPromise(transaction.objectStore(name).clear()));
  return true;
}

export async function count(storeName) {
  const name = assertStoreName(storeName);
  return withTransaction(name, 'readonly', (transaction) => requestToPromise(transaction.objectStore(name).count()));
}

function defaultSettings() {
  return {
    id: 'app',
    language: 'ar',
    theme: 'light',
    autoLockMinutes: 5,
    passwordGeneratorDefaults: {
      length: 16,
      uppercase: true,
      lowercase: true,
      numbers: true,
      symbols: true,
      excludeAmbiguous: false
    },
    driveSync: {
      enabled: false,
      lastSyncAt: null,
      fileId: ''
    },
    backup: {
      lastExportAt: null,
      lastChangedAt: null,
      formatVersion: 1
    }
  };
}

function mergeObjects(base, extra) {
  if (!isObject(extra)) {
    return base;
  }
  const result = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
      continue;
    }
    if (isObject(value) && isObject(result[key])) {
      result[key] = mergeObjects(result[key], value);
    } else if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

export function getDefaultSettings() {
  return defaultSettings();
}

export async function getSetting(key) {
  const record = await getById(SETTINGS_STORE, 'app');
  const settings = mergeObjects(defaultSettings(), isObject(record) ? record : {});
  settings.id = 'app';
  if (typeof key === 'string') {
    let value = settings;
    for (const part of key.split('.')) {
      if (!isObject(value) || !Object.prototype.hasOwnProperty.call(value, part)) {
        return undefined;
      }
      value = value[part];
    }
    return value;
  }
  return settings;
}

export function saveSetting(settingsOrKey, value) {
  const operation = settingsMutationQueue.catch(() => undefined).then(async () => {
    if (typeof settingsOrKey !== 'string' && !isObject(settingsOrKey)) {
      throw new StorageError('INVALID_SETTINGS', 'Settings must be an object');
    }
    const parts = typeof settingsOrKey === 'string'
      ? settingsOrKey.split('.').filter(Boolean)
      : [];
    if (typeof settingsOrKey === 'string' && (parts.length === 0 || parts.some((part) => part === '__proto__' || part === 'prototype' || part === 'constructor'))) {
      throw new StorageError('INVALID_SETTING_KEY', 'The setting key is invalid');
    }
    return withTransaction(SETTINGS_STORE, 'readwrite', async (transaction) => {
      const objectStore = transaction.objectStore(SETTINGS_STORE);
      const currentRecord = await requestToPromise(objectStore.get('app'));
      const current = mergeObjects(defaultSettings(), isObject(currentRecord) ? currentRecord : {});
      let next = current;
      if (typeof settingsOrKey === 'string') {
        next = { ...current };
        let target = next;
        for (let index = 0; index < parts.length - 1; index += 1) {
          const part = parts[index];
          if (!isObject(target[part])) {
            target[part] = {};
          }
          target = target[part];
        }
        target[parts[parts.length - 1]] = value;
      } else {
        next = mergeObjects(current, settingsOrKey);
      }
      next.id = 'app';
      await requestToPromise(objectStore.put(next));
      return next;
    });
  });
  settingsMutationQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

export async function createBackupPayload() {
  let stores;
  await withTransaction(BACKUP_STORE_NAMES, 'readonly', async (transaction) => {
    const requests = BACKUP_STORE_NAMES.map((storeName) => requestToPromise(transaction.objectStore(storeName).getAll()));
    const values = await Promise.all(requests);
    stores = Object.fromEntries(BACKUP_STORE_NAMES.map((storeName, index) => [storeName, values[index]]));
  });
  return {
    format: 'hsa-notes-backup',
    version: 1,
    createdAt: new Date().toISOString(),
    stores
  };
}

function parseBackupPayload(payload) {
  let value = payload;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch (error) {
      throw new StorageError('INVALID_BACKUP', 'The backup payload is not valid JSON', error);
    }
  }
  if (!isObject(value) || (value.format !== undefined && value.format !== 'hsa-notes-backup')) {
    throw new StorageError('INVALID_BACKUP', 'The backup payload is invalid');
  }
  const source = isObject(value.stores) ? value.stores : isObject(value.data) ? value.data : null;
  if (!source) {
    throw new StorageError('INVALID_BACKUP', 'The backup payload has no stores');
  }
  const stores = {};
  for (const storeName of BACKUP_STORE_NAMES) {
    const records = source[storeName] === undefined ? [] : source[storeName];
    if (!Array.isArray(records)) {
      throw new StorageError('INVALID_BACKUP', `The backup store ${storeName} is invalid`);
    }
    const ids = new Set();
    stores[storeName] = records.map((record) => {
      if (!isObject(record)) {
        throw new StorageError('INVALID_BACKUP', `The backup store ${storeName} is invalid`);
      }
      const copy = { ...record };
      const id = String(copy.id ?? '');
      if (!id || ids.has(id)) {
        throw new StorageError('INVALID_BACKUP', `The backup store ${storeName} contains duplicate or invalid IDs`);
      }
      ids.add(id);
      for (const field of SENSITIVE_FIELDS[storeName] || []) {
        if (!envelopeLike(copy[field])) {
          throw new StorageError('INVALID_BACKUP', `The backup store ${storeName} contains an unencrypted sensitive field`);
        }
      }
      if (storeName === SETTINGS_STORE) {
        copy.id = 'app';
      }
      if (storeName === AUTH_VAULT_STORE) {
        copy.id = 'vault';
      }
      return validateRecord(copy, storeName);
    });
  }
  return stores;
}

export async function restoreBackupPayload(payload) {
  const stores = parseBackupPayload(payload);
  const counts = {};
  await withTransaction(BACKUP_STORE_NAMES, 'readwrite', async (transaction) => {
    const requests = [];
    for (const storeName of BACKUP_STORE_NAMES) {
      const objectStore = transaction.objectStore(storeName);
      requests.push(requestToPromise(objectStore.clear()));
      for (const record of stores[storeName]) {
        requests.push(requestToPromise(objectStore.put(record)));
      }
      counts[storeName] = stores[storeName].length;
    }
    await Promise.all(requests);
  });
  return { restored: true, counts };
}

export async function clearUserData(options = {}) {
  const preserveSettings = options === true || (isObject(options) && options.preserveSettings === true);
  const names = preserveSettings ? STORE_NAMES.filter((name) => name !== SETTINGS_STORE) : STORE_NAMES;
  await withTransaction(names, 'readwrite', async (transaction) => {
    await Promise.all(names.map((storeName) => requestToPromise(transaction.objectStore(storeName).clear())));
  });
  return true;
}

export async function getRecentActivity(limit = 10) {
  if (!Number.isInteger(limit) || limit < 0 || limit > 100) {
    throw new StorageError('INVALID_LIMIT', 'The activity limit must be between 0 and 100');
  }
  if (limit === 0) {
    return [];
  }
  const records = [];
  const activityStores = [API_KEY_STORE, CREDENTIAL_STORE, NOTES_STORE];
  const snapshots = await withTransaction(activityStores, 'readonly', async (transaction) => {
    const values = await Promise.all(activityStores.map((storeName) => requestToPromise(transaction.objectStore(storeName).getAll())));
    return Object.fromEntries(activityStores.map((storeName, index) => [storeName, values[index]]));
  });
  for (const storeName of activityStores) {
    for (const record of snapshots[storeName]) {
      if (!isObject(record)) {
        continue;
      }
      const updatedAt = typeof record.updatedAt === 'string' ? record.updatedAt : '';
      const createdAt = typeof record.createdAt === 'string' ? record.createdAt : '';
      records.push({
        id: record.id,
        store: storeName,
        type: storeName,
        title: typeof record.title === 'string' ? record.title : typeof record.siteName === 'string' ? record.siteName : '',
        updatedAt,
        createdAt,
        action: updatedAt || createdAt ? 'updated' : 'created'
      });
    }
  }
  return records
    .sort((left, right) => {
      const leftTime = Date.parse(left.updatedAt || left.createdAt || '') || 0;
      const rightTime = Date.parse(right.updatedAt || right.createdAt || '') || 0;
      return rightTime - leftTime;
    })
    .slice(0, limit);
}

function envelopeLike(value) {
  if (isObject(value)) {
    return value.v === 1 && typeof value.iv === 'string' && typeof value.data === 'string';
  }
  if (typeof value !== 'string') {
    return false;
  }
  try {
    const parsed = JSON.parse(value);
    return isObject(parsed) && parsed.v === 1 && typeof parsed.iv === 'string' && typeof parsed.data === 'string';
  } catch {
    return false;
  }
}

function recordsMatch(current, snapshot) {
  if (current.length !== snapshot.length) {
    return false;
  }
  const snapshotById = new Map(snapshot.map((record) => [String(record.id), record]));
  for (const record of current) {
    const previous = snapshotById.get(String(record.id));
    if (!previous || JSON.stringify(previous) !== JSON.stringify(record)) {
      return false;
    }
  }
  return true;
}

function vaultMatches(current, expected) {
  if (!expected) {
    return true;
  }
  if (!current) {
    return false;
  }
  return current.id === expected.id && current.updatedAt === expected.updatedAt && current.salt === expected.salt && JSON.stringify(current.verificationHash) === JSON.stringify(expected.verificationHash);
}

export async function reencryptSensitiveData(oldKey, newKey, options = {}) {
  assertCryptoAvailable();
  const settings = isObject(options) ? options : {};
  const requestedStores = Array.isArray(settings.stores) ? settings.stores : [API_KEY_STORE, CREDENTIAL_STORE, NOTES_STORE];
  const stores = requestedStores.map(assertStoreName).filter((storeName) => SENSITIVE_FIELDS[storeName]);
  const vault = settings.vault;
  const expectedVault = settings.expectedVault;
  const snapshots = {};
  const transformed = {};
  for (const storeName of stores) {
    const records = await getAll(storeName);
    snapshots[storeName] = records;
    transformed[storeName] = [];
    for (const record of records) {
      const next = { ...record };
      for (const field of SENSITIVE_FIELDS[storeName]) {
        const value = record[field];
        if (value === undefined || value === null) {
          continue;
        }
        const objectEnvelope = isObject(value) && envelopeLike(value);
        if (typeof value !== 'string' && !objectEnvelope) {
          throw new StorageError('INVALID_SENSITIVE_FIELD', `The sensitive field ${field} must be a string or encrypted envelope`);
        }
        let plaintext = value;
        if (objectEnvelope || envelopeLike(value)) {
          try {
            const envelope = objectEnvelope ? value : JSON.parse(value);
            plaintext = await decryptText(envelope, oldKey, settings.aad);
          } catch (error) {
            throw new StorageError('SENSITIVE_DATA_DECRYPTION_FAILED', `The sensitive field ${field} could not be decrypted`, error);
          }
        }
        try {
          next[field] = await encryptText(plaintext, newKey, settings.aad);
        } catch (error) {
          throw new StorageError('SENSITIVE_DATA_ENCRYPTION_FAILED', `The sensitive field ${field} could not be encrypted`, error);
        }
      }
      transformed[storeName].push(next);
    }
  }
  const writeStores = vault ? [...stores, AUTH_VAULT_STORE] : stores;
  if (writeStores.length === 0 && !vault) {
    return { updated: 0, stores: {} };
  }
  let updated = 0;
  await withTransaction(writeStores, 'readwrite', async (transaction) => {
    const currentValues = await Promise.all(stores.map((storeName) => requestToPromise(transaction.objectStore(storeName).getAll())));
    const currentByStore = Object.fromEntries(stores.map((storeName, index) => [storeName, currentValues[index]]));
    for (const storeName of stores) {
      if (!recordsMatch(currentByStore[storeName], snapshots[storeName])) {
        throw new StorageError('STORAGE_CONFLICT', 'The data changed while it was being re-encrypted');
      }
    }
    const vaultStore = vault ? transaction.objectStore(AUTH_VAULT_STORE) : null;
    const currentVault = vaultStore ? requestToPromise(vaultStore.get('vault')) : Promise.resolve(undefined);
    const [vaultValue] = await Promise.all([currentVault]);
    if (vault && !vaultMatches(vaultValue, expectedVault)) {
      throw new StorageError('STORAGE_CONFLICT', 'The vault changed while it was being updated');
    }
    const requests = [];
    for (const storeName of stores) {
      const objectStore = transaction.objectStore(storeName);
      for (const record of transformed[storeName]) {
        requests.push(requestToPromise(objectStore.put(record)));
        updated += 1;
      }
    }
    if (vault) {
      requests.push(requestToPromise(vaultStore.put(vault)));
    }
    await Promise.all(requests);
  });
  return { updated, stores: Object.fromEntries(stores.map((storeName) => [storeName, transformed[storeName].length])) };
}
