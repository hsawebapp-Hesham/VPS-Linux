import { getMasterKey } from './auth.js';
import { decryptText, encryptText } from './crypto-utils.js';
import { t } from './i18n.js';
import {
  API_KEY_STORE,
  CREDENTIAL_STORE,
  NOTES_STORE,
  SETTINGS_STORE,
  createBackupPayload,
  getDefaultSettings,
  getSetting,
  requestToPromise,
  saveSetting,
  withTransaction
} from './storage.js';
import {
  escapeHTML,
  formatDate,
  icon,
  setButtonLoading,
  showToast
} from './ui.js';

export const BACKUP_FORMAT = 'hsa-notes-backup';
export const BACKUP_VERSION = 1;
export const BACKUP_MIME_TYPE = 'application/json';
const DATA_STORES = Object.freeze([API_KEY_STORE, CREDENTIAL_STORE, NOTES_STORE]);
const RESTORE_STORES = Object.freeze([...DATA_STORES, SETTINGS_STORE]);
const MAX_BACKUP_BYTES = 25 * 1024 * 1024;
const SENSITIVE_FIELDS = Object.freeze({
  [API_KEY_STORE]: Object.freeze(['keyValue']),
  [CREDENTIAL_STORE]: Object.freeze(['username', 'password']),
  [NOTES_STORE]: Object.freeze(['contentHtml'])
});
let backupState = createDefaultBackupState();
let stateReadPromise;
let activeContainer;
let renderGeneration = 0;
let cleanup = () => undefined;

export class BackupError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = 'BackupError';
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function createDefaultBackupState() {
  return {
    lastExportAt: null,
    lastChangedAt: null,
    formatVersion: BACKUP_VERSION
  };
}

function normalizeTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
}

function normalizeBackupState(value, fallback = null) {
  const source = isObject(value) ? value : {};
  return {
    lastExportAt: normalizeTimestamp(source.lastExportAt) || normalizeTimestamp(fallback?.lastSyncAt),
    lastChangedAt: normalizeTimestamp(source.lastChangedAt),
    formatVersion: Number(source.formatVersion) === BACKUP_VERSION ? BACKUP_VERSION : BACKUP_VERSION
  };
}

async function readBackupState() {
  if (stateReadPromise) {
    return stateReadPromise;
  }
  stateReadPromise = (async () => {
    try {
      const settings = await getSetting();
      backupState = normalizeBackupState(settings.backup, settings.driveSync);
    } catch {
      backupState = createDefaultBackupState();
    }
    return { ...backupState };
  })();
  try {
    return await stateReadPromise;
  } finally {
    stateReadPromise = undefined;
  }
}

export async function getBackupState() {
  return readBackupState();
}

export async function refreshBackupState() {
  stateReadPromise = undefined;
  return readBackupState();
}

function dispatch(name, detail) {
  const EventApi = globalThis.CustomEvent;
  if (typeof EventApi === 'function' && typeof globalThis.dispatchEvent === 'function') {
    globalThis.dispatchEvent(new EventApi(name, detail === undefined ? undefined : { detail }));
  }
}

export async function markBackupExported() {
  const exportedAt = new Date().toISOString();
  await saveSetting('backup.lastExportAt', exportedAt);
  backupState = { ...backupState, lastExportAt: exportedAt };
  dispatch('hsa-page-refresh');
  return backupState;
}

export async function notifyDataChanged() {
  const changedAt = new Date().toISOString();
  try {
    await saveSetting('backup.lastChangedAt', changedAt);
    backupState = { ...backupState, lastChangedAt: changedAt };
  } catch {
    backupState = { ...backupState, lastChangedAt: changedAt };
  }
  dispatch('hsa-data-changed', { backup: true });
  dispatch('hsa-page-refresh');
  return backupState;
}

function isEncryptedEnvelope(value) {
  return isObject(value) && value.v === 1 && typeof value.iv === 'string' && typeof value.data === 'string';
}

function cloneJson(value) {
  if (typeof globalThis.structuredClone === 'function') {
    try {
      return globalThis.structuredClone(value);
    } catch {
      return JSON.parse(JSON.stringify(value));
    }
  }
  return JSON.parse(JSON.stringify(value));
}

