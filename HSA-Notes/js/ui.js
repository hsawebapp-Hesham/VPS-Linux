import {
  applyTranslations,
  getLanguage,
  initI18n,
  setLanguage,
  t
} from './i18n.js';
import {
  changeMasterPassword,
  createVault,
  estimatePasswordStrength,
  getMasterKey,
  hasVault,
  initAuth,
  isUnlocked,
  lockVault,
  touchActivity,
  unlockVault,
  validateMasterPasswordStrength
} from './auth.js';

const THEME_STORAGE_KEY = 'hsaNotesTheme';
const TOAST_DURATION_MS = 4500;
const MODAL_SIZES = new Set(['sm', 'md', 'lg', 'xl', 'full']);
const TOAST_TYPES = new Set(['info', 'success', 'error', 'warning']);
const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [contenteditable="true"], [tabindex]:not([tabindex="-1"])';
const modalStack = [];
const buttonStates = new WeakMap();
let bodyOverflowBeforeModals;
let modalSequence = 0;

let delegatedListenersInstalled = false;
let globalShortcutsInstalled = false;
let globalShortcutsCleanup;
let uiInitPromise;
let authMode = 'setup';
let authSubmitPromise;

export class UIError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = 'UIError';
    this.code = code;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

function documentApi() {
  return globalThis.document || null;
}

function isElement(value) {
  return Boolean(value && value.nodeType === 1);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function safeToken(value, fallback) {
  const text = String(value ?? '');
  return /^[A-Za-z0-9_-]+$/.test(text) ? text : fallback;
}

function safeClassNames(value, fallback = '') {
  const tokens = String(value ?? '')
    .split(/\s+/)
    .map((token) => token.replace(/[^A-Za-z0-9_-]/g, ''))
    .filter(Boolean);
  return tokens.length > 0 ? tokens.join(' ') : fallback;
}

function appendChildren(parent, children) {
  for (const child of children) {
    parent.appendChild(child);
  }
}

function removeChildren(parent) {
  while (parent.firstChild) {
    parent.removeChild(parent.firstChild);
  }
}

function setHidden(element, hidden) {
  if (!element) {
    return;
  }
  element.hidden = Boolean(hidden);
  element.setAttribute('aria-hidden', String(Boolean(hidden)));
  element.classList.toggle('is-hidden', Boolean(hidden));
}

function spriteHref(name) {
  const rawName = safeToken(name, 'circle');
  const spriteName = rawName.startsWith('icon-') ? rawName : `icon-${rawName}`;
  return `assets/icons/sprite.svg#${spriteName}`;
}

function appendIconNode(doc, parent, name, className = 'icon') {
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', safeClassNames(className, 'icon'));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const use = doc.createElementNS('http://www.w3.org/2000/svg', 'use');
  const href = spriteHref(name);
  use.setAttribute('href', href);
  use.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', href);
  svg.appendChild(use);
  parent.appendChild(svg);
  return svg;
}

export function icon(name, className = '') {
  const safeClass = safeClassNames(className, 'icon');
  const href = spriteHref(name);
  return `<svg class="${escapeAttr(safeClass)}" aria-hidden="true" focusable="false"><use href="${escapeAttr(href)}" xlink:href="${escapeAttr(href)}"></use></svg>`;
}

export function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

export function escapeAttr(value) {
  return escapeHTML(value);
}

export function formatDate(value, options = {}) {
  if (value === undefined || value === null || value === '') {
    return '';
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const locale = getLanguage() === 'ar' ? 'ar' : 'en-US';
  const defaults = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  };
  const optionObject = isObject(options) ? options : {};
  const hasStyle = Boolean(optionObject.dateStyle || optionObject.timeStyle || optionObject.calendar || optionObject.numberingSystem || optionObject.timeZone);
  const normalizedOptions = { ...(hasStyle ? {} : defaults), ...optionObject };
  const requestedLocale = typeof options === 'string' ? options : normalizedOptions.locale || locale;
  delete normalizedOptions.locale;
  try {
    return new Intl.DateTimeFormat(requestedLocale, normalizedOptions).format(date);
  } catch {
    return date.toISOString();
  }
}

export function debounce(fn, wait = 300) {
  if (typeof fn !== 'function') {
    throw new UIError('INVALID_DEBOUNCE_FUNCTION', 'A function is required');
  }
  const delay = Math.max(0, Number(wait) || 0);
  let timer;
  let lastArgs;
  let lastThis;
  let result;
  const debounced = function debounced(...args) {
    lastArgs = args;
    lastThis = this;
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = undefined;
      result = fn.apply(lastThis, lastArgs);
    }, delay);
    return result;
  };
  debounced.cancel = () => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };
  debounced.flush = () => {
    if (timer === undefined) {
      return result;
    }
    clearTimeout(timer);
    timer = undefined;
    result = fn.apply(lastThis, lastArgs);
    return result;
  };
  return debounced;
}

export async function copyText(value) {
  const text = String(value ?? '');
  const clipboard = globalThis.navigator?.clipboard;
  if (clipboard && typeof clipboard.writeText === 'function') {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      return copyTextWithTextarea(text);
    }
  }
  return copyTextWithTextarea(text);
}

