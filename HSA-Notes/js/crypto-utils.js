const DEFAULT_ITERATIONS = 310000;
const MIN_ITERATIONS = 310000;
const MAX_ITERATIONS = 10000000;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const MAX_RANDOM_BYTES = 1048576;
const MAX_ENVELOPE_BYTES = 104857600;
const VAULT_VERIFICATION_MARKER = 'HSA_NOTES_VAULT_VERIFIER_V1';
const ENVELOPE_KEYS = new Set(['v', 'iv', 'data']);

export class CryptoError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = 'CryptoError';
    this.code = code;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

function cryptoApi() {
  const value = globalThis.crypto;
  if (!value || !value.subtle || typeof value.getRandomValues !== 'function') {
    throw new CryptoError('CRYPTO_UNAVAILABLE', 'Web Crypto API is unavailable');
  }
  return value;
}

function encoder() {
  if (typeof TextEncoder !== 'function') {
    throw new CryptoError('TEXT_ENCODER_UNAVAILABLE', 'TextEncoder is unavailable');
  }
  return new TextEncoder();
}

function decoder() {
  if (typeof TextDecoder !== 'function') {
    throw new CryptoError('TEXT_DECODER_UNAVAILABLE', 'TextDecoder is unavailable');
  }
  return new TextDecoder('utf-8', { fatal: true });
}

function bytesFrom(value, code = 'INVALID_BYTES') {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new CryptoError(code, 'A byte array is required');
}

function assertSalt(salt) {
  const bytes = bytesFrom(salt, 'INVALID_SALT');
  if (bytes.byteLength !== SALT_LENGTH) {
    throw new CryptoError('INVALID_SALT', 'The salt must be exactly 16 bytes');
  }
  return bytes;
}

function base64Encode(bytes) {
  const view = bytesFrom(bytes, 'INVALID_BYTES');
  const browserApi = globalThis.btoa;
  if (typeof browserApi === 'function') {
    let binary = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < view.byteLength; offset += chunkSize) {
      const chunk = view.subarray(offset, Math.min(offset + chunkSize, view.byteLength));
      for (let index = 0; index < chunk.byteLength; index += 1) {
        binary += String.fromCharCode(chunk[index]);
      }
    }
    return browserApi(binary);
  }
  const nodeBuffer = globalThis.Buffer;
  if (nodeBuffer && typeof nodeBuffer.from === 'function') {
    return nodeBuffer.from(view).toString('base64');
  }
  throw new CryptoError('BASE64_UNAVAILABLE', 'Base64 encoding is unavailable');
}

function base64Decode(value) {
  if (typeof value !== 'string' || value.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new CryptoError('INVALID_BASE64', 'The Base64 value is invalid');
  }
  const browserApi = globalThis.atob;
  let binary;
  if (typeof browserApi === 'function') {
    try {
      const padded = value + '='.repeat((4 - (value.length % 4)) % 4);
      binary = browserApi(padded);
    } catch (error) {
      throw new CryptoError('INVALID_BASE64', 'The Base64 value is invalid', error);
    }
  } else {
    const nodeBuffer = globalThis.Buffer;
    if (!nodeBuffer || typeof nodeBuffer.from !== 'function') {
      throw new CryptoError('BASE64_UNAVAILABLE', 'Base64 decoding is unavailable');
    }
    try {
      binary = nodeBuffer.from(value, 'base64').toString('binary');
    } catch (error) {
      throw new CryptoError('INVALID_BASE64', 'The Base64 value is invalid', error);
    }
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  const canonicalInput = value.replace(/=+$/, '');
  const canonicalOutput = base64Encode(bytes).replace(/=+$/, '');
  if (canonicalInput !== canonicalOutput) {
    throw new CryptoError('INVALID_BASE64', 'The Base64 value is invalid');
  }
  return bytes;
}

function normalizeAad(aad) {
  if (aad === undefined || aad === null) {
    return undefined;
  }
  if (typeof aad === 'string') {
    return encoder().encode(aad);
  }
  return bytesFrom(aad, 'INVALID_AAD');
}

function validateKey(key, requiredUsage) {
  if (!key || typeof key !== 'object') {
    throw new CryptoError('INVALID_KEY', 'A CryptoKey is required');
  }
  if (key.algorithm && (key.algorithm.name !== 'AES-GCM' || (key.algorithm.length !== undefined && key.algorithm.length !== 256))) {
    throw new CryptoError('INVALID_KEY', 'The key must be an AES-GCM 256-bit key');
  }
  if (Array.isArray(key.usages) && !key.usages.includes(requiredUsage)) {
    throw new CryptoError('INVALID_KEY', 'The key does not support the required operation');
  }
}

function normalizeIterations(iterations) {
  if (iterations === undefined) {
    return DEFAULT_ITERATIONS;
  }
  if (!Number.isInteger(iterations) || iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) {
    throw new CryptoError('INVALID_ITERATIONS', `PBKDF2 iterations must be between ${MIN_ITERATIONS} and ${MAX_ITERATIONS}`);
  }
  return iterations;
}

function validateEnvelope(envelope) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    throw new CryptoError('INVALID_ENVELOPE', 'The encrypted envelope is invalid');
  }
  const keys = Object.keys(envelope);
  if (keys.length !== ENVELOPE_KEYS.size || keys.some((key) => !ENVELOPE_KEYS.has(key))) {
    throw new CryptoError('INVALID_ENVELOPE', 'The encrypted envelope is invalid');
  }
  if (envelope.v !== 1 || typeof envelope.iv !== 'string' || typeof envelope.data !== 'string') {
    throw new CryptoError('INVALID_ENVELOPE', 'The encrypted envelope is invalid');
  }
  const iv = base64Decode(envelope.iv);
  const data = base64Decode(envelope.data);
  if (iv.byteLength !== IV_LENGTH) {
    throw new CryptoError('INVALID_ENVELOPE', 'The encrypted envelope IV is invalid');
  }
  if (data.byteLength < AUTH_TAG_LENGTH || data.byteLength > MAX_ENVELOPE_BYTES) {
    throw new CryptoError('INVALID_ENVELOPE', 'The encrypted envelope data is invalid');
  }
  return { v: 1, iv, data };
}