function normalizeGeneratorDefaults(value) {
  const defaults = getDefaultSettings().passwordGeneratorDefaults;
  const source = isObject(value) ? value : {};
  const length = Number(source.length);
  return {
    length: Number.isInteger(length) && length >= 4 && length <= 64 ? length : defaults.length,
    uppercase: typeof source.uppercase === 'boolean' ? source.uppercase : defaults.uppercase,
    lowercase: typeof source.lowercase === 'boolean' ? source.lowercase : defaults.lowercase,
    numbers: typeof source.numbers === 'boolean' ? source.numbers : defaults.numbers,
    symbols: typeof source.symbols === 'boolean' ? source.symbols : defaults.symbols,
    excludeAmbiguous: typeof source.excludeAmbiguous === 'boolean' ? source.excludeAmbiguous : defaults.excludeAmbiguous
  };
}

function normalizeSafeSettings(record) {
  const defaults = getDefaultSettings();
  const source = isObject(record) ? record : {};
  const autoLockMinutes = Number(source.autoLockMinutes);
  return {
    id: 'app',
    language: source.language === 'en' || source.language === 'ar' ? source.language : defaults.language,
    theme: source.theme === 'dark' || source.theme === 'light' ? source.theme : defaults.theme,
    autoLockMinutes: [0, 5, 10, 15, 30].includes(autoLockMinutes) ? autoLockMinutes : defaults.autoLockMinutes,
    passwordGeneratorDefaults: normalizeGeneratorDefaults(source.passwordGeneratorDefaults)
  };
}

function normalizeRecord(record, storeName) {
  if (!isObject(record)) {
    throw new BackupError('BACKUP_INVALID_RECORD', 'The backup contains an invalid record');
  }
  const id = record.id;
  if ((typeof id !== 'string' && typeof id !== 'number') || String(id).length === 0) {
    throw new BackupError('BACKUP_INVALID_RECORD', 'The backup contains an invalid record');
  }
  return cloneJson(record);
}

function normalizeStoreRecords(records, storeName) {
  if (!Array.isArray(records) || records.length > 20000) {
    throw new BackupError('BACKUP_INVALID_STORE', 'The backup contains invalid store data');
  }
  const ids = new Set();
  return records.map((record) => {
    const normalized = normalizeRecord(record, storeName);
    const id = String(normalized.id);
    if (ids.has(id)) {
      throw new BackupError('BACKUP_DUPLICATE_ID', 'The backup contains duplicate record IDs');
    }
    ids.add(id);
    for (const field of SENSITIVE_FIELDS[storeName] || []) {
      if (!isEncryptedEnvelope(normalized[field])) {
        throw new BackupError('BACKUP_UNENCRYPTED_FIELD', `The backup contains an unencrypted ${field}`);
      }
    }
    return normalized;
  });
}

export function validateBackupPayload(payload) {
  if (!isObject(payload) || payload.format !== BACKUP_FORMAT || payload.version !== BACKUP_VERSION || !isObject(payload.stores)) {
    throw new BackupError('BACKUP_INVALID_FORMAT', 'The backup format is invalid');
  }
  if (Object.prototype.hasOwnProperty.call(payload.stores, 'authVault')) {
    throw new BackupError('BACKUP_AUTH_PRESENT', 'The backup must not contain an authentication vault');
  }
  const stores = {};
  for (const storeName of DATA_STORES) {
    stores[storeName] = normalizeStoreRecords(payload.stores[storeName], storeName);
  }
  if (!Array.isArray(payload.stores[SETTINGS_STORE]) || payload.stores[SETTINGS_STORE].length > 1) {
    throw new BackupError('BACKUP_INVALID_SETTINGS', 'The backup settings are invalid');
  }
  const settingsRecord = payload.stores[SETTINGS_STORE][0] || getDefaultSettings();
  stores[SETTINGS_STORE] = [normalizeSafeSettings(settingsRecord)];
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: normalizeTimestamp(payload.createdAt),
    lastChangedAt: normalizeTimestamp(payload.lastChangedAt),
    stores
  };
}

