import {
  changeMasterPassword,
  estimatePasswordStrength,
  getMasterKey,
  resetAuthStateAfterDeletion,
  startAutoLock
} from './auth.js';
import { getSetting, saveSetting, clearUserData } from './storage.js';
import { applyTranslations, setLanguage, t } from './i18n.js';
import {
  closeModal,
  confirmAction,
  escapeHTML,
  icon,
  openModal,
  setButtonLoading,
  setTheme,
  showToast
} from './ui.js';
import {
  decryptBackupEnvelope,
  exportEncryptedBackupFile,
  notifyDataChanged,
  restoreSafeBackupPayload
} from './drive-sync.js';

const AUTO_LOCK_VALUES = new Set([0, 5, 10, 15, 30]);
const MAX_IMPORT_BYTES = 25 * 1024 * 1024;
let activeContainer;
let settingsUiCleanup = () => undefined;
let ownedModalHandles = new Set();
let activeTab = 'general';
let renderGeneration = 0;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function resolveContainer(container) {
  if (typeof container === 'string') {
    return globalThis.document?.querySelector(container) || null;
  }
  return container?.nodeType === 1 ? container : null;
}

function trackOwnedModal(handle) {
  if (!handle) {
    return null;
  }
  ownedModalHandles.add(handle);
  const originalOnClose = handle.onClose;
  handle.onClose = (closedHandle) => {
    ownedModalHandles.delete(handle);
    if (typeof originalOnClose === 'function') {
      originalOnClose(closedHandle);
    }
  };
  return handle;
}

function openOwnedModal(options) {
  return trackOwnedModal(openModal(options));
}

function disposeOwnedModals() {
  for (const handle of [...ownedModalHandles]) {
    closeModal(handle);
  }
  ownedModalHandles.clear();
}

function dispatch(name, detail) {
  const eventApi = globalThis.CustomEvent;
  if (typeof eventApi === 'function' && typeof globalThis.dispatchEvent === 'function') {
    globalThis.dispatchEvent(new eventApi(name, detail === undefined ? undefined : { detail }));
  }
}

function currentLanguageValue(settings) {
  return settings?.language === 'en' ? 'en' : 'ar';
}

function currentThemeValue(settings) {
  return settings?.theme === 'dark' ? 'dark' : 'light';
}

function currentAutoLockValue(settings) {
  const value = Number(settings?.autoLockMinutes);
  return AUTO_LOCK_VALUES.has(value) ? value : 5;
}

function currentGeneratorDefaults(settings) {
  const source = isObject(settings?.passwordGeneratorDefaults) ? settings.passwordGeneratorDefaults : {};
  return {
    length: Number.isInteger(Number(source.length)) ? Number(source.length) : 16,
    uppercase: source.uppercase !== false,
    lowercase: source.lowercase !== false,
    numbers: source.numbers !== false,
    symbols: source.symbols !== false,
    excludeAmbiguous: source.excludeAmbiguous === true
  };
}

function settingsErrorMessage(error) {
  const code = error?.code || error?.message || '';
  const keys = {
    AUTH_INVALID_PASSWORD: 'validation.currentPasswordIncorrect',
    AUTH_PASSWORD_WEAK: 'auth.passwordTooShort',
    AUTH_PASSWORD_TOO_SHORT: 'auth.passwordTooShort',
    AUTH_PASSWORD_COMPLEXITY: 'auth.passwordHint',
    AUTH_PASSWORD_COMMON: 'auth.passwordHint',
    AUTH_PASSWORD_SAME: 'auth.passwordMismatch',
    AUTH_PASSWORD_MISMATCH: 'auth.passwordMismatch',
    AUTH_LOCKED: 'auth.locked',
    AUTH_CRYPTO_UNAVAILABLE: 'auth.cryptoUnavailable',
    AUTH_STORAGE_UNAVAILABLE: 'auth.secureStorageUnavailable',
    BACKUP_LOCKED: 'auth.locked',
    BACKUP_DECRYPT_FAILED: 'settings.importError',
    BACKUP_INVALID_FORMAT: 'validation.invalidJson',
    BACKUP_INVALID_RECORD: 'validation.invalidJson',
    BACKUP_INVALID_STORE: 'validation.invalidJson',
    BACKUP_INVALID_SETTINGS: 'validation.invalidJson',
    BACKUP_AUTH_PRESENT: 'validation.invalidJson',
    BACKUP_DUPLICATE_ID: 'validation.invalidJson',
    BACKUP_UNENCRYPTED_FIELD: 'validation.invalidJson',
    BACKUP_PICKER_FAILED: 'backup.exportError',
    BACKUP_WRITE_FAILED: 'backup.exportError',
    BACKUP_DOWNLOAD_UNAVAILABLE: 'backup.exportError',
    BACKUP_TOO_LARGE: 'validation.fileTooLarge'
  };
  return t(keys[code] || 'toast.operationFailed');
}

