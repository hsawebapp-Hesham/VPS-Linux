import {
  getMasterKey,
  initAuth,
  isUnlocked,
  lockVault,
  startAutoLock
} from './auth.js';
import { decryptText } from './crypto-utils.js';
import {
  applyTranslations,
  getLanguage,
  setLanguage,
  t
} from './i18n.js';
import {
  navigateTo,
  refreshCurrentRoute,
  startRouter,
  stopRouter
} from './router.js';
import { openApiKeyEditor } from './apikeys.js';
import { openCredentialEditor } from './credentials.js';
import { openNoteEditor } from './notes.js';
import {
  API_KEY_STORE,
  CREDENTIAL_STORE,
  NOTES_STORE,
  getAll,
  getSetting,
  saveSetting
} from './storage.js';
import {
  getTheme,
  initUI,
  setTheme,
  showGlobalSearch,
  showToast
} from './ui.js';

const RESULT_TYPES = Object.freeze({
  apiKey: 'apiKey',
  credential: 'credential',
  note: 'note'
});

let listenersController;
let sessionGeneration = 0;
let activationPromise;
let preferenceQueue = Promise.resolve();
let workspaceSearchHandle;
let serviceWorkerRegistrationStarted = false;

function documentApi() {
  return globalThis.document || null;
}

function showOperationError() {
  showToast(t('toast.error'), 'error');
}

function normalizeSearch(value) {
  return String(value ?? '').normalize('NFKC').toLocaleLowerCase();
}

function searchableTags(value) {
  return Array.isArray(value) ? value.join(' ') : String(value ?? '');
}

function searchableValues(values) {
  return values.map(normalizeSearch).join(' ');
}

function htmlToSearchText(value) {
  const doc = documentApi();
  if (!doc || typeof value !== 'string') {
    return '';
  }
  const template = doc.createElement('template');
  template.innerHTML = value;
  return String(template.content?.textContent || '').replace(/\s+/gu, ' ').trim();
}

function typeLabel(type) {
  if (type === RESULT_TYPES.apiKey) {
    return t('apiKeys.title');
  }
  if (type === RESULT_TYPES.credential) {
    return t('credentials.title');
  }
  return t('notes.title');
}

function fallbackTitle(type) {
  if (type === RESULT_TYPES.apiKey) {
    return t('apiKeys.newKey');
  }
  if (type === RESULT_TYPES.credential) {
    return t('credentials.newCredential');
  }
  return t('notes.noteTitle');
}

function createSearchResult(type, record, title) {
  const id = record?.id === undefined || record.id === null ? '' : String(record.id);
  if (!id) {
    return null;
  }
  const archived = record.isArchived === true;
  const route = type === RESULT_TYPES.apiKey
    ? archived ? 'api-archive' : 'api-keys'
    : type === RESULT_TYPES.credential
      ? archived ? 'credential-archive' : 'credentials'
      : archived ? 'note-archive' : 'notes';
  return {
    type,
    id,
    route,
    label: `${typeLabel(type)} · ${String(title || fallbackTitle(type))}`
  };
}

async function searchProvider(query) {
  if (!isUnlocked()) {
    return [];
  }
  const key = getMasterKey();
  if (!key) {
    return [];
  }
  const normalizedQuery = normalizeSearch(query).trim();
  const [apiKeys, credentials, notes] = await Promise.all([
    getAll(API_KEY_STORE),
    getAll(CREDENTIAL_STORE),
    getAll(NOTES_STORE)
  ]);
  if (!isUnlocked()) {
    return [];
  }
  const results = [];
  for (const record of Array.isArray(apiKeys) ? apiKeys : []) {
    const title = String(record?.title || '').trim() || fallbackTitle(RESULT_TYPES.apiKey);
    const searchable = searchableValues([
      title,
      record?.serviceName,
      record?.category,
      record?.environment,
      record?.notes,
      searchableTags(record?.tags)
    ]);
    if (!normalizedQuery || searchable.includes(normalizedQuery)) {
      const result = createSearchResult(RESULT_TYPES.apiKey, record, title);
      if (result) {
        results.push(result);
      }
    }
  }
  for (const record of Array.isArray(credentials) ? credentials : []) {
    const title = String(record?.siteName || '').trim() || fallbackTitle(RESULT_TYPES.credential);
    const searchable = searchableValues([
      title,
      record?.siteUrl,
      record?.category,
      record?.notes,
      searchableTags(record?.tags)
    ]);
    if (!normalizedQuery || searchable.includes(normalizedQuery)) {
      const result = createSearchResult(RESULT_TYPES.credential, record, title);
      if (result) {
        results.push(result);
      }
    }
  }
  for (const record of Array.isArray(notes) ? notes : []) {
    const title = String(record?.title || '').trim() || fallbackTitle(RESULT_TYPES.note);
    let contentText = '';
    if (normalizedQuery) {
      try {
        contentText = htmlToSearchText(await decryptText(record?.contentHtml, key));
      } catch {
        contentText = '';
      }
      if (!isUnlocked()) {
        return [];
      }
    }
    const searchable = searchableValues([
      title,
      record?.folder,
      contentText,
      searchableTags(record?.tags)
    ]);
    if (!normalizedQuery || searchable.includes(normalizedQuery)) {
      const result = createSearchResult(RESULT_TYPES.note, record, title);
      if (result) {
        results.push(result);
      }
    }
  }
  return results.slice(0, 100);
}