function copyTextWithTextarea(text) {
  const doc = documentApi();
  if (!doc || !doc.body || typeof doc.execCommand !== 'function') {
    return false;
  }
  const activeElement = doc.activeElement;
  const selection = doc.getSelection?.();
  const selectedRanges = [];
  if (selection) {
    for (let index = 0; index < selection.rangeCount; index += 1) {
      selectedRanges.push(selection.getRangeAt(index).cloneRange());
    }
  }
  const textarea = doc.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '-1000px';
  textarea.style.left = '-1000px';
  textarea.style.opacity = '0';
  doc.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  let copied = false;
  try {
    copied = doc.execCommand('copy');
  } catch {
    copied = false;
  }
  textarea.remove();
  if (activeElement && typeof activeElement.focus === 'function') {
    activeElement.focus();
  }
  if (selection) {
    selection.removeAllRanges();
    for (const range of selectedRanges) {
      selection.addRange(range);
    }
  }
  return copied;
}

export function showToast(message, type = 'info') {
  const doc = documentApi();
  if (!doc || !doc.body) {
    return null;
  }
  let container = doc.getElementById('toast-container') || doc.getElementById('toast-root');
  if (!container) {
    container = doc.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    container.setAttribute('aria-live', 'polite');
    doc.body.appendChild(container);
  }
  container.classList.add('toast-container');
  const toastType = TOAST_TYPES.has(type) ? type : 'info';
  const toast = doc.createElement('div');
  toast.className = `toast toast--${toastType}`;
  toast.setAttribute('role', toastType === 'error' ? 'alert' : 'status');
  const text = doc.createElement('span');
  text.className = 'toast__message';
  text.textContent = String(message ?? '');
  toast.appendChild(text);
  const close = doc.createElement('button');
  close.type = 'button';
  close.className = 'toast__close';
  close.dataset.action = 'close-toast';
  close.setAttribute('aria-label', t('common.close'));
  close.textContent = '×';
  toast.appendChild(close);
  const visibleToasts = Array.from(container.children).filter((child) => child.classList?.contains('toast'));
  while (visibleToasts.length >= 3) {
    visibleToasts.shift()?.remove();
  }
  container.appendChild(toast);
  const timeout = setTimeout(() => toast.remove(), TOAST_DURATION_MS);
  if (timeout && typeof timeout.unref === 'function') {
    timeout.unref();
  }
  toast.addEventListener('click', (event) => {
    const action = event.target?.closest?.('[data-action="close-toast"]');
    if (action) {
      clearTimeout(timeout);
      toast.remove();
    }
  });
  return toast;
}

export function setButtonLoading(button, loading, label) {
  let target = button;
  if (typeof target === 'string') {
    target = documentApi()?.querySelector(target) || null;
  }
  if (!isElement(target)) {
    return null;
  }
  const shouldLoad = Boolean(loading);
  let state = buttonStates.get(target);
  if (!state) {
    state = {
      children: Array.from(target.childNodes).map((child) => child.cloneNode(true)),
      disabled: target.disabled,
      ariaBusy: target.getAttribute('aria-busy')
    };
    buttonStates.set(target, state);
  }
  target.disabled = shouldLoad || state.disabled;
  target.setAttribute('aria-busy', String(shouldLoad));
  target.classList.toggle('is-loading', shouldLoad);
  if (shouldLoad) {
    const text = label === undefined ? (target.textContent || '').trim() : String(label);
    removeChildren(target);
    const spinner = target.ownerDocument.createElement('span');
    spinner.className = 'button-spinner';
    spinner.setAttribute('aria-hidden', 'true');
    target.appendChild(spinner);
    if (text) {
      const textNode = target.ownerDocument.createElement('span');
      textNode.textContent = text;
      target.appendChild(textNode);
    }
  } else {
    removeChildren(target);
    appendChildren(target, state.children.map((child) => child.cloneNode(true)));
    if (state.ariaBusy === null) {
      target.removeAttribute('aria-busy');
    } else {
      target.setAttribute('aria-busy', state.ariaBusy);
    }
    buttonStates.delete(target);
  }
  return target;
}

function renderAction(action) {
  const config = typeof action === 'string' ? { label: action } : isObject(action) ? action : {};
  const label = String(config.label ?? '');
  const actionName = safeToken(config.action, '');
  const classes = safeClassNames(config.className, 'button');
  const iconName = config.iconName ? icon(config.iconName, 'button__icon') : '';
  const actionAttribute = actionName ? ` data-action="${escapeAttr(actionName)}"` : '';
  const typeAttribute = config.type === 'submit' ? ' type="submit"' : ' type="button"';
  return `<button${typeAttribute} class="${escapeAttr(classes)}"${actionAttribute}>${iconName}<span>${escapeHTML(label)}</span></button>`;
}

export function renderEmptyState(options = {}) {
  const config = typeof options === 'string' ? { title: options } : isObject(options) ? options : {};
  const title = String(config.title ?? t('common.empty'));
  const message = config.message === undefined ? '' : String(config.message);
  const actionLabel = config.actionLabel === undefined ? '' : String(config.actionLabel);
  const actionName = safeToken(config.action, '');
  const actionMarkup = actionLabel
    ? `<button type="button" class="button button--primary"${actionName ? ` data-action="${escapeAttr(actionName)}"` : ''}>${config.actionIcon ? icon(config.actionIcon, 'button__icon') : ''}<span>${escapeHTML(actionLabel)}</span></button>`
    : '';
  return `<section class="empty-state" role="status"><div class="empty-state__icon">${icon(config.iconName || 'inbox', 'empty-state__icon')}</div><h2>${escapeHTML(title)}</h2>${message ? `<p>${escapeHTML(message)}</p>` : ''}${actionMarkup}</section>`;
}

