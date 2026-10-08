import { t } from './i18n.js';
import { renderAboutPage, disposeAboutPage } from './about.js';
import {
  renderApiKeysPage,
  disposeApiKeysPage
} from './apikeys.js';
import {
  renderCredentialsPage,
  disposeCredentialsPage
} from './credentials.js';
import {
  renderDashboardPage,
  disposeDashboardPage
} from './dashboard.js';
import {
  disposeGeneratorPage,
  renderGeneratorPage
} from './password-generator.js';
import {
  disposeNotesPage,
  renderNotesPage
} from './notes.js';
import {
  disposeSettingsPage,
  renderSettingsPage
} from './settings.js';
import {
  disposeSyncPage,
  renderSyncPage
} from './drive-sync.js';

const ROUTES = Object.freeze({
  dashboard: Object.freeze({
    titleKey: 'nav.dashboard',
    render: renderDashboardPage,
    dispose: disposeDashboardPage
  }),
  'api-keys': Object.freeze({
    titleKey: 'nav.apiKeys',
    render: renderApiKeysPage,
    dispose: disposeApiKeysPage
  }),
  'api-archive': Object.freeze({
    titleKey: 'archive.apiKey',
    context: Object.freeze({ archive: true }),
    render: renderApiKeysPage,
    dispose: disposeApiKeysPage
  }),
  credentials: Object.freeze({
    titleKey: 'nav.credentials',
    render: renderCredentialsPage,
    dispose: disposeCredentialsPage
  }),
  'credential-archive': Object.freeze({
    titleKey: 'archive.credential',
    context: Object.freeze({ archive: true }),
    render: renderCredentialsPage,
    dispose: disposeCredentialsPage
  }),
  generator: Object.freeze({
    titleKey: 'nav.generator',
    render: renderGeneratorPage,
    dispose: disposeGeneratorPage,
    disposeOnAbort: true
  }),
  notes: Object.freeze({
    titleKey: 'nav.notes',
    render: renderNotesPage,
    dispose: disposeNotesPage
  }),
  'note-archive': Object.freeze({
    titleKey: 'archive.note',
    context: Object.freeze({ archive: true }),
    render: renderNotesPage,
    dispose: disposeNotesPage
  }),
  backup: Object.freeze({
    titleKey: 'backup.title',
    render: renderSyncPage,
    dispose: disposeSyncPage
  }),
  sync: Object.freeze({
    titleKey: 'backup.title',
    render: renderSyncPage,
    dispose: disposeSyncPage
  }),
  settings: Object.freeze({
    titleKey: 'nav.settings',
    render: renderSettingsPage,
    dispose: disposeSettingsPage
  }),
  about: Object.freeze({
    titleKey: 'nav.about',
    render: renderAboutPage,
    dispose: disposeAboutPage
  })
});

const MOBILE_NAV_PARENTS = Object.freeze({
  'api-archive': 'api-keys',
  'credential-archive': 'credentials',
  'note-archive': 'notes',
  sync: 'backup'
});

let routerStarted = false;
let routerAbortController;
let activeModule;
let activeRenderPromise;
let ignoredHash = '';
let renderGeneration = 0;

function documentApi() {
  return globalThis.document || null;
}

function hasRoute(route) {
  return Object.prototype.hasOwnProperty.call(ROUTES, route);
}

function rawHashValue(hash) {
  const source = hash === undefined ? globalThis.location?.hash || '' : hash;
  const raw = String(source).trim();
  if (!raw) {
    return '';
  }
  const value = raw.startsWith('#') ? raw.slice(1) : raw;
  try {
    return decodeURIComponent(value).trim().toLowerCase();
  } catch {
    return value.toLowerCase();
  }
}

function normalizeRoute(route) {
  const value = String(route ?? '').trim().replace(/^#/, '').toLowerCase();
  return hasRoute(value) ? value : 'dashboard';
}

function pageContainer() {
  const doc = documentApi();
  return doc?.getElementById('page-content')
    || doc?.querySelector?.('.page-content')
    || null;
}

function updateNavigation(route) {
  const doc = documentApi();
  if (!doc) {
    return;
  }
  const activeRoutes = new Set([route]);
  const mobileParent = MOBILE_NAV_PARENTS[route];
  if (mobileParent) {
    activeRoutes.add(mobileParent);
  }
  for (const link of doc.querySelectorAll('[data-nav]')) {
    const linkRoute = normalizeRoute(link.dataset.nav);
    const isActive = activeRoutes.has(linkRoute);
    link.classList.toggle('is-active', isActive);
    if (isActive) {
      link.setAttribute('aria-current', 'page');
    } else {
      link.removeAttribute('aria-current');
    }
  }
}

function updateRouteMetadata(route) {
  const doc = documentApi();
  if (!doc) {
    return;
  }
  if (doc.body) {
    doc.body.dataset.route = route;
  }
  const title = doc.getElementById('page-title');
  if (title) {
    const titleKey = ROUTES[route].titleKey;
    title.dataset.i18n = titleKey;
    title.textContent = t(titleKey);
  }
}

function clearRouteMetadata() {
  const doc = documentApi();
  if (!doc) {
    return;
  }
  doc.body?.removeAttribute('data-route');
  const title = doc.getElementById('page-title');
  title?.removeAttribute('data-i18n');
  for (const link of doc.querySelectorAll('[data-nav]')) {
    link.classList.remove('is-active');
    link.removeAttribute('aria-current');
  }
}

function renderLoading(container) {
  const doc = documentApi();
  if (!doc || !container) {
    return;
  }
  const state = doc.createElement('div');
  state.className = 'page-state page-state-loading';
  state.dataset.routerState = 'loading';
  state.setAttribute('role', 'status');
  const loading = doc.createElement('span');
  loading.className = 'loading-mark';
  loading.setAttribute('aria-hidden', 'true');
  const mark = doc.createElement('span');
  loading.appendChild(mark);
  const label = doc.createElement('strong');
  label.dataset.i18n = 'common.loading';
  label.textContent = t('common.loading');
  const hint = doc.createElement('span');
  hint.dataset.i18n = 'common.loadingHint';
  hint.textContent = t('common.loadingHint');
  state.append(loading, label, hint);
  container.replaceChildren(state);
}

function renderError(container) {
  const doc = documentApi();
  if (!doc || !container) {
    return;
  }
  const state = doc.createElement('div');
  state.className = 'page-state';
  state.dataset.routerState = 'error';
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
    void refreshCurrentRoute();
  }, { once: true });
  state.append(title, message, retry);
  container.replaceChildren(state);
}

