import { t } from './i18n.js';
import {
  API_KEY_STORE,
  getAll,
  getById,
  put,
  remove
} from './storage.js';
import { getMasterKey } from './auth.js';
import { decryptText, encryptText } from './crypto-utils.js';
import {
  confirmAction,
  copyText,
  escapeHTML,
  icon,
  openModal,
  setButtonLoading,
  showToast
} from './ui.js';

const STORE = API_KEY_STORE;
const MASK = '••••••••';
const ENVIRONMENTS = ['production', 'development', 'testing'];
const ACTION = Object.freeze({
  add: 'add-api-key',
  edit: 'edit-api-key',
  favorite: 'favorite-key',
  archive: 'archive-key',
  restore: 'restore-key',
  delete: 'delete-key',
  toggle: 'show-key',
  copy: 'copy-key',
  search: 'search-api-key',
  category: 'filter-api-key-category',
  environment: 'filter-api-key-environment',
  favoriteFilter: 'filter-api-key-favorites',
  clear: 'clear-api-key-filters',
  grid: 'api-key-grid-view',
  list: 'api-key-list-view'
});

let viewMode = 'grid';
let pageRoot = null;
let pageContext = { archive: false };
let records = [];
let filters = {
  search: '',
  category: '',
  environment: '',
  favoriteOnly: false
};
let generation = 0;
let cleanup = [];
let editorSession = null;
let secretCache = new Map();
let revealedSecrets = new Set();
let observers = new Set();

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function textValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function currentKey() {
  const key = getMasterKey();
  return key && typeof key === 'object' ? key : null;
}

function safeId(value) {
  return value === undefined || value === null ? '' : String(value);
}

function createId() {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof cryptoApi?.getRandomValues !== 'function') {
    throw new Error('Secure random generation is unavailable');
  }
  cryptoApi.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function isEnvelope(value) {
  return isObject(value) && value.v === 1 && typeof value.iv === 'string' && typeof value.data === 'string';
}

