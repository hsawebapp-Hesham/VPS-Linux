/*
 * ملف التشغيل الرئيسي — HSA Come
 * يهيئ المكونات المشتركة عند اكتمال DOM: الترويسة، قائمة الجوال، العودة للأعلى،
 * الظهور عند التمرير، سنة التذييل، وحدات الصفحات، التنبيهات، والعارض الضوئي.
 * (Main entry — initializes shared UI modules on DOMContentLoaded)
 */

(function () {
  'use strict';

  /* ------------------------------------------------------------
     التنبيهات المنبثقة (Toasts)
     ------------------------------------------------------------ */

  // إنشاء تنبيه منبثق من نوع (info/success/error) يختفي تلقائيًا بعد المدة
  function showToast(message, type = 'info', duration = 3500) {
    if (!message || !document.body) {
      return;
    }
    let container = document.querySelector('.toast-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = 'toast toast-' + type;
    toast.textContent = message;
    container.appendChild(toast);
    requestAnimationFrame(() => {
      toast.classList.add('show');
    });
    setTimeout(() => {
      toast.classList.add('hide');
      setTimeout(() => {
        if (toast.parentNode) {
          toast.parentNode.removeChild(toast);
        }
      }, 400);
    }, duration);
  }

  window.showToast = showToast;

  /* ------------------------------------------------------------
     العارض الضوئي (Lightbox) — عناصره تُنشأ كسولًا عند أول استخدام
     ------------------------------------------------------------ */

  let lightboxImages = [];
  let lightboxIndex = 0;
  let lightboxAlt = '';
  let lightboxEl = null;
  let lightboxImg = null;
  let lightboxCloseBtn = null;
  let lightboxPrevBtn = null;
  let lightboxNextBtn = null;

  // قراءة تسمية مترجمة مع قيمة افتراضية إن لم توجد الترجمة
  function lightboxLabel(key, fallback) {
    if (typeof LanguageManager !== 'undefined' && typeof LanguageManager.t === 'function') {
      const text = LanguageManager.t(key);
      if (text && text !== key) {
        return text;
      }
    }
    return fallback;
  }

  // قلب أيقونات الأسهم في وضع RTL لتعكس اتجاه القراءة
  function updateLightboxIconDirection() {
    const rtl = document.documentElement.dir === 'rtl';
    [lightboxPrevBtn, lightboxNextBtn].forEach((btn) => {
      if (!btn) {
        return;
      }
      const svg = btn.querySelector('svg');
      if (svg) {
        svg.style.transform = rtl ? 'scaleX(-1)' : '';
      }
    });
  }

  // إنشاء عناصر العارض الضوئي مرة واحدة فقط وإضافتها إلى الجسم
  function ensureLightbox() {
    if (lightboxEl) {
      return lightboxEl;
    }

    lightboxEl = document.createElement('div');
    lightboxEl.className = 'lightbox';
    lightboxEl.setAttribute('role', 'dialog');
    lightboxEl.setAttribute('aria-modal', 'true');

    lightboxCloseBtn = document.createElement('button');
    lightboxCloseBtn.className = 'lightbox-close icon-btn';
    lightboxCloseBtn.type = 'button';
    lightboxCloseBtn.setAttribute('aria-label', lightboxLabel('common.close', 'Close'));
    lightboxCloseBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
    lightboxCloseBtn.addEventListener('click', closeLightbox);

    lightboxPrevBtn = document.createElement('button');
    lightboxPrevBtn.className = 'lightbox-prev icon-btn';
    lightboxPrevBtn.type = 'button';
    lightboxPrevBtn.setAttribute('aria-label', lightboxLabel('details.gallery.prev', 'Previous'));
    lightboxPrevBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"></polyline></svg>';
    lightboxPrevBtn.addEventListener('click', lightboxPrev);

    lightboxNextBtn = document.createElement('button');
    lightboxNextBtn.className = 'lightbox-next icon-btn';
    lightboxNextBtn.type = 'button';
    lightboxNextBtn.setAttribute('aria-label', lightboxLabel('details.gallery.next', 'Next'));
    lightboxNextBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"></polyline></svg>';
    lightboxNextBtn.addEventListener('click', lightboxNext);

    lightboxImg = document.createElement('img');
    lightboxImg.className = 'lightbox-content';
    lightboxImg.alt = '';

    lightboxEl.appendChild(lightboxCloseBtn);
    lightboxEl.appendChild(lightboxPrevBtn);
    lightboxEl.appendChild(lightboxNextBtn);
    lightboxEl.appendChild(lightboxImg);

    // النقر على الخلفية يغلق العارض
    lightboxEl.addEventListener('click', (e) => {
      if (e.target === lightboxEl) {
        closeLightbox();
      }
    });

    // لوحة المفاتيح: Escape للإغلاق، الأسهم للتنقل (في RTL: يمين = السابق، يسار = التالي)
    document.addEventListener('keydown', (e) => {
      if (!lightboxEl || !lightboxEl.classList.contains('open')) {
        return;
      }
      if (e.key === 'Escape') {
        closeLightbox();
      } else if (e.key === 'Tab' && lightboxEl && lightboxEl.classList.contains('open')) {
        // حبس التركيز داخل العارض (Trap focus inside the lightbox)
        const focusables = [lightboxCloseBtn, lightboxPrevBtn, lightboxNextBtn].filter(Boolean);
        if (!focusables.length) {
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        } else if (!lightboxEl.contains(document.activeElement)) {
          e.preventDefault();
          first.focus();
        }
      } else if (e.key === 'ArrowLeft') {
        if (document.documentElement.dir === 'rtl') {
          lightboxNext();
        } else {
          lightboxPrev();
        }
      } else if (e.key === 'ArrowRight') {
        if (document.documentElement.dir === 'rtl') {
          lightboxPrev();
        } else {
          lightboxNext();
        }
      }
    });

    // تحديث التسميات والأسهم عند تغير اللغة
    document.addEventListener('languagechange', () => {
      if (!lightboxEl) {
        return;
      }
      lightboxCloseBtn.setAttribute('aria-label', lightboxLabel('common.close', 'Close'));
      lightboxPrevBtn.setAttribute('aria-label', lightboxLabel('details.gallery.prev', 'Previous'));
      lightboxNextBtn.setAttribute('aria-label', lightboxLabel('details.gallery.next', 'Next'));
      updateLightboxIconDirection();
    });

    document.body.appendChild(lightboxEl);
    return lightboxEl;
  }

  // عرض الصورة الحالية في العارض
  function showLightboxImage() {
    if (!lightboxImg) {
      return;
    }
    lightboxImg.src = lightboxImages[lightboxIndex];
    lightboxImg.alt = lightboxAlt;
  }

  // فتح العارض بصورة، واختياريًا مع مصفوفة صور للتنقل بينها
  function openLightbox(src, alt, images) {
    if (!src) {
      return;
    }
    if (Array.isArray(images) && images.length > 0) {
      lightboxImages = images.slice();
      const found = lightboxImages.indexOf(src);
      lightboxIndex = found >= 0 ? found : 0;
    } else if (lightboxImages.indexOf(src) >= 0) {
      lightboxIndex = lightboxImages.indexOf(src);
    } else {
      lightboxImages = [src];
      lightboxIndex = 0;
    }
    lightboxAlt = (alt == null) ? '' : String(alt);

    const lb = ensureLightbox();
    showLightboxImage();
    lb.classList.add('open');
    document.body.style.overflow = 'hidden';
    if (lightboxCloseBtn) {
      lightboxCloseBtn.focus();
    }
  }

  // إغلاق العارض
  function closeLightbox() {
    if (!lightboxEl) {
      return;
    }
    lightboxEl.classList.remove('open');
    document.body.style.overflow = '';
  }

  // الصورة السابقة (يلتف من الأول إلى الأخير)
  function lightboxPrev() {
    if (lightboxImages.length === 0) {
      return;
    }
    lightboxIndex = (lightboxIndex - 1 + lightboxImages.length) % lightboxImages.length;
    showLightboxImage();
  }

  // الصورة التالية (يلتف من الأخير إلى الأول)
  function lightboxNext() {
    if (lightboxImages.length === 0) {
      return;
    }
    lightboxIndex = (lightboxIndex + 1) % lightboxImages.length;
    showLightboxImage();
  }

  window.openLightbox = openLightbox;
  window.closeLightbox = closeLightbox;
  window.lightboxPrev = lightboxPrev;
  window.lightboxNext = lightboxNext;

  /* ------------------------------------------------------------
     وحدات الصفحات (Page modules)
     ------------------------------------------------------------ */

  // تشغيل وحدة الصفحة الحالية حسب data-page في الجسم
  function renderCurrentPage() {
    const page = document.body ? document.body.dataset.page : '';
    switch (page) {
      case 'home':
        if (typeof AppsLoader !== 'undefined' && typeof AppsLoader.renderHome === 'function') {
          AppsLoader.renderHome();
        }
        break;
      case 'apps':
        if (typeof AppsPage !== 'undefined' && typeof AppsPage.init === 'function') {
          AppsPage.init();
        }
        break;
      case 'details':
        if (typeof AppDetailsPage !== 'undefined' && typeof AppDetailsPage.init === 'function') {
          AppDetailsPage.init();
        }
        break;
      case 'report':
        if (typeof ReportForm !== 'undefined' && typeof ReportForm.init === 'function') {
          ReportForm.init();
        }
        break;
      default:
        break;
    }
  }

  /* ------------------------------------------------------------
     المكونات العامة (Shared components)
     ------------------------------------------------------------ */

  // إغلاق قائمة الجوال (تُستخدم من عدة أماكن)
  // إدارة التركيز: إرجاع التركيز إلى زر القائمة عند إغلاق قائمة مفتوحة
  function closeMobileMenu() {
    const hamburger = document.getElementById('hamburger');
    const navLinks = document.getElementById('nav-links');
    if (!hamburger || !navLinks) {
      return;
    }
    const wasOpen = hamburger.classList.contains('open');
    hamburger.classList.remove('open');
    navLinks.classList.remove('open');
    hamburger.setAttribute('aria-expanded', 'false');
    if (wasOpen) {
      hamburger.focus();
    }
  }

  // ظل الترويسة عند التمرير أكثر من 10px
  function initHeaderScroll() {
    const header = document.getElementById('header');
    if (!header) {
      return;
    }
    const onScroll = () => {
      if (window.scrollY > 10) {
        header.classList.add('scrolled');
      } else {
        header.classList.remove('scrolled');
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // قائمة الجوال: تبديل الفتح/الإغلاق، الإغلاق عند الروابط وعند Escape
  function initMobileMenu() {
    const hamburger = document.getElementById('hamburger');
    const navLinks = document.getElementById('nav-links');
    if (!hamburger || !navLinks) {
      return;
    }
    hamburger.setAttribute('aria-expanded', 'false');
    hamburger.setAttribute('aria-controls', 'nav-links');

    hamburger.addEventListener('click', () => {
      if (hamburger.classList.contains('open')) {
        closeMobileMenu();
      } else {
        hamburger.classList.add('open');
        navLinks.classList.add('open');
        hamburger.setAttribute('aria-expanded', 'true');
        // نقل التركيز إلى أول رابط عند فتح قائمة الجوال
        const firstLink = navLinks.querySelector('.nav-link');
        if (firstLink) {
          firstLink.focus();
        }
      }
    });

    navLinks.querySelectorAll('.nav-link').forEach((link) => {
      link.addEventListener('click', closeMobileMenu);
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && hamburger.classList.contains('open')) {
        closeMobileMenu();
      }
    });
  }

  // زر العودة للأعلى يظهر بعد 400px ويعود بتمرير سلس
  function initBackToTop() {
    const btn = document.getElementById('back-to-top');
    if (!btn) {
      return;
    }
    const onScroll = () => {
      if (window.scrollY > 400) {
        btn.classList.add('visible');
      } else {
        btn.classList.remove('visible');
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    btn.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    onScroll();
  }

  // مراقب الظهور التدريجي — يُخزَّن في نطاق خارجي لإعادة مسح العناصر المُحقونة لاحقًا
  // (scroll-reveal observer — stored in outer scope for re-scanning injected elements)
  let revealObserver = null;

  // الظهور التدريجي للعناصر عند دخولها مجال الرؤية
  function initScrollReveal() {
    const reveals = document.querySelectorAll('.reveal');
    if (!reveals.length) {
      return;
    }
    if (typeof IntersectionObserver === 'undefined') {
      reveals.forEach((el) => el.classList.add('visible'));
      return;
    }
    revealObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          revealObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });
    reveals.forEach((el) => revealObserver.observe(el));
  }

  // إعادة مسح عناصر .reveal المُحقونة ديناميكيًا (re-scan dynamically injected .reveal elements)
  window.__initScrollRevealAgain = function () {
    if (!revealObserver) {
      document.querySelectorAll('.reveal:not(.visible)').forEach((el) => el.classList.add('visible'));
      return;
    }
    document.querySelectorAll('.reveal:not(.visible)').forEach((el) => revealObserver.observe(el));
  };

  // ملء السنة الحالية في عناصر data-year
  function initFooterYear() {
    const year = String(new Date().getFullYear());
    document.querySelectorAll('[data-year]').forEach((el) => {
      el.textContent = year;
    });
  }

  // تشغيل وحدة الصفحة الحالية
  function initPageModules() {
    renderCurrentPage();
  }

  // إعادة تشغيل وحدة الصفحة عند تغير اللغة لترجمة المحتوى الديناميكي
  function initLanguageReRender() {
    document.addEventListener('languagechange', () => {
      renderCurrentPage();
    });
  }

  // التمرير السلس للأنكرات يتم عبر CSS (scroll-behavior)؛ هنا نغلق قائمة الجوال فقط عند النقر عليها
  function initSmoothAnchors() {
    document.querySelectorAll('a[href^="#"]').forEach((link) => {
      link.addEventListener('click', closeMobileMenu);
    });
  }

  // تمييز رابط الصفحة الحالية في شريط التنقل (Highlight the current page in the nav)
  function initNavHighlight() {
    const page = document.body ? document.body.dataset.page : '';
    const map = {
      home: 'index.html',
      apps: 'apps.html',
      details: 'app-details.html',
      about: 'about.html',
      report: 'report-issue.html'
    };
    const target = map[page];
    if (!target) return;
    document.querySelectorAll('.nav-link').forEach((link) => {
      const href = link.getAttribute('href') || '';
      if (href === target || href.indexOf(target + '?') === 0 || href.indexOf(target + '#') === 0) {
        link.classList.add('active');
      }
    });
  }

  /* ------------------------------------------------------------
     الإقلاع (Boot)
     ------------------------------------------------------------ */

  // الإقلاع غير المتزامن: تهيئة طبقة التخزين (DB) قبل أي عرض
  // (Async boot: initialize the storage backend (DB) before anything renders)
  async function boot() {
    // المدراء المحليون أولًا — النص والسمة يظهران حتى لو تعلقت الخلفية
    // (Local managers first — text and theme render even if the backend hangs)
    if (typeof ThemeManager !== 'undefined') {
      ThemeManager.init();
    }
    if (typeof LanguageManager !== 'undefined') {
      LanguageManager.init();
    }
    // طبقة التخزين بحد أقصى 5 ثوانٍ — لا تحجب الصفحة أبدًا
    // (Storage layer with a 5s cap — never blocks the page)
    if (typeof DB !== 'undefined' && DB && typeof DB.init === 'function') {
      try {
        await Promise.race([
          DB.init(),
          new Promise((resolve, reject) => {
            setTimeout(() => reject(new Error('DB init timed out')), 5000);
          })
        ]);
      } catch (e) { /* تجاهل — DB يرجع تلقائيًا للمحلي (ignore — DB falls back to local) */ }
    }
    initHeaderScroll();
    initMobileMenu();
    initBackToTop();
    initScrollReveal();
    initFooterYear();
    initPageModules();
    initNavHighlight();
    initLanguageReRender();
    initSmoothAnchors();
  }

  document.addEventListener('DOMContentLoaded', () => { boot(); });
})();
