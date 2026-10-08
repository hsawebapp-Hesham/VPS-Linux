import { getMasterKey } from './auth.js';
import { decryptText, encryptText } from './crypto-utils.js';
import { t } from './i18n.js';
import {
  NOTES_STORE,
  getAll,
  getById,
  put,
  remove
} from './storage.js';
import {
  closeModal,
  confirmAction,
  escapeHTML,
  formatDate,
  icon,
  openModal,
  showToast
} from './ui.js';

const ALL_FILTER = '__all__';
const PINNED_FILTER = '__pinned__';
const DEFAULT_NOTE_COLOR = '#8ed8bb';
const SAFE_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'STRONG', 'B', 'EM', 'I', 'U', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'A', 'BR', 'DIV', 'SPAN']);
const DROP_TAGS = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'TEMPLATE', 'SVG', 'MATH', 'META', 'LINK', 'BASE', 'FORM', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'NOSCRIPT']);
const SAFE_REL_VALUES = new Set(['nofollow', 'noopener', 'noreferrer', 'external']);
const SAFE_COLOR_NAMES = new Set([
  'black', 'silver', 'gray', 'grey', 'white', 'maroon', 'red', 'purple', 'fuchsia',
  'green', 'lime', 'olive', 'yellow', 'navy', 'blue', 'teal', 'aqua', 'cyan', 'orange',
  'pink', 'brown', 'gold', 'indigo', 'violet', 'coral', 'salmon', 'khaki', 'plum',
  'orchid', 'tan', 'beige', 'ivory', 'lavender', 'turquoise', 'currentcolor', 'transparent'
]);

let notesPageState = null;
let noteEditorSession = null;
let openingEditorPromise = null;
let editorContextVersion = 0;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function getDocument() {
  return globalThis.document || null;
}

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeSearch(value) {
  return String(value ?? '').normalize('NFKC').toLocaleLowerCase();
}

function normalizeTags(value) {
  const values = Array.isArray(value) ? value : String(value ?? '').split(/[,،]/u);
  const result = [];
  const seen = new Set();
  for (const item of values) {
    const tag = normalizeText(item).slice(0, 80);
    const key = normalizeSearch(tag);
    if (tag && !seen.has(key)) {
      seen.add(key);
      result.push(tag);
    }
  }
  return result.slice(0, 40);
}

function isSafeColor(value) {
  const color = normalizeText(value).toLowerCase();
  if (/^#[\da-f]{3,4}$/u.test(color) || /^#[\da-f]{6}(?:[\da-f]{2})?$/u.test(color)) {
    return true;
  }
  if (SAFE_COLOR_NAMES.has(color)) {
    return true;
  }
  if (/^rgba?\(\s*[\d.]+%?(?:\s*[, ]\s*[\d.]+%?){2}(?:\s*[,/]\s*[\d.]+%?)?\s*\)$/u.test(color)) {
    return true;
  }
  return /^hsla?\(\s*[\d.]+(?:deg)?\s*[, ]\s*[\d.]+%\s*[, ]\s*[\d.]+%?(?:\s*[,/]\s*[\d.]+%?)?\s*\)$/u.test(color);
}

function normalizeColor(value, fallback = '') {
  const color = normalizeText(value);
  return isSafeColor(color) ? color : fallback;
}

function sanitizeUrl(value) {
  const raw = normalizeText(value);
  if (!raw || /[\u0000-\u001f\u007f]/u.test(raw)) {
    return '';
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    return '';
  }
  if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) {
    return '';
  }
  if ((url.protocol === 'http:' || url.protocol === 'https:') && !url.hostname) {
    return '';
  }
  if (url.protocol === 'mailto:' && !url.pathname) {
    return '';
  }
  return url.href;
}

function safeAttributeText(value, limit = 500) {
  return normalizeText(value).replace(/[\u0000-\u001f\u007f]/gu, '').slice(0, limit);
}

function safeStyleColor(value) {
  const declarations = String(value ?? '').split(';');
  for (const declaration of declarations) {
    const separator = declaration.indexOf(':');
    if (separator < 0) {
      continue;
    }
    const property = declaration.slice(0, separator).trim().toLowerCase();
    const color = normalizeText(declaration.slice(separator + 1));
    if (property === 'color' && isSafeColor(color)) {
      return color;
    }
  }
  return '';
}

function appendSanitizedNodes(source, target) {
  for (const node of Array.from(source.childNodes || [])) {
    if (node.nodeType === 3) {
      target.appendChild(target.ownerDocument.createTextNode(node.nodeValue || ''));
      continue;
    }
    if (node.nodeType !== 1) {
      continue;
    }
    const tag = String(node.tagName || '').toUpperCase();
    if (DROP_TAGS.has(tag) || node.namespaceURI !== 'http://www.w3.org/1999/xhtml') {
      continue;
    }
    if (!SAFE_TAGS.has(tag)) {
      appendSanitizedNodes(node, target);
      continue;
    }
    if (tag === 'A') {
      const href = sanitizeUrl(node.getAttribute('href'));
      if (!href) {
        appendSanitizedNodes(node, target);
        continue;
      }
    }
    const clean = target.ownerDocument.createElement(tag);
    const title = safeAttributeText(node.getAttribute('title'));
    if (title) {
      clean.setAttribute('title', title);
    }
    if (tag === 'A') {
      clean.setAttribute('href', sanitizeUrl(node.getAttribute('href')));
      const targetValue = node.getAttribute('target');
      const targetName = targetValue === '_blank' || targetValue === '_self' ? targetValue : '';
      if (targetName) {
        clean.setAttribute('target', targetName);
      }
      const relValues = String(node.getAttribute('rel') || '')
        .split(/\s+/u)
        .map((item) => item.toLowerCase())
        .filter((item) => SAFE_REL_VALUES.has(item));
      if (targetName === '_blank') {
        if (!relValues.includes('noopener')) {
          relValues.push('noopener');
        }
        if (!relValues.includes('noreferrer')) {
          relValues.push('noreferrer');
        }
      }
      if (relValues.length > 0) {
        clean.setAttribute('rel', Array.from(new Set(relValues)).join(' '));
      }
    }
    const color = safeStyleColor(node.getAttribute('style'));
    if (color) {
      clean.setAttribute('style', `color: ${color}`);
    }
    appendSanitizedNodes(node, clean);
    target.appendChild(clean);
  }
}