function dataTimestamp(payload) {
  let latest = 0;
  for (const storeName of DATA_STORES) {
    for (const record of payload.stores[storeName] || []) {
      for (const field of ['updatedAt', 'createdAt']) {
        const value = Date.parse(record[field]);
        if (Number.isFinite(value)) {
          latest = Math.max(latest, value);
        }
      }
    }
  }
  return latest;
}

function buildSnapshot(payload, state, createdAt = new Date().toISOString()) {
  const validated = validateBackupPayload(payload);
  const inferred = dataTimestamp(validated);
  const lastChanged = normalizeTimestamp(state.lastChangedAt) || (inferred > 0 ? new Date(inferred).toISOString() : createdAt);
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: normalizeTimestamp(validated.createdAt) || createdAt,
    lastChangedAt: lastChanged,
    stores: validated.stores
  };
}

function requireMasterKey() {
  const key = getMasterKey();
  if (!key) {
    throw new BackupError('BACKUP_LOCKED', 'The vault is locked');
  }
  return key;
}

export async function createEncryptedBackupEnvelope(options = {}) {
  const key = requireMasterKey();
  const config = isObject(options) ? options : {};
  const state = config.state || await readBackupState();
  const payload = config.payload || await createBackupPayload();
  const snapshot = buildSnapshot(payload, state, normalizeTimestamp(config.createdAt) || new Date().toISOString());
  return encryptText(JSON.stringify(snapshot), key);
}

export async function decryptBackupEnvelope(envelope, key = getMasterKey(), options = {}) {
  if (!key) {
    throw new BackupError('BACKUP_DECRYPT_FAILED', 'The encrypted backup could not be decrypted');
  }
  let plaintext;
  try {
    plaintext = await decryptText(envelope, key);
  } catch {
    throw new BackupError('BACKUP_DECRYPT_FAILED', 'The encrypted backup could not be decrypted');
  }
  let payload;
  try {
    payload = JSON.parse(plaintext);
  } catch {
    throw new BackupError('BACKUP_INVALID_FORMAT', 'The backup format is invalid');
  }
  if (isObject(options) && options.requireNoAuth === true) {
    return validateBackupPayload(payload);
  }
  return validateBackupPayload(payload);
}

function getSettingsRecord(records) {
  return records.find((record) => isObject(record) && record.id === 'app') || records[0] || {};
}

export async function restoreSafeBackupPayload(payload) {
  const validated = validateBackupPayload(payload);
  const currentSettings = await getSetting();
  const safeSettings = getSettingsRecord(validated.stores[SETTINGS_STORE]);
  await withTransaction(RESTORE_STORES, 'readwrite', async (transaction) => {
    const requests = [];
    for (const storeName of DATA_STORES) {
      const objectStore = transaction.objectStore(storeName);
      requests.push(requestToPromise(objectStore.clear()));
      for (const record of validated.stores[storeName]) {
        requests.push(requestToPromise(objectStore.put(record)));
      }
    }
    const settingsStore = transaction.objectStore(SETTINGS_STORE);
    const settingsRequest = requestToPromise(settingsStore.get('app'));
    const [currentRecord] = await Promise.all([settingsRequest, ...requests]);
    const current = isObject(currentRecord) ? currentRecord : currentSettings;
    await requestToPromise(settingsStore.put({
      ...current,
      ...safeSettings,
      id: 'app',
      backup: current.backup || currentSettings.backup
    }));
  });
  await refreshBackupState();
  return {
    restored: true,
    counts: Object.fromEntries(DATA_STORES.map((storeName) => [storeName, validated.stores[storeName].length]))
  };
}

export function isFilePickerSupported() {
  return typeof globalThis.showSaveFilePicker === 'function';
}

function backupFilename(date = new Date()) {
  return `hsa-notes-encrypted-${date.toISOString().slice(0, 10)}.json`;
}

