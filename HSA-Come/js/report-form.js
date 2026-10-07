/*
 * ============================================================
 *  report-form.js — نموذج الإبلاغ عن مشكلة (Issue Report Form)
 *  HSA Come — تحقق من الصحة، إرسال عبر طبقة التخزين DB، عرض البلاغات المرسلة
 *  (Validation, submission via the DB storage layer, my-issues list)
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

const ReportForm = {
  /* خريطة الحقول: اسم الحقل -> معرف العنصر (Field name -> element id) */
  FIELDS: {
    name: 'issue-name',
    email: 'issue-email',
    app: 'issue-app',
    message: 'issue-message'
  },

  init() {
    // main.js يعيد استدعاء init() عند تغيير اللغة — اجعل التهيئة مكررة بأمان
    // (main.js re-calls init() on languagechange — keep init idempotent)
    if (this._initialized) { this.populateAppSelect(); this.renderMyIssues(); return; }
    this._initialized = true;
    // تحميل التطبيقات ثم تعبئة قائمة الاختيار (Load apps then populate select)
    const populate = () => this.populateAppSelect();
    if (typeof AppsLoader !== 'undefined' && typeof AppsLoader.load === 'function') {
      AppsLoader.load().then(populate).catch(populate);
    } else {
      populate();
    }

    // إعادة التعبئة عند تغيير اللغة مع الحفاظ على التحديد
    // (Re-populate on language change, preserving selection)
    document.addEventListener('languagechange', () => this.populateAppSelect());

    // ربط النموذج (Bind form submit)
    const form = document.getElementById('report-form');
    if (form) form.addEventListener('submit', e => this.onSubmit(e));

    // التحقق عند الخروج من الحقل ومسح الخطأ عند الكتابة
    // (Validate on blur, clear error on input)
    Object.keys(this.FIELDS).forEach(field => {
      const el = document.getElementById(this.FIELDS[field]);
      if (!el) return;
      el.addEventListener('blur', () => {
        const data = this.getFormData();
        const result = this.validate(data);
        if (result.errors[field]) this.showErrors({ [field]: result.errors[field] });
      });
      el.addEventListener('input', () => this.clearFieldError(field));
      el.addEventListener('change', () => this.clearFieldError(field));
    });

    this.renderMyIssues();

    // إعادة عرض البلاغات عند تغيير اللغة (Re-render issues on language change)
    document.addEventListener('languagechange', () => this.renderMyIssues());
  },

  /* قراءة بيانات النموذج (Read form data) */
  getFormData() {
    const get = id => { const el = document.getElementById(id); return el ? el.value : ''; };
    return {
      name: get(this.FIELDS.name),
      email: get(this.FIELDS.email),
      app: get(this.FIELDS.app),
      message: get(this.FIELDS.message)
    };
  },

  /* تعبئة قائمة التطبيقات (Populate app select) */
  populateAppSelect() {
    const select = document.getElementById('issue-app');
    if (!select) return;
    const selected = select.value;
    select.innerHTML = '';
    // خيار الإرشاد (Placeholder option)
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = hsaT('report.form.app.placeholder');
    select.appendChild(placeholder);
    // خيار لكل تطبيق (One option per app)
    let apps = [];
    if (typeof AppsLoader !== 'undefined' && typeof AppsLoader.getAll === 'function') {
      apps = AppsLoader.getAll();
    } else if (typeof APPS_FALLBACK !== 'undefined') {
      apps = APPS_FALLBACK;
    }
    const lang = hsaLang();
    apps.forEach(app => {
      const opt = document.createElement('option');
      opt.value = app.id;
      opt.textContent = (app.name && (app.name[lang] || app.name.en)) || app.id;
      select.appendChild(opt);
    });
    // استعادة التحديد السابق أو المعامل من الرابط (?app=)
    // (Restore previous selection or preselect from query param)
    let preselect = selected;
    if (!preselect) {
      try { preselect = new URLSearchParams(location.search).get('app') || ''; } catch (e) { /* تجاهل */ }
    }
    if (preselect && Array.prototype.some.call(select.options, o => o.value === preselect)) {
      select.value = preselect;
    }
  },

  /* التحقق من صحة البيانات (Validate data) */
  validate(data) {
    const errors = {};
    const name = (data.name || '').trim();
    const email = (data.email || '').trim();
    const message = (data.message || '').trim();
    if (!name) errors.name = { key: 'error.required' };
    else if (name.length < 2) errors.name = { key: 'error.min', params: { n: 2 } };
    if (!email) errors.email = { key: 'error.required' };
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = { key: 'error.email' };
    if (!data.app) errors.app = { key: 'error.required' };
    if (!message) errors.message = { key: 'error.required' };
    else if (message.length < 10) errors.message = { key: 'error.min', params: { n: 10 } };
    else if (message.length > 500) errors.message = { key: 'error.max', params: { n: 500 } };
    return { valid: Object.keys(errors).length === 0, errors };
  },

  /* إظهار الأخطاء (Show errors) */
  showErrors(errors) {
    Object.keys(errors).forEach(field => {
      const err = errors[field];
      const input = document.getElementById(this.FIELDS[field]);
      if (input) {
        input.classList.add('invalid');
        input.setAttribute('aria-invalid', 'true');
      }
      const errEl = document.querySelector('.form-error[data-error-for="' + field + '"]');
      if (errEl) {
        errEl.textContent = hsaT(err.key, err.params);
        errEl.classList.add('show');
      }
    });
  },

  /* مسح خطأ حقل واحد (Clear single field error) */
  clearFieldError(field) {
    const input = document.getElementById(this.FIELDS[field]);
    if (input) {
      input.classList.remove('invalid');
      input.removeAttribute('aria-invalid');
    }
    const errEl = document.querySelector('.form-error[data-error-for="' + field + '"]');
    if (errEl) {
      errEl.textContent = '';
      errEl.classList.remove('show');
    }
  },

  /* مسح كل الأخطاء (Clear all errors) */
  clearErrors() {
    Object.keys(this.FIELDS).forEach(field => this.clearFieldError(field));
  },

  /* إرسال النموذج (Handle submit) */
  async onSubmit(e) {
    e.preventDefault();
    this.clearErrors();
    const data = this.getFormData();
    const result = this.validate(data);
    if (!result.valid) {
      this.showErrors(result.errors);
      // تنبيه بأول خطأ (Toast with first error message)
      const firstKey = Object.keys(result.errors)[0];
      const firstErr = result.errors[firstKey];
      if (typeof showToast === 'function') showToast(hsaT(firstErr.key, firstErr.params), 'info');
      const firstInvalid = document.querySelector('.form-control.invalid');
      if (firstInvalid) firstInvalid.focus();
      return;
    }

    const submitBtn = document.querySelector('#report-form button[type="submit"]');
    const originalText = submitBtn ? submitBtn.textContent : '';

    try {
      // تعطيل زر الإرسال أثناء الإرسال (Disable submit button while sending)
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = hsaT('report.form.sending'); }

      // محاكاة تأخير الشبكة — الإرسال الفعلي يتم عبر طبقة التخزين DB (Firebase/Formspree)
      // (Simulate async delay — the real submission goes through the DB storage layer)
      await new Promise(resolve => setTimeout(resolve, 600));

      const lang = hsaLang();
      let apps = [];
      if (typeof AppsLoader !== 'undefined' && typeof AppsLoader.getAll === 'function') {
        apps = AppsLoader.getAll();
      } else if (typeof APPS_FALLBACK !== 'undefined') {
        apps = APPS_FALLBACK;
      }
      const appObj = apps.find(a => a.id === data.app);
      const issue = {
        id: Date.now(),
        name: (data.name || '').trim(),
        email: (data.email || '').trim(),
        appId: data.app,
        appName: appObj ? ((appObj.name && (appObj.name[lang] || appObj.name.en)) || appObj.id) : data.app,
        message: (data.message || '').trim(),
        status: 'review',
        date: new Date().toISOString(),
        reply: null
      };
      try {
        if (typeof DB !== 'undefined' && DB && typeof DB.addIssue === 'function') {
          await DB.addIssue(issue);
        }
      } catch (e) { /* تجاهل — البلاغ لم يُحفظ (ignore — issue not persisted) */ }

      const success = document.getElementById('form-success');
      if (success) success.classList.add('show');
      if (typeof showToast === 'function') showToast(hsaT('toast.issue.sent'), 'success');
      const form = document.getElementById('report-form');
      if (form) form.reset();
      await this.renderMyIssues();
    } finally {
      // إعادة تفعيل زر الإرسال (Re-enable submit button)
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = originalText; }
    }
  },

  /* قراءة البلاغات المحفوظة لهذا الجهاز عبر طبقة التخزين
     (Read stored issues for this device via the storage layer) */
  async getMyIssues() {
    if (typeof DB === 'undefined' || !DB || typeof DB.getMyIssues !== 'function') return [];
    return await DB.getMyIssues();
  },

  /* عرض البلاغات المرسلة (Render my submitted issues) */
  async renderMyIssues() {
    const list = document.getElementById('issues-list');
    if (!list) return;
    let issues = [];
    try {
      issues = await this.getMyIssues();
    } catch (e) {
      issues = []; // تجاهل — ignore
    }
    const lang = hsaLang();
    const locale = lang === 'ar' ? 'ar-EG' : 'en-US';
    if (!issues.length) {
      list.innerHTML = '<p class="muted">' + hsaEscapeHtml(hsaT('report.myissues.empty')) + '</p>';
      return;
    }
    list.innerHTML = issues.map(issue => {
      let dateStr = '';
      try { dateStr = new Date(issue.date).toLocaleDateString(locale); } catch (e) { /* تجاهل */ }
      const replied = issue.status === 'replied';
      const statusKey = replied ? 'report.status.replied' : 'report.status.review';
      const statusClass = replied ? 'badge-status-replied' : 'badge-status-review';
      let html =
        '<div class="issue-item">' +
          '<div class="issue-header">' +
            '<span class="issue-app">' + hsaEscapeHtml(issue.appName || '') + '</span>' +
            '<span class="issue-date">' + hsaEscapeHtml(dateStr) + '</span>' +
          '</div>' +
          '<p class="issue-message">' + hsaEscapeHtml(issue.message || '') + '</p>' +
          '<span class="badge ' + statusClass + '">' + hsaEscapeHtml(hsaT(statusKey)) + '</span>';
      if (issue.reply) {
        html +=
          '<div class="issue-reply"><strong>' + hsaEscapeHtml(hsaT('report.myissues.reply')) + ':</strong> ' + hsaEscapeHtml(issue.reply) + '</div>';
      }
      return html + '</div>';
    }).join('');
  }
};