export function renderPageHeader(options = {}) {
  const config = isObject(options) ? options : {};
  const title = String(config.title ?? '');
  const subtitle = config.subtitle === undefined ? '' : String(config.subtitle);
  const eyebrow = config.eyebrow === undefined ? '' : String(config.eyebrow);
  const actions = Array.isArray(config.actions) ? config.actions.map((action) => renderAction(action)).join('') : '';
  return `<header class="page-header">${eyebrow ? `<div class="page-header__eyebrow">${escapeHTML(eyebrow)}</div>` : ''}<div class="page-header__content"><div><h1>${escapeHTML(title)}</h1>${subtitle ? `<p>${escapeHTML(subtitle)}</p>` : ''}</div>${actions ? `<div class="page-header__actions">${actions}</div>` : ''}</div></header>`;
}

export function renderSkeleton(count = 3, variant = 'list') {
  const amount = Math.min(20, Math.max(1, Number.isInteger(count) ? count : 1));
  const safeVariant = safeToken(variant, 'list');
  return `<div class="skeleton skeleton--${escapeAttr(safeVariant)}" aria-hidden="true">${Array.from({ length: amount }, () => '<span class="skeleton__line"></span>').join('')}</div>`;
}

function appendModalContent(parent, content) {
  if (content === undefined || content === null || content === '') {
    return;
  }
  if (Array.isArray(content)) {
    for (const item of content) {
      appendModalContent(parent, item);
    }
    return;
  }
  if (typeof content === 'function') {
    const result = content({ body: parent });
    if (result && typeof result.then === 'function') {
      result.then((value) => appendModalContent(parent, value)).catch(() => undefined);
    } else {
      appendModalContent(parent, result);
    }
    return;
  }
  if (isElement(content) || content.nodeType === 11 || content.nodeType === 9) {
    parent.appendChild(content);
    return;
  }
  parent.textContent = String(content);
}

function createModalAction(doc, config, handle) {
  const action = typeof config === 'string' ? { label: config } : isObject(config) ? config : {};
  const button = doc.createElement('button');
  button.type = action.submit === true ? 'submit' : 'button';
  button.className = safeClassNames(action.className, `button button--${safeToken(action.variant, 'secondary')}`);
  if (action.disabled) {
    button.disabled = true;
  }
  if (action.iconName) {
    const iconElement = doc.createElement('span');
    iconElement.className = 'button__icon';
    appendIconNode(doc, iconElement, action.iconName);
    button.appendChild(iconElement);
  }
  const label = doc.createElement('span');
  label.textContent = String(action.label ?? t('common.cancel'));
  button.appendChild(label);
  button.addEventListener('click', async (event) => {
    let shouldClose = action.closeOnClick !== false;
    if (typeof action.onClick === 'function') {
      try {
        const callbackContext = {
          event,
          handle,
          preventDefault: () => event.preventDefault(),
          stopPropagation: () => event.stopPropagation()
        };
        const result = await action.onClick(callbackContext, handle);
        if (result === false) {
          shouldClose = false;
        } else if (result === true) {
          shouldClose = true;
        }
      } catch {
        shouldClose = false;
        showToast(t('toast.error'), 'error');
      }
    }
    if (shouldClose) {
      closeModal(handle);
    }
  });
  return button;
}

export function openModal(options = {}) {
  const doc = documentApi();
  if (!doc || !doc.body) {
    return null;
  }
  const config = isObject(options) ? options : {};
  const overlay = doc.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.setAttribute('role', 'presentation');
  const dialog = doc.createElement('section');
  const modalSize = MODAL_SIZES.has(config.size) ? config.size : 'md';
  dialog.className = `modal modal--${modalSize}`;
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  const modalId = ++modalSequence;
  const titleId = `modal-title-${modalId}`;
  const bodyId = `modal-body-${modalId}`;
  dialog.setAttribute('aria-labelledby', titleId);
  const header = doc.createElement('header');
  header.className = 'modal__header';
  const title = doc.createElement('h2');
  title.id = titleId;
  title.className = 'modal__title';
  title.textContent = String(config.title ?? '');
  header.appendChild(title);
  const closeButton = doc.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'modal__close';
  closeButton.dataset.action = 'close-modal';
  closeButton.setAttribute('aria-label', t('common.close'));
  closeButton.textContent = '×';
  header.appendChild(closeButton);
  const body = doc.createElement('div');
  body.id = bodyId;
  body.className = 'modal__body';
  body.setAttribute('aria-labelledby', titleId);
  appendModalContent(body, config.content);
  const actions = Array.isArray(config.actions) ? config.actions : config.actions ? [config.actions] : [];
  const footer = doc.createElement('footer');
  footer.className = 'modal__actions';
  for (const action of actions) {
    footer.appendChild(createModalAction(doc, action, null));
  }
  dialog.append(header, body);
  if (actions.length > 0) {
    dialog.appendChild(footer);
  }
  overlay.appendChild(dialog);
  const previousFocus = doc.activeElement;
  const handle = {
    element: overlay,
    dialog,
    body,
    title,
    close: () => closeModal(handle),
    setContent: (content) => {
      removeChildren(body);
      appendModalContent(body, content);
    },
    setTitle: (value) => {
      title.textContent = String(value ?? '');
    }
  };
  closeButton.addEventListener('click', () => closeModal(handle));
  overlay.__modalHandle = handle;
  const actionButtons = Array.from(footer.children);
  for (let index = 0; index < actionButtons.length; index += 1) {
    const button = actionButtons[index];
    const action = actions[index];
    const configAction = typeof action === 'string' ? { label: action } : isObject(action) ? action : {};
    button.replaceWith(createModalAction(doc, configAction, handle));
  }
  const handleKeydown = (event) => {
    if (modalStack[modalStack.length - 1] !== handle) {
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      closeModal(handle);
      return;
    }
    if (event.key !== 'Tab') {
      return;
    }
    const focusable = Array.from(dialog.querySelectorAll(FOCUSABLE_SELECTOR)).filter((element) => !element.disabled && !element.hidden && element.getAttribute('aria-hidden') !== 'true');
    if (focusable.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && doc.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && doc.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  handle.previousFocus = previousFocus;
  handle.onClose = config.onClose;
  handle.handleKeydown = handleKeydown;
  dialog.tabIndex = -1;
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      closeModal(handle);
    }
  });
  doc.addEventListener('keydown', handleKeydown, true);
  if (modalStack.length === 0) {
    bodyOverflowBeforeModals = doc.body.style.overflow;
  }
  modalStack.push(handle);
  const modalRoot = doc.getElementById('modal-root') || doc.body;
  modalRoot.appendChild(overlay);
  doc.body.style.overflow = 'hidden';
  const focusable = dialog.querySelector(FOCUSABLE_SELECTOR);
  (focusable || dialog).focus?.();
  if (typeof config.onOpen === 'function') {
    Promise.resolve().then(() => config.onOpen(handle)).catch(() => showToast(t('toast.error'), 'error'));
  }
  handle.close = () => closeModal(handle);
  return handle;
}

