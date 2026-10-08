import { t } from './i18n.js';
import {
  CREDENTIAL_STORE,
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
  openExternalUrl,
  openModal,
  setButtonLoading,
  showToast
} from './ui.js';

const STORE = CREDENTIAL_STORE;
const USERNAME_MASK = '••••••••';
const PASSWORD_MASK = '••••••••••••';
const FAVICON_MAX_BYTES = 512 * 1024;
const GLOBE_SPRITE = 'globe';
const ACTION = Object.freeze({
  add: 'add-credential',
  edit: 'edit-credential',
  favorite: 'favorite-credential',
  archive: 'archive-credential',
  restore: 'restore-credential',
  delete: 'delete-credential',
  username: 'show-username',
  password: 'show-password',
  copyUsername: 'copy-username',
  copyPassword: 'copy-password',
  openSite: 'open-site',
  search: 'search-credential',
  category: 'filter-credential-category',
  favoriteFilter: 'filter-credential-favorites',
  clear: 'clear-credential-filters',
  grid: 'credential-grid-view',
  list: 'credential-list-view',
  faviconAuto: 'credential-favicon-auto',
  faviconUpload: 'credential-favicon-upload'
});

let viewMode = 'grid';
let pageRoot = null;
let pageContext = { archive: false };
let items = [];
let filters = {
  search: '',
  category: '',
  favoriteOnly: false
};
let generation = 0;
let cleanup = [];
let editorSession = null;
let revealedUsernames = new Set();
let revealedPasswords = new Set();
let observers = new Set();

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function textValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function safeId(value) {
  return value === undefined || value === null ? '' : String(value);
}

function currentKey() {
  const key = getMasterKey();
  return key && typeof key === 'object' ? key : null;
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

function normalizeHttpUrl(value) {
  const raw = textValue(value);
  if (!raw) {
    return '';
  }
  const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(raw);
  if (hasScheme && !/^https?:\/\//i.test(raw)) {
    return '';
  }
  const candidate = hasScheme ? raw : `https://${raw}`;
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    return '';
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) {
    return '';
  }
  return parsed.href;
}

function isHttpUrl(value) {
  return Boolean(normalizeHttpUrl(value));
}

function dataUrlSize(value) {
  if (typeof value !== 'string') {
    return Number.POSITIVE_INFINITY;
  }
  const match = /^data:([^;,]+)(?:;base64)?,([\s\S]*)$/i.exec(value);
  if (!match || !/^image\/(?:png|jpeg|webp|gif)$/i.test(match[1])) {
    return Number.POSITIVE_INFINITY;
  }
  if (value.slice(0, match[0].length).toLowerCase().includes(';base64')) {
    const encoded = match[2].replace(/\s/g, '');
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
      return Number.POSITIVE_INFINITY;
    }
    const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
    return Math.max(0, Math.floor(encoded.length * 3 / 4) - padding);
  }
  return match[2].length;
}

function isValidImageDataUrl(value) {
  return typeof value === 'string' && /^data:image\/(?:png|jpeg|webp|gif);base64,[a-z\d+/]+={0,2}$/i.test(value) && dataUrlSize(value) <= FAVICON_MAX_BYTES;
}

function isValidFavicon(value) {
  return isValidImageDataUrl(value) || isHttpUrl(value);
}

function guessFavicon(siteUrl) {
  const normalized = normalizeHttpUrl(siteUrl);
  if (!normalized) {
    return '';
  }
  try {
    const parsed = new URL(normalized);
    return `${parsed.origin}/favicon.ico`;
  } catch {
    return '';
  }
}

function faviconForRecord(record) {
  const saved = textValue(record?.faviconUrl);
  if (isValidImageDataUrl(saved)) {
    return saved;
  }
  if (record?.faviconAuto === true && globalThis.navigator?.onLine !== false) {
    const guessed = guessFavicon(record?.siteUrl);
    if (isHttpUrl(guessed)) {
      return guessed;
    }
  }
  return '';
}

function passwordScore(value) {
  const password = typeof value === 'string' ? value : '';
  if (!password) {
    return 0;
  }
  const characters = Array.from(password);
  let score = characters.length >= 8 ? 1 : 0;
  if (characters.length >= 12) {
    score += 1;
  }
  const categories = [
    /\p{Ll}/u.test(password),
    /\p{Lu}/u.test(password),
    /\p{N}/u.test(password),
    /[^\p{L}\p{N}\s]/u.test(password)
  ].filter(Boolean).length;
  if (categories >= 2) {
    score += 1;
  }
  if (categories >= 3) {
    score += 1;
  }
  if (/^(password|qwerty|admin|welcome|letmein)/i.test(password)) {
    score = Math.min(score, 1);
  }
  return Math.max(0, Math.min(4, score));
}