function generatorSummary(settings) {
  const defaults = currentGeneratorDefaults(settings);
  return `<div class="info-strip">${icon('wand', 'icon')}<div><strong data-i18n="generator.title">${escapeHTML(t('generator.title'))}</strong><div class="setting-row-copy"><span><span data-i18n="generator.length">${escapeHTML(t('generator.length'))}</span>: ${escapeHTML(String(defaults.length))}</span><span><span data-i18n="generator.uppercase">${escapeHTML(t('generator.uppercase'))}</span>: <span data-i18n="${defaults.uppercase ? 'common.yes' : 'common.no'}">${escapeHTML(t(defaults.uppercase ? 'common.yes' : 'common.no'))}</span></span><span><span data-i18n="generator.lowercase">${escapeHTML(t('generator.lowercase'))}</span>: <span data-i18n="${defaults.lowercase ? 'common.yes' : 'common.no'}">${escapeHTML(t(defaults.lowercase ? 'common.yes' : 'common.no'))}</span></span><span><span data-i18n="generator.numbers">${escapeHTML(t('generator.numbers'))}</span>: <span data-i18n="${defaults.numbers ? 'common.yes' : 'common.no'}">${escapeHTML(t(defaults.numbers ? 'common.yes' : 'common.no'))}</span></span><span><span data-i18n="generator.symbols">${escapeHTML(t('generator.symbols'))}</span>: <span data-i18n="${defaults.symbols ? 'common.yes' : 'common.no'}">${escapeHTML(t(defaults.symbols ? 'common.yes' : 'common.no'))}</span></span><span><span data-i18n="generator.excludeAmbiguous">${escapeHTML(t('generator.excludeAmbiguous'))}</span>: <span data-i18n="${defaults.excludeAmbiguous ? 'common.yes' : 'common.no'}">${escapeHTML(t(defaults.excludeAmbiguous ? 'common.yes' : 'common.no'))}</span></span></div></div></div>`;
}