function sanitizeNoteHtml(value) {
  const doc = getDocument();
  if (!doc || typeof value !== 'string') {
    return '';
  }
  const source = doc.createElement('template');
  const output = doc.createElement('template');
  source.innerHTML = value;
  appendSanitizedNodes(source.content, output.content);
  return output.innerHTML;
}

function htmlToText(value) {
  const doc = getDocument();
  if (!doc) {
    return '';
  }
  const template = doc.createElement('template');
  template.innerHTML = sanitizeNoteHtml(value);
  return String(template.content.textContent || '').replace(/\s+/gu, ' ').trim();
}

function countWords(value) {
  const text = normalizeText(value);
  return text ? Array.from(text.matchAll(/[\p{L}\p{N}]+(?:['’\-_][\p{L}\p{N}]+)*/gu)).length : 0;
}

function createRecordId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function dispatchEvent(name) {
  if (typeof globalThis.dispatchEvent !== 'function') {
    return;
  }
  const EventApi = typeof globalThis.CustomEvent === 'function' ? globalThis.CustomEvent : globalThis.Event;
  if (typeof EventApi === 'function') {
    globalThis.dispatchEvent(new EventApi(name));
  }
}

function notifyMutation() {
  dispatchEvent('hsa-data-changed');
  dispatchEvent('hsa-page-refresh');
}

function getRequiredMasterKey() {
  const key = getMasterKey();
  if (!key) {
    const error = new Error('MASTER_KEY_REQUIRED');
    error.code = 'MASTER_KEY_REQUIRED';
    throw error;
  }
  return key;
}

function normalizeRecord(record) {
  return {
    ...record,
    id: String(record.id),
    title: typeof record.title === 'string' ? record.title : '',
    folder: typeof record.folder === 'string' ? record.folder : '',
    tags: normalizeTags(record.tags),
    color: normalizeColor(record.color),
    isPinned: record.isPinned === true,
    isArchived: record.isArchived === true,
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : '',
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : ''
  };
}

async function readDecryptedNotes() {
  const records = await getAll(NOTES_STORE);
  const key = getRequiredMasterKey();
  const result = [];
  for (const rawRecord of Array.isArray(records) ? records : []) {
    if (!isObject(rawRecord) || rawRecord.id === undefined || rawRecord.id === null) {
      continue;
    }
    const record = normalizeRecord(rawRecord);
    let contentHtml = '';
    let contentText = '';
    let decryptionFailed = false;
    if (record.contentHtml !== undefined && record.contentHtml !== null && record.contentHtml !== '') {
      try {
        const decrypted = await decryptText(record.contentHtml, key);
        contentHtml = sanitizeNoteHtml(decrypted);
        contentText = htmlToText(contentHtml);
      } catch {
        decryptionFailed = true;
      }
    }
    result.push({ ...record, contentHtml, contentText, decryptionFailed });
  }
  return result;
}

export async function getNotesFolderOptions() {
  const records = await getAll(NOTES_STORE);
  const counts = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    if (!isObject(record)) {
      continue;
    }
    const folder = normalizeText(record.folder);
    if (!folder) {
      continue;
    }
    const key = normalizeSearch(folder);
    const current = counts.get(key);
    counts.set(key, current ? current.count + 1 : { value: folder, count: 1 });
  }
  return Array.from(counts.values())
    .sort((left, right) => left.value.localeCompare(right.value))
    .map((item) => ({ value: item.value, label: item.value, count: item.count }));
}

function routeRecords(state) {
  return state.records.filter((record) => state.archive ? record.isArchived : !record.isArchived);
}

function createLoadingState() {
  return `<div class="page-state" role="status"><span class="loading-mark" aria-hidden="true"><span></span></span><strong>${escapeHTML(t('common.loading'))}</strong><span>${escapeHTML(t('common.loadingHint'))}</span></div>`;
}

function createErrorState(state) {
  const doc = getDocument();
  if (!doc) {
    return;
  }
  const wrapper = doc.createElement('div');
  wrapper.className = 'page-state';
  wrapper.setAttribute('role', 'alert');
  const heading = doc.createElement('strong');
  heading.textContent = t(state.error?.code === 'MASTER_KEY_REQUIRED' ? 'auth.locked' : 'toast.error');
  const hint = doc.createElement('span');
  hint.textContent = t('common.loadingHint');
  const retry = doc.createElement('button');
  retry.type = 'button';
  retry.className = 'button button-secondary';
  retry.dataset.action = 'notes-retry';
  retry.textContent = t('common.retry');
  wrapper.append(heading, hint, retry);
  state.container.replaceChildren(wrapper);
}

function renderShell(state) {
  const title = state.archive ? t('notes.archivedNotes') : t('notes.title');
  const headerActions = state.archive
    ? `<a class="button button-secondary" href="#notes">${icon('note')}<span>${escapeHTML(t('notes.allNotes'))}</span></a>`
    : `<a class="button button-secondary" href="#note-archive">${icon('archive')}<span>${escapeHTML(t('notes.archivedNotes'))}</span></a><button type="button" class="button button-primary" data-action="notes-new">${icon('plus')}<span>${escapeHTML(t('notes.newNote'))}</span></button>`;
  state.container.innerHTML = `
    <section class="notes-page ${state.archive ? 'archive-page' : ''}" data-notes-page>
      <header class="feature-page-header">
        <div class="feature-page-header-copy">
          <h2>${escapeHTML(title)}</h2>
          <p>${escapeHTML(t('notes.subtitle'))}</p>
        </div>
        <div class="page-header-actions">${headerActions}</div>
      </header>
      <section class="card page-toolbar-card">
        <div class="toolbar">
          <div class="input-control toolbar-search">
            <span class="input-leading" aria-hidden="true">${icon('search')}</span>
            <input id="notes-search" name="notes-search" type="search" autocomplete="off" placeholder="${escapeHTML(t('notes.searchPlaceholder'))}" aria-label="${escapeHTML(t('common.search'))}" data-notes-search>
          </div>
          <div class="toolbar-end">
            <strong class="muted-text" data-notes-result-label>${escapeHTML(t('notes.allNotes'))}</strong>
          </div>
        </div>
      </section>
      <div class="notes-workspace">
        <aside class="card notes-sidebar" data-notes-folders aria-label="${escapeHTML(t('notes.folders'))}"></aside>
        <section class="notes-editor-column">
          <div data-notes-results aria-live="polite"></div>
        </section>
      </div>
    </section>`;
  state.searchInput = state.container.querySelector('[data-notes-search]');
  state.foldersElement = state.container.querySelector('[data-notes-folders]');
  state.resultsElement = state.container.querySelector('[data-notes-results]');
  state.resultLabel = state.container.querySelector('[data-notes-result-label]');
}

function renderFolders(state) {
  const doc = getDocument();
  if (!doc || !state.foldersElement) {
    return;
  }
  const records = routeRecords(state);
  const folderCounts = new Map();
  for (const record of records) {
    if (!record.folder) {
      continue;
    }
    const key = normalizeSearch(record.folder);
    const item = folderCounts.get(key) || { value: record.folder, count: 0 };
    item.count += 1;
    folderCounts.set(key, item);
  }
  const folders = Array.from(folderCounts.values()).sort((left, right) => left.value.localeCompare(right.value));
  const fragment = doc.createDocumentFragment();
  const heading = doc.createElement('strong');
  heading.className = 'settings-nav-title';
  heading.textContent = t('notes.folders');
  fragment.appendChild(heading);
  const items = [
    { value: ALL_FILTER, label: t('notes.allNotes'), count: records.length, iconName: 'note' },
    { value: PINNED_FILTER, label: t('notes.pinnedNotes'), count: records.filter((record) => record.isPinned).length, iconName: 'pin' },
    ...folders.map((folder) => ({ ...folder, iconName: 'folder' }))
  ];
  for (const item of items) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'notes-folder-item';
    button.dataset.action = 'notes-filter';
    button.dataset.filter = item.value;
    button.classList.toggle('is-active', state.filter === item.value);
    const iconElement = doc.createElement('span');
    iconElement.innerHTML = icon(item.iconName);
    const label = doc.createElement('span');
    label.textContent = item.label;
    const count = doc.createElement('small');
    count.textContent = String(item.count);
    button.append(iconElement, label, count);
    fragment.appendChild(button);
  }
  state.foldersElement.replaceChildren(fragment);
}

function createEmptyResults(state, hasRecords) {
  const doc = getDocument();
  const section = doc.createElement('section');
  section.className = 'empty-state';
  section.setAttribute('role', 'status');
  const iconElement = doc.createElement('div');
  iconElement.className = 'empty-state__icon';
  iconElement.innerHTML = icon(hasRecords ? 'search' : 'note');
  const heading = doc.createElement('h3');
  heading.textContent = t(hasRecords ? 'notes.noMatchingNotes' : 'notes.noNotes');
  const message = doc.createElement('p');
  message.textContent = t(hasRecords ? 'notes.noMatchingNotesDescription' : 'notes.noNotesDescription');
  const actions = doc.createElement('div');
  actions.className = 'empty-state-actions';
  if (!state.archive && !hasRecords) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'button button-primary';
    button.dataset.action = 'notes-new';
    button.textContent = t('notes.newNote');
    actions.appendChild(button);
  }
  section.append(iconElement, heading, message, actions);
  return section;
}

function cardDate(record) {
  return formatDate(record.updatedAt || record.createdAt, { dateStyle: 'medium', timeStyle: 'short' }) || t('common.unknown');
}

function renderCard(state, record) {
  const doc = getDocument();
  const article = doc.createElement('article');
  article.className = 'card note-card';
  article.dataset.noteId = record.id;
  const color = normalizeColor(record.color, DEFAULT_NOTE_COLOR);
  article.style.borderTopColor = color;
  const title = normalizeText(record.title) || t('notes.noteTitle');
  const folder = normalizeText(record.folder) || t('common.allFolders');
  const pinLabel = record.isPinned ? t('notes.unpinNote') : t('notes.pinNote');
  const archiveLabel = record.isArchived ? t('notes.restoreNote') : t('notes.archiveNote');
  const archiveAction = record.isArchived ? 'notes-restore' : 'notes-archive';
  const archiveIcon = record.isArchived ? 'rotate' : 'archive';
  const date = cardDate(record);
  const tags = record.tags.map((tag) => `<span class="tag">${escapeHTML(tag)}</span>`).join('');
  article.innerHTML = `
    <header class="note-card-header">
      <span class="note-icon" aria-hidden="true">${icon('note')}</span>
      <div><strong>${escapeHTML(title)}</strong><small>${escapeHTML(folder)}</small></div>
      <button type="button" class="favorite-button ${record.isPinned ? 'is-favorite' : ''}" data-action="notes-pin" data-record-id="${escapeHTML(record.id)}" aria-label="${escapeHTML(pinLabel)}" title="${escapeHTML(pinLabel)}" aria-pressed="${String(record.isPinned)}">${icon('pin')}</button>
    </header>
    <div class="note-card-content"></div>
    ${tags ? `<div class="note-tags">${tags}</div>` : ''}
    <footer class="note-card-footer">
      <time class="note-date" datetime="${escapeHTML(record.updatedAt || record.createdAt)}" title="${escapeHTML(t('notes.lastEdited'))}">${escapeHTML(date)}</time>
      <span class="data-card-actions">
        <button type="button" class="icon-button" data-action="notes-edit" data-record-id="${escapeHTML(record.id)}" aria-label="${escapeHTML(t('common.edit'))}" title="${escapeHTML(t('common.edit'))}">${icon('edit')}</button>
        <button type="button" class="icon-button" data-action="${archiveAction}" data-record-id="${escapeHTML(record.id)}" aria-label="${escapeHTML(archiveLabel)}" title="${escapeHTML(archiveLabel)}">${icon(archiveIcon)}</button>
        <button type="button" class="icon-button" data-action="notes-delete" data-record-id="${escapeHTML(record.id)}" aria-label="${escapeHTML(t('notes.deleteNote'))}" title="${escapeHTML(t('notes.deleteNote'))}">${icon('trash')}</button>
      </span>
    </footer>`;
  const content = article.querySelector('.note-card-content');
  content.innerHTML = sanitizeNoteHtml(record.contentHtml);
  if (record.decryptionFailed) {
    article.classList.add('note-card-corrupted');
    content.classList.add('danger-text');
    content.textContent = t('notes.decryptionFailed');
    const deleteButton = article.querySelector('[data-action="notes-delete"]');
    if (deleteButton) {
      deleteButton.disabled = true;
    }
  }
  return article;
}

function filteredRecords(state) {
  const query = normalizeSearch(state.query);
  const records = routeRecords(state).filter((record) => {
    if (state.filter === PINNED_FILTER && !record.isPinned) {
      return false;
    }
    if (state.filter !== ALL_FILTER && state.filter !== PINNED_FILTER && normalizeSearch(record.folder) !== normalizeSearch(state.filter)) {
      return false;
    }
    if (!query) {
      return true;
    }
    const searchable = [record.title, record.contentText, ...record.tags].map(normalizeSearch);
    return searchable.some((value) => value.includes(query));
  });
  return records.sort((left, right) => {
    if (left.isPinned !== right.isPinned) {
      return left.isPinned ? -1 : 1;
    }
    const leftTime = Date.parse(left.updatedAt || left.createdAt || '') || 0;
    const rightTime = Date.parse(right.updatedAt || right.createdAt || '') || 0;
    return rightTime - leftTime;
  });
}

function renderResults(state) {
  const doc = getDocument();
  if (!doc || !state.resultsElement) {
    return;
  }
  const scoped = routeRecords(state);
  const records = filteredRecords(state);
  if (state.resultLabel) {
    state.resultLabel.textContent = state.filter === PINNED_FILTER
      ? t('notes.pinnedNotes')
      : state.filter === ALL_FILTER
        ? t('notes.allNotes')
        : state.filter;
  }
  if (records.length === 0) {
    state.resultsElement.replaceChildren(createEmptyResults(state, scoped.length > 0));
    return;
  }
  const grid = doc.createElement('div');
  grid.className = 'notes-grid';
  for (const record of records) {
    grid.appendChild(renderCard(state, record));
  }
  state.resultsElement.replaceChildren(grid);
}

function renderPage(state) {
  if (state.disposed) {
    return;
  }
  renderShell(state);
  renderFolders(state);
  renderResults(state);
}

async function refreshNotes(state) {
  if (!state || state.disposed) {
    return;
  }
  const loadToken = ++state.loadToken;
  try {
    const records = await readDecryptedNotes();
    if (state.disposed || loadToken !== state.loadToken) {
      return;
    }
    state.records = records;
    state.error = null;
    if (state.filter !== ALL_FILTER && state.filter !== PINNED_FILTER && !records.some((record) => normalizeSearch(record.folder) === normalizeSearch(state.filter))) {
      state.filter = ALL_FILTER;
    }
    renderPage(state);
  } catch (error) {
    if (state.disposed || loadToken !== state.loadToken) {
      return;
    }
    state.error = error;
    createErrorState(state);
  }
}

function scheduleRefresh(state) {
  if (!state || state.disposed || state.refreshScheduled) {
    return;
  }
  state.refreshScheduled = true;
  queueMicrotask(() => {
    state.refreshScheduled = false;
    void refreshNotes(state);
  });
}

async function updateNote(id, patch) {
  const current = await getById(NOTES_STORE, id);
  if (!current) {
    return null;
  }
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
  await put(NOTES_STORE, next);
  notifyMutation();
  return next;
}

async function handleNoteAction(state, action, id) {
  if (action === 'notes-retry') {
    await refreshNotes(state);
    return;
  }
  if (action === 'notes-new' || action === 'notes-edit') {
    await openNoteEditor(action === 'notes-edit' ? id : undefined);
    return;
  }
  if (action === 'notes-filter') {
    return;
  }
  if (!id) {
    return;
  }
  const current = await getById(NOTES_STORE, id);
  if (!current) {
    showToast(t('common.notAvailable'), 'warning');
    return;
  }
  const title = normalizeText(current.title) || t('notes.noteTitle');
  if (action === 'notes-pin') {
    await updateNote(id, { isPinned: current.isPinned !== true });
    showToast(t(current.isPinned === true ? 'notes.unpinNote' : 'notes.pinNote'), 'success');
    return;
  }
  if (action === 'notes-archive') {
    const confirmed = await confirmAction({
      title: t('notes.archiveNote'),
      message: `${t('archive.itemType')}: ${title}`,
      confirmLabel: t('notes.archiveNote'),
      cancelLabel: t('common.cancel')
    });
    if (!confirmed) {
      return;
    }
    const now = new Date().toISOString();
    await updateNote(id, { isArchived: true, archivedAt: now });
    showToast(t('notes.noteArchived'), 'success');
    return;
  }
  if (action === 'notes-restore') {
    const confirmed = await confirmAction({
      title: t('notes.restoreNote'),
      message: `${t('archive.restoreConfirm')}\n${title}`,
      confirmLabel: t('archive.restore'),
      cancelLabel: t('common.cancel')
    });
    if (!confirmed) {
      return;
    }
    await updateNote(id, { isArchived: false, archivedAt: null });
    showToast(t('notes.noteRestored'), 'success');
    return;
  }
  if (action === 'notes-delete') {
    const confirmed = await confirmAction({
      title: t('notes.deleteNote'),
      message: t('notes.deleteNoteConfirm'),
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
      type: 'danger'
    });
    if (!confirmed) {
      return;
    }
    await remove(NOTES_STORE, id);
    notifyMutation();
    showToast(t('notes.noteDeleted'), 'success');
  }
}

function installPageListeners(state) {
  const clickHandler = (event) => {
    const target = event.target?.closest?.('[data-action]');
    if (!target || !state.container.contains(target)) {
      return;
    }
    const action = target.dataset.action;
    if (action === 'notes-filter') {
      state.filter = target.dataset.filter || ALL_FILTER;
      renderFolders(state);
      renderResults(state);
      return;
    }
    void handleNoteAction(state, action, target.dataset.recordId).catch(() => showToast(t('toast.error'), 'error'));
  };
  const inputHandler = (event) => {
    if (event.target === state.searchInput) {
      state.query = event.target.value;
      renderResults(state);
    }
  };
  const contentClickHandler = (event) => {
    const anchor = event.target?.closest?.('a[href]');
    if (!anchor || !state.container.contains(anchor)) {
      return;
    }
    const safeHref = sanitizeUrl(anchor.getAttribute('href'));
    if (!safeHref) {
      event.preventDefault();
      return;
    }
    anchor.href = safeHref;
  };
  const options = { signal: state.abortController.signal };
  state.container.addEventListener('click', clickHandler, options);
  state.container.addEventListener('input', inputHandler, options);
  state.container.addEventListener('click', contentClickHandler, options);
  globalThis.addEventListener?.('hsa-data-changed', state.refreshListener, options);
  globalThis.addEventListener?.('hsa-page-refresh', state.refreshListener, options);
}

export async function renderNotesPage(container, options = {}) {
  disposeNotesPage();
  const doc = getDocument();
  if (!container || container.nodeType !== 1 || !doc) {
    return null;
  }
  const abortController = new AbortController();
  const state = {
    container,
    archive: options.archive === true,
    filter: ALL_FILTER,
    query: '',
    records: [],
    loadToken: 0,
    refreshScheduled: false,
    disposed: false,
    abortController
  };
  state.refreshListener = () => scheduleRefresh(state);
  notesPageState = state;
  container.replaceChildren();
  const loading = doc.createElement('div');
  loading.innerHTML = createLoadingState();
  container.replaceChildren(loading.firstElementChild);
  installPageListeners(state);
  await refreshNotes(state);
  return state.disposed ? null : container;
}

export function disposeNotesPage() {
  const state = notesPageState;
  notesPageState = null;
  if (state) {
    state.disposed = true;
    state.loadToken += 1;
    state.abortController.abort();
  }
  editorContextVersion += 1;
  openingEditorPromise = null;
  if (noteEditorSession) {
    noteEditorSession.suppressReopen = true;
    if (noteEditorSession.handle && !noteEditorSession.handle.closed) {
      closeModal(noteEditorSession.handle);
    }
  }
}

function buildDraft(record, contentHtml = '') {
  const values = {
    title: normalizeText(record?.title),
    folder: normalizeText(record?.folder),
    tags: normalizeTags(record?.tags),
    color: normalizeColor(record?.color, DEFAULT_NOTE_COLOR),
    html: sanitizeNoteHtml(contentHtml)
  };
  return {
    recordId: record?.id ? String(record.id) : '',
    baseline: { ...values, tags: [...values.tags] },
    values: { ...values, tags: [...values.tags] }
  };
}

function createEditorContent(draft, folders) {
  const doc = getDocument();
  const wrapper = doc.createElement('div');
  wrapper.innerHTML = `
    <form class="modal-form" data-note-form novalidate>
      <div class="form-field">
        <label for="note-title-input">${escapeHTML(t('notes.noteTitle'))}</label>
        <div class="input-control"><input id="note-title-input" name="title" type="text" maxlength="240" autocomplete="off" value="${escapeHTML(draft.values.title)}" placeholder="${escapeHTML(t('notes.noteTitlePlaceholder'))}"></div>
      </div>
      <div class="form-field">
        <label for="note-folder-input">${escapeHTML(t('notes.folderName'))}</label>
        <div class="input-control"><input id="note-folder-input" name="folder" type="text" maxlength="120" list="note-folder-options" autocomplete="off" value="${escapeHTML(draft.values.folder)}" placeholder="${escapeHTML(t('notes.folderNamePlaceholder'))}"><datalist id="note-folder-options"></datalist></div>
      </div>
      <div class="form-field">
        <label for="note-tags-input">${escapeHTML(t('notes.noteTags'))}</label>
        <div class="input-control"><input id="note-tags-input" name="tags" type="text" maxlength="2000" autocomplete="off" value="${escapeHTML(draft.values.tags.join(', '))}" placeholder="${escapeHTML(t('notes.noteTagsPlaceholder'))}"></div>
      </div>
      <div class="form-field">
        <label for="note-color-input">${escapeHTML(t('notes.textColor'))}</label>
        <div class="input-control"><input id="note-color-input" name="color" type="color" value="${escapeHTML(draft.values.color || DEFAULT_NOTE_COLOR)}" aria-label="${escapeHTML(t('notes.textColor'))}"></div>
      </div>
      <div class="card editor-shell">
        <div class="editor-toolbar" role="toolbar" aria-label="${escapeHTML(t('notes.formatting'))}">
          <button type="button" class="editor-tool" data-editor-command="heading" aria-label="${escapeHTML(t('notes.heading'))}" title="${escapeHTML(t('notes.heading'))}">${icon('heading')}</button>
          <span class="editor-divider" aria-hidden="true"></span>
          <button type="button" class="editor-tool" data-editor-command="bold" aria-label="${escapeHTML(t('notes.bold'))}" title="${escapeHTML(t('notes.bold'))}">${icon('bold')}</button>
          <button type="button" class="editor-tool" data-editor-command="italic" aria-label="${escapeHTML(t('notes.italic'))}" title="${escapeHTML(t('notes.italic'))}">${icon('italic')}</button>
          <button type="button" class="editor-tool" data-editor-command="underline" aria-label="${escapeHTML(t('notes.underline'))}" title="${escapeHTML(t('notes.underline'))}">${icon('underline')}</button>
          <span class="editor-divider" aria-hidden="true"></span>
          <button type="button" class="editor-tool" data-editor-command="bullet" aria-label="${escapeHTML(t('notes.bulletList'))}" title="${escapeHTML(t('notes.bulletList'))}">${icon('list')}</button>
          <button type="button" class="editor-tool" data-editor-command="numbered" aria-label="${escapeHTML(t('notes.numberedList'))}" title="${escapeHTML(t('notes.numberedList'))}">${icon('list-ordered')}</button>
          <button type="button" class="editor-tool" data-editor-command="quote" aria-label="${escapeHTML(t('notes.quote'))}" title="${escapeHTML(t('notes.quote'))}">${icon('quote')}</button>
          <button type="button" class="editor-tool" data-editor-command="link" aria-label="${escapeHTML(t('notes.insertLink'))}" title="${escapeHTML(t('notes.insertLink'))}">${icon('link')}</button>
          <span class="editor-divider" aria-hidden="true"></span>
          <input id="note-editor-color" name="editor-color" type="color" class="editor-tool" data-editor-color value="${escapeHTML(draft.values.color || DEFAULT_NOTE_COLOR)}" aria-label="${escapeHTML(t('notes.textColor'))}" title="${escapeHTML(t('notes.textColor'))}">
        </div>
        <div class="editor-area" contenteditable="true" role="textbox" aria-multiline="true" spellcheck="true" data-placeholder="${escapeHTML(t('notes.noteContentPlaceholder'))}" data-note-editor></div>
        <footer class="editor-footer"><span data-note-words></span><span data-note-characters></span></footer>
      </div>
      <p class="form-error" data-note-error role="alert" hidden></p>
    </form>`;
  const datalist = wrapper.querySelector('#note-folder-options');
  for (const folder of folders) {
    const option = doc.createElement('option');
    option.value = folder.value;
    option.label = folder.label;
    datalist.appendChild(option);
  }
  const editor = wrapper.querySelector('[data-note-editor]');
  editor.innerHTML = sanitizeNoteHtml(draft.values.html);
  return wrapper;
}

function selectedRangeInside(editor) {
  const doc = getDocument();
  const selection = doc?.getSelection?.();
  if (!selection || selection.rangeCount === 0) {
    return null;
  }
  const range = selection.getRangeAt(0);
  if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) {
    return null;
  }
  return range.cloneRange();
}