export function closeModal(handleOrElement) {
  const handle = handleOrElement?.__modalHandle || handleOrElement?.element?.__modalHandle || modalStack.find((item) => item.element === handleOrElement) || handleOrElement;
  if (!handle || handle.closed) {
    return false;
  }
  handle.closed = true;
  const index = modalStack.indexOf(handle);
  if (index >= 0) {
    modalStack.splice(index, 1);
  }
  const doc = handle.element?.ownerDocument;
  if (doc) {
    doc.removeEventListener('keydown', handle.handleKeydown, true);
    if (modalStack.length === 0) {
      doc.body.style.overflow = bodyOverflowBeforeModals || '';
      bodyOverflowBeforeModals = undefined;
    }
  }
  if (typeof handle.onClose === 'function') {
    Promise.resolve().then(() => handle.onClose(handle)).catch(() => undefined);
  }
  handle.element?.remove();
  if (handle.previousFocus && typeof handle.previousFocus.focus === 'function' && handle.previousFocus.isConnected !== false) {
    handle.previousFocus.focus();
  }
  return true;
}

export function confirmAction(options = {}) {
  const doc = documentApi();
  if (!doc || !doc.body) {
    return Promise.resolve(false);
  }
  const config = isObject(options) ? options : {};
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (!settled) {
        settled = true;
        resolve(Boolean(value));
      }
    };
    const handle = openModal({
      title: config.title || t('common.confirm'),
      content: config.message || '',
      size: config.size || 'sm',
      actions: [
        { label: config.cancelLabel || t('common.cancel'), variant: 'secondary', onClick: () => finish(false) },
        { label: config.confirmLabel || t('common.confirm'), variant: safeToken(config.type, 'primary'), onClick: () => finish(true) }
      ],
      onClose: () => finish(false)
    });
    if (!handle) {
      finish(false);
    }
  });
}

function searchResultItems(items) {
  return (Array.isArray(items) ? items : []).map((item) => {
    if (typeof item === 'string') {
      return { label: item, value: item };
    }
    if (!isObject(item)) {
      return null;
    }
    return {
      ...item,
      label: String(item.label ?? item.title ?? item.name ?? item.value ?? ''),
      value: item.value ?? item.id ?? item.label ?? item.title ?? ''
    };
  }).filter(Boolean);
}

export function showGlobalSearch(options = {}) {
  const doc = documentApi();
  if (!doc || !doc.body) {
    return null;
  }
  const config = isObject(options) ? options : {};
  const content = doc.createElement('div');
  content.className = 'global-search';
  const input = doc.createElement('input');
  input.type = 'search';
  input.className = 'global-search__input';
  input.placeholder = config.placeholder || t('app.searchPlaceholder');
  input.setAttribute('aria-label', config.placeholder || t('common.search'));
  input.autocomplete = 'off';
  const results = doc.createElement('div');
  results.className = 'global-search__results';
  results.setAttribute('role', 'listbox');
  content.append(input, results);
  let items = searchResultItems(config.items || []);
  let activeIndex = -1;
  let searchToken = 0;
  let handle;
  const provider = typeof config.onSearch === 'function' ? config.onSearch : typeof config.search === 'function' ? config.search : null;
  const renderResults = (nextItems) => {
    items = searchResultItems(nextItems);
    removeChildren(results);
    activeIndex = -1;
    if (items.length === 0) {
      const empty = doc.createElement('div');
      empty.className = 'global-search__empty';
      empty.textContent = t('app.noResults');
      results.appendChild(empty);
      return;
    }
    for (const item of items) {
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'global-search__result';
      button.setAttribute('role', 'option');
      button.textContent = item.label;
      button.addEventListener('click', () => {
        if (typeof config.onSelect === 'function') {
          Promise.resolve(config.onSelect(item, handle)).catch(() => showToast(t('toast.error'), 'error'));
        }
        closeModal(handle);
      });
      results.appendChild(button);
    }
  };
  const performSearch = async (query) => {
    const token = ++searchToken;
    if (!provider) {
      const normalized = query.trim().toLocaleLowerCase();
      renderResults(items.filter((item) => !normalized || item.label.toLocaleLowerCase().includes(normalized)));
      return;
    }
    try {
      const value = await provider(query);
      if (token === searchToken) {
        renderResults(Array.isArray(value) ? value : value?.items || []);
      }
    } catch {
      if (token === searchToken) {
        renderResults([]);
        showToast(t('toast.error'), 'error');
      }
    }
  };
  const debouncedSearch = debounce((query) => {
    void performSearch(query);
  }, Math.max(0, Number(config.debounceMs) || 200));
  input.addEventListener('input', () => debouncedSearch(input.value));
  input.addEventListener('keydown', (event) => {
    const buttons = Array.from(results.querySelectorAll('button'));
    if (event.key === 'ArrowDown' && buttons.length > 0) {
      event.preventDefault();
      activeIndex = (activeIndex + 1) % buttons.length;
      buttons[activeIndex].focus();
    } else if (event.key === 'ArrowUp' && buttons.length > 0) {
      event.preventDefault();
      activeIndex = activeIndex <= 0 ? buttons.length - 1 : activeIndex - 1;
      buttons[activeIndex].focus();
    } else if (event.key === 'Enter' && activeIndex >= 0 && buttons[activeIndex]) {
      event.preventDefault();
      buttons[activeIndex].click();
    }
  });
  renderResults(items);
  handle = openModal({
    title: config.title || t('common.search'),
    content,
    size: config.size || 'lg',
    onOpen: (modalHandle) => {
      input.focus();
      if (config.initialQuery) {
        input.value = String(config.initialQuery);
      }
      void performSearch(input.value);
      return modalHandle;
    },
    onClose: () => {
      debouncedSearch.cancel();
    }
  });
  return handle;
}