function closeWorkspaceSearch() {
  const handle = workspaceSearchHandle;
  workspaceSearchHandle = undefined;
  if (handle && !handle.closed) {
    handle.close();
  }
}

async function openSearchResult(item) {
  if (!isUnlocked() || !item?.route || !item?.id) {
    return;
  }
  await navigateTo(item.route);
  if (!isUnlocked()) {
    return;
  }
  if (item.type === RESULT_TYPES.apiKey) {
    await openApiKeyEditor(item.id);
  } else if (item.type === RESULT_TYPES.credential) {
    await openCredentialEditor(item.id);
  } else if (item.type === RESULT_TYPES.note) {
    await openNoteEditor(item.id);
  }
}

function openWorkspaceSearch(initialQuery = '') {
  if (!isUnlocked()) {
    return null;
  }
  if (workspaceSearchHandle && !workspaceSearchHandle.closed) {
    const input = workspaceSearchHandle.element?.querySelector?.('.global-search__input');
    if (input) {
      if (initialQuery) {
        input.value = String(initialQuery);
      }
      input.focus();
    }
    return workspaceSearchHandle;
  }
  workspaceSearchHandle = showGlobalSearch({
    initialQuery: String(initialQuery || ''),
    onSearch: searchProvider,
    onSelect: openSearchResult
  });
  return workspaceSearchHandle;
}

function sidebarElements() {
  const doc = documentApi();
  return {
    body: doc?.body || null,
    sidebar: doc?.getElementById('sidebar') || null,
    menuButton: doc?.getElementById('mobile-menu-button') || null
  };
}

function setSidebarOpen(open) {
  const { body, sidebar, menuButton } = sidebarElements();
  const isOpen = Boolean(open);
  body?.classList.toggle('sidebar-open', isOpen);
  if (isOpen) {
    body?.setAttribute('data-sidebar-open', 'true');
  } else {
    body?.removeAttribute('data-sidebar-open');
  }
  sidebar?.classList.toggle('is-open', isOpen);
  menuButton?.setAttribute('aria-expanded', String(isOpen));
}

function userMenuElements() {
  const doc = documentApi();
  return {
    wrap: doc?.querySelector?.('.user-menu-wrap') || null,
    button: doc?.getElementById('user-menu-button') || null,
    popover: doc?.getElementById('user-menu-popover') || null
  };
}

function setUserMenuOpen(open) {
  const { button, popover } = userMenuElements();
  const isOpen = Boolean(open);
  button?.setAttribute('aria-expanded', String(isOpen));
  if (popover) {
    popover.hidden = !isOpen;
  }
}

function clearShellState() {
  setSidebarOpen(false);
  setUserMenuOpen(false);
  closeWorkspaceSearch();
}

function normalizedLanguage(settings) {
  return settings?.language === 'en' ? 'en' : 'ar';
}

function normalizedTheme(settings) {
  return settings?.theme === 'dark' ? 'dark' : 'light';
}

function updateSyncBadge(settings) {
  const badge = documentApi()?.querySelector('[data-nav-badge="backup"]');
  const lastExport = settings?.backup?.lastExportAt || settings?.driveSync?.lastSyncAt;
  if (badge) {
    badge.textContent = lastExport ? t('common.updated') : '—';
    badge.title = lastExport ? t('backup.lastExport') : t('backup.neverExported');
  }
}

async function refreshSyncBadge() {
  try {
    updateSyncBadge(await getSetting());
  } catch {
    updateSyncBadge(null);
  }
}