function rememberEditorSelection(session) {
  const range = selectedRangeInside(session.editor);
  if (range) {
    session.selectionRange = range;
  }
}

function restoreEditorSelection(session) {
  const doc = getDocument();
  const selection = doc?.getSelection?.();
  if (!selection) {
    return false;
  }
  try {
    session.editor.focus({ preventScroll: true });
  } catch {
    session.editor.focus();
  }
  if (session.selectionRange && session.editor.contains(session.selectionRange.startContainer) && session.editor.contains(session.selectionRange.endContainer)) {
    selection.removeAllRanges();
    selection.addRange(session.selectionRange);
    return true;
  }
  const range = doc.createRange();
  range.selectNodeContents(session.editor);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
  session.selectionRange = range.cloneRange();
  return true;
}

function updateEditorCounts(session) {
  const text = session.editor.textContent || '';
  const words = countWords(text);
  const characters = Array.from(text).length;
  session.wordsElement.textContent = `${t('notes.wordCount')}: ${words}`;
  session.charactersElement.textContent = `${t('notes.characterCount')}: ${characters}`;
}

function captureDraft(session) {
  session.draft.values.title = session.titleInput.value;
  session.draft.values.folder = session.folderInput.value;
  session.draft.values.tags = normalizeTags(session.tagsInput.value);
  session.draft.values.color = normalizeColor(session.colorInput.value, DEFAULT_NOTE_COLOR);
  session.draft.values.html = session.editor.innerHTML;
  return session.draft;
}