function isEditableTarget(target) {
  if (!target || target.nodeType !== 1) {
    return false;
  }
  const tagName = target.tagName;
  return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT' || target.isContentEditable === true;
}

function handleGlobalKeydown(event) {
  const key = String(event.key || '').toLowerCase();
  const modifier = event.ctrlKey || event.metaKey;
  if (modifier && !event.shiftKey && key === 'k') {
    event.preventDefault();
    showGlobalSearch();
    return;
  }
  if (modifier && event.shiftKey && key === 'l') {
    event.preventDefault();
    void lockApplication();
    return;
  }
  if (modifier && event.shiftKey && key === 'd') {
    event.preventDefault();
    toggleTheme();
    return;
  }
  if (event.key === '/' && !modifier && !isEditableTarget(event.target)) {
    event.preventDefault();
    showGlobalSearch();
  }
}

export function initGlobalShortcuts() {
  if (globalShortcutsInstalled) {
    return globalShortcutsCleanup;
  }
  const doc = documentApi();
  if (!doc) {
    return () => undefined;
  }
  doc.addEventListener('keydown', handleGlobalKeydown);
  globalShortcutsInstalled = true;
  globalShortcutsCleanup = () => {
    if (!globalShortcutsInstalled) {
      return;
    }
    doc.removeEventListener('keydown', handleGlobalKeydown);
    globalShortcutsInstalled = false;
    globalShortcutsCleanup = undefined;
  };
  return globalShortcutsCleanup;
}

export const installGlobalShortcuts = initGlobalShortcuts;

export function destroyGlobalShortcuts() {
  if (globalShortcutsCleanup) {
    globalShortcutsCleanup();
  }
}

function findExisting(doc, ids, selectors = []) {
  for (const id of ids) {
    const element = doc.getElementById(id);
    if (element) {
      return element;
    }
  }
  for (const selector of selectors) {
    const element = doc.querySelector(selector);
    if (element) {
      return element;
    }
  }
  return null;
}

function ensureExistingChild(parent, ids, tagName, className, selectors = []) {
  const doc = parent.ownerDocument;
  let element = findExisting(doc, ids, selectors);
  if (!element) {
    element = doc.createElement(tagName);
    element.id = ids[0];
    parent.appendChild(element);
  }
  if (className) {
    element.classList.add(...safeClassNames(className).split(' ').filter(Boolean));
  }
  return element;
}