export function isCryptoAvailable() {
  try {
    const value = globalThis.crypto;
    return Boolean(value && value.subtle && typeof value.getRandomValues === 'function' && typeof TextEncoder === 'function' && typeof TextDecoder === 'function');
  } catch {
    return false;
  }
}

export function randomBytes(length) {
  if (!Number.isInteger(length) || length < 0 || length > MAX_RANDOM_BYTES) {
    throw new CryptoError('INVALID_LENGTH', 'The requested random byte length is invalid');
  }
  const result = new Uint8Array(length);
  if (length === 0) {
    return result;
  }
  const api = cryptoApi();
  const chunkSize = 65536;
  for (let offset = 0; offset < length; offset += chunkSize) {
    api.getRandomValues(result.subarray(offset, Math.min(offset + chunkSize, length)));
  }
  return result;
}

export function bytesToBase64(bytes) {
  return base64Encode(bytes);
}

export function base64ToBytes(value) {
  return base64Decode(value);
}

export async function deriveMasterKey(password, salt, iterations = DEFAULT_ITERATIONS) {
  if (typeof password !== 'string' || password.length === 0) {
    throw new CryptoError('INVALID_PASSWORD', 'A non-empty password is required');
  }
  const saltBytes = assertSalt(salt);
  const count = normalizeIterations(iterations);
  const api = cryptoApi();
  let keyMaterial;
  try {
    keyMaterial = await api.subtle.importKey(
      'raw',
      encoder().encode(password),
      'PBKDF2',
      false,
      ['deriveKey']
    );
    return await api.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: saltBytes,
        iterations: count,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  } catch (error) {
    if (error instanceof CryptoError) {
      throw error;
    }
    throw new CryptoError('KEY_DERIVATION_FAILED', 'The encryption key could not be derived', error);
  }
}

export async function encryptText(plaintext, key, aad) {
  if (typeof plaintext !== 'string') {
    throw new CryptoError('INVALID_PLAINTEXT', 'Plaintext must be a string');
  }
  validateKey(key, 'encrypt');
  const api = cryptoApi();
  const iv = randomBytes(IV_LENGTH);
  const additionalData = normalizeAad(aad);
  const params = {
    name: 'AES-GCM',
    iv,
    ...(additionalData === undefined ? {} : { additionalData })
  };
  let encrypted;
  try {
    encrypted = new Uint8Array(await api.subtle.encrypt(params, key, encoder().encode(plaintext)));
  } catch (error) {
    if (error instanceof CryptoError) {
      throw error;
    }
    throw new CryptoError('ENCRYPTION_FAILED', 'The text could not be encrypted', error);
  }
  return {
    v: 1,
    iv: bytesToBase64(iv),
    data: bytesToBase64(encrypted)
  };
}

export async function decryptText(envelope, key, aad) {
  let normalizedEnvelope = envelope;
  if (typeof normalizedEnvelope === 'string') {
    try {
      normalizedEnvelope = JSON.parse(normalizedEnvelope);
    } catch (error) {
      throw new CryptoError('INVALID_ENVELOPE', 'The encrypted envelope is invalid', error);
    }
  }
  const validated = validateEnvelope(normalizedEnvelope);
  validateKey(key, 'decrypt');
  const api = cryptoApi();
  const additionalData = normalizeAad(aad);
  const params = {
    name: 'AES-GCM',
    iv: validated.iv,
    ...(additionalData === undefined ? {} : { additionalData })
  };
  let decrypted;
  try {
    decrypted = await api.subtle.decrypt(params, key, new Uint8Array(validated.data));
  } catch (error) {
    throw new CryptoError('DECRYPTION_FAILED', 'The encrypted text could not be decrypted', error);
  }
  try {
    return decoder().decode(decrypted);
  } catch (error) {
    throw new CryptoError('INVALID_PLAINTEXT_ENCODING', 'The decrypted text is not valid UTF-8', error);
  }
}

export async function createVaultVerifier(key) {
  return encryptText(VAULT_VERIFICATION_MARKER, key);
}

export async function verifyVault(verifier, key) {
  let envelope = verifier;
  if (typeof verifier === 'string') {
    try {
      envelope = JSON.parse(verifier);
    } catch {
      return false;
    }
  }
  try {
    const value = await decryptText(envelope, key);
    return value === VAULT_VERIFICATION_MARKER;
  } catch {
    return false;
  }
}

export { VAULT_VERIFICATION_MARKER };