function sessionIsDirty(session) {
  const draft = captureDraft(session);
  const baseline = draft.baseline;
  return draft.values.title !== baseline.title
    || draft.values.folder !== baseline.folder
    || draft.values.tags.join('\u0000') !== baseline.tags.join('\u0000')
    || normalizeColor(draft.values.color, DEFAULT_NOTE_COLOR) !== normalizeColor(baseline.color, DEFAULT_NOTE_COLOR)
    || sanitizeNoteHtml(draft.values.html) !== baseline.html;
}

function insertFragment(editor, fragment) {
  const selection = getDocument().getSelection();
  if (!selection || selection.rangeCount === 0) {
    editor.appendChild(fragment);
    return;
  }
  const range = selection.getRangeAt(0);
  range.deleteContents();
  const lastNode = fragment.lastChild;
  range.insertNode(fragment);
  if (lastNode) {
    range.setStartAfter(lastNode);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }
}

function wrapEditorSelection(session, tagName, styleColor = '') {
  const doc = getDocument();
  restoreEditorSelection(session);
  const selection = doc.getSelection();
  const wrapper = doc.createElement(tagName);
  if (styleColor && isSafeColor(styleColor)) {
    wrapper.style.color = styleColor;
  }
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    wrapper.appendChild(doc.createElement('br'));
    insertFragment(session.editor, wrapper);
    const caret = doc.createRange();
    caret.selectNodeContents(wrapper);
    caret.collapse(false);
    selection.removeAllRanges();
    selection.addRange(caret);
    return;
  }
  const range = selection.getRangeAt(0);
  wrapper.appendChild(range.extractContents());
  range.insertNode(wrapper);
  selection.selectNodeContents(wrapper);
  selection.collapseToEnd();
}