function parseEnvelope(value) {
  if (isEnvelope(value)) {
    return value;
  }
  if (typeof value !== 'string') {
    return null;
  }
  try {
    const parsed = JSON.parse(value);
    return isEnvelope(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function notifyError() {
  showToast(t('toast.operationFailed'), 'error');
}

function notifyLocked() {
  showToast(t('common.notAvailable'), 'warning');
}

function dispatchChange(action) {
  const eventApi = globalThis.CustomEvent;
  if (typeof eventApi !== 'function' || typeof globalThis.dispatchEvent !== 'function') {
    return;
  }
  globalThis.dispatchEvent(new eventApi('hsa-data-changed', {
    detail: {
      store: STORE,
      action: String(action)
    }
  }));
  globalThis.dispatchEvent(new eventApi('hsa-page-refresh'));
}

function addRootListener(target, type, handler, options) {
  if (!target || typeof target.addEventListener !== 'function') {
    return;
  }
  target.addEventListener(type, handler, options);
  cleanup.push(() => target.removeEventListener(type, handler, options));
}

function trackObserver(observer) {
  if (observer && typeof observer.disconnect === 'function') {
    observers.add(observer);
  }
  return observer;
}

function removeObserver(observer) {
  if (observer && typeof observer.disconnect === 'function') {
    observer.disconnect();
  }
  observers.delete(observer);
}

function normalizeEnvironment(value) {
  const normalized = textValue(value).toLowerCase();
  return ENVIRONMENTS.includes(normalized) ? normalized : textValue(value);
}

function environmentLabel(value) {
  const normalized = textValue(value).toLowerCase();
  if (normalized === 'production') {
    return t('apiKeys.production');
  }
  if (normalized === 'development') {
    return t('apiKeys.development');
  }
  if (normalized === 'testing') {
    return t('apiKeys.testing');
  }
  return textValue(value);
}

function normalizeTags(value) {
  const source = Array.isArray(value) ? value : String(value ?? '').split(/[,\n]/);
  const tags = [];
  const seen = new Set();
  for (const item of source) {
    const tag = textValue(item);
    const key = tag.toLocaleLowerCase();
    if (tag && !seen.has(key)) {
      seen.add(key);
      tags.push(tag);
    }
  }
  return tags;
}

function recordMatchesArchive(record) {
  return Boolean(record?.isArchived) === pageContext.archive;
}

function searchText(record) {
  return [
    record?.title,
    record?.serviceName,
    record?.category,
    record?.environment,
    record?.notes,
    Array.isArray(record?.tags) ? record.tags.join(' ') : record?.tags
  ].map((value) => String(value ?? '')).join(' ').toLocaleLowerCase();
}

function filteredRecords() {
  const query = textValue(filters.search).toLocaleLowerCase();
  const category = textValue(filters.category).toLocaleLowerCase();
  const environment = textValue(filters.environment).toLocaleLowerCase();
  return records
    .filter((record) => recordMatchesArchive(record))
    .filter((record) => !filters.favoriteOnly || Boolean(record.isFavorite))
    .filter((record) => !category || textValue(record.category).toLocaleLowerCase() === category)
    .filter((record) => !environment || textValue(record.environment).toLocaleLowerCase() === environment)
    .filter((record) => !query || searchText(record).includes(query))
    .sort((left, right) => {
      const favoriteOrder = Number(Boolean(right.isFavorite)) - Number(Boolean(left.isFavorite));
      if (favoriteOrder !== 0) {
        return favoriteOrder;
      }
      return String(right.updatedAt || right.createdAt || '').localeCompare(String(left.updatedAt || left.createdAt || ''));
    });
}

function routeRecords() {
  return records.filter(recordMatchesArchive);
}

function categoryOptions() {
  const values = new Set();
  for (const record of routeRecords()) {
    const value = textValue(record.category);
    if (value) {
      values.add(value);
    }
  }
  return Array.from(values).sort((left, right) => left.localeCompare(right));
}

function environmentOptions() {
  const values = new Set();
  for (const record of routeRecords()) {
    const value = textValue(record.environment);
    if (value) {
      values.add(value);
    }
  }
  return Array.from(values).sort((left, right) => left.localeCompare(right));
}

function renderTags(tags) {
  return normalizeTags(tags).map((tag) => `<span class="tag">${escapeHTML(tag)}</span>`).join('');
}

function renderEnvironment(record) {
  const value = textValue(record.environment);
  if (!value) {
    return '';
  }
  return `<span class="badge badge-info">${escapeHTML(environmentLabel(value))}</span>`;
}

function renderCategory(record) {
  const value = textValue(record.category);
  return value ? `<span class="badge badge-neutral">${escapeHTML(value)}</span>` : '';
}

function renderSecret(record) {
  const id = safeId(record.id);
  const isRevealed = revealedSecrets.has(id) && secretCache.has(id);
  return `<div class="secret-value"><span data-secret-value>${isRevealed ? escapeHTML(secretCache.get(id)) : MASK}</span><div class="secret-actions"><button type="button" class="icon-button" data-action="${ACTION.toggle}" data-id="${escapeHTML(id)}" aria-label="${escapeHTML(isRevealed ? t('apiKeys.hideKey') : t('apiKeys.showKey'))}">${icon(isRevealed ? 'eye-off' : 'eye')}</button><button type="button" class="icon-button" data-action="${ACTION.copy}" data-id="${escapeHTML(id)}" aria-label="${escapeHTML(t('apiKeys.copyKey'))}">${icon('copy')}</button></div></div>`;
}

function actionButton(action, id, label, iconName, className = 'icon-button') {
  return `<button type="button" class="${className}" data-action="${action}" data-id="${escapeHTML(safeId(id))}" aria-label="${escapeHTML(label)}" title="${escapeHTML(label)}">${icon(iconName)}</button>`;
}

function renderCard(record) {
  const id = safeId(record.id);
  const favorite = Boolean(record.isFavorite);
  const archiveAction = pageContext.archive ? ACTION.restore : ACTION.archive;
  const archiveLabel = pageContext.archive ? t('apiKeys.restoreKey') : t('apiKeys.archiveKey');
  const archiveIcon = pageContext.archive ? 'refresh' : 'archive';
  const deleteLabel = pageContext.archive ? t('archive.deletePermanently') : t('apiKeys.deleteKey');
  return `<article class="card data-card api-key-card" data-id="${escapeHTML(id)}"><div class="data-card-top"><div class="data-card-title-row"><span class="data-card-icon">${icon('key-round')}</span><div class="data-card-title"><strong>${escapeHTML(textValue(record.title) || t('apiKeys.newKey'))}</strong><small>${escapeHTML(textValue(record.serviceName) || t('apiKeys.serviceName'))}</small></div></div><button type="button" class="favorite-button${favorite ? ' is-favorite' : ''}" data-action="${ACTION.favorite}" data-id="${escapeHTML(id)}" aria-label="${escapeHTML(favorite ? t('apiKeys.removeFavorite') : t('apiKeys.markFavorite'))}" title="${escapeHTML(favorite ? t('apiKeys.removeFavorite') : t('apiKeys.markFavorite'))}">${icon('star')}</button></div><div class="data-card-body">${renderSecret(record)}<div class="data-card-meta">${renderCategory(record)}${renderEnvironment(record)}${renderTags(record.tags)}</div>${textValue(record.notes) ? `<p>${escapeHTML(record.notes)}</p>` : ''}</div><div class="data-card-footer"><span>${escapeHTML(t('common.updated'))}</span><div class="data-card-actions">${actionButton(ACTION.edit, id, t('common.edit'), 'edit', 'icon-button')}${actionButton(archiveAction, id, archiveLabel, archiveIcon, 'icon-button')}${actionButton(ACTION.delete, id, deleteLabel, 'trash', 'icon-button')}</div></div></article>`;
}

function renderListRow(record) {
  const id = safeId(record.id);
  const favorite = Boolean(record.isFavorite);
  const archiveAction = pageContext.archive ? ACTION.restore : ACTION.archive;
  const archiveLabel = pageContext.archive ? t('apiKeys.restoreKey') : t('apiKeys.archiveKey');
  const archiveIcon = pageContext.archive ? 'refresh' : 'archive';
  const deleteLabel = pageContext.archive ? t('archive.deletePermanently') : t('apiKeys.deleteKey');
  return `<article class="list-row card" data-id="${escapeHTML(id)}"><div class="list-row-main"><span class="data-card-icon">${icon('key-round')}</span><div class="list-row-copy"><strong>${escapeHTML(textValue(record.title) || t('apiKeys.newKey'))}</strong><small>${escapeHTML([textValue(record.serviceName), textValue(record.category), environmentLabel(record.environment)].filter(Boolean).join(' · '))}</small></div></div><div class="secret-value"><span data-secret-value>${revealedSecrets.has(id) && secretCache.has(id) ? escapeHTML(secretCache.get(id)) : MASK}</span><div class="secret-actions">${actionButton(ACTION.toggle, id, revealedSecrets.has(id) ? t('apiKeys.hideKey') : t('apiKeys.showKey'), revealedSecrets.has(id) ? 'eye-off' : 'eye')}${actionButton(ACTION.copy, id, t('apiKeys.copyKey'), 'copy')}</div></div><div class="list-row-side"><button type="button" class="favorite-button${favorite ? ' is-favorite' : ''}" data-action="${ACTION.favorite}" data-id="${escapeHTML(id)}" aria-label="${escapeHTML(favorite ? t('apiKeys.removeFavorite') : t('apiKeys.markFavorite'))}">${icon('star')}</button>${actionButton(ACTION.edit, id, t('common.edit'), 'edit')}${actionButton(archiveAction, id, archiveLabel, archiveIcon)}${actionButton(ACTION.delete, id, deleteLabel, 'trash')}</div></article>`;
}

function renderEmpty() {
  const archived = pageContext.archive;
  const title = archived ? t('apiKeys.archivedKeys') : filters.search || filters.category || filters.environment || filters.favoriteOnly ? t('apiKeys.noMatchingKeys') : t('apiKeys.noKeys');
  const message = archived ? t('archive.emptyDescription') : filters.search || filters.category || filters.environment || filters.favoriteOnly ? t('apiKeys.noMatchingKeysDescription') : t('apiKeys.noKeysDescription');
  return `<section class="empty-state" role="status"><div class="empty-state-icon">${icon(archived ? 'archive' : 'key-round')}</div><h3>${escapeHTML(title)}</h3><p>${escapeHTML(message)}</p>${archived ? '' : `<button type="button" class="button button-primary" data-action="${ACTION.add}">${icon('plus')}<span>${escapeHTML(t('apiKeys.addKey'))}</span></button>`}</section>`;
}

function renderLocked() {
  return `<section class="empty-state" role="status"><div class="empty-state-icon">${icon('lock')}</div><h3>${escapeHTML(t('common.notAvailable'))}</h3><p>${escapeHTML(t('auth.securityNote'))}</p></section>`;
}

function renderLoading() {
  return `<section class="page-state" role="status"><span class="loading-mark"><span></span></span><strong>${escapeHTML(t('common.loading'))}</strong></section>`;
}

function renderError() {
  return `<section class="empty-state" role="alert"><div class="empty-state-icon">${icon('alert')}</div><h3>${escapeHTML(t('toast.operationFailed'))}</h3><p>${escapeHTML(t('auth.unexpectedError'))}</p></section>`;
}

function renderResultsMarkup() {
  if (!currentKey()) {
    return renderLocked();
  }
  const list = filteredRecords();
  if (list.length === 0) {
    return renderEmpty();
  }
  return viewMode === 'grid' ? `<div class="cards-grid">${list.map(renderCard).join('')}</div>` : `<div class="list-view">${list.map(renderListRow).join('')}</div>`;
}

function renderToolbar() {
  const categories = categoryOptions();
  const environments = environmentOptions();
  const categoryOptionsMarkup = categories.map((value) => `<option value="${escapeHTML(value)}"${filters.category === value ? ' selected' : ''}>${escapeHTML(value)}</option>`).join('');
  const environmentOptionsMarkup = environments.map((value) => `<option value="${escapeHTML(value)}"${filters.environment === value ? ' selected' : ''}>${escapeHTML(environmentLabel(value))}</option>`).join('');
  return `<div class="page-toolbar-card"><div class="toolbar"><div class="toolbar-start"><div class="input-control toolbar-search"><span class="input-leading">${icon('search')}</span><input id="api-key-search" name="api-key-search" type="search" autocomplete="off" data-action="${ACTION.search}" value="${escapeHTML(filters.search)}" placeholder="${escapeHTML(t('apiKeys.searchPlaceholder'))}" aria-label="${escapeHTML(t('common.search'))}"></div><div class="select-control"><select id="api-key-category-filter" name="api-key-category" data-action="${ACTION.category}" aria-label="${escapeHTML(t('apiKeys.filterByCategory'))}"><option value="">${escapeHTML(t('common.allCategories'))}</option>${categoryOptionsMarkup}</select></div><div class="select-control"><select id="api-key-environment-filter" name="api-key-environment" data-action="${ACTION.environment}" aria-label="${escapeHTML(t('apiKeys.filterByEnvironment'))}"><option value="">${escapeHTML(t('common.all'))}</option>${environmentOptionsMarkup}</select></div><button type="button" class="filter-chip${filters.favoriteOnly ? ' is-active' : ''}" data-action="${ACTION.favoriteFilter}" aria-pressed="${String(filters.favoriteOnly)}">${icon('star')}<span>${escapeHTML(t('apiKeys.favoriteKeys'))}</span></button></div><div class="toolbar-end"><div class="view-switcher"><button type="button" class="${viewMode === 'grid' ? 'is-active' : ''}" data-action="${ACTION.grid}" aria-label="${escapeHTML(t('common.gridView'))}">${icon('grid-view')}</button><button type="button" class="${viewMode === 'list' ? 'is-active' : ''}" data-action="${ACTION.list}" aria-label="${escapeHTML(t('common.listView'))}">${icon('list-view')}</button></div><button type="button" class="button button-secondary button-small" data-action="${ACTION.clear}">${icon('filter-x')}<span>${escapeHTML(t('common.clearFilters'))}</span></button></div></div></div>`;
}

function renderPageMarkup() {
  const title = pageContext.archive ? t('apiKeys.archivedKeys') : t('apiKeys.title');
  const subtitle = pageContext.archive ? t('archive.subtitle') : t('apiKeys.subtitle');
  const actions = pageContext.archive
    ? `<a class="button button-secondary" href="#api-keys">${icon('key-round')}<span>${escapeHTML(t('apiKeys.allKeys'))}</span></a>`
    : `<a class="button button-secondary" href="#api-archive">${icon('archive')}<span>${escapeHTML(t('apiKeys.archivedKeys'))}</span></a><button type="button" class="button button-primary" data-action="${ACTION.add}">${icon('plus')}<span>${escapeHTML(t('apiKeys.addKey'))}</span></button>`;
  return `<div class="feature-page-header"><div class="feature-page-header-copy"><h2>${escapeHTML(title)}</h2><p>${escapeHTML(subtitle)}</p></div><div class="page-header-actions">${actions}</div></div>${renderToolbar()}<div data-results>${renderLoading()}</div>`;
}

function renderResults() {
  if (!pageRoot) {
    return;
  }
  const target = pageRoot.querySelector('[data-results]');
  if (target) {
    target.innerHTML = renderResultsMarkup();
  }
}

function bindRoot() {
  addRootListener(pageRoot, 'click', handleClick);
  addRootListener(pageRoot, 'input', handleInput);
  addRootListener(pageRoot, 'change', handleChange);
}

function actionFor(value) {
  const action = String(value || '');
  const aliases = {
    'api-key-add': ACTION.add,
    'add-api-key': ACTION.add,
    'api-key-edit': ACTION.edit,
    'edit-api-key': ACTION.edit,
    'favorite-key': ACTION.favorite,
    'toggle-key-favorite': ACTION.favorite,
    'api-key-favorite': ACTION.favorite,
    'api-key-archive': ACTION.archive,
    'archive-key': ACTION.archive,
    'api-key-restore': ACTION.restore,
    'restore-key': ACTION.restore,
    'api-key-delete': ACTION.delete,
    'delete-key': ACTION.delete,
    'api-key-toggle': ACTION.toggle,
    'toggle-key': ACTION.toggle,
    'show-key': ACTION.toggle,
    'api-key-copy': ACTION.copy,
    'copy-key': ACTION.copy,
    'api-key-search': ACTION.search,
    'search-api-key': ACTION.search,
    'api-key-category': ACTION.category,
    'filter-api-key-category': ACTION.category,
    'api-key-environment': ACTION.environment,
    'filter-api-key-environment': ACTION.environment,
    'api-key-favorite-filter': ACTION.favoriteFilter,
    'filter-api-key-favorites': ACTION.favoriteFilter,
    'api-key-clear-filters': ACTION.clear,
    'clear-api-key-filters': ACTION.clear,
    'api-key-grid': ACTION.grid,
    'api-key-list': ACTION.list,
    'grid-view': ACTION.grid,
    'list-view': ACTION.list
  };
  return aliases[action] || action;
}

function getActionId(target) {
  return safeId(target?.closest?.('[data-id]')?.dataset?.id || '');
}

async function getRecord(id) {
  if (!id) {
    return null;
  }
  try {
    return await getById(STORE, id);
  } catch {
    return null;
  }
}

async function reloadRecords() {
  const currentGeneration = generation;
  try {
    const result = await getAll(STORE);
    const nextRecords = Array.isArray(result) ? result.filter(isObject) : [];
    if (currentGeneration !== generation || !pageRoot) {
      return false;
    }
    records = nextRecords;
    return true;
  } catch {
    if (currentGeneration === generation) {
      records = [];
    }
    throw new Error('load-failed');
  }
}

async function decryptKey(record, key) {
  const value = record?.keyValue;
  if (value === undefined || value === null || value === '') {
    return '';
  }
  if (isEnvelope(value)) {
    try {
      return await decryptText(value, key);
    } catch {
      return '';
    }
  }
  const envelope = parseEnvelope(value);
  if (envelope) {
    try {
      return await decryptText(envelope, key);
    } catch {
      return '';
    }
  }
  return typeof value === 'string' ? value : '';
}

async function ensureWritableKey() {
  const key = currentKey();
  if (!key) {
    notifyLocked();
    return null;
  }
  return key;
}

async function refreshView() {
  try {
    await reloadRecords();
    renderResults();
  } catch {
    if (pageRoot?.querySelector('[data-results]')) {
      pageRoot.querySelector('[data-results]').innerHTML = renderError();
    }
  }
}

async function handleItemAction(action, id) {
  if (!id) {
    return;
  }
  const key = await ensureWritableKey();
  if (!key) {
    return;
  }
  const record = await getRecord(id);
  if (!record) {
    notifyError();
    return;
  }
  if (action === ACTION.favorite) {
    const next = { ...record, isFavorite: !Boolean(record.isFavorite), updatedAt: new Date().toISOString() };
    try {
      await put(STORE, next);
      dispatchChange('favorite');
      showToast(t('toast.updated'), 'success');
      await refreshView();
    } catch {
      notifyError();
    }
    return;
  }
  if (action === ACTION.archive || action === ACTION.restore) {
    const restoring = action === ACTION.restore;
    const confirmed = await confirmAction({
      title: restoring ? t('apiKeys.restoreKey') : t('apiKeys.archiveKey'),
      message: restoring ? t('archive.restoreConfirm') : t('apiKeys.archiveKey'),
      confirmLabel: restoring ? t('archive.restore') : t('apiKeys.archiveKey'),
      type: restoring ? 'primary' : 'secondary'
    });
    if (!confirmed) {
      return;
    }
    const next = { ...record, isArchived: restoring ? false : true, updatedAt: new Date().toISOString() };
    try {
      await put(STORE, next);
      dispatchChange(restoring ? 'restore' : 'archive');
      showToast(restoring ? t('toast.restored') : t('toast.archived'), 'success');
      await refreshView();
    } catch {
      notifyError();
    }
    return;
  }
  if (action === ACTION.delete) {
    const confirmed = await confirmAction({
      title: t('common.deleteConfirm'),
      message: t('apiKeys.deleteKeyConfirm'),
      confirmLabel: t('archive.deletePermanently'),
      type: 'danger'
    });
    if (!confirmed) {
      return;
    }
    try {
      await remove(STORE, id);
      secretCache.delete(id);
      revealedSecrets.delete(id);
      dispatchChange('delete');
      showToast(t('toast.deleted'), 'success');
      await refreshView();
    } catch {
      notifyError();
    }
  }
}

async function handleClick(event) {
  const target = event.target?.closest?.('[data-action]');
  if (!target || !pageRoot?.contains?.(target)) {
    return;
  }
  const action = actionFor(target.dataset.action);
  if (action === ACTION.add) {
    event.preventDefault();
    void openApiKeyEditor();
    return;
  }
  if (action === ACTION.grid) {
    event.preventDefault();
    viewMode = 'grid';
    renderPage();
    return;
  }
  if (action === ACTION.list) {
    event.preventDefault();
    viewMode = 'list';
    renderPage();
    return;
  }
  if (action === ACTION.favoriteFilter) {
    event.preventDefault();
    filters.favoriteOnly = !filters.favoriteOnly;
    renderPage();
    return;
  }
  if (action === ACTION.clear) {
    event.preventDefault();
    filters.search = '';
    filters.category = '';
    filters.environment = '';
    filters.favoriteOnly = false;
    renderPage();
    return;
  }
  if (action === ACTION.edit) {
    event.preventDefault();
    void openApiKeyEditor(getActionId(target));
    return;
  }
  if (action === ACTION.toggle) {
    event.preventDefault();
    const id = getActionId(target);
    if (!id) {
      return;
    }
    if (revealedSecrets.has(id)) {
      revealedSecrets.delete(id);
      secretCache.delete(id);
      renderResults();
      return;
    }
    const pageGeneration = generation;
    const key = await ensureWritableKey();
    if (!key) {
      return;
    }
    const record = await getRecord(id);
    if (!record) {
      notifyError();
      return;
    }
    const value = await decryptKey(record, key);
    if (pageGeneration !== generation || !currentKey() || !pageRoot?.contains(target)) {
      return;
    }
    if (!value) {
      notifyError();
      return;
    }
    secretCache.set(id, value);
    revealedSecrets.add(id);
    renderResults();
    return;
  }
  if (action === ACTION.copy) {
    event.preventDefault();
    const id = getActionId(target);
    const pageGeneration = generation;
    const key = await ensureWritableKey();
    if (!id || !key) {
      return;
    }
    const record = await getRecord(id);
    const value = record ? await decryptKey(record, key) : '';
    if (pageGeneration !== generation || !currentKey() || !pageRoot?.contains(target)) {
      return;
    }
    if (!value) {
      notifyError();
      return;
    }
    const copied = await copyText(value);
    showToast(copied ? t('apiKeys.keyCopied') : t('toast.operationFailed'), copied ? 'success' : 'error');
    return;
  }
  await handleItemAction(action, getActionId(target));
}

function handleInput(event) {
  const target = event.target;
  if (actionFor(target?.dataset?.action) !== ACTION.search) {
    return;
  }
  filters.search = String(target.value ?? '');
  renderResults();
}

function handleChange(event) {
  const target = event.target;
  const action = actionFor(target?.dataset?.action);
  if (action === ACTION.category) {
    filters.category = String(target.value ?? '');
    renderResults();
  } else if (action === ACTION.environment) {
    filters.environment = String(target.value ?? '');
    renderResults();
  }
}

function renderPage() {
  if (!pageRoot) {
    return;
  }
  pageRoot.innerHTML = renderPageMarkup();
  renderResults();
}

async function loadPage() {
  const currentGeneration = generation;
  try {
    await reloadRecords();
    if (currentGeneration !== generation || !pageRoot) {
      return;
    }
    renderResults();
  } catch {
    if (currentGeneration === generation && pageRoot) {
      renderResults();
    }
  }
}

function setEditorError(form, message) {
  const error = form.querySelector('[data-editor-error]');
  if (error) {
    error.textContent = String(message || '');
  }
}

function editorField({ id, name, label, type = 'text', value = '', placeholder = '', required = false, multiline = false, autocomplete = 'off' }) {
  const labelMarkup = `<label for="${escapeHTML(id)}">${escapeHTML(label)}${required ? '' : ` <span class="field-hint">${escapeHTML(t('common.optional'))}</span>`}</label>`;
  if (multiline) {
    return `<div class="form-field">${labelMarkup}<div class="textarea-control"><textarea id="${escapeHTML(id)}" name="${escapeHTML(name)}" placeholder="${escapeHTML(placeholder)}" rows="4">${escapeHTML(value)}</textarea></div></div>`;
  }
  return `<div class="form-field">${labelMarkup}<div class="input-control"><input id="${escapeHTML(id)}" name="${escapeHTML(name)}" type="${escapeHTML(type)}" value="${escapeHTML(value)}" placeholder="${escapeHTML(placeholder)}" autocomplete="${escapeHTML(autocomplete)}"${required ? ' required' : ''}></div></div>`;
}

function editorSelect({ id, name, label, value, options }) {
  const optionMarkup = options.map((option) => `<option value="${escapeHTML(option.value)}"${String(option.value) === String(value) ? ' selected' : ''}>${escapeHTML(option.label)}</option>`).join('');
  return `<div class="form-field"><label for="${escapeHTML(id)}">${escapeHTML(label)}</label><div class="select-control"><select id="${escapeHTML(id)}" name="${escapeHTML(name)}">${optionMarkup}</select></div></div>`;
}

function editorEnvironmentSelect(value) {
  return editorSelect({
    id: 'api-key-editor-environment',
    name: 'environment',
    label: t('apiKeys.environment'),
    value,
    options: [
      { value: '', label: t('common.select') },
      { value: 'production', label: t('apiKeys.production') },
      { value: 'development', label: t('apiKeys.development') },
      { value: 'testing', label: t('apiKeys.testing') }
    ]
  });
}

function closeEditorSession(session) {
  if (!session || session.closed) {
    return;
  }
  session.closed = true;
  for (const removeListener of session.cleanup) {
    removeListener();
  }
  session.cleanup = [];
  secretCache.delete(session.recordId);
  if (editorSession === session) {
    editorSession = null;
  }
}

function makeApiEditor(record) {
  const editing = Boolean(record);
  const form = globalThis.document.createElement('form');
  form.className = 'modal-form';
  form.noValidate = true;
  form.setAttribute('data-api-key-editor', 'true');
  const existingEnvironment = normalizeEnvironment(record?.environment);
  form.innerHTML = `${editorField({ id: 'api-key-editor-title', name: 'title', label: t('apiKeys.keyTitle'), value: textValue(record?.title), placeholder: t('apiKeys.keyTitlePlaceholder'), required: true })}${editorField({ id: 'api-key-editor-value', name: 'keyValue', label: t('apiKeys.keyValue'), type: 'password', placeholder: t('apiKeys.keyValuePlaceholder') })}${editorField({ id: 'api-key-editor-service', name: 'serviceName', label: t('apiKeys.serviceName'), value: textValue(record?.serviceName), placeholder: t('apiKeys.serviceNamePlaceholder') })}${editorField({ id: 'api-key-editor-category', name: 'category', label: t('common.category'), value: textValue(record?.category), placeholder: t('apiKeys.categoryPlaceholder') })}${editorEnvironmentSelect(existingEnvironment)}${editorField({ id: 'api-key-editor-tags', name: 'tags', label: t('common.tags'), value: normalizeTags(record?.tags).join(', '), placeholder: t('common.tags') })}${editorField({ id: 'api-key-editor-notes', name: 'notes', label: t('apiKeys.keyNotes'), value: String(record?.notes ?? ''), placeholder: t('apiKeys.keyNotesPlaceholder'), multiline: true })}<p class="form-error" data-editor-error role="alert"></p><button type="submit" class="button button-primary button-block" data-action="api-key-editor-submit">${icon('check')}<span>${escapeHTML(t('common.save'))}</span></button>`;
  const submit = form.querySelector('[type="submit"]');
  const session = {
    recordId: safeId(record?.id),
    form,
    handle: null,
    closed: false,
    cleanup: []
  };
  const handleSubmit = async (event) => {
    event.preventDefault();
    if (session.closed) {
      return;
    }
    const key = await ensureWritableKey();
    if (!key) {
      return;
    }
    const title = textValue(form.elements.title?.value);
    const keyValue = String(form.elements.keyValue?.value ?? '');
    if (!title || (!editing && !keyValue)) {
      setEditorError(form, t('validation.required'));
      showToast(t('validation.required'), 'error');
      return;
    }
    setEditorError(form, '');
    setButtonLoading(submit, true);
    try {
      const now = new Date().toISOString();
      const next = {
        id: editing ? safeId(record.id) : createId(),
        title,
        serviceName: textValue(form.elements.serviceName?.value),
        category: textValue(form.elements.category?.value),
        environment: normalizeEnvironment(form.elements.environment?.value),
        notes: String(form.elements.notes?.value ?? ''),
        tags: normalizeTags(form.elements.tags?.value),
        isFavorite: Boolean(record?.isFavorite),
        isArchived: Boolean(record?.isArchived),
        createdAt: textValue(record?.createdAt) || now,
        updatedAt: now
      };
      if (keyValue) {
        next.keyValue = await encryptText(keyValue, key);
      } else if (editing && record?.keyValue) {
        const envelope = parseEnvelope(record.keyValue);
        if (envelope) {
          next.keyValue = envelope;
        } else if (typeof record.keyValue === 'string') {
          next.keyValue = await encryptText(record.keyValue, key);
        }
      }
      await put(STORE, next);
      dispatchChange(editing ? 'update' : 'create');
      showToast(t('toast.saved'), 'success');
      session.handle?.close?.();
      await refreshView();
    } catch {
      notifyError();
    } finally {
      setButtonLoading(submit, false);
    }
  };
  form.addEventListener('submit', handleSubmit);
  session.cleanup.push(() => form.removeEventListener('submit', handleSubmit));
  return session;
}

export async function openApiKeyEditor(recordId, options = {}) {
  void options;
  const id = textValue(recordId);
  const key = await ensureWritableKey();
  if (!key) {
    return null;
  }
  let record = null;
  if (id) {
    record = await getRecord(id);
    if (!currentKey()) {
      notifyLocked();
      return null;
    }
    if (!record) {
      notifyError();
      return null;
    }
  }
  if (editorSession) {
    const previous = editorSession;
    previous.handle?.close?.();
    closeEditorSession(previous);
  }
  const session = makeApiEditor(record);
  const handle = openModal({
    title: record ? t('apiKeys.editKey') : t('apiKeys.newKey'),
    content: session.form,
    size: 'lg',
    actions: [{ label: t('common.cancel'), variant: 'secondary' }],
    onClose: () => closeEditorSession(session)
  });
  if (!handle) {
    closeEditorSession(session);
    return null;
  }
  session.handle = handle;
  editorSession = session;
  return handle;
}

function clearPageState() {
  for (const removeListener of cleanup) {
    removeListener();
  }
  cleanup = [];
  for (const observer of observers) {
    removeObserver(observer);
  }
  observers.clear();
  if (editorSession) {
    const session = editorSession;
    session.handle?.close?.();
    closeEditorSession(session);
  }
  secretCache = new Map();
  revealedSecrets = new Set();
  records = [];
  filters = {
    search: '',
    category: '',
    environment: '',
    favoriteOnly: false
  };
  pageRoot = null;
}

export function renderApiKeysPage(container, context = {}) {
  clearPageState();
  generation += 1;
  if (!container || container.nodeType !== 1) {
    return null;
  }
  pageRoot = container;
  pageContext = { archive: Boolean(context?.archive) };
  container.innerHTML = renderPageMarkup();
  bindRoot();
  void loadPage();
  return container;
}

export function disposeApiKeysPage() {
  generation += 1;
  clearPageState();
  pageContext = { archive: false };
}

export const renderApikeysPage = renderApiKeysPage;
export const renderAPIKeysPage = renderApiKeysPage;
export const disposeApikeysPage = disposeApiKeysPage;
export const disposeAPIKeysPage = disposeApiKeysPage;
export const openApikeyEditor = openApiKeyEditor;
export const openAPIKeyEditor = openApiKeyEditor;