function disposeActiveModule() {
  const active = activeModule;
  activeModule = undefined;
  if (!active) {
    return;
  }
  if (active.definition.disposeOnAbort) {
    if (!active.controller.signal.aborted) {
      active.controller.abort();
    }
    return;
  }
  try {
    active.definition.dispose?.();
  } catch {
    return;
  } finally {
    if (!active.controller.signal.aborted) {
      active.controller.abort();
    }
  }
}

function isCurrentRender(generation, controller) {
  return routerStarted
    && generation === renderGeneration
    && !controller.signal.aborted;
}

async function performRender() {
  const generation = ++renderGeneration;
  disposeActiveModule();
  const route = normalizeRoute(rawHashValue());
  const definition = ROUTES[route];
  const container = pageContainer();
  updateRouteMetadata(route);
  updateNavigation(route);
  if (!container) {
    return null;
  }
  const controller = new AbortController();
  const context = Object.freeze({
    ...(definition.context || {}),
    route,
    signal: controller.signal,
    generation
  });
  activeModule = { controller, definition, route };
  renderLoading(container);
  try {
    const result = await definition.render(container, context);
    if (!isCurrentRender(generation, controller)) {
      return null;
    }
    return result || container;
  } catch {
    if (!isCurrentRender(generation, controller)) {
      return null;
    }
    disposeActiveModule();
    renderError(container);
    return null;
  }
}

function handleHashChange() {
  const raw = rawHashValue();
  if (ignoredHash && raw === ignoredHash) {
    ignoredHash = '';
    return;
  }
  ignoredHash = '';
  void renderCurrentRoute();
}

export function getCurrentRoute() {
  return normalizeRoute(rawHashValue());
}

export function renderCurrentRoute() {
  if (!routerStarted) {
    return Promise.resolve(null);
  }
  const operation = performRender();
  activeRenderPromise = operation;
  void operation.then(() => {
    if (activeRenderPromise === operation) {
      activeRenderPromise = undefined;
    }
  }, () => {
    if (activeRenderPromise === operation) {
      activeRenderPromise = undefined;
    }
  });
  return operation;
}

export function refreshCurrentRoute() {
  return renderCurrentRoute();
}

export function navigateTo(route, options = {}) {
  const target = normalizeRoute(route);
  const replace = typeof options === 'boolean' ? options : options.replace === true;
  const hash = `#${target}`;
  const raw = rawHashValue();
  if (!routerStarted) {
    if (globalThis.location) {
      if (replace && typeof globalThis.history?.replaceState === 'function') {
        globalThis.history.replaceState(globalThis.history.state, '', hash);
      } else {
        globalThis.location.hash = hash;
      }
    }
    return Promise.resolve(null);
  }
  if (replace) {
    ignoredHash = '';
    if (typeof globalThis.history?.replaceState === 'function') {
      globalThis.history.replaceState(globalThis.history.state, '', hash);
    } else if (globalThis.location) {
      const base = globalThis.location.href.split('#')[0];
      globalThis.location.replace(`${base}${hash}`);
    }
  } else if (raw !== target) {
    ignoredHash = target;
    if (globalThis.location) {
      globalThis.location.hash = hash;
    }
  }
  return renderCurrentRoute();
}

export function startRouter() {
  if (routerStarted) {
    return activeRenderPromise || Promise.resolve(null);
  }
  routerStarted = true;
  routerAbortController = new AbortController();
  if (typeof globalThis.addEventListener === 'function') {
    globalThis.addEventListener('hashchange', handleHashChange, {
      signal: routerAbortController.signal
    });
  }
  return renderCurrentRoute();
}

export function stopRouter() {
  routerStarted = false;
  renderGeneration += 1;
  ignoredHash = '';
  routerAbortController?.abort();
  routerAbortController = undefined;
  activeRenderPromise = undefined;
  disposeActiveModule();
  clearRouteMetadata();
}