function fallbackCommand(session, command, value) {
  if (command === 'bold' || command === 'italic' || command === 'underline') {
    wrapEditorSelection(session, command === 'bold' ? 'strong' : command === 'italic' ? 'em' : 'u');
    return;
  }
  if (command === 'formatBlock') {
    wrapEditorSelection(session, String(value || 'p').toLowerCase());
    return;
  }
  if (command === 'insertUnorderedList' || command === 'insertOrderedList') {
    const doc = getDocument();
    restoreEditorSelection(session);
    const selection = doc.getSelection();
    const list = doc.createElement(command === 'insertUnorderedList' ? 'ul' : 'ol');
    const item = doc.createElement('li');
    if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
      item.appendChild(selection.getRangeAt(0).extractContents());
    } else {
      item.appendChild(doc.createElement('br'));
    }
    list.appendChild(item);
    insertFragment(session.editor, list);
    const itemRange = doc.createRange();
    itemRange.selectNodeContents(item.lastChild || item);
    itemRange.collapse(false);
    selection.removeAllRanges();
    selection.addRange(itemRange);
    return;
  }
  if (command === 'foreColor') {
    wrapEditorSelection(session, 'span', value);
    return;
  }
  if (command === 'createLink') {
    const safeHref = sanitizeUrl(value);
    if (!safeHref) {
      return;
    }
    const doc = getDocument();
    restoreEditorSelection(session);
    const selection = doc.getSelection();
    const anchor = doc.createElement('a');
    if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
      anchor.appendChild(selection.getRangeAt(0).extractContents());
    } else {
      anchor.textContent = safeHref;
    }
    anchor.setAttribute('href', safeHref);
    anchor.setAttribute('target', safeHref.startsWith('mailto:') ? '_self' : '_blank');
    anchor.setAttribute('rel', 'noopener noreferrer');
    insertFragment(session.editor, anchor);
    const range = doc.createRange();
    range.selectNodeContents(anchor);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }
}