function renderFatalState() {
  const doc = documentApi();
  if (!doc) {
    return;
  }
  stopRouter();
  clearShellState();
  const app = doc.getElementById('app-shell') || doc.getElementById('app');
  const container = doc.getElementById('page-content');
  if (!app || !container || app.hidden) {
    return;
  }
  const state = doc.createElement('div');
  state.className = 'page-state';
  state.dataset.fatalAppState = 'true';
  state.setAttribute('role', 'alert');
  const title = doc.createElement('strong');
  title.dataset.i18n = 'toast.error';
  title.textContent = t('toast.error');
  const message = doc.createElement('span');
  message.dataset.i18n = 'auth.unexpectedError';
  message.textContent = t('auth.unexpectedError');
  const retry = doc.createElement('button');
  retry.type = 'button';
  retry.className = 'button button-secondary';
  retry.dataset.i18n = 'common.retry';
  retry.textContent = t('common.retry');
  retry.addEventListener('click', () => {
    globalThis.location?.reload?.();
  }, { once: true });
  state.append(title, message, retry);
  container.replaceChildren(state);
}

function deactivateSession() {
  sessionGeneration += 1;
  activationPromise = undefined;
  clearShellState();
  stopRouter();
}

function activateUnlockedSession() {
  if (!isUnlocked()) {
    return Promise.resolve(false);
  }
  if (activationPromise) {
    return activationPromise;
  }
  const generation = ++sessionGeneration;
  const operation = (async () => {
    await initAuth();
    if (!isUnlocked() || generation !== sessionGeneration) {
      return false;
    }
    const settings = await getSetting();
    updateSyncBadge(settings);
    if (!isUnlocked() || generation !== sessionGeneration) {
      return false;
    }
    const language = normalizedLanguage(settings);
    const theme = normalizedTheme(settings);
    await setLanguage(language);
    if (!isUnlocked() || generation !== sessionGeneration) {
      return false;
    }
    setTheme(theme);
    applyTranslations();
    await startAutoLock();
    if (!isUnlocked() || generation !== sessionGeneration) {
      return false;
    }
    await startRouter();
    return isUnlocked() && generation === sessionGeneration;
  })();
  activationPromise = operation;
  void operation.then(() => {
    if (activationPromise === operation) {
      activationPromise = undefined;
    }
  }, () => {
    if (activationPromise === operation) {
      activationPromise = undefined;
    }
  });
  return operation;
}

function handleAuthUnlocked() {
  void activateUnlockedSession().catch(renderFatalState);
}

function handleAuthLocked() {
  deactivateSession();
}

function handlePageHide() {
  if (isUnlocked()) {
    lockVault();
  }
  deactivateSession();
}

function queueTopbarPreference(type) {
  const generation = sessionGeneration;
  const operation = preferenceQueue.catch(() => undefined).then(async () => {
    if (!isUnlocked() || generation !== sessionGeneration) {
      return;
    }
    let saveFailed = false;
    if (type === 'language') {
      const language = getLanguage() === 'ar' ? 'en' : 'ar';
      await setLanguage(language);
      try {
        await saveSetting('language', language);
      } catch {
        saveFailed = true;
      }
      applyTranslations();
    } else {
      const theme = getTheme() === 'dark' ? 'light' : 'dark';
      setTheme(theme);
      try {
        await saveSetting('theme', theme);
      } catch {
        saveFailed = true;
      }
    }
    if (isUnlocked() && generation === sessionGeneration) {
      await refreshCurrentRoute();
    }
    if (saveFailed) {
      showOperationError();
    }
  });
  preferenceQueue = operation.catch(() => undefined);
  return operation;
}

function isEditableTarget(target) {
  if (!target || target.nodeType !== 1) {
    return false;
  }
  return target.tagName === 'INPUT'
    || target.tagName === 'TEXTAREA'
    || target.tagName === 'SELECT'
    || target.isContentEditable === true;
}

async function handleShellClick(event) {
  const preference = event.target?.closest?.('.topbar [data-action="theme"], .topbar [data-action="language-toggle"]');
  if (preference) {
    if (!isUnlocked()) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const type = preference.dataset.action === 'theme' ? 'theme' : 'language';
    await queueTopbarPreference(type);
    return;
  }
  if (!isUnlocked()) {
    return;
  }
  if (event.target?.closest?.('#logout-button, [data-logout-button]')) {
    event.preventDefault();
    event.stopPropagation();
    clearShellState();
    if (isUnlocked()) {
      lockVault();
    }
    return;
  }
  if (event.target?.closest?.('#user-menu-button')) {
    event.preventDefault();
    const { button } = userMenuElements();
    setUserMenuOpen(button?.getAttribute('aria-expanded') !== 'true');
    return;
  }
  if (event.target?.closest?.('#global-search, .global-search-shell')) {
    event.preventDefault();
    const input = event.target?.closest?.('#global-search');
    openWorkspaceSearch(input?.value || '');
    return;
  }
  if (event.target?.closest?.('[data-open-sidebar], #mobile-menu-button')) {
    event.preventDefault();
    setSidebarOpen(true);
    setUserMenuOpen(false);
    return;
  }
  if (event.target?.closest?.('[data-close-sidebar]')) {
    event.preventDefault();
    setSidebarOpen(false);
    return;
  }
  if (event.target?.closest?.('[data-nav]')) {
    setSidebarOpen(false);
    setUserMenuOpen(false);
    return;
  }
  if (!event.target?.closest?.('.user-menu-wrap')) {
    setUserMenuOpen(false);
  }
}

