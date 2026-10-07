# HSA Come — هسا كوم

> مدونة شخصية ثنائية اللغة لعرض تطبيقات المطور (ويب، كمبيوتر، أندرويد) — A bilingual personal blog showcasing developer apps (web, desktop, Android).

---

## 📖 الوصف | Description

**HSA Come** هو مدونة شخصية ثنائية اللغة (العربية افتراضيًا مع `dir="rtl"`، والإنجليزية مع `dir="ltr"`) لعرض تطبيقات رقمية جاهزة لأنظمة الويب والكمبيوتر والأندرويد. جميع البيانات تُقرأ من ملف JSON واحد، والواجهة تتفاعل معها ديناميكيًا دون إعادة تحميل الصفحة.

**HSA Come** is a bilingual personal blog (Arabic default with `dir="rtl"`, English with `dir="ltr"`) showcasing ready-to-use digital apps for web, desktop, and Android. All data is read from a single JSON file, and the UI interacts with it dynamically without page reloads.

---

## ✨ المميزات | Features

- 🌐 **ثنائية اللغة AR/EN** مع دعم كامل لـ RTL/LTR — Bilingual AR/EN with full RTL/LTR support
- 🌗 **سمة فاتحة/داكنة** مع منع وميض قبل أول رسم — Light/dark theme with zero flash
- 📦 **بيانات مدفوعة بـ JSON** (`data/apps.json`) مع نسخة احتياطية مضمّنة — JSON-driven apps data with embedded fallback
- 👍 **ردود فعل** (إعجاب/عدم إعجاب) عبر طبقة `DB` — محلية افتراضيًا أو Firebase — Reactions (like/dislike) via the `DB` layer — local by default or Firebase
- 📝 **نموذج إبلاغ** مع تحقق من الصحة وحفظ عبر `DB` — Report form with validation and storage via `DB`
- 🔍 **SEO محسّن**: بيانات مهيكلة (JSON-LD)، خريطة موقع، robots.txt — SEO-ready: structured data (JSON-LD), sitemap, robots.txt
- 📱 **PWA-ready** عبر `manifest.json` — PWA-ready via manifest.json
- 📐 **متجاوب بالكامل** (1024 / 768 / 480px) مع احترام تقليل الحركة — Fully responsive with reduced-motion support
- ♿ **إتاحة (a11y)**: رابط تخطي التنقل، سمات aria، تنقل بلوحة المفاتيح — Accessibility: skip link, aria attributes, keyboard navigation

---

## 🗂️ هيكل المشروع | Project Structure