function settingsMarkup(settings) {
  const language = currentLanguageValue(settings);
  const theme = currentThemeValue(settings);
  const autoLock = currentAutoLockValue(settings);
  return `<section class="settings-page">
    <header class="page-header">
      <div class="page-header__copy">
        <div class="page-header__eyebrow">${escapeHTML(t('nav.system'))}</div>
        <h2>${escapeHTML(t('settings.title'))}</h2>
        <p>${escapeHTML(t('settings.subtitle'))}</p>
      </div>
    </header>
    <div class="settings-layout">
      <nav class="card settings-tabs" role="tablist" aria-label="${escapeHTML(t('settings.title'))}">
        <span class="settings-nav-title">${escapeHTML(t('settings.title'))}</span>
        <button class="settings-tab ${activeTab === 'general' ? 'is-active' : ''}" type="button" role="tab" aria-selected="${activeTab === 'general'}" data-settings-tab="general">${icon('settings', 'icon')}<span>${escapeHTML(t('settings.general'))}</span></button>
        <button class="settings-tab ${activeTab === 'security' ? 'is-active' : ''}" type="button" role="tab" aria-selected="${activeTab === 'security'}" data-settings-tab="security">${icon('shield', 'icon')}<span>${escapeHTML(t('settings.security'))}</span></button>
        <button class="settings-tab ${activeTab === 'data' ? 'is-active' : ''}" type="button" role="tab" aria-selected="${activeTab === 'data'}" data-settings-tab="data">${icon('database', 'icon')}<span>${escapeHTML(t('settings.dataManagement'))}</span></button>
      </nav>
      <div class="settings-content">
        <section class="card settings-card ${activeTab === 'general' ? '' : 'is-hidden'}" role="tabpanel" data-settings-section="general">
          <div class="settings-card-header"><h3>${escapeHTML(t('settings.preferences'))}</h3><p>${escapeHTML(t('settings.subtitle'))}</p></div>
          <div class="setting-row">
            <div class="setting-row-main"><span class="setting-row-icon">${icon('globe', 'icon')}</span><div class="setting-row-copy"><strong>${escapeHTML(t('settings.language'))}</strong><small>${escapeHTML(t('settings.languageDescription'))}</small></div></div>
            <div class="setting-control"><div class="select-control"><select id="settings-language" name="language" aria-label="${escapeHTML(t('settings.language'))}"><option value="ar" ${language === 'ar' ? 'selected' : ''}>${escapeHTML(t('common.arabic'))}</option><option value="en" ${language === 'en' ? 'selected' : ''}>${escapeHTML(t('common.english'))}</option></select></div></div>
          </div>
          <div class="setting-row">
            <div class="setting-row-main"><span class="setting-row-icon">${icon(theme === 'dark' ? 'moon' : 'sun', 'icon')}</span><div class="setting-row-copy"><strong>${escapeHTML(t('settings.appearance'))}</strong><small>${escapeHTML(t('settings.appearanceDescription'))}</small></div></div>
            <div class="setting-control"><div class="select-control"><select id="settings-theme" name="theme" aria-label="${escapeHTML(t('settings.appearance'))}"><option value="light" ${theme === 'light' ? 'selected' : ''}>${escapeHTML(t('settings.lightMode'))}</option><option value="dark" ${theme === 'dark' ? 'selected' : ''}>${escapeHTML(t('settings.darkMode'))}</option></select></div></div>
          </div>
          <div class="setting-row">
            <div class="setting-row-main"><span class="setting-row-icon">${icon('lock', 'icon')}</span><div class="setting-row-copy"><strong>${escapeHTML(t('settings.autoLock'))}</strong><small>${escapeHTML(t('settings.autoLockDescription'))}</small></div></div>
            <div class="setting-control"><div class="select-control"><select id="settings-auto-lock" name="auto-lock-minutes" aria-label="${escapeHTML(t('settings.autoLockMinutes'))}"><option value="0" ${autoLock === 0 ? 'selected' : ''}>${escapeHTML(t('settings.autoLockDisabled'))}</option><option value="5" ${autoLock === 5 ? 'selected' : ''}>${escapeHTML(t('settings.autoLockFiveMinutes'))}</option><option value="10" ${autoLock === 10 ? 'selected' : ''}>${escapeHTML(t('settings.autoLockTenMinutes'))}</option><option value="15" ${autoLock === 15 ? 'selected' : ''}>${escapeHTML(t('settings.autoLockFifteenMinutes'))}</option><option value="30" ${autoLock === 30 ? 'selected' : ''}>${escapeHTML(t('settings.autoLockThirtyMinutes'))}</option></select></div></div>
          </div>
          ${generatorSummary(settings)}
        </section>
        <section class="card settings-card ${activeTab === 'security' ? '' : 'is-hidden'}" role="tabpanel" data-settings-section="security">
          <div class="settings-card-header"><h3>${escapeHTML(t('settings.security'))}</h3><p>${escapeHTML(t('settings.changeMasterPasswordDescription'))}</p></div>
          <div class="setting-row">
            <div class="setting-row-main"><span class="setting-row-icon">${icon('key-round', 'icon')}</span><div class="setting-row-copy"><strong>${escapeHTML(t('settings.changeMasterPassword'))}</strong><small>${escapeHTML(t('settings.changeMasterPasswordDescription'))}</small></div></div>
            <div class="setting-control"><button class="button button-secondary" type="button" data-change-password>${escapeHTML(t('settings.changeMasterPassword'))}</button></div>
          </div>
          <div class="security-alert warning"><span class="alert-icon">${icon('shield', 'icon')}</span><div class="alert-copy"><strong>${escapeHTML(t('settings.security'))}</strong><p>${escapeHTML(t('settings.clientEncryptionNote'))}</p></div></div>
          <div class="section-header"><div><h3>${escapeHTML(t('backup.title'))}</h3><p>${escapeHTML(t('backup.subtitle'))}</p></div><a class="section-link" href="#backup"><span>${escapeHTML(t('nav.backup'))}</span>${icon('chevron-left', 'icon')}</a></div>
        </section>
        <section class="card settings-card ${activeTab === 'data' ? '' : 'is-hidden'}" role="tabpanel" data-settings-section="data">
          <div class="settings-card-header"><h3>${escapeHTML(t('settings.dataManagement'))}</h3><p>${escapeHTML(t('settings.exportDescription'))}</p></div>
          <div class="setting-row">
            <div class="setting-row-main"><span class="setting-row-icon">${icon('google-drive', 'icon')}</span><div class="setting-row-copy"><strong>${escapeHTML(t('backup.chooseDrive'))}</strong><small>${escapeHTML(t('backup.exportDescription'))}</small></div></div>
            <div class="setting-control"><button class="button button-secondary" type="button" data-export-backup>${escapeHTML(t('backup.chooseDrive'))}</button></div>
          </div>
          <div class="setting-row">
            <div class="setting-row-main"><span class="setting-row-icon">${icon('upload', 'icon')}</span><div class="setting-row-copy"><strong>${escapeHTML(t('settings.importBackup'))}</strong><small>${escapeHTML(t('settings.importDescription'))}</small></div></div>
            <div class="setting-control"><button class="button button-secondary" type="button" data-import-backup>${escapeHTML(t('common.upload'))}</button><input id="settings-backup-input" name="settings-backup" class="sr-only" type="file" accept="application/json,.json" data-max-bytes="26214400"></div>
          </div>
          <div class="danger-zone card">
            <div class="settings-card-header"><h3>${escapeHTML(t('settings.dangerZone'))}</h3><p>${escapeHTML(t('settings.deleteAllDataDescription'))}</p></div>
            <div class="security-alert warning"><span class="alert-icon">${icon('trash', 'icon')}</span><div class="alert-copy"><strong>${escapeHTML(t('settings.deleteDataWarning'))}</strong></div></div>
            <div class="sync-hero-actions"><button class="button button-danger" type="button" data-delete-all>${escapeHTML(t('settings.deleteEverything'))}</button></div>
          </div>
        </section>
      </div>
    </div>
  </section>`;
}