function runEditorCommand(session, command, value = null) {
  const doc = getDocument();
  if (!doc || !session.editor.isConnected) {
    return;
  }
  if (!restoreEditorSelection(session)) {
    return;
  }
  if (!selectedRangeInside(session.editor)) {
    return;
  }
  const before = session.editor.innerHTML;
  if (command === 'foreColor' && typeof doc.execCommand === 'function') {
    try {
      doc.execCommand('styleWithCSS', false, true);
    } catch {
      fallbackCommand(session, command, value);
      rememberEditorSelection(session);
      updateEditorCounts(session);
      captureDraft(session);
      return;
    }
  }
  if (typeof doc.execCommand === 'function') {
    try {
      const changed = doc.execCommand(command, false, value);
      if (changed || session.editor.innerHTML !== before) {
        rememberEditorSelection(session);
        updateEditorCounts(session);
        captureDraft(session);
        return;
      }
    } catch {
      fallbackCommand(session, command, value);
      rememberEditorSelection(session);
      updateEditorCounts(session);
      captureDraft(session);
      return;
    }
  }
  fallbackCommand(session, command, value);
  rememberEditorSelection(session);
  updateEditorCounts(session);
  captureDraft(session);
}

function handleEditorPaste(session, event) {
  const clipboard = event.clipboardData;
  if (!clipboard) {
    return;
  }
  event.preventDefault();
  const doc = getDocument();
  restoreEditorSelection(session);
  const html = clipboard.getData('text/html');
  const text = clipboard.getData('text/plain');
  if (html) {
    const template = doc.createElement('template');
    template.innerHTML = sanitizeNoteHtml(html);
    insertFragment(session.editor, template.content);
  } else {
    const fragment = doc.createDocumentFragment();
    fragment.appendChild(doc.createTextNode(String(text || '').replace(/\r\n?/gu, '\n')));
    insertFragment(session.editor, fragment);
  }
  rememberEditorSelection(session);
  updateEditorCounts(session);
  captureDraft(session);
}

