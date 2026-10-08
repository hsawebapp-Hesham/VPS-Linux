import { applyTranslations, t } from './i18n.js';
import { escapeHTML, icon } from './ui.js';

const DEVELOPER_NAME = 'Eng. Hesham Soliman Aid';
const DEVELOPER_PHONE = '01008361225';
const DEVELOPER_EMAIL = 'hsasinai@gmail.com';
const APP_VERSION = '1.0.0';

let activeContainer;
let renderGeneration = 0;

function resolveContainer(container) {
  if (typeof container === 'string') {
    return globalThis.document?.querySelector(container) || null;
  }
  return container?.nodeType === 1 ? container : null;
}

function aboutMarkup() {
  return `<section class="about-page">
    <header class="page-header">
      <div class="page-header__copy">
        <div class="page-header__eyebrow">${escapeHTML(t('nav.system'))}</div>
        <h2>${escapeHTML(t('about.title'))}</h2>
        <p>${escapeHTML(t('about.subtitle'))}</p>
      </div>
    </header>
    <div class="about-layout">
      <section class="card about-brand-card">
        <img class="about-logo" src="assets/logo/hsa-notes-logo.svg" alt="${escapeHTML(t('common.appName'))}">
        <h3>${escapeHTML(t('common.appName'))}</h3>
        <p>${escapeHTML(t('about.builtFor'))}</p>
        <span class="about-version"><span data-i18n="about.version">${escapeHTML(t('about.version'))}</span> ${escapeHTML(APP_VERSION)}</span>
      </section>
      <section class="card about-details-card">
        <h3>${escapeHTML(t('about.developer'))}</h3>
        <div class="about-contact-list">
          <div class="about-contact-copy"><small>${escapeHTML(t('about.developer'))}</small><strong>${escapeHTML(DEVELOPER_NAME)}</strong></div>
          <a class="about-contact-link" href="tel:${DEVELOPER_PHONE}" aria-label="${escapeHTML(t('about.callDeveloper'))}">${icon('phone', 'icon')}<span class="about-contact-copy"><small>${escapeHTML(t('about.phone'))}</small><strong>${escapeHTML(DEVELOPER_PHONE)}</strong></span></a>
          <a class="about-contact-link" href="mailto:${DEVELOPER_EMAIL}" aria-label="${escapeHTML(t('about.emailDeveloper'))}">${icon('mail', 'icon')}<span class="about-contact-copy"><small>${escapeHTML(t('about.email'))}</small><strong>${escapeHTML(DEVELOPER_EMAIL)}</strong></span></a>
        </div>
        <p class="about-note"><span data-i18n="about.privacyPromise">${escapeHTML(t('about.privacyPromise'))}</span>: <span data-i18n="about.privacyDescription">${escapeHTML(t('about.privacyDescription'))}</span></p>
        <p class="about-note"><span data-i18n="about.offlinePromise">${escapeHTML(t('about.offlinePromise'))}</span>: <span data-i18n="about.offlineDescription">${escapeHTML(t('about.offlineDescription'))}</span></p>
        <p class="about-footer-note">${escapeHTML(t('about.rights'))}</p>
        <p class="about-footer-note">${escapeHTML(t('about.madeWithCare'))}</p>
      </section>
    </div>
  </section>`;
}

function markAboutTranslations(root) {
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
  setText(root.querySelector('.page-header h2'), 'about.title');
  setText(root.querySelector('.page-header p'), 'about.subtitle');
  setText(root.querySelector('.about-brand-card h3'), 'common.appName');
  setText(root.querySelector('.about-brand-card p'), 'about.builtFor');
  setText(root.querySelector('.about-details-card > h3'), 'about.developer');
  setText(root.querySelector('.about-contact-list > .about-contact-copy small'), 'about.developer');
  const links = root.querySelectorAll('.about-contact-link');
  setAria(links[0], 'about.callDeveloper');
  setAria(links[1], 'about.emailDeveloper');
  setText(links[0]?.querySelector('small'), 'about.phone');
  setText(links[1]?.querySelector('small'), 'about.email');
  setText(root.querySelectorAll('.about-note')[0]?.querySelector('span[data-i18n="about.privacyPromise"]'), 'about.privacyPromise');
  setText(root.querySelectorAll('.about-note')[0]?.querySelector('span[data-i18n="about.privacyDescription"]'), 'about.privacyDescription');
  setText(root.querySelectorAll('.about-note')[1]?.querySelector('span[data-i18n="about.offlinePromise"]'), 'about.offlinePromise');
  setText(root.querySelectorAll('.about-note')[1]?.querySelector('span[data-i18n="about.offlineDescription"]'), 'about.offlineDescription');
  setText(root.querySelectorAll('.about-footer-note')[0], 'about.rights');
  setText(root.querySelectorAll('.about-footer-note')[1], 'about.madeWithCare');
}

export function renderAboutPage(container) {
  const target = resolveContainer(container);
  if (!target) {
    return null;
  }
  const generation = ++renderGeneration;
  activeContainer = target;
  target.innerHTML = aboutMarkup();
  markAboutTranslations(target);
  applyTranslations(target);
  return generation === renderGeneration && activeContainer === target ? target : null;
}

export function disposeAboutPage() {
  renderGeneration += 1;
  activeContainer = undefined;
}