function markSettingsTranslations(root) {
  const setText = (element, key) => {
    if (element) {
      element.setAttribute('data-i18n', key);
    }
  };
  const setAria = (element, key) => {
    if (element) {
      element.setAttribute('data-i18n-aria-label', key);
    }
  };
  setText(root.querySelector('.page-header__eyebrow'), 'nav.system');
  setText(root.querySelector('.page-header h2'), 'settings.title');
  setText(root.querySelector('.page-header p'), 'settings.subtitle');
  setAria(root.querySelector('.settings-tabs'), 'settings.title');
  setText(root.querySelector('.settings-nav-title'), 'settings.title');
  const tabKeys = { general: 'settings.general', security: 'settings.security', data: 'settings.dataManagement' };
  for (const button of root.querySelectorAll('[data-settings-tab]')) {
    setText(button.querySelector('span'), tabKeys[button.dataset.settingsTab]);
  }
  const general = root.querySelector('[data-settings-section="general"]');
  setText(general?.querySelector('.settings-card-header h3'), 'settings.preferences');
  setText(general?.querySelector('.settings-card-header p'), 'settings.subtitle');
  const generalRows = general?.querySelectorAll('.setting-row') || [];
  const generalRowKeys = [
    ['settings.language', 'settings.languageDescription'],
    ['settings.appearance', 'settings.appearanceDescription'],
    ['settings.autoLock', 'settings.autoLockDescription']
  ];
  generalRowKeys.forEach((keys, index) => {
    setText(generalRows[index]?.querySelector('strong'), keys[0]);
    setText(generalRows[index]?.querySelector('small'), keys[1]);
  });
  setAria(root.querySelector('#settings-language'), 'settings.language');
  setAria(root.querySelector('#settings-theme'), 'settings.appearance');
  setAria(root.querySelector('#settings-auto-lock'), 'settings.autoLockMinutes');
  const languageOptions = root.querySelectorAll('#settings-language option');
  setText(languageOptions[0], 'common.arabic');
  setText(languageOptions[1], 'common.english');
  const themeOptions = root.querySelectorAll('#settings-theme option');
  setText(themeOptions[0], 'settings.lightMode');
  setText(themeOptions[1], 'settings.darkMode');
  const autoLockKeys = ['settings.autoLockDisabled', 'settings.autoLockFiveMinutes', 'settings.autoLockTenMinutes', 'settings.autoLockFifteenMinutes', 'settings.autoLockThirtyMinutes'];
  root.querySelectorAll('#settings-auto-lock option').forEach((option, index) => setText(option, autoLockKeys[index]));
  const security = root.querySelector('[data-settings-section="security"]');
  setText(security?.querySelector('.settings-card-header h3'), 'settings.security');
  setText(security?.querySelector('.settings-card-header p'), 'settings.changeMasterPasswordDescription');
  const securityRows = security?.querySelectorAll('.setting-row') || [];
  const securityRowKeys = [
    ['settings.changeMasterPassword', 'settings.changeMasterPasswordDescription']
  ];
  securityRowKeys.forEach((keys, index) => {
    setText(securityRows[index]?.querySelector('strong'), keys[0]);
    setText(securityRows[index]?.querySelector('small'), keys[1]);
  });
  setText(security?.querySelector('.security-alert strong'), 'settings.security');
  setText(security?.querySelector('.security-alert p'), 'settings.clientEncryptionNote');
  setText(security?.querySelector('.section-header h3'), 'backup.title');
  setText(security?.querySelector('.section-header p'), 'backup.subtitle');
  setText(security?.querySelector('[data-change-password]'), 'settings.changeMasterPassword');
  setText(security?.querySelector('.section-link span'), 'nav.backup');
  const data = root.querySelector('[data-settings-section="data"]');
  setText(data?.querySelector('.settings-card-header h3'), 'settings.dataManagement');
  setText(data?.querySelector('.settings-card-header p'), 'settings.exportDescription');
  const dataRows = data?.querySelectorAll('.setting-row') || [];
  setText(dataRows[0]?.querySelector('strong'), 'backup.chooseDrive');
  setText(dataRows[0]?.querySelector('small'), 'backup.exportDescription');
  setText(dataRows[1]?.querySelector('strong'), 'settings.importBackup');
  setText(dataRows[1]?.querySelector('small'), 'settings.importDescription');
  setText(data?.querySelector('.danger-zone .settings-card-header h3'), 'settings.dangerZone');
  setText(data?.querySelector('.danger-zone .settings-card-header p'), 'settings.deleteAllDataDescription');
  setText(data?.querySelector('.danger-zone .security-alert strong'), 'settings.deleteDataWarning');
  setText(data?.querySelector('[data-export-backup]'), 'backup.chooseDrive');
  setText(data?.querySelector('[data-import-backup]'), 'common.upload');
  setText(data?.querySelector('[data-delete-all]'), 'settings.deleteEverything');
}