function ensureCoreUI() {
  const doc = documentApi();
  if (!doc || !doc.body) {
    return null;
  }
  const splash = ensureExistingChild(doc.body, ['splash', 'splash-screen'], 'section', 'splash');
  const splashTitle = ensureExistingChild(splash, ['splash-title'], 'div', 'splash__title', ['.splash-brand-name']);
  splashTitle.textContent = t('common.appName');
  const splashText = ensureExistingChild(splash, ['splash-text'], 'p', 'splash__text', ['.splash-caption']);
  splashText.textContent = t('app.loadingSecureWorkspace');
  const auth = ensureExistingChild(doc.body, ['auth', 'auth-screen'], 'main', 'auth-screen');
  const authCard = ensureExistingChild(auth, ['auth-card', 'auth-panel'], 'section', 'auth-card');
  const modeTitle = ensureExistingChild(authCard, ['auth-mode-title'], 'h1', 'auth-card__title');
  const modeText = ensureExistingChild(authCard, ['auth-mode-text', 'auth-mode-subtitle'], 'p', 'auth-card__description');
  const form = ensureExistingChild(authCard, ['auth-form'], 'form', 'auth-form');
  form.setAttribute('data-auth-form', 'true');
  form.noValidate = true;
  const passwordLabel = ensureExistingChild(form, ['auth-password-label'], 'label', 'form-label', ['label[for="master-password"]', 'label[for="auth-password"]']);
  const password = ensureExistingChild(form, ['auth-password', 'master-password'], 'input', 'form-input');
  if (!password.dataset.uiInitialized) {
    password.type = 'password';
    password.name = 'masterPassword';
    password.autocomplete = 'current-password';
    password.required = true;
    password.dataset.uiInitialized = 'true';
  }
  passwordLabel.htmlFor = password.id;
  const confirmField = ensureExistingChild(form, ['auth-confirm-field', 'confirm-password-field'], 'div', 'form-field', ['[data-confirm-password-field]']);
  const confirmLabel = ensureExistingChild(confirmField, ['auth-confirm-password-label'], 'label', 'form-label', ['label[for="confirm-master-password"]', 'label[for="auth-confirm-password"]']);
  const confirm = ensureExistingChild(confirmField, ['auth-confirm-password', 'confirm-master-password'], 'input', 'form-input');
  if (!confirm.dataset.uiInitialized) {
    confirm.type = 'password';
    confirm.name = 'confirmMasterPassword';
    confirm.autocomplete = 'new-password';
    confirm.dataset.uiInitialized = 'true';
  }
  confirmLabel.htmlFor = confirm.id;
  const passwordToggle = ensureExistingChild(form, ['auth-show-password', 'master-password-toggle'], 'button', 'password-toggle');
  passwordToggle.type = 'button';
  passwordToggle.dataset.action = 'show-password';
  passwordToggle.dataset.passwordTarget = password.id;
  passwordToggle.setAttribute('aria-label', t('auth.showPassword'));
  passwordToggle.setAttribute('aria-pressed', 'false');
  const strength = ensureExistingChild(form, ['auth-strength', 'auth-strength-wrap'], 'div', 'password-strength');
  const strengthBar = ensureExistingChild(strength, ['auth-strength-bar'], 'span', 'password-strength__bar', ['.strength-track']);
  let strengthFill = strengthBar.querySelector('.strength-fill');
  if (!strengthFill) {
    strengthFill = doc.createElement('span');
    strengthFill.className = 'strength-fill';
    strengthBar.appendChild(strengthFill);
  }
  const strengthText = ensureExistingChild(strength, ['auth-strength-text', 'auth-strength-label'], 'span', 'password-strength__text');
  const submit = ensureExistingChild(form, ['auth-submit'], 'button', 'button button--primary auth-submit');
  submit.type = 'submit';
  submit.dataset.action = 'auth-submit';
  const error = ensureExistingChild(authCard, ['auth-error'], 'p', 'form-error');
  error.setAttribute('role', 'alert');
  setHidden(error, true);
  const modeToggle = ensureExistingChild(authCard, ['auth-toggle-mode'], 'button', 'auth-card__mode-toggle');
  modeToggle.type = 'button';
  modeToggle.dataset.action = 'auth-toggle-mode';
  const app = ensureExistingChild(doc.body, ['app', 'app-shell'], 'main', 'app-shell');
  return { splash, auth, authCard, app, form, password, passwordLabel, confirm, confirmLabel, confirmField, passwordToggle, strength, strengthBar, strengthFill, strengthText, submit, error, modeTitle, modeText, modeToggle };
}

function strengthTranslationKey(label) {
  return label === 'veryWeak' ? 'generator.veryWeak' : `credentials.${label}`;
}

function updatePasswordStrength(elements, value) {
  if (!elements) {
    return;
  }
  const estimate = estimatePasswordStrength(value);
  if (elements.strengthFill) {
    elements.strengthFill.style.width = `${estimate.percent}%`;
    elements.strengthBar.style.width = '100%';
  } else {
    elements.strengthBar.style.width = `${estimate.percent}%`;
  }
  elements.strengthBar.dataset.strength = estimate.label;
  elements.strengthBar.dataset.level = estimate.label;
  elements.strengthBar.setAttribute('aria-valuenow', String(estimate.percent));
  elements.strengthText.textContent = `${t('auth.passwordStrength')}: ${t(strengthTranslationKey(estimate.label))}`;
}

function updateAuthMode(elements, mode) {
  if (!elements) {
    return;
  }
  authMode = mode === 'login' ? 'login' : 'setup';
  const setup = authMode === 'setup';
  elements.modeTitle.textContent = t(setup ? 'auth.setupTitle' : 'auth.loginTitle');
  elements.modeText.textContent = t(setup ? 'auth.setupSubtitle' : 'auth.loginSubtitle');
  const eyebrow = elements.authCard.querySelector('.section-eyebrow');
  if (eyebrow) {
    eyebrow.textContent = t(setup ? 'auth.firstTime' : 'auth.welcomeBack');
  }
  elements.passwordLabel.textContent = t('auth.masterPassword');
  elements.confirmLabel.textContent = t('auth.confirmPassword');
  elements.password.setAttribute('autocomplete', setup ? 'new-password' : 'current-password');
  elements.passwordToggle.setAttribute('aria-label', t(elements.password.type === 'password' ? 'auth.showPassword' : 'auth.hidePassword'));
  const submitLabel = elements.submit.querySelector('span[data-i18n]');
  if (submitLabel) {
    submitLabel.textContent = t(setup ? 'auth.createAndUnlock' : 'auth.unlock');
  } else {
    elements.submit.textContent = t(setup ? 'auth.createAndUnlock' : 'auth.unlock');
  }
  const togglePrefix = elements.modeToggle.querySelector('.auth-mode-toggle-copy span[data-i18n="auth.firstTime"], .auth-mode-toggle-copy span[data-i18n="auth.alreadyHaveAccount"]');
  const toggleStrong = elements.modeToggle.querySelector('.auth-mode-toggle-copy strong');
  if (togglePrefix) {
    togglePrefix.textContent = t(setup ? 'auth.firstTime' : 'auth.alreadyHaveAccount');
  }
  if (toggleStrong) {
    toggleStrong.textContent = t(setup ? 'auth.useExistingAccount' : 'auth.createAccount');
  } else {
    elements.modeToggle.textContent = t(setup ? 'auth.useExistingAccount' : 'auth.createAccount');
  }
  setHidden(elements.modeToggle, hasVault());
  setHidden(elements.confirmField, !setup);
  setHidden(elements.strength, !setup);
  updatePasswordStrength(elements, elements.password.value);
}

