/*
 * ============================================================
 *  db.js — طبقة تجريد التخزين (Storage Abstraction Layer)
 *  HSA Come — يعمل على أحد خلفيتين:
 *  • "local" (LocalStorage) — الوضع الافتراضي، دون إنترنت تمامًا
 *  • "firebase" (Firebase Realtime Database) — وضع الإنتاج متعدد المستخدمين
 *  (Runs on EITHER "local" (LocalStorage, DEFAULT, fully offline,
 *  zero external resources) OR "firebase" (Firebase Realtime Database)
 *  for multi-user production — the SDK loads from CDN only when selected)
 * ============================================================
 */

const DB = {
  CONFIG: {
    backend: 'local',   // 'local' | 'firebase' — الخلفية المختارة (chosen backend)
    firebase: {
      apiKey: 'YOUR_API_KEY',
      authDomain: 'YOUR_PROJECT.firebaseapp.com',
      databaseURL: 'https://YOUR_PROJECT-default-rtdb.firebaseio.com',
      projectId: 'YOUR_PROJECT',
      storageBucket: 'YOUR_PROJECT.appspot.com',
      messagingSenderId: 'YOUR_SENDER_ID',
      appId: 'YOUR_APP_ID'
    }
  },

  _deviceId: null,   // معرّف مجهول ثابت للجهاز (stable anonymous per-device id)
  _db: null,         // مرجع قاعدة بيانات Firebase بعد التهيئة (firebase database reference once initialized)
  _backend: 'local', // الخلفية الفعلية — تعود لـ 'local' عند فشل Firebase (effective backend, falls back to 'local' if firebase fails)

  // تُستدعى مرة واحدة عند الإقلاع — تُرجع Promise
  // (Called once at startup. Returns a Promise. Loads+initializes Firebase
  // only when CONFIG.backend === 'firebase'. On ANY failure (offline, bad
  // config), logs a warning and falls back to the 'local' backend so the
  // site never breaks.)
  async init() {
    if (this.CONFIG.backend !== 'firebase') {
      this._backend = 'local';
      return; // لا شبكة على الإطلاق في الوضع المحلي (no network at all in local mode)
    }
    try {
      await this._initFirebase();
      this._backend = 'firebase';
    } catch (e) {
      console.warn('[HSA Come] Firebase initialization failed — falling back to the local (LocalStorage) backend.', e);
      this._backend = 'local';
    }
  },

  // معرّف جهاز مجهول ثابت (محفوظ في localStorage 'hsa-device-id')
  // يُستخدم كمفتاح الناخب في Firebase حتى لا يصوّت الزائر مرتين،
  // ولإسناد البلاغات إلى مُرسِلها.
  // (Stable per-device anonymous id stored in localStorage 'hsa-device-id'.
  // Used as the voter key in Firebase so one visitor can't vote twice,
  // and to attribute issues to their submitter.)
  _getDeviceId() {
    if (this._deviceId) return this._deviceId;
    let id = null;
    try { id = localStorage.getItem('hsa-device-id'); } catch (e) { id = null; }
    if (!id) {
      // توليد معرّف فريد تقريبي (generate a UUID-ish id)
      id = 'device-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10) + '-' + Math.random().toString(36).slice(2, 6);
      try { localStorage.setItem('hsa-device-id', id); } catch (e) { /* تجاهل — ignore */ }
    }
    this._deviceId = id;
    return id;
  },

  // ---- ردود الفعل (إعجاب / عدم إعجاب) — Reactions (like / dislike) ----

  // تُرجع { likes: Number, dislikes: Number, userVote: 'like'|'dislike'|null }
  // (Returns { likes, dislikes, userVote })
  async getReactionCounts(app) {
    if (!app || !app.id) return { likes: 0, dislikes: 0, userVote: null };
    if (this._backend !== 'firebase' || !this._db) {
      // محلي: العدادات الأساسية من التطبيق + صوت هذا الزائر
      // (local: base counts from the app + this visitor's own vote)
      const votes = this._localGetVotes();
      const userVote = votes[app.id] || null;
      return {
        likes: (Number(app.likes) || 0) + (userVote === 'like' ? 1 : 0),
        dislikes: (Number(app.dislikes) || 0) + (userVote === 'dislike' ? 1 : 0),
        userVote: userVote
      };
    }
    try {
      const deviceId = this._getDeviceId();
      const countsSnap = await this._db.ref('reactions/' + app.id + '/counts').once('value');
      const counts = (countsSnap && typeof countsSnap.exists === 'function' && countsSnap.exists()) ? (countsSnap.val() || {}) : {};
      // عدادات Firebase هي الزيادات فقط — أضف الأساس من بيانات التطبيق
      // (Firebase counts hold deltas only — add the base from the app data)
      const likes = (Number(app.likes) || 0) + (Number(counts.likes) || 0);
      const dislikes = (Number(app.dislikes) || 0) + (Number(counts.dislikes) || 0);
      const voteSnap = await this._db.ref('reactions/' + app.id + '/voters/' + deviceId).once('value');
      let userVote = null;
      if (voteSnap && typeof voteSnap.exists === 'function' && voteSnap.exists()) {
        const v = voteSnap.val();
        if (v === 'like' || v === 'dislike') userVote = v;
      }
      return { likes: likes, dislikes: dislikes, userVote: userVote };
    } catch (e) {
      console.warn('[HSA Come] Firebase read failed — using local reaction data.', e);
      const votes = this._localGetVotes();
      const userVote = votes[app.id] || null;
      return {
        likes: (Number(app.likes) || 0) + (userVote === 'like' ? 1 : 0),
        dislikes: (Number(app.dislikes) || 0) + (userVote === 'dislike' ? 1 : 0),
        userVote: userVote
      };
    }
  },

  // يسجّل صوت الزائر. type هي 'like' | 'dislike' | null (null يزيل الصوت)
  // (Records the visitor's vote. type is 'like' | 'dislike' | null — null removes the vote.)
  async setReaction(appId, type) {
    if (!appId) return;
    if (this._backend !== 'firebase' || !this._db) {
      const votes = this._localGetVotes();
      if (type === null) {
        delete votes[appId];
      } else {
        votes[appId] = type;
      }
      this._localSetVotes(votes);
      return;
    }
    try {
      const deviceId = this._getDeviceId();
      const countsRef = this._db.ref('reactions/' + appId + '/counts');
      const voterRef = this._db.ref('reactions/' + appId + '/voters/' + deviceId);
      // قراءة صوت هذا الجهاز الحالي أولًا (read the current vote of this device first)
      let userVote = null;
      const snap = await voterRef.once('value');
      if (snap && typeof snap.exists === 'function' && snap.exists()) {
        const v = snap.val();
        if (v === 'like' || v === 'dislike') userVote = v;
      }
      if (type === null || userVote === type) {
        // إلغاء التصويت: إنقاص العدّاد القديم (إن وُجد) ثم حذف سجل الناخب
        // (remove the vote: decrement the old count if it existed, then delete the voter record)
        if (userVote) {
          const field = userVote === 'like' ? 'likes' : 'dislikes';
          await countsRef.transaction(current => {
            const cur = (current && typeof current === 'object') ? current : {};
            const next = { likes: Number(cur.likes) || 0, dislikes: Number(cur.dislikes) || 0 };
            next[field] = Math.max(0, next[field] - 1);
            return next;
          });
        }
        await voterRef.remove();
      } else {
        // تبديل/إضافة صوت: إنقاص القديم (إن وُجد) ثم زيادة الجديد وتسجيل الناخب
        // (switch/add vote: decrement the old count if it existed, increment the new one, and record the voter)
        const newField = type === 'like' ? 'likes' : 'dislikes';
        const oldField = userVote === 'like' ? 'likes' : (userVote === 'dislike' ? 'dislikes' : null);
        await countsRef.transaction(current => {
          const cur = (current && typeof current === 'object') ? current : {};
          const next = { likes: Number(cur.likes) || 0, dislikes: Number(cur.dislikes) || 0 };
          if (oldField) next[oldField] = Math.max(0, next[oldField] - 1);
          next[newField] = next[newField] + 1;
          return next;
        });
        await voterRef.set(type);
      }
    } catch (e) {
      console.warn('[HSA Come] Firebase setReaction failed — saving the vote locally instead.', e);
      // احتياط: حفظ الصوت محليًا حتى لا يضيع (fallback: keep the vote in local storage so it isn't lost)
      const votes = this._localGetVotes();
      if (type === null) {
        delete votes[appId];
      } else {
        votes[appId] = type;
      }
      this._localSetVotes(votes);
    }
  },

  // ---- البلاغات (تقارير المشكلات) — Issues (problem reports) ----

  // تُرجع البلاغات التي أُنشئت من هذا الجهاز فقط
  // (local: كل البلاغات المخزنة؛ firebase: البلاغات المفلترة بمعرّف الجهاز)
  // (Returns the issues created by THIS device (local: all stored issues;
  // firebase: all issues filtered by this device's id).)
  async getMyIssues() {
    if (this._backend !== 'firebase' || !this._db) {
      return this._localGetIssues();
    }
    try {
      const deviceId = this._getDeviceId();
      const snap = await this._db.ref('issues').orderByChild('deviceId').equalTo(deviceId).once('value');
      const list = [];
      if (snap && typeof snap.exists === 'function' && snap.exists()) {
        snap.forEach(child => {
          const val = child.val();
          if (val && typeof val === 'object') {
            const item = Object.assign({}, val);
            if (!item.id) item.id = child.key; // مفتاح Firebase كـ id إن لم يوجد (include the firebase key as id if the object has no id)
            list.push(item);
          }
        });
      }
      // الأحدث أولًا حسب التاريخ (newest first by date)
      list.sort((a, b) => {
        const da = new Date(a.date).getTime() || 0;
        const dbTime = new Date(b.date).getTime() || 0;
        return dbTime - da;
      });
      return list;
    } catch (e) {
      console.warn('[HSA Come] Firebase getMyIssues failed — using local issues.', e);
      return this._localGetIssues();
    }
  },

  // يحفظ بلاغًا جديدًا — تُرجع Promise
  // (Persists a new issue object. Returns a Promise.)
  async addIssue(issue) {
    if (!issue) return;
    if (this._backend !== 'firebase' || !this._db) {
      const arr = this._localGetIssues();
      arr.unshift(issue);
      this._localSetIssues(arr);
      return;
    }
    try {
      issue.deviceId = this._getDeviceId(); // إسناد البلاغ إلى مُرسِله (attribute the issue to its submitter)
      await this._db.ref('issues').push(issue);
    } catch (e) {
      console.warn('[HSA Come] Firebase addIssue failed — saving the issue locally.', e);
      const arr = this._localGetIssues();
      arr.unshift(issue);
      this._localSetIssues(arr);
    }
  },

  // ---- التنفيذات الداخلية للخلفية — internal backend implementations ----

  // حقن سكربت وحلّه عند اكتمال تحميله (مع حد أقصى 10 ثوانٍ لمنع التعليق)
  // (injects a <script> and resolves on load — 10s timeout guards against hangs)
  _loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error('Timeout loading script: ' + src));
      }, 10000);
      s.onload = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      s.onerror = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error('Could not load script: ' + src));
      };
      document.head.appendChild(s);
    });
  },

  // تحميل حزمة التوافق (compat) وتهيئة التطبيق وتعيين this._db
  // (loads the compat SDK, runs initializeApp, and sets this._db)
  async _initFirebase() {
    await this._loadScript('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
    await this._loadScript('https://www.gstatic.com/firebasejs/10.12.0/firebase-database-compat.js');
    if (typeof firebase === 'undefined' || !firebase.apps) {
      throw new Error('Firebase SDK is not available');
    }
    // تخطي إعادة التهيئة إن وُجد تطبيق مُهيَّأ مسبقًا
    // (skip re-init if an app is already initialized)
    if (firebase.apps.length === 0) {
      firebase.initializeApp(this.CONFIG.firebase);
    }
    this._db = firebase.database();
  },

  // قراءة أصوات الزائر من localStorage 'hsa-reactions' -> {appId: vote}
  // (read stored votes from localStorage 'hsa-reactions')
  _localGetVotes() {
    try { return JSON.parse(localStorage.getItem('hsa-reactions')) || {}; }
    catch (e) { return {}; }
  },

  _localSetVotes(map) {
    try { localStorage.setItem('hsa-reactions', JSON.stringify(map || {})); } catch (e) { /* تجاهل — ignore */ }
  },

  // قراءة البلاغات من localStorage 'hsa-issues' -> array
  // (read stored issues from localStorage 'hsa-issues')
  _localGetIssues() {
    try { return JSON.parse(localStorage.getItem('hsa-issues')) || []; }
    catch (e) { return []; }
  },

  _localSetIssues(arr) {
    try { localStorage.setItem('hsa-issues', JSON.stringify(arr || [])); } catch (e) { /* تجاهل — ignore */ }
  }
};

if (typeof window !== 'undefined') {
  window.DB = DB;
}