function updatePasswordStrength(track, fill, label, value) {
  const estimate = estimatePasswordStrength(value);
  fill.style.width = `${estimate.percent}%`;
  track.dataset.strength = estimate.label;
  track.setAttribute('aria-valuenow', String(estimate.percent));
  label.textContent = t(`credentials.${estimate.label}`);
}

function openChangePasswordModal() {
  const doc = globalThis.document;
  if (!doc) {
    return null;
  }
  const form = doc.createElement('form');
  form.className = 'modal-form';
  form.noValidate = true;
  form.innerHTML = `<div class="form-field"><label for="settings-current-password">${escapeHTML(t('settings.currentMasterPassword'))}</label><div class="input-control"><input id="settings-current-password" name="current-password" type="password" autocomplete="current-password" required><span class="input-leading">${icon('lock', 'icon')}</span></div></div>
    <div class="form-field"><label for="settings-new-password">${escapeHTML(t('settings.newMasterPassword'))}</label><div class="input-control"><input id="settings-new-password" name="new-password" type="password" autocomplete="new-password" required><span class="input-leading">${icon('key-round', 'icon')}</span></div></div>
    <div class="form-field"><label for="settings-confirm-password">${escapeHTML(t('settings.confirmNewMasterPassword'))}</label><div class="input-control"><input id="settings-confirm-password" name="confirm-password" type="password" autocomplete="new-password" required><span class="input-leading">${icon('key-round', 'icon')}</span></div></div>
    <div class="auth-strength-wrap"><div class="strength-meta"><span>${escapeHTML(t('auth.passwordStrength'))}</span><span class="strength-label"></span></div><div class="strength-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span class="strength-fill"></span></div></div>
    <p class="form-error" role="alert" aria-live="assertive"></p>`;
  const currentInput = form.querySelector('#settings-current-password');
  const newInput = form.querySelector('#settings-new-password');
  const confirmInput = form.querySelector('#settings-confirm-password');
  const track = form.querySelector('.strength-track');
  const fill = form.querySelector('.strength-fill');
  const label = form.querySelector('.strength-label');
  const error = form.querySelector('.form-error');
  let handle;
  let running = false;
  const ownerGeneration = renderGeneration;
  const submit = async () => {
    if (running) {
      return false;
    }
    error.textContent = '';
    const currentPassword = currentInput.value;
    const newPassword = newInput.value;
    const confirmPassword = confirmInput.value;
    if (!currentPassword) {
      error.textContent = t('auth.passwordRequired');
      currentInput.focus();
      return false;
    }
    if (!newPassword) {
      error.textContent = t('auth.passwordRequired');
      newInput.focus();
      return false;
    }
    if (newPassword !== confirmPassword) {
      error.textContent = t('auth.passwordMismatch');
      confirmInput.focus();
      return false;
    }
    running = true;
    try {
      await changeMasterPassword(currentPassword, newPassword);
      if (renderGeneration !== ownerGeneration) {
        return true;
      }
      closeModal(handle);
      showToast(t('settings.passwordUpdated'), 'success');
      await notifyDataChanged();
      dispatch('hsa-page-refresh');
      return true;
    } catch (changeError) {
      error.textContent = settingsErrorMessage(changeError);
      return false;
    } finally {
      running = false;
    }
  };
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void submit();
  });
  newInput.addEventListener('input', () => updatePasswordStrength(track, fill, label, newInput.value));
  handle = openOwnedModal({
    title: t('settings.changeMasterPassword'),
    content: form,
    size: 'md',
    actions: [
      { label: t('common.cancel'), variant: 'secondary' },
      { label: t('common.save'), variant: 'primary', onClick: () => submit() }
    ]
  });
  return handle;
}

