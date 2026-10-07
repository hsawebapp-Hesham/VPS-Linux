/*
 * ============================================================
 *  apps-loader.js — طبقة بيانات التطبيقات (Apps Data Layer)
 *  HSA Come — تحميل بيانات التطبيقات من data/apps.json
 *  مع احتياط مدمج (APPS_FALLBACK) عند تعذّر الجلب (بروتوكول file://)
 *  + دوال عرض البطاقات والشبكات وصفحات التطبيقات
 *  (Load apps from data/apps.json with embedded fallback + rendering helpers)
 * ============================================================
 */

/* نص مترجم آمن — يعمل حتى لو لم يُحمَّل LanguageManager بعد (Safe translated string) */
function hsaT(key, params) {
  try {
    if (typeof LanguageManager !== 'undefined' && LanguageManager && typeof LanguageManager.t === 'function') {
      return LanguageManager.t(key, params);
    }
  } catch (e) { /* تجاهل — ignore */ }
  try {
    var lang = hsaLang();
    var dict = (window.TRANSLATIONS && window.TRANSLATIONS[lang]) || {};
    var str = dict[key] || key;
    if (params) {
      Object.keys(params).forEach(function (k) {
        str = str.replace(new RegExp('\\{' + k + '\\}', 'g'), params[k]);
      });
    }
    return str;
  } catch (e) {
    return key;
  }
}

/* اللغة الحالية (Current language: ar|en — Arabic is the default) */
function hsaLang() {
  try {
    if (typeof LanguageManager !== 'undefined' && LanguageManager && typeof LanguageManager.getLang === 'function') {
      return LanguageManager.getLang();
    }
  } catch (e) { /* تجاهل — ignore */ }
  if (document.documentElement && document.documentElement.lang) {
    return document.documentElement.lang.indexOf('ar') === 0 ? 'ar' : 'en';
  }
  return 'ar';
}

/* تنسيق الأرقام حسب اللغة (Locale-aware number formatting) */
function hsaFormatNumber(n) {
  var locale = hsaLang() === 'ar' ? 'ar-EG' : 'en-US';
  var num = Number(n) || 0;
  return num.toLocaleString(locale);
}

/* تهريب HTML لمنع الحقن (Escape HTML to prevent injection) */
function hsaEscapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// تطهير الروابط — السماح فقط بالمسارات النسبية والبروتوكولات الآمنة
// (sanitize URLs — allow relative paths and safe schemes only)
function hsaSafeUrl(url) {
  var u = String(url || '').trim();
  if (!u || u === '#') return '#';
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(u)) {
    var scheme = u.split(':', 1)[0].toLowerCase();
    if (['http', 'https', 'mailto', 'tel'].indexOf(scheme) === -1) return '#';
  }
  return u;
}

/* أيقونات SVG مدمجة (Inline SVG icons — feather-style, currentColor) */
function hsaIcons() {
  return {
    globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
    monitor: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><path d="M8 21h8"/><path d="M12 17v4"/></svg>',
    smartphone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><path d="M12 18h.01"/></svg>',
    file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>',
    tag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><path d="M7 7h.01"/></svg>',
    download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>',
    link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
    whatsapp: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z"/></svg>'
  };
}