function strengthLabel(score) {
  if (score <= 1) {
    return t('credentials.weak');
  }
  if (score === 2) {
    return t('credentials.fair');
  }
  if (score === 3) {
    return t('credentials.strong');
  }
  return t('credentials.veryStrong');
}

function strengthMarkup(score) {
  const normalized = Math.max(0, Math.min(4, Number(score) || 0));
  return `<div class="credential-strength" data-score="${normalized}"><div class="credential-strength-track" aria-hidden="true"><span style="width:${normalized * 25}%"></span></div><span>${escapeHTML(strengthLabel(normalized))}</span></div>`;
}

function faviconMarkup(url) {
  if (!isValidFavicon(url)) {
    return `<span class="credential-icon" data-favicon-fallback="true">${icon(GLOBE_SPRITE)}</span>`;
  }
  return `<img class="credential-icon" data-favicon="true" src="${escapeHTML(url)}" alt="" loading="lazy">`;
}

function replaceFaviconWithFallback(target) {
  const doc = target?.ownerDocument;
  if (!doc || !target.parentNode) {
    return;
  }
  const fallback = doc.createElement('span');
  fallback.className = 'credential-icon';
  fallback.setAttribute('data-favicon-fallback', 'true');
  fallback.innerHTML = icon(GLOBE_SPRITE);
  target.replaceWith(fallback);
}

function handleFaviconError(event) {
  const target = event.target;
  if (target?.matches?.('img[data-favicon="true"]')) {
    replaceFaviconWithFallback(target);
  }
}

function recordMatchesArchive(record) {
  return Boolean(record?.isArchived) === pageContext.archive;
}

function faviconSearchText(value) {
  const text = textValue(value);
  if (!text) {
    return '';
  }
  if (isValidImageDataUrl(text)) {
    return `data:image ${text.slice(0, 96)}`;
  }
  return text;
}

function searchText(item) {
  const record = item.record;
  return [
    record.siteName,
    record.siteUrl,
    record.category,
    faviconSearchText(record.faviconUrl),
    item.usernamePlain,
    Array.isArray(record.tags) ? record.tags.join(' ') : record.tags
  ].map((value) => String(value ?? '')).join(' ').toLocaleLowerCase();
}

function filteredItems() {
  const query = textValue(filters.search).toLocaleLowerCase();
  const category = textValue(filters.category).toLocaleLowerCase();
  return items
    .filter((item) => recordMatchesArchive(item.record))
    .filter((item) => !filters.favoriteOnly || Boolean(item.record.isFavorite))
    .filter((item) => !category || textValue(item.record.category).toLocaleLowerCase() === category)
    .filter((item) => !query || searchText(item).includes(query))
    .sort((left, right) => {
      const favoriteOrder = Number(Boolean(right.record.isFavorite)) - Number(Boolean(left.record.isFavorite));
      if (favoriteOrder !== 0) {
        return favoriteOrder;
      }
      return String(right.record.updatedAt || right.record.createdAt || '').localeCompare(String(left.record.updatedAt || left.record.createdAt || ''));
    });
}

function routeItems() {
  return items.filter((item) => recordMatchesArchive(item.record));
}

function categoryOptions() {
  const values = new Set();
  for (const item of routeItems()) {
    const value = textValue(item.record.category);
    if (value) {
      values.add(value);
    }
  }
  return Array.from(values).sort((left, right) => left.localeCompare(right));
}