```
HSA-Come/
├── index.html                  # الصفحة الرئيسية | Home page
├── apps.html                   # صفحة جميع التطبيقات | All apps page
├── app-details.html            # صفحة تفاصيل التطبيق | App details page
├── about.html                  # صفحة نبذة عن المطور | About the developer
├── report-issue.html           # صفحة الإبلاغ عن مشكلة | Report issue page
├── 404.html                    # صفحة الخطأ 404 | 404 page
├── manifest.json               # ملف PWA | PWA manifest
├── sitemap.xml                 # خريطة الموقع | XML sitemap
├── robots.txt                  # ملف الروبوتات | Robots file
├── README.md                   # هذا الملف | This file
├── assets/
│   ├── fonts/                  # خط Cairo المحلي — ضع ملفات woff2/woff هنا
│   │   │                       # (Self-hosted Cairo — place woff2/woff files here)
│   │   ├── Cairo-Regular.woff2     # (أضفه | add it)
│   │   ├── Cairo-SemiBold.woff2    # (أضفه | add it)
│   │   ├── Cairo-Bold.woff2        # (أضفه | add it)
│   │   ├── Cairo-Black.woff2       # (أضفه | add it)
│   │   └── README.txt              # ترخيص SIL OFL 1.1 | SIL OFL 1.1 license
│   ├── icons/                # أيقونات التطبيقات الستة | Six app icons
│   │   ├── hsa-store.svg
│   │   ├── hsa-notes.svg
│   │   ├── hsa-calculator.svg
│   │   ├── hsa-chat.svg
│   │   ├── hsa-backup.svg
│   │   └── hsa-portfolio.svg
│   ├── images/               # الصور | Images
│   │   ├── hero-illustration.svg
│   │   ├── avatar.svg
│   │   └── shots/            # لقطات الشاشة (3 لكل تطبيق) | Screenshots (3 per app)
│   │       ├── hsa-store-1.svg … hsa-store-3.svg
│   │       ├── hsa-notes-1.svg … hsa-notes-3.svg
│   │       ├── hsa-calculator-1.svg … hsa-calculator-3.svg
│   │       ├── hsa-chat-1.svg … hsa-chat-3.svg
│   │       ├── hsa-backup-1.svg … hsa-backup-3.svg
│   │       └── hsa-portfolio-1.svg … hsa-portfolio-3.svg
│   └── img/logo/             # الشعار والأيقونة | Logo & favicon
│       ├── logo.svg
│       └── favicon.svg
├── css/
│   ├── themes.css            # المتغيرات + خط Cairo + السمات | Variables + font + themes
│   ├── style.css             # أنماط المكونات | Component styles
│   └── responsive.css        # نقاط التوقف | Responsive breakpoints
├── data/
│   └── apps.json             # بيانات التطبيقات (المصدر الأساسي) | Apps data (source of truth)
└── js/
    ├── translations.js       # نصوص الترجمة AR/EN | Translation strings
    ├── language.js           # مدير اللغة | Language manager
    ├── db.js               # طبقة تجريد التخزين (LocalStorage/Firebase) | Storage abstraction layer
    ├── theme.js              # مدير السمة | Theme manager
    ├── apps-fallback.js      # نسخة مضمّنة من البيانات (لبروتوكول file://) | Embedded fallback
    ├── apps-loader.js        # طبقة البيانات + دوال العرض | Data layer + rendering
    ├── reactions.js          # ردود الفعل (إعجاب/عدم إعجاب) | Reactions
    ├── report-form.js        # نموذج الإبلاغ عن مشكلة | Report form
    └── main.js               # الملف الرئيسي (التشغيل) | Main entry (boot)
```

---

## 🚀 كيفية التشغيل | How to Run

### الطريقة 1 — فتح مباشر (يعمل دون إنترنت) | Option 1 — Open directly (works offline)

افتح ملف `index.html` مباشرة في المتصفح. عند التشغيل عبر بروتوكول `file://` تحظر المتصفحات عملية `fetch`، لذلك تُستخدم **البيانات المضمّنة** في `js/apps-fallback.js` تلقائيًا (نسخة طبق الأصل من `data/apps.json`).

Open `index.html` directly in your browser. Over the `file://` protocol browsers block `fetch`, so the **embedded fallback** in `js/apps-fallback.js` (an exact mirror of `data/apps.json`) kicks in automatically.

### الطريقة 2 — خادم HTTP (المُوصى بها للإنتاج) | Option 2 — HTTP server (recommended)

شغّل الموقع عبر خادم HTTP ليُجلب `data/apps.json` حيًّا:

Serve the site over HTTP so `data/apps.json` is fetched live:

```bash
# Python 3
python -m http.server 8000

# أو باستخدام VS Code: امتداد "Live Server" → Open with Live Server
# Or with VS Code: "Live Server" extension → Open with Live Server
```

ثم افتح `http://localhost:8000` | Then open `http://localhost:8000`

---

## 🗄️ الربط بقاعدة بيانات خارجية | External Database Connection

### البنية | Architecture

الموقع يعمل عبر **طبقة تجريد تخزين واحدة** في `js/db.js` (الكائن العام `DB`). الوضع الافتراضي هو **`local`** — جميع البيانات (الأصوات والبلاغات) تُخزَّن في LocalStorage، والموقع يعمل **دون إنترنت تمامًا** وبدون أي موارد خارجية. لتشغيل وضع الإنتاج متعدد المستخدمين، بدّل الخلفية إلى **Firebase Realtime Database** — يُحمَّل Firebase SDK من CDN **فقط عند اختياره**، فلا يتأثر الوضع المحلي.

The site runs through a **single storage abstraction layer** in `js/db.js` (the global `DB` object). The default backend is **`local`** — all data (votes and issues) is stored in LocalStorage, and the site works **fully offline** with zero external resources. To run multi-user production mode, switch the backend to **Firebase Realtime Database** — the Firebase SDK is loaded from a CDN **only when selected**, so local mode stays offline.