function downloadEncryptedEnvelope(content, filename) {
  const doc = globalThis.document;
  if (!doc?.body || typeof globalThis.Blob !== 'function' || !globalThis.URL?.createObjectURL) {
    throw new BackupError('BACKUP_DOWNLOAD_UNAVAILABLE', 'The browser cannot download the backup');
  }
  let objectUrl = '';
  try {
    const blob = new globalThis.Blob([content], { type: BACKUP_MIME_TYPE });
    objectUrl = globalThis.URL.createObjectURL(blob);
    const link = doc.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    link.style.display = 'none';
    doc.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    if (objectUrl) {
      setTimeout(() => globalThis.URL.revokeObjectURL(objectUrl), 0);
    }
  }
}

export async function exportEncryptedBackupFile(options = {}) {
  requireMasterKey();
  const config = isObject(options) ? options : {};
  const preferredName = config.filename || backupFilename();
  const preferPicker = config.preferPicker !== false;
  let fileHandle = null;
  if (preferPicker && isFilePickerSupported()) {
    try {
      fileHandle = await globalThis.showSaveFilePicker({
        suggestedName: preferredName,
        types: [{
          description: 'HSA Notes encrypted backup',
          accept: { [BACKUP_MIME_TYPE]: ['.json'] }
        }]
      });
    } catch (error) {
      if (error?.name === 'AbortError' || error?.code === 20) {
        return { cancelled: true, method: 'file-picker' };
      }
      throw new BackupError('BACKUP_PICKER_FAILED', 'The save dialog could not be opened');
    }
  }
  const envelope = await createEncryptedBackupEnvelope();
  const content = JSON.stringify(envelope);
  if (content.length > MAX_BACKUP_BYTES) {
    throw new BackupError('BACKUP_TOO_LARGE', 'The encrypted backup is too large');
  }
  if (fileHandle) {
    if (typeof fileHandle.createWritable !== 'function') {
      throw new BackupError('BACKUP_WRITE_FAILED', 'The selected destination cannot be written');
    }
    const writable = await fileHandle.createWritable();
    try {
      await writable.write(content);
      await writable.close();
    } catch (error) {
      try {
        await writable.abort?.();
      } catch {}
      throw new BackupError('BACKUP_WRITE_FAILED', 'The encrypted backup could not be saved', error);
    }
  } else {
    downloadEncryptedEnvelope(content, preferredName);
  }
  await markBackupExported();
  return {
    cancelled: false,
    method: fileHandle ? 'file-picker' : 'download',
    filename: fileHandle?.name || preferredName
  };
}

function resolveContainer(container) {
  if (typeof container === 'string') {
    return globalThis.document?.querySelector(container) || null;
  }
  return container?.nodeType === 1 ? container : null;
}