function openLinkDialog(session) {
  rememberEditorSelection(session);
  const doc = getDocument();
  const content = doc.createElement('div');
  content.className = 'modal-form';
  content.innerHTML = `
    <div class="form-field">
      <label for="note-link-url">${escapeHTML(t('notes.insertLink'))}</label>
      <div class="input-control"><input id="note-link-url" name="note-link-url" type="text" inputmode="url" autocomplete="url"></div>
      <p class="form-error" data-link-error role="alert" hidden></p>
    </div>`;
  let linkHandle = null;
  linkHandle = openModal({
    title: t('notes.insertLink'),
    content,
    size: 'sm',
    actions: [
      { label: t('common.cancel'), variant: 'secondary' },
      {
        label: t('common.confirm'),
        variant: 'primary',
        onClick: async () => {
          const input = content.querySelector('#note-link-url');
          const error = content.querySelector('[data-link-error]');
          const href = sanitizeUrl(input.value);
          if (!href) {
            error.textContent = t('validation.invalidUrl');
            error.hidden = false;
            input.focus();
            return false;
          }
          runEditorCommand(session, 'createLink', href);
          return true;
        }
      }
    ],
    onOpen: (handle) => {
      linkHandle = handle;
      content.querySelector('#note-link-url').focus();
    }
  });
  return linkHandle;
}

function installEditorListeners(session) {
  const options = { signal: session.abortController.signal };
  session.toolbar.addEventListener('pointerdown', () => rememberEditorSelection(session), options);
  session.toolbar.addEventListener('click', (event) => {
    const commandButton = event.target?.closest?.('[data-editor-command]');
    if (commandButton) {
      rememberEditorSelection(session);
      const command = commandButton.dataset.editorCommand;
      if (command === 'link') {
        openLinkDialog(session);
        return;
      }
      const commandMap = {
        heading: ['formatBlock', 'h2'],
        bold: ['bold'],
        italic: ['italic'],
        underline: ['underline'],
        bullet: ['insertUnorderedList'],
        numbered: ['insertOrderedList'],
        quote: ['formatBlock', 'blockquote']
      };
      const config = commandMap[command];
      if (config) {
        runEditorCommand(session, config[0], config[1] || null);
      }
    }
  });
  session.toolbar.addEventListener('input', (event) => {
    if (event.target === session.textColor) {
      rememberEditorSelection(session);
      runEditorCommand(session, 'foreColor', normalizeColor(event.target.value));
    }
  });
  session.editor.addEventListener('input', () => {
    updateEditorCounts(session);
    captureDraft(session);
  }, options);
  session.editor.addEventListener('keyup', () => rememberEditorSelection(session), options);
  session.editor.addEventListener('mouseup', () => rememberEditorSelection(session), options);
  session.editor.addEventListener('paste', (event) => handleEditorPaste(session, event), options);
  session.editor.addEventListener('keydown', (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) {
      return;
    }
    const key = String(event.key || '').toLowerCase();
    const command = key === 'b' ? 'bold' : key === 'i' ? 'italic' : key === 'u' ? 'underline' : '';
    if (command) {
      event.preventDefault();
      runEditorCommand(session, command);
    }
  }, options);
  session.titleInput.addEventListener('input', () => {
    session.errorElement.hidden = true;
    captureDraft(session);
  }, options);
  session.folderInput.addEventListener('input', () => captureDraft(session), options);
  session.tagsInput.addEventListener('input', () => captureDraft(session), options);
  session.colorInput.addEventListener('input', () => {
    session.textColor.value = normalizeColor(session.colorInput.value, DEFAULT_NOTE_COLOR);
    captureDraft(session);
  }, options);
  globalThis.addEventListener?.('hsa-auth-locked', () => {
    session.allowClose = true;
    session.suppressReopen = true;
  }, options);
}