function setAuthError(elements, message) {
  if (!elements) {
    return;
  }
  elements.error.textContent = message ? String(message) : '';
  setHidden(elements.error, !message);
}

function authErrorMessage(error) {
  const code = error?.code || '';
  const messages = {
    AUTH_INVALID_PASSWORD: 'auth.invalidCredentials',
    AUTH_PASSWORD_WEAK: 'auth.passwordTooShort',
    AUTH_VAULT_ALREADY_EXISTS: 'auth.vaultExists',
    AUTH_VAULT_NOT_FOUND: 'auth.vaultMissing',
    AUTH_LOCKED: 'auth.locked',
    AUTH_CRYPTO_UNAVAILABLE: 'auth.cryptoUnavailable',
    AUTH_STORAGE_UNAVAILABLE: 'auth.secureStorageUnavailable',
    AUTH_LOCKOUT: 'auth.tooManyAttempts',
    AUTH_OPERATION_CANCELLED: 'auth.unexpectedError'
  };
  return t(messages[code] || 'auth.unexpectedError');
}

async function handleAuthSubmit(event) {
  if (event) {
    event.preventDefault();
  }
  if (authSubmitPromise) {
    return authSubmitPromise;
  }
  const elements = ensureCoreUI();
  if (!elements) {
    return false;
  }
  const password = elements.password.value;
  const operation = (async () => {
    setAuthError(elements, '');
    setButtonLoading(elements.submit, true);
    try {
      await initAuth();
      if (hasVault() && authMode === 'setup') {
        updateAuthMode(elements, 'login');
      }
      if (authMode === 'setup') {
        if (elements.confirm.value !== password) {
          throw new Error('AUTH_PASSWORD_MISMATCH');
        }
        await createVault(password);
      } else {
        await unlockVault(password);
      }
      elements.password.value = '';
      elements.confirm.value = '';
      updatePasswordStrength(elements, '');
      showAppView();
      dispatchAuthEvent('hsa-auth-unlocked');
      showToast(t(authMode === 'setup' ? 'auth.passwordCreated' : 'auth.loginSuccess'), 'success');
      return true;
    } catch (error) {
      const message = error?.message === 'AUTH_PASSWORD_MISMATCH' ? t('auth.passwordMismatch') : authErrorMessage(error);
      setAuthError(elements, message);
      if (error?.code === 'AUTH_LOCKOUT') {
        showToast(message, 'warning');
      }
      return false;
    } finally {
      setButtonLoading(elements.submit, false);
      updatePasswordStrength(elements, elements.password.value);
    }
  })();
  authSubmitPromise = operation.finally(() => {
    authSubmitPromise = undefined;
  });
  return authSubmitPromise;
}

function dispatchAuthEvent(name) {
  const eventApi = globalThis.CustomEvent;
  if (typeof eventApi === 'function' && typeof globalThis.dispatchEvent === 'function') {
    globalThis.dispatchEvent(new eventApi(name));
  }
}

function showAuthView(options = {}) {
  const elements = ensureCoreUI();
  if (!elements) {
    return;
  }
  setHidden(elements.splash, true);
  setHidden(elements.auth, false);
  setHidden(elements.app, true);
  updateAuthMode(elements, options.mode || (hasVault() ? 'login' : 'setup'));
  if (options.clearApp) {
    elements.password.value = '';
    elements.confirm.value = '';
    setAuthError(elements, '');
    const pageContent = elements.app.querySelector?.('#page-content') || elements.app;
    removeChildren(pageContent);
  }
}

function showAppView() {
  const elements = ensureCoreUI();
  if (!elements) {
    return;
  }
  setHidden(elements.splash, true);
  setHidden(elements.auth, true);
  setHidden(elements.app, false);
}

async function lockApplication() {
  if (!isUnlocked()) {
    showAuthView({ clearApp: true });
    return true;
  }
  lockVault();
  showAuthView({ clearApp: true });
  return true;
}

function handlePasswordToggle(button) {
  const targetId = button.dataset.passwordTarget || 'auth-password';
  const target = documentApi()?.getElementById(targetId);
  if (!target) {
    return;
  }
  const show = target.type === 'password';
  target.type = show ? 'text' : 'password';
  button.setAttribute('aria-pressed', String(show));
  button.setAttribute('aria-label', t(show ? 'auth.hidePassword' : 'auth.showPassword'));
  const use = button.querySelector('use');
  if (use) {
    const href = show ? 'assets/icons/sprite.svg#icon-eye-off' : 'assets/icons/sprite.svg#icon-eye';
    use.setAttribute('href', href);
    use.setAttribute('xlink:href', href);
  }
}