### التبديل إلى Firebase | Switching to Firebase

1. **أنشئ مشروعًا مجانيًا** على [console.firebase.google.com](https://console.firebase.google.com) — Create a free Firebase project.
2. **أضف تطبيق ويب** (Web app) إلى المشروع وانسخ كائن الإعدادات (`firebaseConfig`) — Add a web app to the project and copy the config object.
3. في `js/db.js`: اضبط `CONFIG.backend = 'firebase'` والصق كائن الإعدادات في `CONFIG.firebase` — In `js/db.js`: set `CONFIG.backend = 'firebase'` and paste the config into `CONFIG.firebase`.
4. في وحدة تحكم Firebase: أنشئ **Realtime Database** (ابدأ في وضع الاختبار Test Mode واختر الموقع الأقرب لك) — In the Firebase console: create a Realtime Database (start in test mode, pick the location nearest you).
5. **انشر قواعد الأمان** التالية (انظر التحذير أدناه — يجب تشديدها للإنتاج) — Deploy the security rules below (see the warning below — tighten them for production).
6. **تم** — لا حاجة لأي تغيير آخر في الكود — Done — no other code changes needed.

### قواعد أمان Realtime Database | Realtime Database Security Rules

```json
{
  "rules": {
    "reactions": {
      "$appId": {
        ".read": true,
        "counts": { ".read": true },
        "voters": { "$deviceId": { ".read": true, ".write": true } }
      }
    },
    "issues": { ".read": true, ".write": true, ".indexOn": ["deviceId"] }
  }
}
```

> ⚠️ **للإنتاج | For production:** شدّد قواعد الكتابة (تحقق من صحة المدخلات، حدّ من معدل الطلبات rate-limit). التصويت بمعرّف جهاز مجهول يعني أن مسح بيانات المتصفح يسمح بإعادة التصويت — مقبول للعرض التجريبي؛ التطبيقات الحقيقية يجب أن تضيف **Firebase Auth**.
>
> Tighten the write rules for production (validate input, rate-limit). Anonymous deviceId-based voting means clearing browser data allows a re-vote — acceptable for a demo; real apps should add **Firebase Auth**.

### نموذج البيانات في Firebase | Firebase Data Model

```
reactions/{appId}/counts/likes        : number
reactions/{appId}/counts/dislikes     : number
reactions/{appId}/voters/{deviceId}   : 'like' | 'dislike'
issues/{pushId}/                      : { id, name, email, appId, appName, message, status, date, reply, deviceId }
```

### بديل أبسط: Formspree | Simpler alternative: Formspree

لنموذج الإبلاغ فقط (نقطة نهاية POST بدون قراءة مرتجعة في الطبقة المجانية): ضع نقطة النهاية في `DB.CONFIG` (مثل `formspreeEndpoint: 'https://formspree.io/f/XXXX'`) واستبدل `addIssue` بطلب `fetch POST`. لا يدعم عرض البلاغات المرتجعة (my-issues) في الطبقة المجانية.

For the issue form only (POST endpoint, no read-back on the free tier): set an endpoint in `DB.CONFIG` (e.g. `formspreeEndpoint: 'https://formspree.io/f/XXXX'`) and swap `addIssue` to a `fetch POST`. Read-back (my-issues) is not supported on the free tier.

---

## ➕ كيفية إضافة تطبيق جديد | How to Add a New App

### الخطوة 1 | Step 1 — عدّل `data/apps.json`

أضف كائنًا جديدًا إلى مصفوفة `"apps"` بجميع الحقول التالية:

Add a new object to the `"apps"` array with all these fields:

```json
{
  "id": "hsa-new-app",
  "name": { "ar": "اسم التطبيق بالعربية", "en": "App Name in English" },
  "platform": "web",
  "size": "5 MB",
  "version": "1.0.0",
  "rating": 4.5,
  "downloads": 1000,
  "likes": 100,
  "dislikes": 2,
  "icon": "assets/icons/hsa-new-app.svg",
  "shortDescription": {
    "ar": "وصف قصير بالعربية",
    "en": "Short description in English"
  },
  "fullDescription": {
    "ar": "وصف تفصيلي كامل بالعربية...",
    "en": "Full detailed description in English..."
  },
  "features": {
    "ar": ["ميزة أولى", "ميزة ثانية"],
    "en": ["First feature", "Second feature"]
  },
  "screenshots": [
    "assets/images/shots/hsa-new-app-1.svg",
    "assets/images/shots/hsa-new-app-2.svg",
    "assets/images/shots/hsa-new-app-3.svg"
  ],
  "downloadUrl": "#",
  "featured": false,
  "dateAdded": "2026-10-05"
}
```

> **حقول إلزامية | Required fields:** `id` (فريد | unique)، `name.ar/en`، `platform` (`web` | `desktop` | `android`)، `size`، `version`، `rating` (0–5)، `downloads`، `likes`، `dislikes`، `icon`، `shortDescription.ar/en`، `fullDescription.ar/en`، `features.ar[]/en[]`، `screenshots[]`، `downloadUrl`، `featured` (boolean)، `dateAdded` (YYYY-MM-DD).

### الخطوة 2 | Step 2 — حافظ على المزامنة

أضف **نفس الكائن** إلى `js/apps-fallback.js` (مصفوفة `APPS_FALLBACK`) حتى يعمل الموقع عبر `file://`. حافظ على مزامنة النسختين دائمًا.

Add the **same object** to `js/apps-fallback.js` (the `APPS_FALLBACK` array) so the site keeps working over `file://`. Keep both copies in sync.

### الخطوة 3 | Step 3 — الأصول | Assets

أضف 3 لقطات شاشة SVG إلى `assets/images/shots/` وأيقونة SVG إلى `assets/icons/` (بأسماء مطابقة لما في الكائن).

Add 3 screenshot SVGs to `assets/images/shots/` and an icon SVG to `assets/icons/` (matching the paths in the object).

---

## 🌐 كيف يعمل النظام ثنائي اللغة | How the Bilingual System Works

- جميع نصوص الواجهة مخزّنة في `js/translations.js` داخل الكائن `TRANSLATIONS` بمفتاحين: `ar` و`en`.
- تُطبَّق الترجمات على عناصر الصفحة عبر سمات `data-i18n` (نص العنصر)، `data-i18n-placeholder` (نص الإدخال)، `data-i18n-aria` (تسمية الوصول)، و`data-i18n-title` (تلميح العنوان).
- `LanguageManager` (في `js/language.js`) يقرأ اللغة المحفوظة، ويحدّث `lang` و`dir` على العنصر الجذري، ويُطلق حدث `languagechange` لإعادة عرض المحتوى الديناميكي.
- العناصر النائبة `{n}` و`{year}` تُستبدل أثناء التشغيل.
- اللغة الافتراضية هي **العربية** (`ar`).

- All UI strings live in `js/translations.js` inside the `TRANSLATIONS` object with two keys: `ar` and `en`.
- Translations are applied via `data-i18n` (element text), `data-i18n-placeholder` (input placeholder), `data-i18n-aria` (aria-label), and `data-i18n-title` (tooltip).
- `LanguageManager` (in `js/language.js`) reads the stored language, updates `lang`/`dir` on the root element, and dispatches a `languagechange` event to re-render dynamic content.
- Placeholders `{n}` and `{year}` are replaced at runtime.
- The default language is **Arabic** (`ar`).

---

## 🎨 كيف تعمل السمة | How the Theme Works

- جميع الألوان والمقاسات مُعرَّفة كمتغيرات CSS في `css/themes.css` (`:root` للسمة الفاتحة و`[data-theme="dark"]` للداكنة).
- تُطبَّق السمة عبر السمة `data-theme` على العنصر الجذري `<html>`، لذا تتكيف كل المكونات تلقائيًا.
- `ThemeManager` (في `js/theme.js`) يقرأ السمة المحفوظة (وإلا يُحترم تفضيل النظام `prefers-color-scheme`)، ويحدّث `data-theme` ولون `meta[name="theme-color"]`.
- **منع الوميض:** سكربت inline صغير في `<head>` يضبط `data-theme` قبل تحميل CSS لمنع وميض السمة قبل أول رسم.

- All colors and sizing are defined as CSS variables in `css/themes.css` (`:root` for light, `[data-theme="dark"]` for dark).
- The theme is applied via the `data-theme` attribute on the root `<html>` element, so every component adapts automatically.
- `ThemeManager` (in `js/theme.js`) reads the stored theme (else respects `prefers-color-scheme`), and updates `data-theme` and `meta[name="theme-color"]`.
- **Zero flash:** a tiny inline script in `<head>` sets `data-theme` before CSS loads to prevent a theme flash before first paint.

---

## 💾 مفاتيح LocalStorage | LocalStorage Keys

| المفتاح | الوصف | النوع |
|---|---|---|
| `hsa-lang` | اللغة المختارة (`ar` \| `en`) | string |
| `hsa-theme` | السمة المختارة (`light` \| `dark`) | string |
| `hsa-device-id` | معرّف الجهاز المجهول للتصويت وإسناد البلاغات (تستخدمه `js/db.js` في Firebase) | string |
| `hsa-reactions` | أصوات الزائر لكل تطبيق `{ "appId": "like" \| "dislike" }` | JSON object |
| `hsa-issues` | البلاغات المرسلة من هذا الجهاز | JSON array |

| Key | Description | Type |
|---|---|---|
| `hsa-lang` | Selected language (`ar` \| `en`) | string |
| `hsa-theme` | Selected theme (`light` \| `dark`) | string |
| `hsa-device-id` | Anonymous device id for voting & issue attribution (used by `js/db.js` with Firebase) | string |
| `hsa-reactions` | Visitor's votes per app `{ "appId": "like" \| "dislike" }` | JSON object |
| `hsa-issues` | Reports submitted from this device | JSON array |

---

## 🏭 ملاحظات الإنتاج | Production Notes

- **ردود الفعل والبلاغات تعمل عبر طبقة تجريد `DB`** (`js/db.js`) — الوضع الافتراضي محلي (LocalStorage) ويعمل على جهاز واحد، ويمكن التبديل إلى Firebase Realtime Database لوضع الإنتاج متعدد المستخدمين (راجع قسم "الربط بقاعدة بيانات خارجية" أعلاه).
- **Reactions & issues go through the `DB` abstraction layer** (`js/db.js`) — local (LocalStorage) by default, working on a single device, switchable to Firebase Realtime Database for multi-user production (see "External Database Connection" above).
- بدائل أخرى للنموذج/البيانات:
- Other form/data alternatives:
  - **Google Sheets API** (جدول بيانات كقاعدة خلفية | spreadsheet as backend)
  - **Formspree** (نماذج بدون خادم | serverless forms)
  - **EmailJS** (إرسال بريد من المتصفح | browser email sending)
- الكود مُقسَّم وحداتيًا، لذا استبدال الخلفية معزول في `js/db.js` فقط:
- The code is modular, so backend replacement is isolated in `js/db.js` only:
  - `DB.getReactionCounts(app)` / `DB.setReaction(appId, type)` — ردود الفعل | reactions
  - `DB.getMyIssues()` / `DB.addIssue(issue)` — البلاغات | issues

---

## 🔤 الخطوط | Fonts

- خط **Cairo** مستضاف ذاتيًا عبر `@font-face` في `css/themes.css` (الأوزان 400 / 600 / 700 / 900).
- ضع ملفات `Cairo-{Regular,SemiBold,Bold,Black}.woff2` (واختياريًا `.woff`) في مجلد `assets/fonts/`.
- راجع `assets/fonts/README.txt` للتفاصيل — الترخيص **SIL OFL 1.1**.

- The **Cairo** font is self-hosted via `@font-face` in `css/themes.css` (weights 400 / 600 / 700 / 900).
- Place `Cairo-{Regular,SemiBold,Bold,Black}.woff2` (and optionally `.woff`) files in the `assets/fonts/` folder.
- See `assets/fonts/README.txt` for details — licensed under **SIL OFL 1.1**.

---

## ⚖️ الترخيص | License

- خط **Cairo** © Cairo Font Project — ترخيص **SIL Open Font License 1.1**.
- جميع ملفات المشروع الأخرى (HTML, CSS, JS, JSON, XML, الصور SVG) — ترخيص **MIT**.

- The **Cairo** font © Cairo Font Project — licensed under the **SIL Open Font License 1.1**.
- All other project files (HTML, CSS, JS, JSON, XML, SVG images) — licensed under **MIT**.

---

<p align="center">صُنع بـ ❤️ بواسطة <strong>Eng. Hesham Soliman Aid</strong> — HSA Come</p>
