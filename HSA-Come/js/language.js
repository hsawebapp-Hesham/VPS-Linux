/*
 * ملف مدير اللغة — HSA Come
 * يتولى التبديل بين العربية (RTL) والإنجليزية (LTR)،
 * وتطبيق الترجمات على عناصر الصفحة عبر سمات data-i18n*.
 * (Language manager — bilingual AR/EN support with RTL/LTR switching)
 */

const LanguageManager = {
  STORAGE_KEY: 'hsa-lang',
  currentLang: 'ar',

  init() {
    // قراءة اللغة المحفوظة من localStorage والتحقق من وجودها في TRANSLATIONS، والافتراضي 'ar'
    let stored = null;
    try {
      stored = localStorage.getItem(this.STORAGE_KEY);
    } catch (e) {
      stored = null; // تجاهل أخطاء التخزين (وضع التصفح الخفي)
    }
    this.currentLang = this.isValidLang(stored) ? stored : 'ar';

    // تطبيق اللغة دون حفظ (القيمة موجودة مسبقًا أو هي الافتراضي)
    this.setLang(this.currentLang, { save: false });

    // ربط زر تبديل اللغة
    const toggle = document.getElementById('lang-toggle');
    if (toggle) {
      toggle.addEventListener('click', () => this.toggle());
    }
  },

  setLang(lang, opts = { save: true }) {
    // التحقق من اللغة وإلا الرجوع إلى 'ar'
    if (!this.isValidLang(lang)) {
      lang = 'ar';
    }
    this.currentLang = lang;

    // تحديد لغة واتجاه المستند (العربية RTL، الإنجليزية LTR)
    document.documentElement.lang = lang;
    document.documentElement.dir = (lang === 'ar') ? 'rtl' : 'ltr';

    // حفظ الاختيار
    if (opts && opts.save) {
      try {
        localStorage.setItem(this.STORAGE_KEY, lang);
      } catch (e) {
        /* تجاهل أخطاء التخزين */
      }
    }

    // تطبيق الترجمات على العناصر الثابتة
    this.applyTranslations();

    // تحديث نص زر اللغة ليعرض اللغة الأخرى ('EN' عند العربية، 'عربي' عند الإنجليزية)
    const toggle = document.getElementById('lang-toggle');
    if (toggle) {
      const label = toggle.querySelector('.lang-label');
      if (label) {
        label.textContent = (lang === 'ar') ? 'EN' : 'عربي';
      }
    }

    // إشعار بقية المكونات بتغير اللغة
    document.dispatchEvent(new CustomEvent('languagechange', { detail: { lang } }));
  },

  toggle() {
    this.setLang(this.currentLang === 'ar' ? 'en' : 'ar');
  },

  t(key, params = {}) {
    // بحث بنقاط (dot-notation) في اللغة الحالية، ثم الإنجليزية، ثم المفتاح نفسه
    let text = this.lookup(this.currentLang, key);
    if (text == null) {
      text = this.lookup('en', key);
    }
    if (text == null) {
      return key;
    }
    const safeParams = (params && typeof params === 'object') ? params : {};
    const year = (safeParams.year != null) ? safeParams.year : new Date().getFullYear();
    return String(text)
      .replace(/\{n\}/g, (safeParams.n != null) ? String(safeParams.n) : '{n}')
      .replace(/\{year\}/g, String(year));
  },

  lookup(lang, key) {
    if (typeof TRANSLATIONS === 'undefined' || !TRANSLATIONS[lang]) {
      return null;
    }
    const dict = TRANSLATIONS[lang];
    if (Object.prototype.hasOwnProperty.call(dict, key)) {
      return dict[key];
    }
    // دعم المسارات المتداخلة مثل "nav.home" لو وُجدت ككائنات مستقبلاً
    let node = dict;
    const parts = String(key).split('.');
    for (let i = 0; i < parts.length; i++) {
      if (node && typeof node === 'object' && Object.prototype.hasOwnProperty.call(node, parts[i])) {
        node = node[parts[i]];
      } else {
        return null;
      }
    }
    return (typeof node === 'string') ? node : null;
  },

  applyTranslations() {
    // النصوص داخل العناصر
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      if (key) {
        el.textContent = this.t(key, this.parseParams(el));
      }
    });
    // نصوص الأماكن الافتراضية
    document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      const key = el.getAttribute('data-i18n-placeholder');
      if (key) {
        el.setAttribute('placeholder', this.t(key, this.parseParams(el)));
      }
    });
    // تسميات الوصول (aria-label)
    document.querySelectorAll('[data-i18n-aria]').forEach((el) => {
      const key = el.getAttribute('data-i18n-aria');
      if (key) {
        el.setAttribute('aria-label', this.t(key, this.parseParams(el)));
      }
    });
    // تلميحات العنوان (title)
    document.querySelectorAll('[data-i18n-title]').forEach((el) => {
      const key = el.getAttribute('data-i18n-title');
      if (key) {
        el.setAttribute('title', this.t(key, this.parseParams(el)));
      }
    });
  },

  // تحليل سمات data-i18n-params (كائن JSON) لدمجها في t()
  parseParams(el) {
    const raw = el.getAttribute('data-i18n-params');
    if (!raw) {
      return {};
    }
    try {
      const parsed = JSON.parse(raw);
      return (parsed && typeof parsed === 'object') ? parsed : {};
    } catch (e) {
      return {};
    }
  },

  isValidLang(lang) {
    return typeof lang === 'string' &&
      typeof TRANSLATIONS !== 'undefined' &&
      !!TRANSLATIONS[lang];
  },

  getLang() {
    return this.currentLang;
  }
};

if (typeof window !== 'undefined') {
  window.LanguageManager = LanguageManager;
}