async function importEncryptedBackup(file) {
  const ownerGeneration = renderGeneration;
  if (!file || typeof file.size !== 'number') {
    throw new Error('BACKUP_FILE_REQUIRED');
  }
  if (file.size > MAX_IMPORT_BYTES) {
    throw new Error('BACKUP_FILE_TOO_LARGE');
  }
  const key = getMasterKey();
  if (!key) {
    throw new Error('AUTH_LOCKED');
  }
  const text = await file.text();
  let envelope;
  try {
    envelope = JSON.parse(text);
  } catch {
    throw new Error('BACKUP_INVALID_JSON');
  }
  const payload = await decryptBackupEnvelope(envelope, key);
  const confirmed = await confirmAction({
    title: t('settings.importBackup'),
    message: t('settings.importDescription'),
    confirmLabel: t('common.confirm'),
    cancelLabel: t('common.cancel'),
    type: 'primary'
  });
  if (!confirmed) {
    return false;
  }
  if (renderGeneration !== ownerGeneration || getMasterKey() !== key) {
    throw Object.assign(new Error('The operation was cancelled'), { code: 'AUTH_LOCKED' });
  }
  await restoreSafeBackupPayload(payload);
  if (renderGeneration !== ownerGeneration) {
    return true;
  }
  const updatedSettings = await getSetting();
  await setLanguage(currentLanguageValue(updatedSettings));
  setTheme(currentThemeValue(updatedSettings));
  await startAutoLock().catch(() => undefined);
  await notifyDataChanged();
  dispatch('hsa-page-refresh');
  showToast(t('settings.importSuccess'), 'success');
  return true;
}

