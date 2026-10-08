import { estimatePasswordStrength, getMasterKey } from './auth.js';
import { decryptText } from './crypto-utils.js';
import { t } from './i18n.js';
import { openNoteEditor } from './notes.js';
import {
  API_KEY_STORE,
  CREDENTIAL_STORE,
  NOTES_STORE,
  getAll,
  getRecentActivity,
  getSetting
} from './storage.js';
import {
  escapeHTML,
  formatDate,
  icon,
  showToast
} from './ui.js';

const OLD_CREDENTIAL_MS = 180 * 24 * 60 * 60 * 1000;
let dashboardPageState = null;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isActive(record) {
  return isObject(record) && record.isArchived !== true;
}

function normalizePassword(value) {
  return String(value ?? '').normalize('NFKC').trim();
}

function isWeakPassword(value) {
  try {
    return estimatePasswordStrength(String(value ?? '')).score <= 1;
  } catch {
    return true;
  }
}

function recordTimestamp(record) {
  const date = Date.parse(record?.updatedAt || record?.createdAt || '');
  return Number.isFinite(date) ? date : 0;
}

function isOldCredential(record, now) {
  const timestamp = recordTimestamp(record);
  return timestamp > 0 && now - timestamp > OLD_CREDENTIAL_MS;
}

async function decryptCredentialPassword(value, key) {
  if (value === undefined || value === null || value === '') {
    return '';
  }
  try {
    const password = await decryptText(value, key);
    if (typeof password !== 'string') {
      throw new Error('INVALID_PASSWORD_VALUE');
    }
    return password;
  } catch {
    return null;
  }
}

async function calculateCredentialHealth(credentials, key, now = Date.now()) {
  const activeCredentials = Array.isArray(credentials) ? credentials.filter(isActive) : [];
  const frequencies = new Map();
  const entries = [];
  for (const record of activeCredentials) {
    const decrypted = await decryptCredentialPassword(record.password, key);
    const readable = decrypted !== null;
    const password = readable ? decrypted : '';
    const normalized = normalizePassword(password);
    const duplicate = normalized.length > 0;
    if (duplicate) {
      const current = frequencies.get(normalized) || { count: 0, indexes: [] };
      current.count += 1;
      current.indexes.push(entries.length);
      frequencies.set(normalized, current);
    }
    entries.push({
      index: entries.length,
      weak: !readable || isWeakPassword(password),
      duplicate,
      old: isOldCredential(record, now)
    });
  }
  let reusedPasswords = 0;
  const duplicateIndexes = new Set();
  for (const group of frequencies.values()) {
    if (group.count <= 1) {
      continue;
    }
    reusedPasswords += group.count - 1;
    for (const index of group.indexes) {
      duplicateIndexes.add(index);
    }
  }
  const weakPasswords = entries.filter((entry) => entry.weak).length;
  const oldItems = entries.filter((entry) => entry.old).length;
  const issueIndexes = new Set();
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry.weak || duplicateIndexes.has(index) || entry.old) {
      issueIndexes.add(index);
    }
  }
  const totalItems = entries.length;
  const healthyItems = totalItems - issueIndexes.size;
  const score = totalItems === 0
    ? 100
    : Math.max(0, Math.round(entries.reduce((sum, entry) => {
      const penalty = (entry.weak ? 50 : 0) + (duplicateIndexes.has(entry.index) ? 30 : 0) + (entry.old ? 20 : 0);
      return sum + (100 - penalty);
    }, 0) / totalItems));
  return {
    score,
    totalItems,
    healthyItems,
    weakPasswords,
    reusedPasswords,
    oldItems,
    issues: issueIndexes.size
  };
}

