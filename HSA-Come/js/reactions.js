/*
 * ============================================================
 *  reactions.js — نظام ردود الفعل (Reactions: Like / Dislike)
 *  HSA Come — تصويت واحد لكل زائر لكل تطبيق، عبر طبقة التخزين DB
 *  (One vote per visitor per app, persisted via the DB storage layer)
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

/* أيقونات الإعجاب (Thumbs icons) */
function hsaReactionIcons() {
  return {
    thumbsUp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3z"/><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>',
    thumbsDown: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3z"/><path d="M17 2h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3"/></svg>'
  };
}

const Reactions = {
  /* إجمالي الإعجابات لتطبيق — يُستخدم لترتيب "الأكثر إعجابًا"
     (Total likes for an app — used by the "most liked" ranking) */
  async getTotalLikes(app) {
    try {
      if (typeof DB === 'undefined' || !DB || typeof DB.getReactionCounts !== 'function') {
        return (app && app.likes) || 0;
      }
      const c = await DB.getReactionCounts(app);
      return c.likes;
    } catch (e) {
      return (app && app.likes) || 0;
    }
  },

  /* عرض ردود الفعل (Render reactions UI) */
  async renderReactions(container, app) {
    if (!container || !app) return;

    // إلغاء أي مستمع سابق لتجنب التكرار عند إعادة العرض (Abort previous listeners)
    if (container.__hsaReactionsAbort && typeof container.__hsaReactionsAbort.abort === 'function') {
      container.__hsaReactionsAbort.abort();
    }
    const controller = new AbortController();
    container.__hsaReactionsAbort = controller;
    const icons = hsaReactionIcons();

    const build = async () => {
      try {
        const counts = await DB.getReactionCounts(app);
        const likeActive = counts.userVote === 'like' ? ' active-like' : '';
        const dislikeActive = counts.userVote === 'dislike' ? ' active-dislike' : '';
        container.innerHTML =
          '<div class="reactions">' +
            '<button class="reaction-btn like-btn' + likeActive + '" type="button" data-reaction="like" aria-label="' + hsaEscapeHtml(hsaT('details.like')) + '">' +
              icons.thumbsUp + '<span class="reaction-count">' + counts.likes + '</span>' +
            '</button>' +
            '<button class="reaction-btn dislike-btn' + dislikeActive + '" type="button" data-reaction="dislike" aria-label="' + hsaEscapeHtml(hsaT('details.dislike')) + '">' +
              icons.thumbsDown + '<span class="reaction-count">' + counts.dislikes + '</span>' +
            '</button>' +
          '</div>' +
          '<p class="muted">' + hsaEscapeHtml(hsaT('details.already.voted')) + '</p>';

        container.querySelectorAll('.reaction-btn').forEach(btn => {
          btn.addEventListener('click', async () => {
            try {
              const type = btn.getAttribute('data-reaction');
              const prev = (await DB.getReactionCounts(app)).userVote;
              // نفس الصوت يلغي التصويت، والتبديل يستبدل
              // (same vote toggles off, switching replaces)
              const newType = (type === prev) ? null : type;
              await DB.setReaction(app.id, newType);
              if (!newType) {
                if (typeof showToast === 'function') showToast(hsaT('toast.vote.removed'), 'info');
              } else {
                if (typeof showToast === 'function') showToast(hsaT('toast.vote.registered'), 'success');
              }
              // تحديث العدادات والحالات في مكانها دون إعادة عرض كاملة
              // (update DOM in place without full re-render)
              await this.updateInPlace(container, app);
            } catch (e) { /* تجاهل — ignore */ }
          }, { signal: controller.signal });
        });
      } catch (e) { /* تجاهل — ignore */ }
    };

    build();

    // إعادة العرض عند تغيير اللغة (Re-render on language change)
    document.addEventListener('languagechange', () => { build(); }, { signal: controller.signal });
  },

  /* تحديث العدادات وفئات الحالة في مكانها (Update counts and active classes in place) */
  async updateInPlace(container, app) {
    if (!container || !app) return;
    try {
      const counts = await DB.getReactionCounts(app);
      const likeBtn = container.querySelector('.like-btn');
      const dislikeBtn = container.querySelector('.dislike-btn');
      if (likeBtn) {
        likeBtn.classList.toggle('active-like', counts.userVote === 'like');
        const c = likeBtn.querySelector('.reaction-count');
        if (c) c.textContent = counts.likes;
      }
      if (dislikeBtn) {
        dislikeBtn.classList.toggle('active-dislike', counts.userVote === 'dislike');
        const c = dislikeBtn.querySelector('.reaction-count');
        if (c) c.textContent = counts.dislikes;
      }
    } catch (e) { /* تجاهل — ignore */ }
  }
};