function openDeleteAllModal() {
  const doc = globalThis.document;
  if (!doc) {
    return null;
  }
  const form = doc.createElement('form');
  form.className = 'modal-form';
  form.noValidate = true;
  form.innerHTML = `<div class="security-alert warning"><span class="alert-icon">${icon('trash', 'icon')}</span><div class="alert-copy"><strong>${escapeHTML(t('settings.deleteDataWarning'))}</strong></div></div><div class="form-field"><label for="delete-confirm-input">${escapeHTML(t('settings.typeDeleteToConfirm'))}</label><div class="input-control"><input id="delete-confirm-input" name="delete-confirm" type="text" autocomplete="off" spellcheck="false" required></div></div><p class="form-error" role="alert" aria-live="assertive"></p>`;
  const input = form.querySelector('#delete-confirm-input');
  const error = form.querySelector('.form-error');
  let handle;
  let running = false;
  const ownerGeneration = renderGeneration;
  const submit = async () => {
    if (running) {
      return false;
    }
    if (input.value !== 'DELETE') {
      error.textContent = t('validation.confirmDelete');
      input.focus();
      return false;
    }
    running = true;
    try {
      if (renderGeneration !== ownerGeneration) {
        return true;
      }
      await clearUserData();
      dispatch('hsa-data-changed', { backup: false });
      dispatch('hsa-page-refresh');
      closeModal(handle);
      resetAuthStateAfterDeletion();
      showToast(t('toast.deleted'), 'success');
      return true;
    } catch (deleteError) {
      error.textContent = settingsErrorMessage(deleteError);
      return false;
    } finally {
      running = false;
    }
  };
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void submit();
  });
  handle = openOwnedModal({
    title: t('settings.deleteDataTitle'),
    content: form,
    size: 'sm',
    actions: [
      { label: t('common.cancel'), variant: 'secondary' },
      { label: t('settings.deleteEverything'), variant: 'danger', onClick: () => submit() }
    ]
  });
  return handle;
}

async function requestDeleteAll() {
  const confirmed = await confirmAction({
    title: t('settings.deleteDataTitle'),
    message: t('settings.deleteAllDataDescription'),
    confirmLabel: t('common.confirm'),
    cancelLabel: t('common.cancel'),
    type: 'danger'
  });
  if (confirmed) {
    openDeleteAllModal();
  }
}