function handleShellKeydown(event) {
  const key = String(event.key || '').toLowerCase();
  const modifier = event.ctrlKey || event.metaKey;
  if (isUnlocked() && modifier && event.shiftKey && key === 'd') {
    event.preventDefault();
    event.stopPropagation();
    void queueTopbarPreference('theme');
    return;
  }
  if (isUnlocked() && modifier && !event.shiftKey && key === 'k') {
    event.preventDefault();
    event.stopPropagation();
    openWorkspaceSearch();
    return;
  }
  if (isUnlocked() && event.key === '/' && !isEditableTarget(event.target)) {
    event.preventDefault();
    event.stopPropagation();
    openWorkspaceSearch();
    return;
  }
  if (event.target?.matches?.('#global-search') && event.key === 'Enter' && isUnlocked()) {
    event.preventDefault();
    event.stopPropagation();
    openWorkspaceSearch(event.target.value || '');
    return;
  }
  if (event.key === 'Escape') {
    setSidebarOpen(false);
    setUserMenuOpen(false);
  }
}

function handleOpenApiEditor(event) {
  if (!isUnlocked()) {
    return;
  }
  const id = event.detail?.id ?? event.detail?.recordId;
  void openApiKeyEditor(id).catch(showOperationError);
}

function handleOpenNoteEditor(event) {
  if (!isUnlocked()) {
    return;
  }
  const id = event.detail?.id ?? event.detail?.recordId;
  void openNoteEditor(id).catch(showOperationError);
}

function handleNavigateToCredentials(event) {
  if (!isUnlocked()) {
    return;
  }
  void (async () => {
    await navigateTo('credentials');
    if (isUnlocked()) {
      await openCredentialEditor(undefined, { password: event.detail?.password });
    }
  })().catch(showOperationError);
}

function handleNavigateToGenerator() {
  if (!isUnlocked()) {
    return;
  }
  void navigateTo('generator').catch(showOperationError);
}

function installApplicationListeners() {
  if (listenersController) {
    return;
  }
  const doc = documentApi();
  if (!doc) {
    return;
  }
  const controller = new AbortController();
  listenersController = controller;
  const listenerOptions = { capture: true, signal: controller.signal };
  doc.addEventListener('click', (event) => {
    void handleShellClick(event).catch(showOperationError);
  }, listenerOptions);
  doc.addEventListener('keydown', handleShellKeydown, listenerOptions);
  globalThis.addEventListener?.('hsa-auth-unlocked', handleAuthUnlocked, { signal: controller.signal });
  globalThis.addEventListener?.('hsa-auth-locked', handleAuthLocked, { signal: controller.signal });
  globalThis.addEventListener?.('hsa-open-api-editor', handleOpenApiEditor, { signal: controller.signal });
  globalThis.addEventListener?.('hsa-open-note-editor', handleOpenNoteEditor, { signal: controller.signal });
  globalThis.addEventListener?.('hsa-navigate-to-credentials', handleNavigateToCredentials, { signal: controller.signal });
  globalThis.addEventListener?.('hsa-navigate-to-generator', handleNavigateToGenerator, { signal: controller.signal });
  globalThis.addEventListener?.('hsa-page-refresh', refreshSyncBadge, { signal: controller.signal });
  globalThis.addEventListener?.('pagehide', handlePageHide, { signal: controller.signal });
}

function registerServiceWorker() {
  if (serviceWorkerRegistrationStarted) {
    return;
  }
  const protocol = globalThis.location?.protocol;
  if (protocol !== 'http:' && protocol !== 'https:') {
    return;
  }
  const serviceWorker = globalThis.navigator?.serviceWorker;
  const doc = documentApi();
  if (!serviceWorker || typeof serviceWorker.register !== 'function' || !doc) {
    return;
  }
  serviceWorkerRegistrationStarted = true;
  const register = () => {
    void serviceWorker.register('./sw.js').catch(() => undefined);
  };
  if (doc.readyState === 'complete') {
    register();
  } else {
    globalThis.addEventListener?.('load', register, { once: true });
  }
}

async function bootstrap() {
  try {
    const state = await initUI();
    if (!state?.ready) {
      renderFatalState();
      return;
    }
    await initAuth();
    installApplicationListeners();
    if (isUnlocked()) {
      await activateUnlockedSession();
    } else {
      deactivateSession();
    }
  } catch {
    renderFatalState();
  } finally {
    registerServiceWorker();
  }
}

await bootstrap();