const AppsLoader = {
  apps: [],

  /* تحميل التطبيقات — جلب من data/apps.json مع احتياط مدمج (Load apps with fallback) */
  async load() {
    if (this.apps.length) return this.apps; // محمّلة مسبقًا — already loaded
    try {
      const res = await fetch('data/apps.json');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      this.apps = data.apps || [];
    } catch (err) {
      // بروتوكول file:// أو خادم غير متاح: استخدم البيانات المدمجة
      // (file:// protocol or missing server: use embedded fallback)
      this.apps = (typeof APPS_FALLBACK !== 'undefined') ? APPS_FALLBACK : [];
      console.warn('[HSA Come] Could not load data/apps.json (running from file://?). Using embedded fallback data. For production, serve the site over HTTP.');
    }
    return this.apps;
  },

  getAll() { return this.apps; },
  getById(id) { return this.apps.find(a => a.id === id); },
  getFeatured(limit = 3) { return this.apps.filter(a => a.featured).slice(0, limit); },
  getByPlatform(platform) { return platform === 'all' ? this.apps : this.apps.filter(a => a.platform === platform); },

  search(query) {
    const q = (query || '').trim().toLowerCase();
    if (!q) return this.apps;
    return this.apps.filter(a => (((a.name && a.name.ar) || '') + ' ' + ((a.name && a.name.en) || '')).toLowerCase().includes(q));
  },

  // الأكثر إعجابًا — ترتيب حسب إجمالي الإعجابات (غير متزامن عبر DB)
  // (Most liked — sorted by total likes (async via DB))
  async getTopLiked(limit = 4) {
    const decorated = await Promise.all(this.apps.map(async a => ({
      app: a,
      likes: (typeof Reactions !== 'undefined' && Reactions.getTotalLikes) ? await Reactions.getTotalLikes(a) : (a.likes || 0)
    })));
    decorated.sort((x, y) => y.likes - x.likes);
    return decorated.slice(0, limit).map(d => d.app);
  },

  platformBadgeClass(platform) {
    return { web: 'badge-web', desktop: 'badge-desktop', android: 'badge-android' }[platform] || 'badge-web';
  },

  platformLabel(platform) { return hsaT('platform.' + platform); },

  appName(app, lang) {
    lang = lang || hsaLang();
    return (app.name && (app.name[lang] || app.name.en)) || app.id || '';
  },

  /* نجوم التقييم — 5 نجوم مع تعبئة حسب التقريب (Rating stars — filled = Math.round(rating)) */
  renderStars(rating) {
    const filled = Math.round(Number(rating) || 0);
    const value = Number(rating) || 0;
    const label = hsaT('card.rating') + ': ' + value + '/5';
    let html = '<div class="stars" role="img" aria-label="' + hsaEscapeHtml(label) + '">';
    for (let i = 1; i <= 5; i++) {
      html += '<span class="star' + (i <= filled ? ' star-filled' : '') + '">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>' +
        '</span>';
    }
    return html + '</div>';
  },

  /* بطاقة تطبيق واحدة (Single app card) */
  renderCard(app) {
    const lang = hsaLang();
    const name = hsaEscapeHtml(this.appName(app, lang));
    const short = hsaEscapeHtml((app.shortDescription && (app.shortDescription[lang] || app.shortDescription.en)) || '');
    const platform = app.platform || 'web';
    const rating = Number(app.rating) || 0;
    const icons = hsaIcons();
    return (
      '<article class="card app-card reveal">' +
        '<div class="app-card-icon">' +
          '<img src="' + hsaEscapeHtml(app.icon || '') + '" alt="' + name + '" loading="lazy" width="80" height="80">' +
        '</div>' +
        '<div class="card-body">' +
          '<h3 class="app-card-title">' + name + '</h3>' +
          '<span class="badge app-card-platform ' + this.platformBadgeClass(platform) + '">' + hsaEscapeHtml(this.platformLabel(platform)) + '</span>' +
          '<p class="card-text">' + short + '</p>' +
          '<div class="app-card-meta">' +
            '<span>' + icons.file + hsaEscapeHtml(hsaT('card.size')) + ': ' + hsaEscapeHtml(app.size || '') + '</span>' +
            '<span>' + icons.tag + hsaEscapeHtml(hsaT('card.version')) + ': ' + hsaEscapeHtml(app.version || '') + '</span>' +
            '<span>' + this.renderStars(rating) + ' ' + rating + '</span>' +
            '<span>' + icons.download + hsaFormatNumber(app.downloads) + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="card-footer app-card-actions">' +
          '<a class="btn btn-primary btn-sm" href="app-details.html?id=' + hsaEscapeHtml(encodeURIComponent(app.id)) + '">' + hsaEscapeHtml(hsaT('card.details')) + '</a>' +
           '<a class="btn btn-outline btn-sm" href="' + hsaEscapeHtml(hsaSafeUrl(app.downloadUrl)) + '" target="_blank" rel="noopener">' + hsaEscapeHtml(hsaT('card.download')) + '</a>' +
        '</div>' +
      '</article>'
    );
  },

  renderGrid(container, apps) {
    if (!container) return;
    container.innerHTML = (apps || []).map(a => this.renderCard(a)).join('');
  },

  showSkeletons(container, count = 6) {
    if (!container) return;
    container.innerHTML = Array.from({ length: count }, () => '<div class="skeleton-card skeleton"></div>').join('');
  },

  /* إعادة تفعيل ظهور العناصر عند التمرير بعد الحقن الديناميكي (Re-scan scroll reveal) */
  refreshReveal(root) {
    if (typeof window.__initScrollRevealAgain === 'function') {
      window.__initScrollRevealAgain();
    } else {
      const scope = root || document;
      scope.querySelectorAll('.reveal:not(.visible)').forEach(el => el.classList.add('visible'));
    }
  },

  /* ---- الصفحة الرئيسية (Home page) ---- */
  async renderHome() {
    if (!this.apps.length) {
      // هيكل تحميل أثناء جلب البيانات (skeleton while fetching)
      this.showSkeletons(document.getElementById('featured-grid'), 3);
      this.showSkeletons(document.getElementById('top-grid'), 4);
      await this.load();
    }
    const lang = hsaLang();

    // التطبيقات المميزة (Featured apps)
    const featuredGrid = document.getElementById('featured-grid');
    if (featuredGrid) this.renderGrid(featuredGrid, this.getFeatured(3));

    // الأكثر إعجابًا (Most liked)
    const topGrid = document.getElementById('top-grid');
    if (topGrid) this.renderGrid(topGrid, await this.getTopLiked(4));

    // التصنيفات حسب المنصة (Categories by platform)
    const catGrid = document.getElementById('categories-grid');
    if (catGrid) {
      const cats = [
        { platform: 'web', icon: hsaIcons().globe },
        { platform: 'desktop', icon: hsaIcons().monitor },
        { platform: 'android', icon: hsaIcons().smartphone }
      ];
      catGrid.innerHTML = cats.map(c => {
        const count = this.getByPlatform(c.platform).length;
        return (
          '<a class="card category-card reveal" href="apps.html?platform=' + c.platform + '">' +
            '<div class="category-icon">' + c.icon + '</div>' +
            '<h3 class="category-title">' + hsaEscapeHtml(hsaT('home.categories.' + c.platform)) + '</h3>' +
            '<span class="category-count">' + count + ' ' + hsaEscapeHtml(hsaT('home.stats.apps')) + '</span>' +
            '<span class="category-view">' + hsaEscapeHtml(hsaT('home.categories.view.all')) + '</span>' +
          '</a>'
        );
      }).join('');
    }

    // إحصائيات قسم البطل (Hero stats)
    const statApps = document.getElementById('stat-apps');
    if (statApps) statApps.textContent = hsaFormatNumber(this.apps.length);
    const statDownloads = document.getElementById('stat-downloads');
    if (statDownloads) statDownloads.textContent = hsaFormatNumber(this.apps.reduce((sum, a) => sum + (Number(a.downloads) || 0), 0));
    const statPlatforms = document.getElementById('stat-platforms');
    if (statPlatforms) statPlatforms.textContent = '3';

    // إعادة تفعيل الظهور للعناصر المُحقونة حديثًا فقط
    // (Re-scan scroll reveal — scoped to freshly injected containers)
    if (featuredGrid) this.refreshReveal(featuredGrid);
    if (topGrid) this.refreshReveal(topGrid);
    if (catGrid) this.refreshReveal(catGrid);
  },

  /* ---- صفحة التطبيقات (Apps page) ---- */
  AppsPage: {
    state: { platform: 'all', query: '' },

    init() {
      // main.js يعيد استدعاء init() عند تغيير اللغة — اجعل التهيئة مكررة بأمان
      // (main.js re-calls init() on languagechange — keep init idempotent)
      if (this._initialized) { this.apply(); return; }
      this._initialized = true;
      // قراءة معامل المنصة من الرابط (?platform=)
      try {
        const p = new URLSearchParams(location.search).get('platform');
        if (p && ['web', 'desktop', 'android'].indexOf(p) !== -1) this.state.platform = p;
      } catch (e) { /* تجاهل */ }

      // تبويبات الفلترة (Filter tabs)
      const tabs = document.querySelectorAll('#filter-tabs .filter-tab');
      tabs.forEach(tab => {
        tab.addEventListener('click', () => {
          tabs.forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
          this.state.platform = tab.getAttribute('data-platform') || 'all';
          this.apply();
        });
      });
      // مزامنة التبويب النشط مع الحالة الحالية (Sync active tab with state)
      tabs.forEach(t => t.classList.toggle('active', (t.getAttribute('data-platform') || 'all') === this.state.platform));

      // البحث مع تأخير 200ms (Search with debounce)
      const search = document.getElementById('apps-search');
      if (search) {
        let timer = null;
        search.addEventListener('input', () => {
          clearTimeout(timer);
          timer = setTimeout(() => {
            this.state.query = search.value;
            this.apply();
          }, 200);
        });
      }

      // إعادة العرض عند تغيير اللغة (Re-render on language change)
      document.addEventListener('languagechange', () => this.apply());

      this.apply();
    },

    async apply(filter, search) {
      if (!AppsLoader.apps.length) {
        // هيكل تحميل أثناء جلب البيانات (skeleton while fetching)
        AppsLoader.showSkeletons(document.getElementById('apps-grid'), 6);
        await AppsLoader.load();
      }
      let list = AppsLoader.getByPlatform(this.state.platform);
      const q = (this.state.query || '').trim().toLowerCase();
      if (q) {
        // بحث بالاسم داخل القائمة المفلترة (Search by name within filtered list)
        list = list.filter(a => (((a.name && a.name.ar) || '') + ' ' + ((a.name && a.name.en) || '')).toLowerCase().includes(q));
      }
      const grid = document.getElementById('apps-grid');
      if (grid) {
        AppsLoader.renderGrid(grid, list);
        // البطاقات المُحقونة ديناميكيًا تحمل .reveal — اجعلها مرئية
        // (dynamically injected cards carry .reveal — make them visible)
        AppsLoader.refreshReveal(grid);
      }
      const count = document.getElementById('results-count');
      if (count) count.textContent = hsaT('apps.results', { n: list.length });
      const empty = document.getElementById('apps-empty');
      if (empty) empty.classList.toggle('hidden', list.length > 0);
    }
  },

  /* ---- صفحة تفاصيل التطبيق (App details page) ---- */
  AppDetailsPage: {
    app: null,

    async init() {
      // main.js يعيد استدعاء init() عند تغيير اللغة — اجعل التهيئة مكررة بأمان
      // (main.js re-calls init() on languagechange — keep init idempotent)
      if (this._initialized) { await this.render(); return; }
      let id = null;
      try { id = new URLSearchParams(location.search).get('id'); } catch (e) { /* تجاهل */ }
      if (!AppsLoader.apps.length) await AppsLoader.load();
      this.app = id ? AppsLoader.getById(id) : null;

      const loading = document.getElementById('app-loading');
      const notfound = document.getElementById('app-notfound');
      const details = document.getElementById('app-details');

      if (!this.app) {
        if (notfound) notfound.classList.remove('hidden');
        if (loading) loading.classList.add('hidden');
        return;
      }
      if (loading) loading.classList.add('hidden');
      if (details) details.classList.remove('hidden');

      this._initialized = true;
      await this.render();
      document.addEventListener('languagechange', () => this.render());
    },

    setText(id, text) {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    },

    getFeatures(app, lang) {
      const f = app.features;
      if (!f) return [];
      if (Array.isArray(f)) {
        // مصفوفة نصوص أو كائنات {ar, en}
        return f.map(item => {
          if (typeof item === 'string') return item;
          if (item && typeof item === 'object') return item[lang] || item.en || '';
          return '';
        }).filter(Boolean);
      }
      if (typeof f === 'object') {
        // كائن متعدد اللغات: { ar: [...], en: [...] }
        return f[lang] || f.en || [];
      }
      return [];
    },

    getGalleryImages(app) {
      const raw = app.images || app.gallery || app.screenshots || [];
      return raw.map(item => {
        if (typeof item === 'string') return { thumb: item, full: item };
        if (item && typeof item === 'object') {
          const thumb = item.thumb || item.src || item.url || '';
          return { thumb: thumb, full: item.full || thumb };
        }
        return null;
      }).filter(Boolean);
    },

    renderGallery(app) {
      const gallery = document.getElementById('app-gallery');
      if (!gallery) return;
      const images = this.getGalleryImages(app);
      // تخزين الصور للعارض الضوئي (Store images for main.js lightbox nav)
      window.__galleryImages = images.map(i => i.full);
      const lang = hsaLang();
      const alt = AppsLoader.appName(app, lang);
      gallery.innerHTML = '<div class="gallery">' + images.map(i =>
        '<a class="gallery-item" href="' + hsaEscapeHtml(i.full) + '" data-full="' + hsaEscapeHtml(i.full) + '">' +
          '<img src="' + hsaEscapeHtml(i.thumb) + '" alt="' + hsaEscapeHtml(alt) + '" loading="lazy">' +
        '</a>'
      ).join('') + '</div>';
      // فتح العارض الضوئي عند النقر (Open lightbox on click)
      gallery.querySelectorAll('.gallery-item').forEach((a, idx) => {
        a.addEventListener('click', e => {
          e.preventDefault();
          if (typeof window.openLightbox === 'function') {
            // تمرير مصفوفة الصور لدعم التنقل السابق/التالي في العارض
            window.openLightbox(images[idx].full, alt, window.__galleryImages);
          }
        });
      });
    },

    copyFallback(text) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'absolute';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      } catch (e) { /* تجاهل */ }
    },

    renderShare(app, name) {
      const container = document.getElementById('share-container');
      if (!container) return;
      const url = location.href;
      const waUrl = 'https://wa.me/?text=' + encodeURIComponent(name + ' - ' + url);
      const icons = hsaIcons();
      container.innerHTML =
        '<div class="share-buttons">' +
          '<button class="share-btn" type="button" id="share-copy" aria-label="' + hsaEscapeHtml(hsaT('common.copy')) + '">' + icons.link + '</button>' +
          '<a class="share-btn" href="' + waUrl + '" target="_blank" rel="noopener" aria-label="' + hsaEscapeHtml(hsaT('details.whatsapp')) + '">' + icons.whatsapp + '</a>' +
        '</div>';
      const copyBtn = document.getElementById('share-copy');
      if (copyBtn) {
        copyBtn.addEventListener('click', () => {
          const done = () => { if (typeof showToast === 'function') showToast(hsaT('toast.link.copied'), 'success'); };
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(url).then(done).catch(() => { this.copyFallback(url); done(); });
          } else {
            this.copyFallback(url);
            done();
          }
        });
      }
    },

    injectJsonLd(app, name, platform) {
      try {
        const old = document.querySelector('script[data-jsonld-app]');
        if (old) old.remove();
        const osMap = { web: 'Web', desktop: 'Windows, macOS, Linux', android: 'Android' };
        const ld = {
          '@context': 'https://schema.org',
          '@type': 'SoftwareApplication',
          'name': name,
          'operatingSystem': osMap[platform] || 'Web',
          'url': location.href,
          'offers': { '@type': 'Offer', 'price': '0', 'priceCurrency': 'USD' },
          'aggregateRating': { '@type': 'AggregateRating', 'ratingValue': String(Number(app.rating) || 0), 'bestRating': '5' }
        };
        const script = document.createElement('script');
        script.type = 'application/ld+json';
        script.setAttribute('data-jsonld-app', app.id);
        script.textContent = JSON.stringify(ld);
        document.head.appendChild(script);
      } catch (e) { /* تجاهل */ }
    },

    async render() {
      const app = this.app;
      if (!app) return;
      const lang = hsaLang();
      const name = AppsLoader.appName(app, lang);
      const platform = app.platform || 'web';

      // الأيقونة والاسم والمنصة (Icon, name, platform badge)
      const iconImg = document.querySelector('#detail-icon img');
      if (iconImg) { iconImg.src = app.icon || ''; iconImg.alt = name; }
      this.setText('detail-name', name);
      const platformEl = document.getElementById('detail-platform');
      if (platformEl) {
        platformEl.className = 'badge ' + AppsLoader.platformBadgeClass(platform);
        platformEl.textContent = AppsLoader.platformLabel(platform);
      }

      // المواصفات (Specs)
      this.setText('detail-size', hsaT('details.size') + ': ' + (app.size || ''));
      this.setText('detail-version', hsaT('details.version') + ': ' + (app.version || ''));
      this.setText('detail-downloads', hsaT('card.downloads') + ': ' + hsaFormatNumber(app.downloads));
      const ratingEl = document.getElementById('detail-rating');
      if (ratingEl) ratingEl.innerHTML = AppsLoader.renderStars(app.rating) + ' <span>' + (Number(app.rating) || 0) + '/5</span>';

      // الوصف الكامل (Full description)
      this.setText('detail-description', (app.fullDescription && (app.fullDescription[lang] || app.fullDescription.en)) || '');

      // المميزات (Features)
      const featuresEl = document.getElementById('detail-features');
      if (featuresEl) {
        featuresEl.innerHTML = this.getFeatures(app, lang).map(f =>
          '<li>' + hsaIcons().check + hsaEscapeHtml(f) + '</li>'
        ).join('');
      }

      // المعرض (Gallery)
      this.renderGallery(app);

      // أزرار التحميل والإبلاغ (Download & report buttons)
      const dlBtn = document.getElementById('detail-download');
      if (dlBtn) { dlBtn.href = hsaSafeUrl(app.downloadUrl); dlBtn.textContent = hsaT('details.download'); }
      const reportBtn = document.getElementById('detail-report');
      if (reportBtn) { reportBtn.href = 'report-issue.html?app=' + encodeURIComponent(app.id); reportBtn.textContent = hsaT('details.report'); }

      // ردود الفعل (Reactions)
      if (typeof Reactions !== 'undefined' && typeof Reactions.renderReactions === 'function') {
        await Reactions.renderReactions(document.getElementById('reactions-container'), app);
      }

      // المشاركة (Share)
      this.renderShare(app, name);

      // تطبيقات ذات صلة (Related apps — same platform, exclude self, max 3)
      const related = document.getElementById('related-grid');
      if (related) {
        const list = AppsLoader.getByPlatform(platform).filter(a => a.id !== app.id).slice(0, 3);
        AppsLoader.renderGrid(related, list);
        AppsLoader.refreshReveal(related);
      }

      // JSON-LD للبحث (Structured data)
      this.injectJsonLd(app, name, platform);

      // العنوان والوصف (Document title & meta description)
      document.title = name + ' — HSA Come';
      const metaDesc = document.querySelector('meta[name="description"]');
      if (metaDesc) metaDesc.setAttribute('content', (app.shortDescription && (app.shortDescription[lang] || app.shortDescription.en)) || '');
    }
  }
};

/* كشف وحدات الصفحات كمتغيرات عامة — main.js يستدعي AppsPage و AppDetailsPage مباشرة
   (Expose page modules as globals — main.js calls bare AppsPage / AppDetailsPage) */
window.AppsPage = AppsLoader.AppsPage;
window.AppDetailsPage = AppsLoader.AppDetailsPage;