export async function renderSettingsPage(container) {
  const target = resolveContainer(container);
  if (!target) {
    return null;
  }
  const generation = ++renderGeneration;
  settingsUiCleanup();
  settingsUiCleanup = () => undefined;
  activeContainer = target;
  target.innerHTML = `<div class="page-state"><span class="loading-mark"><span></span></span><strong>${escapeHTML(t('common.loading'))}</strong></div>`;
  try {
    const settings = await getSetting();
    if (generation !== renderGeneration || activeContainer !== target) {
      return null;
    }
    target.innerHTML = settingsMarkup(settings);
    markSettingsTranslations(target);
    applyTranslations(target);
    const listeners = [];
    const listen = (element, eventName, handler) => {
      if (!element) {
        return;
      }
      element.addEventListener(eventName, handler);
      listeners.push(() => element.removeEventListener(eventName, handler));
    };
    const showTab = (tab) => {
      activeTab = tab === 'security' || tab === 'data' ? tab : 'general';
      for (const button of target.querySelectorAll('[data-settings-tab]')) {
        const selected = button.dataset.settingsTab === activeTab;
        button.classList.toggle('is-active', selected);
        button.setAttribute('aria-selected', String(selected));
        button.tabIndex = selected ? 0 : -1;
      }
      for (const section of target.querySelectorAll('[data-settings-section]')) {
        const selected = section.dataset.settingsSection === activeTab;
        section.classList.toggle('is-hidden', !selected);
        section.hidden = !selected;
      }
    };
    showTab(activeTab);
    for (const button of target.querySelectorAll('[data-settings-tab]')) {
      listen(button, 'click', () => showTab(button.dataset.settingsTab));
    }
    const languageSelect = target.querySelector('#settings-language');
    const themeSelect = target.querySelector('#settings-theme');
    const autoLockSelect = target.querySelector('#settings-auto-lock');
    const changePasswordButton = target.querySelector('[data-change-password]');
    const exportButton = target.querySelector('[data-export-backup]');
    const importButton = target.querySelector('[data-import-backup]');
    const importInput = target.querySelector('#settings-backup-input');
    const deleteButton = target.querySelector('[data-delete-all]');
    listen(languageSelect, 'change', async () => {
      const value = languageSelect.value === 'en' ? 'en' : 'ar';
      try {
        await saveSetting('language', value);
        await setLanguage(value);
        await notifyDataChanged();
        dispatch('hsa-page-refresh');
        await renderSettingsPage(target);
      } catch (error) {
        showToast(settingsErrorMessage(error), 'error');
      }
    });
    listen(themeSelect, 'change', async () => {
      const value = themeSelect.value === 'dark' ? 'dark' : 'light';
      try {
        setTheme(value);
        await saveSetting('theme', value);
        await notifyDataChanged();
        dispatch('hsa-page-refresh');
      } catch (error) {
        showToast(settingsErrorMessage(error), 'error');
      }
    });
    listen(autoLockSelect, 'change', async () => {
      const value = Number(autoLockSelect.value);
      if (!AUTO_LOCK_VALUES.has(value)) {
        return;
      }
      try {
        await saveSetting('autoLockMinutes', value);
        await startAutoLock();
        await notifyDataChanged();
        dispatch('hsa-page-refresh');
      } catch (error) {
        showToast(settingsErrorMessage(error), 'error');
      }
    });
    listen(changePasswordButton, 'click', () => {
      openChangePasswordModal();
    });
    listen(exportButton, 'click', async () => {
      if (exportButton) {
        setButtonLoading(exportButton, true, t('backup.exporting'));
      }
      try {
        const result = await exportEncryptedBackupFile({ preferPicker: true });
        if (!result.cancelled) {
          showToast(t('backup.exportSuccess'), 'success');
          await renderSettingsPage(target);
        }
      } catch (error) {
        showToast(settingsErrorMessage(error), 'error');
      } finally {
        if (exportButton?.isConnected) {
          setButtonLoading(exportButton, false);
        }
      }
    });
    listen(importButton, 'click', () => importInput?.click());
    listen(importInput, 'change', async () => {
      const file = importInput.files?.[0];
      if (!file) {
        return;
      }
      if (importButton) {
        setButtonLoading(importButton, true, t('common.loading'));
      }
      try {
        await importEncryptedBackup(file);
      } catch (error) {
        const code = error?.message || '';
        const message = code === 'BACKUP_FILE_TOO_LARGE' ? t('validation.fileTooLarge') : code === 'BACKUP_INVALID_JSON' ? t('validation.invalidJson') : settingsErrorMessage(error);
        showToast(message, 'error');
      } finally {
        importInput.value = '';
        if (importButton?.isConnected) {
          setButtonLoading(importButton, false);
        }
      }
    });
    listen(deleteButton, 'click', () => {
      void requestDeleteAll();
    });
    settingsUiCleanup = () => {
      for (const remove of listeners) {
        remove();
      }
    };
    return target;
  } catch (error) {
    if (generation === renderGeneration && activeContainer === target) {
      target.innerHTML = `<div class="page-state"><strong>${escapeHTML(t('toast.error'))}</strong><span>${escapeHTML(settingsErrorMessage(error))}</span></div>`;
    }
    return target;
  }
}

export function disposeSettingsPage() {
  renderGeneration += 1;
  disposeOwnedModals();
  settingsUiCleanup();
  settingsUiCleanup = () => undefined;
  activeContainer = undefined;
}

