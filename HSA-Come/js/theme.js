/*
 * ملف مدير السمة — HSA Come
 * يتولى تبديل السمة الفاتحة/الداكنة، وحفظ الاختيار، وتحديث لون شريط المتصفح.
 * (Theme manager — dark/light switching with storage and meta theme-color)
 *
 * ملاحظة مهمة لمنع وميض السمة قبل أول رسم (zero flash):
 * لتطبيق السمة قبل تحميل هذا الملف، أضف السطر التالي بشكل inline داخل <head>:
 *   <script>
 *     (function(){try{var t=localStorage.getItem('hsa-theme');if(t!=='dark'&&t!=='light'){t=(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches)?'dark':'light';}document.documentElement.setAttribute('data-theme',t);}catch(e){document.documentElement.setAttribute('data-theme','light');}})();
 *   </script>
 * ثم يُحمَّل هذا الملف (theme.js) بـ defer ليكمل الربط والتبديل لاحقًا.
 */

const ThemeManager = {
  STORAGE_KEY: 'hsa-theme',

  init() {
    // قراءة السمة المحفوظة من localStorage، وإلا احترام تفضيل النظام
    let theme = null;
    try {
      theme = localStorage.getItem(this.STORAGE_KEY);
    } catch (e) {
      theme = null; // تجاهل أخطاء التخزين (وضع التصفح الخفي)
    }
    if (theme !== 'dark' && theme !== 'light') {
      theme = 'light';
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        theme = 'dark';
      }
    }

    // تطبيق السمة دون حفظ (القيمة موجودة مسبقًا أو هي الافتراضي)
    this.setTheme(theme, { save: false });

    // ربط زر تبديل السمة
    const toggle = document.getElementById('theme-toggle');
    if (toggle) {
      toggle.addEventListener('click', () => this.toggle());
    }
  },

  setTheme(theme, opts = { save: true }) {
    if (theme !== 'dark' && theme !== 'light') {
      theme = 'light';
    }

    // تطبيق السمة على العنصر الجذري (متغيرات CSS تعمل عبر [data-theme="dark"])
    document.documentElement.setAttribute('data-theme', theme);

    // حفظ الاختيار
    if (opts && opts.save) {
      try {
        localStorage.setItem(this.STORAGE_KEY, theme);
      } catch (e) {
        /* تجاهل أخطاء التخزين */
      }
    }

    // تحديث لون شريط المتصفح (meta theme-color)
    this.updateMetaThemeColor(theme);

    // إشعار بقية المكونات بتغير السمة
    document.dispatchEvent(new CustomEvent('themechange', { detail: { theme } }));
  },

  // تحديث وسم meta[name="theme-color"] — وإن لم يوجد يُنشأ
  updateMetaThemeColor(theme) {
    const color = (theme === 'dark') ? '#0B1120' : '#F8FAFC';
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'theme-color');
      const head = document.head || document.getElementsByTagName('head')[0];
      if (head) {
        head.appendChild(meta);
      }
    }
    meta.setAttribute('content', color);
  },

  toggle() {
    this.setTheme(this.getTheme() === 'dark' ? 'light' : 'dark');
  },

  getTheme() {
    return document.documentElement.getAttribute('data-theme') || 'light';
  }
};

if (typeof window !== 'undefined') {
  window.ThemeManager = ThemeManager;
}