async function decryptSecret(value, key) {
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

async function hydrateItems(records, key) {
  const hydrated = [];
  for (const record of records) {
    const item = {
      record,
      usernamePlain: '',
      passwordPlain: '',
      score: 0
    };
    if (key) {
      item.usernamePlain = await decryptSecret(record.username, key);
      item.passwordPlain = await decryptSecret(record.password, key);
      item.score = passwordScore(item.passwordPlain);
    }
    hydrated.push(item);
  }
  return hydrated;
}

async function reloadItems() {
  const currentGeneration = generation;
  try {
    const result = await getAll(STORE);
    const records = Array.isArray(result) ? result.filter(isObject) : [];
    const nextItems = await hydrateItems(records, currentKey());
    if (currentGeneration !== generation || !pageRoot) {
      return false;
    }
    items = nextItems;
    return true;
  } catch {
    if (currentGeneration === generation) {
      items = [];
    }
    throw new Error('load-failed');
  }
}

async function ensureWritableKey() {
  const key = currentKey();
  if (!key) {
    notifyLocked();
    return null;
  }
  return key;
}

function renderTags(tags) {
  return normalizeTags(tags).map((tag) => `<span class="tag">${escapeHTML(tag)}</span>`).join('');
}

function renderCredentialCard(item) {
  const record = item.record;
  const id = safeId(record.id);
  const usernameVisible = revealedUsernames.has(id) && Boolean(item.usernamePlain);
  const passwordVisible = revealedPasswords.has(id) && Boolean(item.passwordPlain);
  const archiveAction = pageContext.archive ? ACTION.restore : ACTION.archive;
  const archiveLabel = pageContext.archive ? t('credentials.restoreCredential') : t('credentials.archiveCredential');
  const archiveIcon = pageContext.archive ? 'refresh' : 'archive';
  const deleteLabel = pageContext.archive ? t('archive.deletePermanently') : t('credentials.deleteCredential');
  return `<article class="card data-card credential-card" data-id="${escapeHTML(id)}"><div class="credential-header">${faviconMarkup(faviconForRecord(record))}<div><strong>${escapeHTML(textValue(record.siteName) || t('credentials.newCredential'))}</strong><small>${escapeHTML(textValue(record.siteUrl))}</small></div><button type="button" class="favorite-button${record.isFavorite ? ' is-favorite' : ''}" data-action="${ACTION.favorite}" data-id="${escapeHTML(id)}" aria-label="${escapeHTML(record.isFavorite ? t('apiKeys.removeFavorite') : t('apiKeys.markFavorite'))}">${icon('star')}</button></div><div class="credential-fields"><div class="credential-field"><span>${escapeHTML(t('credentials.username'))}</span><div class="credential-field-value"><span>${usernameVisible ? escapeHTML(item.usernamePlain) : USERNAME_MASK}</span><div class="secret-actions"><button type="button" class="icon-button" data-action="${ACTION.username}" data-id="${escapeHTML(id)}" aria-label="${escapeHTML(usernameVisible ? t('common.hide') : t('common.show'))}">${icon(usernameVisible ? 'eye-off' : 'eye')}</button><button type="button" class="icon-button" data-action="${ACTION.copyUsername}" data-id="${escapeHTML(id)}" aria-label="${escapeHTML(t('credentials.copyUsername'))}">${icon('copy')}</button></div></div></div><div class="credential-field"><span>${escapeHTML(t('credentials.password'))}</span><div class="credential-field-value"><span>${passwordVisible ? escapeHTML(item.passwordPlain) : PASSWORD_MASK}</span><div class="secret-actions"><button type="button" class="icon-button" data-action="${ACTION.password}" data-id="${escapeHTML(id)}" aria-label="${escapeHTML(passwordVisible ? t('common.hide') : t('common.show'))}">${icon(passwordVisible ? 'eye-off' : 'eye')}</button><button type="button" class="icon-button" data-action="${ACTION.copyPassword}" data-id="${escapeHTML(id)}" aria-label="${escapeHTML(t('credentials.copyPassword'))}">${icon('copy')}</button></div></div></div>${strengthMarkup(item.score)}</div>${textValue(record.notes) ? `<p>${escapeHTML(record.notes)}</p>` : ''}<div class="data-card-meta">${textValue(record.category) ? `<span class="badge badge-neutral">${escapeHTML(record.category)}</span>` : ''}${renderTags(record.tags)}</div><div class="credential-actions"><button type="button" class="button button-secondary button-small" data-action="${ACTION.openSite}" data-id="${escapeHTML(id)}"${isHttpUrl(record.siteUrl) ? '' : ' disabled'}>${icon('external-link')}<span>${escapeHTML(t('credentials.openSite'))}</span></button><button type="button" class="button button-secondary button-small" data-action="${ACTION.edit}" data-id="${escapeHTML(id)}">${icon('edit')}<span>${escapeHTML(t('common.edit'))}</span></button><button type="button" class="button button-secondary button-small" data-action="${archiveAction}" data-id="${escapeHTML(id)}">${icon(archiveIcon)}<span>${escapeHTML(archiveLabel)}</span></button><button type="button" class="button button-danger button-small" data-action="${ACTION.delete}" data-id="${escapeHTML(id)}">${icon('trash')}<span>${escapeHTML(deleteLabel)}</span></button></div></article>`;
}

function renderCredentialRow(item) {
  const record = item.record;
  const id = safeId(record.id);
  const usernameVisible = revealedUsernames.has(id) && Boolean(item.usernamePlain);
  const passwordVisible = revealedPasswords.has(id) && Boolean(item.passwordPlain);
  const archiveAction = pageContext.archive ? ACTION.restore : ACTION.archive;
  const archiveLabel = pageContext.archive ? t('credentials.restoreCredential') : t('credentials.archiveCredential');
  const archiveIcon = pageContext.archive ? 'refresh' : 'archive';
  const deleteLabel = pageContext.archive ? t('archive.deletePermanently') : t('credentials.deleteCredential');
  return `<article class="list-row card" data-id="${escapeHTML(id)}"><div class="list-row-main">${faviconMarkup(faviconForRecord(record))}<div class="list-row-copy"><strong>${escapeHTML(textValue(record.siteName) || t('credentials.newCredential'))}</strong><small>${escapeHTML([textValue(record.siteUrl), textValue(record.category)].filter(Boolean).join(' · '))}</small></div></div><div class="list-row-side"><div class="credential-field"><span>${escapeHTML(t('credentials.username'))}</span><div class="credential-field-value"><span>${usernameVisible ? escapeHTML(item.usernamePlain) : USERNAME_MASK}</span><button type="button" class="icon-button" data-action="${ACTION.copyUsername}" data-id="${escapeHTML(id)}" aria-label="${escapeHTML(t('credentials.copyUsername'))}">${icon('copy')}</button></div></div><div class="credential-field"><span>${escapeHTML(t('credentials.password'))}</span><div class="credential-field-value"><span>${passwordVisible ? escapeHTML(item.passwordPlain) : PASSWORD_MASK}</span><button type="button" class="icon-button" data-action="${ACTION.copyPassword}" data-id="${escapeHTML(id)}" aria-label="${escapeHTML(t('credentials.copyPassword'))}">${icon('copy')}</button></div></div>${strengthMarkup(item.score)}<button type="button" class="favorite-button${record.isFavorite ? ' is-favorite' : ''}" data-action="${ACTION.favorite}" data-id="${escapeHTML(id)}" aria-label="${escapeHTML(record.isFavorite ? t('apiKeys.removeFavorite') : t('apiKeys.markFavorite'))}">${icon('star')}</button>${actionButton(ACTION.openSite, id, t('credentials.openSite'), 'external-link', !isHttpUrl(record.siteUrl))}${actionButton(ACTION.edit, id, t('common.edit'), 'edit')}${actionButton(archiveAction, id, archiveLabel, archiveIcon)}${actionButton(ACTION.delete, id, deleteLabel, 'trash')}</div></article>`;
}

function actionButton(action, id, label, iconName, disabled = false) {
  return `<button type="button" class="icon-button" data-action="${action}" data-id="${escapeHTML(safeId(id))}" aria-label="${escapeHTML(label)}" title="${escapeHTML(label)}"${disabled ? ' disabled' : ''}>${icon(iconName)}</button>`;
}

function renderEmpty() {
  const archived = pageContext.archive;
  const filtered = Boolean(filters.search || filters.category || filters.favoriteOnly);
  const title = archived ? t('credentials.archivedCredentials') : filtered ? t('credentials.noMatchingCredentials') : t('credentials.noCredentials');
  const message = archived ? t('archive.emptyDescription') : filtered ? t('credentials.noMatchingCredentialsDescription') : t('credentials.noCredentialsDescription');
  return `<section class="empty-state" role="status"><div class="empty-state-icon">${icon(archived ? 'archive' : 'lock')}</div><h3>${escapeHTML(title)}</h3><p>${escapeHTML(message)}</p>${archived ? '' : `<button type="button" class="button button-primary" data-action="${ACTION.add}">${icon('plus')}<span>${escapeHTML(t('credentials.addCredential'))}</span></button>`}</section>`;
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
  const list = filteredItems();
  if (list.length === 0) {
    return renderEmpty();
  }
  return viewMode === 'grid' ? `<div class="cards-grid credential-grid">${list.map(renderCredentialCard).join('')}</div>` : `<div class="list-view">${list.map(renderCredentialRow).join('')}</div>`;
}

function renderToolbar() {
  const categories = categoryOptions();
  const categoryOptionsMarkup = categories.map((value) => `<option value="${escapeHTML(value)}"${filters.category === value ? ' selected' : ''}>${escapeHTML(value)}</option>`).join('');
  return `<div class="page-toolbar-card"><div class="toolbar"><div class="toolbar-start"><div class="input-control toolbar-search"><span class="input-leading">${icon('search')}</span><input id="credential-search" name="credential-search" type="search" autocomplete="off" data-action="${ACTION.search}" value="${escapeHTML(filters.search)}" placeholder="${escapeHTML(t('credentials.searchPlaceholder'))}" aria-label="${escapeHTML(t('common.search'))}"></div><div class="select-control"><select id="credential-category-filter" name="credential-category" data-action="${ACTION.category}" aria-label="${escapeHTML(t('credentials.credentialCategory'))}"><option value="">${escapeHTML(t('common.allCategories'))}</option>${categoryOptionsMarkup}</select></div><button type="button" class="filter-chip${filters.favoriteOnly ? ' is-active' : ''}" data-action="${ACTION.favoriteFilter}" aria-pressed="${String(filters.favoriteOnly)}">${icon('star')}<span>${escapeHTML(t('credentials.favoriteCredentials'))}</span></button></div><div class="toolbar-end"><div class="view-switcher"><button type="button" class="${viewMode === 'grid' ? 'is-active' : ''}" data-action="${ACTION.grid}" aria-label="${escapeHTML(t('common.gridView'))}">${icon('grid-view')}</button><button type="button" class="${viewMode === 'list' ? 'is-active' : ''}" data-action="${ACTION.list}" aria-label="${escapeHTML(t('common.listView'))}">${icon('list-view')}</button></div><button type="button" class="button button-secondary button-small" data-action="${ACTION.clear}">${icon('filter-x')}<span>${escapeHTML(t('common.clearFilters'))}</span></button></div></div></div>`;
}

function renderPageMarkup() {
  const title = pageContext.archive ? t('credentials.archivedCredentials') : t('credentials.title');
  const subtitle = pageContext.archive ? t('archive.subtitle') : t('credentials.subtitle');
  const actions = pageContext.archive
    ? `<a class="button button-secondary" href="#credentials">${icon('lock')}<span>${escapeHTML(t('credentials.allCredentials'))}</span></a>`
    : `<a class="button button-secondary" href="#credential-archive">${icon('archive')}<span>${escapeHTML(t('credentials.archivedCredentials'))}</span></a><button type="button" class="button button-primary" data-action="${ACTION.add}">${icon('plus')}<span>${escapeHTML(t('credentials.addCredential'))}</span></button>`;
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
  addRootListener(pageRoot, 'error', handleFaviconError, true);
}

function actionFor(value) {
  const action = String(value || '');
  const aliases = {
    'credential-add': ACTION.add,
    'add-credential': ACTION.add,
    'credentials-add': ACTION.add,
    'credential-edit': ACTION.edit,
    'edit-credential': ACTION.edit,
    'favorite-credential': ACTION.favorite,
    'toggle-credential-favorite': ACTION.favorite,
    'credential-favorite': ACTION.favorite,
    'archive-credential': ACTION.archive,
    'credential-archive': ACTION.archive,
    'restore-credential': ACTION.restore,
    'credential-restore': ACTION.restore,
    'delete-credential': ACTION.delete,
    'credential-delete': ACTION.delete,
    'show-username': ACTION.username,
    'toggle-username': ACTION.username,
    'credential-username': ACTION.username,
    'show-password': ACTION.password,
    'toggle-password': ACTION.password,
    'credential-password': ACTION.password,
    'copy-username': ACTION.copyUsername,
    'credential-copy-username': ACTION.copyUsername,
    'copy-password': ACTION.copyPassword,
    'credential-copy-password': ACTION.copyPassword,
    'open-site': ACTION.openSite,
    'credential-open-site': ACTION.openSite,
    'search-credential': ACTION.search,
    'credential-search': ACTION.search,
    'filter-credential-category': ACTION.category,
    'credential-category': ACTION.category,
    'filter-credential-favorites': ACTION.favoriteFilter,
    'credential-favorite-filter': ACTION.favoriteFilter,
    'clear-credential-filters': ACTION.clear,
    'credential-clear-filters': ACTION.clear,
    'credential-grid': ACTION.grid,
    'credential-list': ACTION.list,
    'grid-view': ACTION.grid,
    'list-view': ACTION.list,
    'credential-favicon-auto': ACTION.faviconAuto,
    'credential-favicon-upload': ACTION.faviconUpload
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

async function getItem(id) {
  const existing = items.find((item) => safeId(item.record.id) === safeId(id));
  if (existing) {
    return existing;
  }
  const record = await getRecord(id);
  if (!record) {
    return null;
  }
  const [item] = await hydrateItems([record], currentKey());
  return item || null;
}

async function refreshView() {
  try {
    await reloadItems();
    renderResults();
  } catch {
    if (pageRoot?.querySelector('[data-results]')) {
      pageRoot.querySelector('[data-results]').innerHTML = renderError();
    }
  }
}

async function copySecret(item, kind) {
  if (!item) {
    notifyError();
    return;
  }
  const key = await ensureWritableKey();
  if (!key) {
    return;
  }
  const value = kind === 'username' ? item.usernamePlain : item.passwordPlain;
  if (!value) {
    notifyError();
    return;
  }
  const copied = await copyText(value);
  const message = kind === 'username' ? t('credentials.usernameCopied') : t('credentials.passwordCopied');
  showToast(copied ? message : t('toast.operationFailed'), copied ? 'success' : 'error');
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
    try {
      await put(STORE, { ...record, isFavorite: !Boolean(record.isFavorite), updatedAt: new Date().toISOString() });
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
      title: restoring ? t('credentials.restoreCredential') : t('credentials.archiveCredential'),
      message: restoring ? t('archive.restoreConfirm') : t('credentials.archiveCredential'),
      confirmLabel: restoring ? t('archive.restore') : t('credentials.archiveCredential'),
      type: restoring ? 'primary' : 'secondary'
    });
    if (!confirmed) {
      return;
    }
    try {
      await put(STORE, { ...record, isArchived: restoring ? false : true, updatedAt: new Date().toISOString() });
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
      message: t('credentials.deleteCredentialConfirm'),
      confirmLabel: t('archive.deletePermanently'),
      type: 'danger'
    });
    if (!confirmed) {
      return;
    }
    try {
      await remove(STORE, id);
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
    void openCredentialEditor();
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
    filters.favoriteOnly = false;
    renderPage();
    return;
  }
  if (action === ACTION.edit) {
    event.preventDefault();
    void openCredentialEditor(getActionId(target));
    return;
  }
  if (action === ACTION.openSite) {
    event.preventDefault();
    const id = getActionId(target);
    const item = await getItem(id);
    const siteUrl = item ? item.record.siteUrl : '';
    if (!openExternalUrl(siteUrl)) {
      showToast(t('validation.invalidUrl'), 'error');
    }
    return;
  }
  if (action === ACTION.username || action === ACTION.password) {
    event.preventDefault();
    const id = getActionId(target);
    const isUsername = action === ACTION.username;
    const revealed = isUsername ? revealedUsernames : revealedPasswords;
    if (revealed.has(id)) {
      revealed.delete(id);
      renderResults();
      return;
    }
    const pageGeneration = generation;
    const key = await ensureWritableKey();
    if (!key) {
      return;
    }
    let item = items.find((entry) => safeId(entry.record.id) === id);
    if (!item) {
      item = await getItem(id);
    }
    if (!item || !(isUsername ? item.usernamePlain : item.passwordPlain)) {
      notifyError();
      return;
    }
    if (pageGeneration !== generation || !currentKey() || !pageRoot?.contains(target)) {
      return;
    }
    revealed.add(id);
    renderResults();
    return;
  }
  if (action === ACTION.copyUsername || action === ACTION.copyPassword) {
    event.preventDefault();
    const id = getActionId(target);
    const item = await getItem(id);
    await copySecret(item, action === ACTION.copyUsername ? 'username' : 'password');
    return;
  }
  await handleItemAction(action, getActionId(target));
}

function handleInput(event) {
  const target = event.target;
  if (actionFor(target?.dataset?.action) === ACTION.search) {
    filters.search = String(target.value ?? '');
    renderResults();
  }
}

function handleChange(event) {
  const target = event.target;
  if (actionFor(target?.dataset?.action) === ACTION.category) {
    filters.category = String(target.value ?? '');
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
    await reloadItems();
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

function faviconPreviewMarkup(url) {
  return faviconMarkup(url);
}

function editorStrengthMarkup(value) {
  const score = passwordScore(value);
  return `<div class="credential-strength" data-editor-strength data-score="${score}"><div class="credential-strength-track" aria-hidden="true"><span style="width:${score * 25}%"></span></div><span>${escapeHTML(strengthLabel(score))}</span></div>`;
}

function makeCredentialEditor(record, options = {}) {
  const editing = Boolean(record);
  const prefillPassword = !editing && typeof options?.password === 'string' ? options.password : '';
  const savedFavicon = textValue(record?.faviconUrl);
  const form = globalThis.document.createElement('form');
  form.className = 'modal-form';
  form.noValidate = true;
  form.setAttribute('data-credential-editor', 'true');
  const initialFavicon = isValidImageDataUrl(savedFavicon)
    ? savedFavicon
    : record?.faviconAuto === true
      ? guessFavicon(record?.siteUrl)
      : '';
  form.innerHTML = `${editorField({ id: 'credential-editor-site-name', name: 'siteName', label: t('credentials.siteName'), value: textValue(record?.siteName), placeholder: t('credentials.siteNamePlaceholder'), required: true })}${editorField({ id: 'credential-editor-site-url', name: 'siteUrl', label: t('credentials.siteUrl'), type: 'url', value: textValue(record?.siteUrl), placeholder: t('credentials.siteUrlPlaceholder'), autocomplete: 'url' })}${editorField({ id: 'credential-editor-username', name: 'username', label: t('credentials.username'), value: '', placeholder: t('credentials.usernamePlaceholder') })}<div class="form-field"><label for="credential-editor-password">${escapeHTML(t('credentials.password'))}</label><div class="input-control"><input id="credential-editor-password" name="password" type="password" value="${escapeHTML(prefillPassword)}" placeholder="${escapeHTML(t('credentials.passwordPlaceholder'))}" autocomplete="new-password"></div><div data-editor-password-strength>${editorStrengthMarkup(prefillPassword)}</div></div>${editorField({ id: 'credential-editor-category', name: 'category', label: t('credentials.credentialCategory'), value: textValue(record?.category), placeholder: t('credentials.credentialCategoryPlaceholder') })}${editorField({ id: 'credential-editor-tags', name: 'tags', label: t('common.tags'), value: normalizeTags(record?.tags).join(', '), placeholder: t('common.tags') })}${editorField({ id: 'credential-editor-notes', name: 'notes', label: t('credentials.credentialNotes'), value: String(record?.notes ?? ''), placeholder: t('credentials.credentialNotesPlaceholder'), multiline: true })}<div class="form-field"><label>${escapeHTML(t('credentials.favicon'))}</label><div class="credential-actions" data-favicon-editor><div data-favicon-preview>${faviconPreviewMarkup(initialFavicon)}</div><button type="button" class="button button-secondary button-small" data-action="${ACTION.faviconAuto}">${icon('refresh')}<span>${escapeHTML(t('credentials.useAutoFavicon'))}</span></button><button type="button" class="button button-secondary button-small" data-action="${ACTION.faviconUpload}">${icon('upload')}<span>${escapeHTML(t('credentials.uploadFavicon'))}</span></button><input id="credential-favicon-file" type="file" name="faviconFile" accept="image/png,image/jpeg,image/webp,image/gif" hidden></div><div class="form-error" data-favicon-error role="alert"></div></div><p class="form-error" data-editor-error role="alert"></p><button type="submit" class="button button-primary button-block" data-action="credential-editor-submit">${icon('check')}<span>${escapeHTML(t('common.save'))}</span></button>`;
  const submit = form.querySelector('[type="submit"]');
  const fileInput = form.querySelector('[name="faviconFile"]');
  const preview = form.querySelector('[data-favicon-preview]');
  const faviconError = form.querySelector('[data-favicon-error]');
  const session = {
    recordId: safeId(record?.id),
    form,
    handle: null,
    closed: false,
    cleanup: [],
    mode: isValidImageDataUrl(savedFavicon) ? 'upload' : record?.faviconAuto === true ? 'auto' : 'local',
    uploadedFavicon: isValidImageDataUrl(savedFavicon) ? savedFavicon : ''
  };
  const setFaviconError = (message) => {
    if (faviconError) {
      faviconError.textContent = String(message || '');
    }
  };
  const updatePreview = () => {
    if (!preview) {
      return;
    }
    const siteUrl = textValue(form.elements.siteUrl?.value);
    const url = session.mode === 'upload'
      ? session.uploadedFavicon
      : session.mode === 'auto'
        ? guessFavicon(siteUrl)
        : '';
    preview.innerHTML = faviconPreviewMarkup(url);
  };
  const updateStrength = () => {
    const container = form.querySelector('[data-editor-password-strength]');
    if (container) {
      container.innerHTML = editorStrengthMarkup(String(form.elements.password?.value ?? ''));
    }
  };
  const handleEditorClick = (event) => {
    const target = event.target?.closest?.('[data-action]');
    if (!target || !form.contains(target)) {
      return;
    }
    const action = actionFor(target.dataset.action);
    if (action === ACTION.faviconAuto) {
      event.preventDefault();
      session.mode = 'auto';
      setFaviconError('');
      updatePreview();
    } else if (action === ACTION.faviconUpload) {
      event.preventDefault();
      if (fileInput) {
        fileInput.value = '';
        fileInput.click();
      }
    }
  };
  const handleEditorInput = (event) => {
    if (event.target === form.elements.siteUrl) {
      setFaviconError('');
      if (session.mode === 'auto') {
        updatePreview();
      }
    }
    if (event.target === form.elements.password) {
      updateStrength();
    }
  };
  const handleFileChange = () => {
    const file = fileInput?.files?.[0];
    if (!file) {
      return;
    }
    if (!/^image\//i.test(String(file.type || ''))) {
      setFaviconError(t('validation.unsupportedFile'));
      return;
    }
    if (Number(file.size) > FAVICON_MAX_BYTES) {
      setFaviconError(t('validation.fileTooLarge'));
      return;
    }
    const Reader = globalThis.FileReader;
    if (typeof Reader !== 'function') {
      setFaviconError(t('validation.unsupportedFile'));
      return;
    }
    const reader = new Reader();
    const onLoad = () => {
      const value = typeof reader.result === 'string' ? reader.result : '';
      if (!isValidImageDataUrl(value)) {
        setFaviconError(t('validation.unsupportedFile'));
        return;
      }
      session.mode = 'upload';
      session.uploadedFavicon = value;
      setFaviconError('');
      updatePreview();
    };
    const onError = () => setFaviconError(t('validation.unsupportedFile'));
    reader.addEventListener('load', onLoad, { once: true });
    reader.addEventListener('error', onError, { once: true });
    session.cleanup.push(() => {
      reader.removeEventListener('load', onLoad);
      reader.removeEventListener('error', onError);
    });
    reader.readAsDataURL(file);
  };
  const handleEditorSubmit = async (event) => {
    event.preventDefault();
    if (session.closed) {
      return;
    }
    const key = await ensureWritableKey();
    if (!key) {
      return;
    }
    const siteName = textValue(form.elements.siteName?.value);
    const username = String(form.elements.username?.value ?? '');
    const password = String(form.elements.password?.value ?? '');
    const rawSiteUrl = textValue(form.elements.siteUrl?.value);
    const siteUrl = rawSiteUrl ? normalizeHttpUrl(rawSiteUrl) : '';
    if (!siteName) {
      setEditorError(form, t('validation.nameRequired'));
      showToast(t('validation.nameRequired'), 'error');
      return;
    }
    if (!editing && (!username.trim() || !password)) {
      setEditorError(form, t('validation.required'));
      showToast(t('validation.required'), 'error');
      return;
    }
    if (rawSiteUrl && !siteUrl) {
      setEditorError(form, t('validation.invalidUrl'));
      showToast(t('validation.invalidUrl'), 'error');
      return;
    }
    let faviconUrl = '';
    if (session.mode === 'upload') {
      if (!isValidImageDataUrl(session.uploadedFavicon)) {
        setFaviconError(t('validation.unsupportedFile'));
        return;
      }
      faviconUrl = session.uploadedFavicon;
    } else if (session.mode === 'auto') {
      faviconUrl = guessFavicon(siteUrl);
    }
    setEditorError(form, '');
    setFaviconError('');
    setButtonLoading(submit, true);
    try {
      const now = new Date().toISOString();
      const next = {
        id: editing ? safeId(record.id) : createId(),
        siteName,
        siteUrl,
        category: textValue(form.elements.category?.value),
        notes: String(form.elements.notes?.value ?? ''),
        faviconUrl,
        faviconAuto: session.mode === 'auto',
        tags: normalizeTags(form.elements.tags?.value),
        isFavorite: Boolean(record?.isFavorite),
        isArchived: Boolean(record?.isArchived),
        createdAt: textValue(record?.createdAt) || now,
        updatedAt: now
      };
      if (username) {
        next.username = await encryptText(username, key);
      } else if (editing && record?.username) {
        const envelope = parseEnvelope(record.username);
        if (envelope) {
          next.username = envelope;
        } else if (typeof record.username === 'string') {
          next.username = await encryptText(record.username, key);
        }
      }
      if (password) {
        next.password = await encryptText(password, key);
      } else if (editing && record?.password) {
        const envelope = parseEnvelope(record.password);
        if (envelope) {
          next.password = envelope;
        } else if (typeof record.password === 'string') {
          next.password = await encryptText(record.password, key);
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
  form.addEventListener('click', handleEditorClick);
  form.addEventListener('input', handleEditorInput);
  form.addEventListener('change', handleFileChange);
  form.addEventListener('error', handleFaviconError, true);
  form.addEventListener('submit', handleEditorSubmit);
  for (const removeListener of [
    () => form.removeEventListener('click', handleEditorClick),
    () => form.removeEventListener('input', handleEditorInput),
    () => form.removeEventListener('change', handleFileChange),
    () => form.removeEventListener('error', handleFaviconError, true),
    () => form.removeEventListener('submit', handleEditorSubmit)
  ]) {
    session.cleanup.push(removeListener);
  }
  return session;
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
  session.uploadedFavicon = '';
  if (editorSession === session) {
    editorSession = null;
  }
}

export async function openCredentialEditor(recordId, options = {}) {
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
  const session = makeCredentialEditor(record, options);
  const handle = openModal({
    title: record ? t('credentials.editCredential') : t('credentials.newCredential'),
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
  items = [];
  revealedUsernames = new Set();
  revealedPasswords = new Set();
  filters = {
    search: '',
    category: '',
    favoriteOnly: false
  };
  pageRoot = null;
}

export function renderCredentialsPage(container, context = {}) {
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

export function disposeCredentialsPage() {
  generation += 1;
  clearPageState();
  pageContext = { archive: false };
}

export const renderCredentialPage = renderCredentialsPage;
export const disposeCredentialPage = disposeCredentialsPage;
export const openCredentialsEditor = openCredentialEditor;