function healthStatusKey(score) {
  if (score >= 85) {
    return 'health.excellent';
  }
  if (score >= 65) {
    return 'health.good';
  }
  return 'health.needsAttention';
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

function getDocument() {
  return globalThis.document || null;
}

function activeCount(records) {
  return Array.isArray(records) ? records.filter(isActive).length : 0;
}

function renderSkeleton(container) {
  const doc = getDocument();
  const state = doc.createElement('div');
  state.className = 'page-state';
  state.setAttribute('role', 'status');
  state.innerHTML = `<span class="loading-mark" aria-hidden="true"><span></span></span><strong>${escapeHTML(t('common.loading'))}</strong><span>${escapeHTML(t('common.loadingHint'))}</span>`;
  container.replaceChildren(state);
}

function renderError(state) {
  const doc = getDocument();
  if (!doc) {
    return;
  }
  const wrapper = doc.createElement('div');
  wrapper.className = 'page-state';
  wrapper.setAttribute('role', 'alert');
  const heading = doc.createElement('strong');
  heading.textContent = t('toast.error');
  const message = doc.createElement('span');
  message.textContent = t('common.loadingHint');
  const retry = doc.createElement('button');
  retry.type = 'button';
  retry.className = 'button button-secondary';
  retry.dataset.dashboardAction = 'retry';
  retry.textContent = t('common.retry');
  wrapper.append(heading, message, retry);
  state.container.replaceChildren(wrapper);
}

function statCard({ label, value, iconName, variant, footer }) {
  return `
    <article class="card stat-card stat-card-${variant}">
      <div class="stat-card-top">
        <span class="stat-card-label">${escapeHTML(label)}</span>
        <span class="stat-card-icon" aria-hidden="true">${icon(iconName)}</span>
      </div>
      <strong class="stat-card-value">${escapeHTML(String(value))}</strong>
      <div class="stat-card-footer"><span>${escapeHTML(footer)}</span></div>
    </article>`;
}

function quickAction(action, label, hint, iconName, variant = '') {
  return `
    <button type="button" class="quick-action ${variant ? `quick-action-${variant}` : ''}" data-dashboard-action="${escapeHTML(action)}">
      <span class="quick-action-icon" aria-hidden="true">${icon(iconName)}</span>
      <span class="quick-action-copy"><strong>${escapeHTML(label)}</strong><small>${escapeHTML(hint)}</small></span>
      ${icon('chevron-left')}
    </button>`;
}

function healthCountCard(iconName, label, message, count) {
  return `
    <article class="card health-card">
      <div class="health-card-top"><span class="setting-row-icon" aria-hidden="true">${icon(iconName)}</span></div>
      <strong>${escapeHTML(label)}</strong>
      <p>${escapeHTML(message)}</p>
      <div class="health-score">${escapeHTML(String(count))}</div>
    </article>`;
}

function activityIcon(type) {
  if (type === API_KEY_STORE) {
    return 'key-round';
  }
  if (type === CREDENTIAL_STORE) {
    return 'lock';
  }
  return 'note';
}

function activityTypeLabel(type) {
  if (type === API_KEY_STORE) {
    return t('apiKeys.title');
  }
  if (type === CREDENTIAL_STORE) {
    return t('credentials.title');
  }
  return t('notes.title');
}

function renderActivity(activity) {
  if (!Array.isArray(activity) || activity.length === 0) {
    return `<section class="empty-state" role="status"><div class="empty-state__icon">${icon('activity')}</div><h3>${escapeHTML(t('dashboard.noActivity'))}</h3><p>${escapeHTML(t('dashboard.noActivityHint'))}</p></section>`;
  }
  const items = activity.slice(0, 6).map((item) => {
    const label = String(item.title || '').trim() || activityTypeLabel(item.type);
    const date = formatDate(item.updatedAt || item.createdAt, { dateStyle: 'medium', timeStyle: 'short' }) || t('common.unknown');
    return `
      <div class="activity-item">
        <span class="activity-item-icon" aria-hidden="true">${icon(activityIcon(item.type))}</span>
        <span class="activity-item-copy"><strong>${escapeHTML(label)}</strong><small>${escapeHTML(activityTypeLabel(item.type))} · ${escapeHTML(t('dashboard.updatedRecently'))}</small></span>
        <time datetime="${escapeHTML(item.updatedAt || item.createdAt || '')}">${escapeHTML(date)}</time>
      </div>`;
  }).join('');
  return `<div class="activity-list">${items}</div>`;
}

function renderDashboard(state, data) {
  if (state.disposed) {
    return;
  }
  const { apiKeys, credentials, notes, settings, activity, health } = data;
  const lastExport = settings?.backup?.lastExportAt || settings?.driveSync?.lastSyncAt;
  const lastExportLabel = lastExport ? formatDate(lastExport, { dateStyle: 'medium', timeStyle: 'short' }) || t('common.unknown') : t('backup.neverExported');
  const healthLabel = t(healthStatusKey(health.score));
  const healthMessage = t(health.issues === 0 ? 'dashboard.healthMessage' : 'dashboard.healthMessageNeedsAttention');
  const healthDetails = `${t('health.totalItems')}: ${health.totalItems} · ${t('dashboard.healthyItems')}: ${health.healthyItems}`;
  const apiCount = activeCount(apiKeys);
  const credentialCount = activeCount(credentials);
  const noteCount = activeCount(notes);
  state.container.innerHTML = `
    <div class="dashboard-stack" data-dashboard-page>
      <section class="dashboard-hero">
        <div class="dashboard-hero-copy">
          <span class="section-eyebrow">${escapeHTML(t('app.workspaceLabel'))}</span>
          <h2>${escapeHTML(t('dashboard.greeting'))}</h2>
          <p>${escapeHTML(t('dashboard.subtitle'))}</p>
        </div>
        <div class="dashboard-hero-actions">
          <button type="button" class="button button-primary" data-dashboard-action="api">${icon('plus')}<span>${escapeHTML(t('dashboard.addApiKey'))}</span></button>
          <button type="button" class="button button-secondary" data-dashboard-action="note">${icon('note')}<span>${escapeHTML(t('dashboard.newNote'))}</span></button>
        </div>
      </section>
      <section>
        <div class="section-header"><h3>${escapeHTML(t('dashboard.overview'))}</h3></div>
        <div class="stats-grid">
          ${statCard({ label: t('dashboard.statsApiKeys'), value: apiCount, iconName: 'key-round', variant: 'mint', footer: t('dashboard.updatedRecently') })}
          ${statCard({ label: t('dashboard.statsCredentials'), value: credentialCount, iconName: 'lock', variant: 'gold', footer: t('dashboard.updatedRecently') })}
          ${statCard({ label: t('dashboard.statsNotes'), value: noteCount, iconName: 'note', variant: 'blue', footer: t('dashboard.updatedRecently') })}
          ${statCard({ label: t('dashboard.statsLastExport'), value: lastExportLabel, iconName: 'file-lock', variant: 'purple', footer: t('dashboard.lastUpdated') })}
        </div>
      </section>
      <section>
        <div class="section-header"><h3>${escapeHTML(t('dashboard.quickActions'))}</h3></div>
        <div class="quick-actions-grid">
          ${quickAction('api', t('dashboard.addApiKey'), t('dashboard.addApiKeyHint'), 'key-round')}
          ${quickAction('credentials', t('credentials.addCredential'), t('dashboard.dataProtectedHint'), 'lock', 'gold')}
          ${quickAction('generator', t('dashboard.generatePassword'), t('dashboard.generatePasswordHint'), 'wand', 'info')}
          ${quickAction('note', t('dashboard.newNote'), t('dashboard.newNoteHint'), 'note')}
        </div>
      </section>
      <section>
        <div class="section-header"><h3>${escapeHTML(t('dashboard.securityHealth'))}</h3></div>
        <div class="dashboard-two-column">
          <div class="dashboard-side-stack">
            <article class="health-summary">
              <div class="health-summary-top">
                ${icon('shield')}
                <strong>${escapeHTML(healthLabel)}</strong>
                <span class="health-score-ring" role="img" aria-label="${escapeHTML(`${t('health.score')}: ${health.score}%`)}">${escapeHTML(String(health.score))}%</span>
              </div>
              <p>${escapeHTML(healthDetails)}</p>
              <p>${escapeHTML(healthMessage)}</p>
            </article>
            <div class="security-alert">
              <span class="alert-icon" aria-hidden="true">${icon('shield')}</span>
              <span class="alert-copy"><strong>${escapeHTML(t('dashboard.dataProtected'))}</strong><p>${escapeHTML(t('dashboard.dataProtectedHint'))}</p></span>
            </div>
          </div>
          <div class="health-layout">
            ${healthCountCard('alert', t('health.weakPasswords'), t('health.reviewItems'), health.weakPasswords)}
            ${healthCountCard('copy', t('health.reusedPasswords'), t('health.reviewItems'), health.reusedPasswords)}
            ${healthCountCard('clock', t('health.oldItems'), t('health.reviewItems'), health.oldItems)}
          </div>
        </div>
      </section>
      <section>
        <div class="section-header"><h3>${escapeHTML(t('dashboard.recentActivity'))}</h3></div>
        <div class="card dashboard-panel">${renderActivity(activity)}</div>
      </section>
    </div>`;
}

async function loadDashboard(state) {
  if (!state || state.disposed) {
    return;
  }
  const loadToken = ++state.loadToken;
  try {
    const [apiKeys, credentials, notes, settings, activity] = await Promise.all([
      getAll(API_KEY_STORE),
      getAll(CREDENTIAL_STORE),
      getAll(NOTES_STORE),
      getSetting(),
      getRecentActivity(10).catch(() => [])
    ]);
    const key = getMasterKey();
    if (!key) {
      const error = new Error('MASTER_KEY_REQUIRED');
      error.code = 'MASTER_KEY_REQUIRED';
      throw error;
    }
    const health = await calculateCredentialHealth(credentials, key);
    if (state.disposed || loadToken !== state.loadToken) {
      return;
    }
    state.data = { apiKeys, credentials, notes, settings, activity, health };
    renderDashboard(state, state.data);
  } catch {
    if (!state.disposed && loadToken === state.loadToken) {
      renderError(state);
    }
  }
}

function scheduleRefresh(state) {
  if (!state || state.disposed || state.refreshScheduled) {
    return;
  }
  state.refreshScheduled = true;
  queueMicrotask(() => {
    state.refreshScheduled = false;
    void loadDashboard(state);
  });
}

function installListeners(state) {
  const clickHandler = (event) => {
    const button = event.target?.closest?.('[data-dashboard-action]');
    if (!button || !state.container.contains(button)) {
      return;
    }
    const action = button.dataset.dashboardAction;
    if (action === 'retry') {
      void loadDashboard(state);
      return;
    }
    if (action === 'api') {
      dispatchEvent('hsa-open-api-editor');
      return;
    }
    if (action === 'credentials') {
      dispatchEvent('hsa-navigate-to-credentials');
      return;
    }
    if (action === 'generator') {
      dispatchEvent('hsa-navigate-to-generator');
      return;
    }
    if (action === 'note') {
      dispatchEvent('hsa-open-note-editor');
      void openNoteEditor().catch(() => showToast(t('toast.error'), 'error'));
    }
  };
  const options = { signal: state.abortController.signal };
  state.container.addEventListener('click', clickHandler, options);
  state.refreshListener = () => scheduleRefresh(state);
  globalThis.addEventListener?.('hsa-data-changed', state.refreshListener, options);
  globalThis.addEventListener?.('hsa-page-refresh', state.refreshListener, options);
}

export async function renderDashboardPage(container) {
  disposeDashboardPage();
  if (!container || container.nodeType !== 1 || !getDocument()) {
    return null;
  }
  const state = {
    container,
    data: null,
    loadToken: 0,
    refreshScheduled: false,
    disposed: false,
    abortController: new AbortController()
  };
  dashboardPageState = state;
  renderSkeleton(container);
  installListeners(state);
  await loadDashboard(state);
  return state.disposed ? null : container;
}

export function disposeDashboardPage() {
  const state = dashboardPageState;
  dashboardPageState = null;
  if (!state) {
    return;
  }
  state.disposed = true;
  state.loadToken += 1;
  state.abortController.abort();
}