async function handleDelegatedAction(event) {
  const target = event.target?.closest?.('[data-action]');
  if (!target) {
    return;
  }
  const action = target.dataset.action;
  if (!action) {
    return;
  }
  if (action === 'auth-submit') {
    event.preventDefault();
    await handleAuthSubmit(event);
    return;
  }
  if (action === 'show-password') {
    event.preventDefault();
    handlePasswordToggle(target);
    return;
  }
  if (action === 'auth-toggle-mode') {
    event.preventDefault();
    if (hasVault()) {
      return;
    }
    const elements = ensureCoreUI();
    updateAuthMode(elements, authMode === 'setup' ? 'login' : 'setup');
    return;
  }
  if (action === 'theme') {
    event.preventDefault();
    toggleTheme();
    applyTranslations();
    return;
  }
  if (action === 'language-toggle') {
    event.preventDefault();
    await setLanguage(getLanguage() === 'ar' ? 'en' : 'ar');
    const elements = ensureCoreUI();
    updateAuthMode(elements, authMode);
    updatePasswordStrength(elements, elements?.password?.value || '');
    return;
  }
  if (action === 'lock-app') {
    event.preventDefault();
    await lockApplication();
    return;
  }
  if (action === 'open-search') {
    event.preventDefault();
    showGlobalSearch();
    return;
  }
  if (action === 'close-modal') {
    event.preventDefault();
    const overlay = target.closest('.modal-overlay');
    if (overlay) {
      closeModal(overlay);
    }
    return;
  }
  if (action === 'close-toast') {
    event.preventDefault();
    target.closest('.toast')?.remove();
  }
}

function handleAuthInput(event) {
  const elements = ensureCoreUI();
  if (event.target === elements?.password || event.target === elements?.confirm) {
    setAuthError(elements, '');
    updatePasswordStrength(elements, elements.password.value);
  }
}

function handleAuthSubmitEvent(event) {
  const form = event.target;
  if (form?.matches?.('[data-auth-form]')) {
    event.preventDefault();
    void handleAuthSubmit(event);
  }
}

function handleAuthLocked() {
  for (const handle of [...modalStack]) {
    closeModal(handle);
  }
  showAuthView({ clearApp: true });
}

function handleDelegatedClick(event) {
  void handleDelegatedAction(event);
}

function installDelegatedListeners() {
  const doc = documentApi();
  if (!doc || delegatedListenersInstalled) {
    return;
  }
  doc.addEventListener('click', handleDelegatedClick);
  doc.addEventListener('submit', handleAuthSubmitEvent);
  doc.addEventListener('input', handleAuthInput);
  globalThis.addEventListener?.('hsa-auth-locked', handleAuthLocked);
  delegatedListenersInstalled = true;
}

function getStoredTheme() {
  try {
    const value = globalThis.localStorage?.getItem(THEME_STORAGE_KEY);
    if (value === 'dark' || value === 'light') {
      return value;
    }
  } catch {
    return documentApi()?.body?.dataset?.theme === 'dark' ? 'dark' : 'light';
  }
  const domTheme = documentApi()?.body?.dataset?.theme;
  return domTheme === 'dark' ? 'dark' : 'light';
}

export function getTheme() {
  return getStoredTheme();
}

function applyThemeToDocument(value) {
  const doc = documentApi();
  if (doc?.documentElement) {
    doc.documentElement.dataset.theme = value;
  }
  if (doc?.body) {
    doc.body.dataset.theme = value;
  }
  for (const button of doc?.querySelectorAll?.('[data-action="theme"]') || []) {
    button.setAttribute('aria-pressed', String(value === 'dark'));
  }
  return value;
}

export function setTheme(theme) {
  const value = theme === 'dark' ? 'dark' : 'light';
  try {
    globalThis.localStorage?.setItem(THEME_STORAGE_KEY, value);
    return applyThemeToDocument(value);
  } catch {
    return applyThemeToDocument(value);
  }
}

export function toggleTheme() {
  return setTheme(getTheme() === 'dark' ? 'light' : 'dark');
}

export function openExternalUrl(value) {
  const doc = documentApi();
  if (!doc) {
    return false;
  }
  let url;
  try {
    url = new URL(String(value), doc.baseURI || globalThis.location?.href);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return false;
  }
  const opener = typeof globalThis.open === 'function' ? globalThis.open : globalThis.window?.open;
  if (typeof opener !== 'function') {
    return false;
  }
  return opener.call(globalThis.window || globalThis, url.href, '_blank', 'noopener,noreferrer') !== null;
}

export const safeWindowOpen = openExternalUrl;

export async function initUI() {
  if (uiInitPromise) {
    return uiInitPromise;
  }
  uiInitPromise = (async () => {
    const elements = ensureCoreUI();
    if (!elements) {
      return { ready: false, elements: null };
    }
    installDelegatedListeners();
    initGlobalShortcuts();
    setTheme(getTheme());
    await initI18n();
    applyTranslations();
    try {
      const state = await initAuth();
      authMode = state.hasVault ? 'login' : 'setup';
      if (state.isUnlocked) {
        showAppView();
      } else {
        showAuthView();
      }
      return { ready: true, elements, ...state };
    } catch (error) {
      authMode = 'login';
      setAuthError(elements, authErrorMessage(error));
      showAuthView({ mode: 'login' });
      uiInitPromise = undefined;
      return { ready: false, elements, error };
    }
  })();
  return uiInitPromise;
}

export const initAuthUI = initUI;

export function destroyUI() {
  destroyGlobalShortcuts();
  const doc = documentApi();
  if (doc) {
    for (const handle of [...modalStack]) {
      closeModal(handle);
    }
  }
  if (delegatedListenersInstalled) {
    documentApi()?.removeEventListener('click', handleDelegatedClick);
    documentApi()?.removeEventListener('submit', handleAuthSubmitEvent);
    documentApi()?.removeEventListener('input', handleAuthInput);
    globalThis.removeEventListener?.('hsa-auth-locked', handleAuthLocked);
    delegatedListenersInstalled = false;
  }
  uiInitPromise = undefined;
}

if (typeof globalThis.document !== 'undefined') {
  void initUI();
}

export { changeMasterPassword, getMasterKey, touchActivity, validateMasterPasswordStrength };