async function saveEditor(session) {
  if (session.saving) {
    return false;
  }
  const draft = captureDraft(session);
  const title = normalizeText(draft.values.title);
  if (!title) {
    session.errorElement.textContent = t('validation.titleRequired');
    session.errorElement.hidden = false;
    session.titleInput.focus();
    return false;
  }
  session.saving = true;
  try {
    const key = getRequiredMasterKey();
    const id = draft.recordId || createRecordId();
    const existing = draft.recordId ? await getById(NOTES_STORE, id) : null;
    if (draft.recordId && !existing) {
      throw new Error('NOTE_NOT_FOUND');
    }
    const now = new Date().toISOString();
    const cleanHtml = sanitizeNoteHtml(draft.values.html);
    const record = {
      ...(existing || {}),
      id,
      title,
      folder: normalizeText(draft.values.folder),
      tags: normalizeTags(draft.values.tags),
      color: normalizeColor(draft.values.color, DEFAULT_NOTE_COLOR),
      contentHtml: await encryptText(cleanHtml, key),
      isPinned: existing?.isPinned === true,
      isArchived: existing?.isArchived === true,
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };
    await put(NOTES_STORE, record);
    session.allowClose = true;
    notifyMutation();
    showToast(t('notes.noteSaved'), 'success');
    return true;
  } catch {
    session.errorElement.textContent = t('toast.error');
    session.errorElement.hidden = false;
    return false;
  } finally {
    session.saving = false;
  }
}

async function confirmEditorClose(session) {
  if (session.allowClose || !sessionIsDirty(session)) {
    return true;
  }
  const confirmed = await confirmAction({
    title: t('common.unsavedChanges'),
    message: t('common.unsavedChanges'),
    confirmLabel: t('common.discard'),
    cancelLabel: t('common.cancel'),
    type: 'danger'
  });
  if (confirmed) {
    session.allowClose = true;
  }
  return confirmed;
}

async function reopenEditor(session) {
  if (session.suppressReopen) {
    return;
  }
  const draft = captureDraft(session);
  openEditorModal(draft, session.folderOptions);
}

function openEditorModal(draft, folderOptions) {
  const doc = getDocument();
  if (!doc) {
    return null;
  }
  const content = createEditorContent(draft, folderOptions);
  const abortController = new AbortController();
  const session = {
    handle: null,
    titleInput: content.querySelector('#note-title-input'),
    folderInput: content.querySelector('#note-folder-input'),
    tagsInput: content.querySelector('#note-tags-input'),
    colorInput: content.querySelector('#note-color-input'),
    editor: content.querySelector('[data-note-editor]'),
    toolbar: content.querySelector('.editor-toolbar'),
    textColor: content.querySelector('[data-editor-color]'),
    wordsElement: content.querySelector('[data-note-words]'),
    charactersElement: content.querySelector('[data-note-characters]'),
    errorElement: content.querySelector('[data-note-error]'),
    draft,
    folderOptions,
    selectionRange: null,
    allowClose: false,
    suppressReopen: false,
    abortController
  };
  noteEditorSession = session;
  installEditorListeners(session);
  updateEditorCounts(session);
  session.handle = openModal({
    title: draft.recordId ? t('notes.editNote') : t('notes.newNote'),
    content,
    size: 'xl',
    actions: [
      {
        label: t('common.cancel'),
        variant: 'secondary',
        closeOnClick: false,
        onClick: () => confirmEditorClose(session)
      },
      {
        label: t('common.save'),
        variant: 'primary',
        closeOnClick: false,
        onClick: () => saveEditor(session)
      }
    ],
    onOpen: () => {
      session.titleInput.focus();
    },
    onClose: () => {
      session.abortController.abort();
      if (noteEditorSession === session) {
        noteEditorSession = null;
      }
      const shouldConfirm = !session.allowClose && sessionIsDirty(session);
      if (shouldConfirm) {
        void confirmAction({
          title: t('common.unsavedChanges'),
          message: t('common.unsavedChanges'),
          confirmLabel: t('common.discard'),
          cancelLabel: t('common.cancel'),
          type: 'danger'
        }).then((confirmed) => {
          if (!confirmed) {
            return reopenEditor(session);
          }
        });
      }
    }
  });
  return session.handle;
}

async function openNoteEditorInternal(recordId, contextVersion) {
  let record = null;
  if (recordId !== undefined && recordId !== null && recordId !== '') {
    const stored = await getById(NOTES_STORE, String(recordId));
    if (contextVersion !== editorContextVersion) {
      return null;
    }
    if (!stored) {
      showToast(t('common.notAvailable'), 'warning');
      return null;
    }
    record = normalizeRecord(stored);
  }
  const folders = await getNotesFolderOptions();
  if (contextVersion !== editorContextVersion) {
    return null;
  }
  let contentHtml = '';
  if (record?.contentHtml) {
    try {
      contentHtml = sanitizeNoteHtml(await decryptText(record.contentHtml, getRequiredMasterKey()));
    } catch {
      if (contextVersion === editorContextVersion) {
        showToast(t('toast.error'), 'error');
      }
      return null;
    }
  }
  if (contextVersion !== editorContextVersion || !getMasterKey()) {
    return null;
  }
  return openEditorModal(buildDraft(record, contentHtml), folders);
}

export function openNoteEditor(recordId) {
  if (noteEditorSession?.handle && !noteEditorSession.handle.closed) {
    sessionTitleFocus(noteEditorSession);
    return Promise.resolve(noteEditorSession.handle);
  }
  if (openingEditorPromise) {
    return openingEditorPromise;
  }
  const contextVersion = editorContextVersion;
  const operation = openNoteEditorInternal(recordId, contextVersion);
  const managed = operation.finally(() => {
    if (openingEditorPromise === managed) {
      openingEditorPromise = null;
    }
  });
  openingEditorPromise = managed;
  return managed;
}

function sessionTitleFocus(session) {
  if (session.titleInput?.isConnected) {
    session.titleInput.focus();
  }
}