function backupPageMarkup(state) {
  const lastExport = state.lastExportAt ? formatDate(state.lastExportAt, { dateStyle: 'medium', timeStyle: 'short' }) : t('backup.neverExported');
  const pickerSupported = isFilePickerSupported();
  return `<section class="sync-page backup-page">
    <header class="feature-page-header">
      <div class="feature-page-header-copy">
        <h2>${escapeHTML(t('backup.title'))}</h2>
        <p>${escapeHTML(t('backup.subtitle'))}</p>
      </div>
      <a class="button button-secondary" href="#settings">${icon('settings')}<span>${escapeHTML(t('settings.title'))}</span></a>
    </header>
    <div class="sync-layout">
      <section class="card sync-hero">
        <span class="drive-mark">${icon('file-lock')}</span>
        <h3>${escapeHTML(t('backup.exportTitle'))}</h3>
        <p>${escapeHTML(t('backup.exportDescription'))}</p>
        <div class="sync-hero-actions">
          <button class="button button-primary" type="button" data-backup-export>${icon('google-drive')}<span>${escapeHTML(t('backup.chooseDrive'))}</span></button>
          <button class="button button-secondary" type="button" data-backup-download>${icon('download')}<span>${escapeHTML(t('backup.downloadFile'))}</span></button>
        </div>
      </section>
      <section class="card sync-status-card">
        <div class="sync-status">
          <span class="sync-status-icon">${icon('clock')}</span>
          <div class="sync-status-copy"><strong>${escapeHTML(t('backup.lastExport'))}</strong><small>${escapeHTML(t('backup.localOnly'))}</small></div>
        </div>
        <div class="sync-time">${icon('check-circle')}<span>${escapeHTML(t('backup.encryptedFile'))}</span><strong>${escapeHTML(t('common.yes'))}</strong></div>
        <div class="sync-time">${icon('database')}<span>${escapeHTML(t('backup.format'))}</span><strong>${escapeHTML(t('backup.encryptedJson'))}</strong></div>
        <div class="sync-time">${icon('file-lock')}<span>${escapeHTML(t('backup.lastExportDate'))}</span><strong>${escapeHTML(lastExport)}</strong></div>
      </section>
    </div>
    <section class="card sync-history-card">
      <div class="section-header"><div><h3>${escapeHTML(t('backup.howItWorks'))}</h3><p>${escapeHTML(t('backup.howItWorksDescription'))}</p></div></div>
      <div class="sync-benefits">
        <div class="sync-benefit">${icon('check-circle')}<span>${escapeHTML(t('backup.stepOne'))}</span></div>
        <div class="sync-benefit">${icon('check-circle')}<span>${escapeHTML(t('backup.stepTwo'))}</span></div>
        <div class="sync-benefit">${icon('check-circle')}<span>${escapeHTML(t('backup.stepThree'))}</span></div>
      </div>
      <p class="form-hint">${escapeHTML(pickerSupported ? t('backup.pickerSupported') : t('backup.pickerFallback'))}</p>
    </section>
  </section>`;
}

function exportErrorMessage(error) {
  if (error?.code === 'BACKUP_LOCKED') return t('auth.locked');
  if (error?.code === 'BACKUP_DOWNLOAD_UNAVAILABLE' || error?.code === 'BACKUP_PICKER_FAILED' || error?.code === 'BACKUP_WRITE_FAILED') return t('backup.exportError');
  return t('backup.exportError');
}

export async function renderSyncPage(container) {
  const target = resolveContainer(container);
  if (!target) {
    return null;
  }
  const generation = ++renderGeneration;
  cleanup();
  cleanup = () => undefined;
  activeContainer = target;
  target.innerHTML = `<div class="page-state"><span class="loading-mark"><span></span></span><strong>${escapeHTML(t('common.loading'))}</strong></div>`;
  try {
    const state = await refreshBackupState();
    if (generation !== renderGeneration || activeContainer !== target) {
      return null;
    }
    target.innerHTML = backupPageMarkup(state);
    const listeners = [];
    const listen = (element, type, handler) => {
      if (!element) return;
      element.addEventListener(type, handler);
      listeners.push(() => element.removeEventListener(type, handler));
    };
    const exportFile = async (button, options) => {
      if (button) setButtonLoading(button, true, t('backup.exporting'));
      try {
        const result = await exportEncryptedBackupFile(options);
        if (!result.cancelled) {
          showToast(t('backup.exportSuccess'), 'success');
          await renderSyncPage(target);
        }
      } catch (error) {
        showToast(exportErrorMessage(error), 'error');
      } finally {
        if (button?.isConnected) setButtonLoading(button, false);
      }
    };
    listen(target.querySelector('[data-backup-export]'), 'click', (event) => void exportFile(event.currentTarget, { preferPicker: true }));
    listen(target.querySelector('[data-backup-download]'), 'click', (event) => void exportFile(event.currentTarget, { preferPicker: false }));
    cleanup = () => {
      for (const remove of listeners) remove();
    };
    return target;
  } catch (error) {
    if (generation === renderGeneration && activeContainer === target) {
      target.innerHTML = `<div class="page-state" role="alert"><strong>${escapeHTML(t('toast.error'))}</strong><span>${escapeHTML(exportErrorMessage(error))}</span></div>`;
    }
    return target;
  }
}

export function disposeSyncPage() {
  renderGeneration += 1;
  cleanup();
  cleanup = () => undefined;
  activeContainer = undefined;
}

export const renderBackupPage = renderSyncPage;
export const disposeBackupPage = disposeSyncPage;
