const LANGUAGE_STORAGE_KEY = 'hsaNotesLanguage';
const DEFAULT_LANGUAGE = 'ar';
const SUPPORTED_LANGUAGES = new Set(['ar', 'en']);

const FALLBACK_DICTIONARY = {
  common: {
    appName: 'HSA Notes',
    language: 'اللغة',
    arabic: 'العربية',
    english: 'الإنجليزية',
    theme: 'المظهر',
    light: 'فاتح',
    dark: 'داكن',
    close: 'إغلاق',
    cancel: 'إلغاء',
    confirm: 'تأكيد',
    save: 'حفظ',
    delete: 'حذف',
    edit: 'تعديل',
    add: 'إضافة',
    search: 'بحث',
    loading: 'جارٍ التحميل…',
    copied: 'تم النسخ',
    copy: 'نسخ',
    show: 'إظهار',
    hide: 'إخفاء',
    retry: 'إعادة المحاولة',
    yes: 'نعم',
    no: 'لا',
    empty: 'لا توجد بيانات',
    back: 'رجوع'
  },
  splash: {
    loading: 'جارٍ تحضير مساحتك الآمنة…'
  },
  auth: {
    setupTitle: 'إنشاء كلمة المرور الرئيسية',
    setupDescription: 'أنشئ كلمة مرور رئيسية قوية لحماية بياناتك.',
    setupSubtitle: 'ابدأ بإنشاء كلمة مرور رئيسية قوية لحماية خزنتك.',
    loginTitle: 'تسجيل الدخول',
    loginDescription: 'أدخل كلمة المرور الرئيسية لفتح HSA Notes.',
    loginSubtitle: 'أدخل كلمة المرور الرئيسية للوصول إلى مساحتك.',
    password: 'كلمة المرور الرئيسية',
    masterPassword: 'كلمة المرور الرئيسية',
    confirmPassword: 'تأكيد كلمة المرور الرئيسية',
    passwordHint: 'استخدم 8 أحرف على الأقل ونوعين مختلفين من الأحرف.',
    strength: 'قوة كلمة المرور',
    passwordStrength: 'قوة كلمة المرور',
    strengthPending: 'بانتظار الإدخال',
    veryWeak: 'ضعيفة جدًا',
    weak: 'ضعيفة',
    fair: 'متوسطة',
    good: 'جيدة',
    strong: 'قوية',
    create: 'إنشاء كلمة المرور',
    createAndUnlock: 'إنشاء وفتح التطبيق',
    unlock: 'فتح التطبيق',
    firstTime: 'تستخدم التطبيق لأول مرة؟',
    createAccount: 'أنشئ كلمة مرور رئيسية',
    useExistingAccount: 'استخدم كلمة المرور الحالية',
    showPassword: 'إظهار كلمة المرور',
    hidePassword: 'إخفاء كلمة المرور',
    toggleMode: 'تبديل الوضع',
    passwordMismatch: 'كلمتا المرور غير متطابقتين',
    passwordWeak: 'كلمة المرور الرئيسية لا تستوفي متطلبات القوة',
    invalidPassword: 'كلمة المرور الرئيسية غير صحيحة',
    invalidCredentials: 'كلمة المرور غير صحيحة. حاول مرة أخرى.',
    passwordTooShort: 'استخدم 8 أحرف على الأقل.',
    tooManyAttempts: 'محاولات كثيرة. انتظر قليلاً قبل إعادة المحاولة.',
    secureStorageUnavailable: 'التخزين الآمن غير متاح في هذا المتصفح.',
    unexpectedError: 'حدث خطأ غير متوقع. حاول مرة أخرى.',
    vaultExists: 'يوجد خزنة بالفعل',
    vaultMissing: 'لا توجد خزنة محفوظة',
    locked: 'التطبيق مقفل',
    cryptoUnavailable: 'واجهة التشفير غير متاحة في هذا المتصفح',
    storageUnavailable: 'التخزين المحلي غير متاح',
    lockout: 'تم إيقاف المحاولات مؤقتًا. حاول لاحقًا.',
    operationFailed: 'تعذر إكمال العملية',
    success: 'تم فتح التطبيق',
    passwordCreated: 'تم إنشاء كلمة المرور الرئيسية.',
    loginSuccess: 'تم فتح مساحتك بأمان.'
  },
  app: {
    name: 'HSA Notes',
    title: 'HSA Notes',
    loadingSecureWorkspace: 'جارٍ تجهيز مساحتك الآمنة',
    dashboard: 'لوحة التحكم',
    apiKeys: 'مفاتيح API',
    credentials: 'بيانات الدخول',
    notes: 'الملاحظات',
    settings: 'الإعدادات',
    about: 'حول التطبيق',
    lock: 'قفل التطبيق',
    searchPlaceholder: 'ابحث في HSA Notes…',
    noResults: 'لا توجد نتائج'
  },
  actions: {
    addApiKey: 'إضافة مفتاح API',
    addCredential: 'إضافة بيانات دخول',
    addNote: 'إضافة ملاحظة',
    generatePassword: 'توليد كلمة مرور',
    sync: 'المزامنة',
    export: 'تصدير نسخة احتياطية',
    import: 'استيراد نسخة احتياطية',
    clearData: 'حذف كل البيانات'
  },
  strength: {
    veryWeak: 'ضعيفة جدًا',
    weak: 'ضعيفة',
    fair: 'متوسطة',
    good: 'جيدة',
    strong: 'قوية'
  },
  credentials: {
    passwordStrength: 'قوة كلمة المرور',
    weak: 'ضعيفة',
    fair: 'متوسطة',
    good: 'جيدة',
    strong: 'قوية',
    veryStrong: 'قوية جدًا'
  },
  generator: {
    veryWeak: 'ضعيفة جدًا'
  },
  toast: {
    success: 'تمت العملية بنجاح',
    error: 'حدث خطأ',
    warning: 'تنبيه',
    info: 'معلومة'
  }
};

const BUNDLED_DICTIONARIES = {
  ar: FALLBACK_DICTIONARY
};

let currentLanguage = readStoredLanguage();
let dictionaries = {
  ar: cloneDictionary(BUNDLED_DICTIONARIES.ar),
  en: {}
};
let initializationPromise;
let languageRequest = 0;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneDictionary(value) {
  if (Array.isArray(value)) {
    return value.map((item) => cloneDictionary(item));
  }
  if (!isObject(value)) {
    return value;
  }
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
      continue;
    }
    result[key] = cloneDictionary(item);
  }
  return result;
}

function readStoredLanguage() {
  try {
    const value = globalThis.localStorage?.getItem(LANGUAGE_STORAGE_KEY);
    return SUPPORTED_LANGUAGES.has(value) ? value : DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

function persistLanguage(language) {
  try {
    globalThis.localStorage?.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    return false;
  }
  return true;
}

function normalizeLanguage(language) {
  return SUPPORTED_LANGUAGES.has(language) ? language : DEFAULT_LANGUAGE;
}

function mergeDictionary(base, extra) {
  if (!isObject(extra)) {
    return base;
  }
  const result = isObject(base) ? { ...base } : {};
  for (const [key, value] of Object.entries(extra)) {
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
      continue;
    }
    if (isObject(value)) {
      result[key] = mergeDictionary(result[key], value);
    } else if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

async function fetchDictionary(language) {
  if (typeof globalThis.fetch !== 'function') {
    return null;
  }
  const path = `assets/lang/${language}.json`;
  try {
    const response = await globalThis.fetch(path, { cache: 'no-store' });
    if (!response || response.ok === false || typeof response.json !== 'function') {
      return null;
    }
    const value = await response.json();
    return isObject(value) ? value : null;
  } catch {
    return null;
  }
}

function lookup(dictionary, key) {
  if (!isObject(dictionary) || typeof key !== 'string' || key.length === 0) {
    return undefined;
  }
  if (Object.prototype.hasOwnProperty.call(dictionary, key)) {
    return dictionary[key];
  }
  let value = dictionary;
  for (const part of key.split('.')) {
    if (!isObject(value) || !Object.prototype.hasOwnProperty.call(value, part)) {
      return undefined;
    }
    value = value[part];
  }
  return value;
}

function interpolate(value, params) {
  if (typeof value !== 'string' || !isObject(params)) {
    return value;
  }
  return value.replace(/\{\{?([^{}]+)\}\}?/g, (match, name) => {
    const replacement = params[name.trim()];
    return replacement === undefined || replacement === null ? match : String(replacement);
  });
}

export function t(key, params) {
  if (typeof key !== 'string' || key.length === 0) {
    return '';
  }
  const value = lookup(dictionaries[currentLanguage], key) ?? lookup(dictionaries.ar, key) ?? lookup(FALLBACK_DICTIONARY, key);
  if (typeof value !== 'string') {
    return key;
  }
  return interpolate(value, params);
}

export function getLanguage() {
  return currentLanguage;
}

export function applyTranslations(root = globalThis.document) {
  const documentApi = root?.nodeType === 9 ? root : root?.ownerDocument || globalThis.document;
  if (!documentApi) {
    return currentLanguage;
  }
  const html = documentApi.documentElement;
  if (html) {
    html.lang = currentLanguage;
    html.dir = currentLanguage === 'ar' ? 'rtl' : 'ltr';
  }
  if (documentApi.body) {
    documentApi.body.dataset.locale = currentLanguage;
  }
  if (documentApi.title !== undefined && !documentApi.querySelector?.('title[data-i18n]')) {
    documentApi.title = t('app.title');
  }
  const description = documentApi.querySelector?.('#app-description');
  if (description) {
    description.setAttribute('content', t('app.tagline'));
  }
  const scope = root && typeof root.querySelectorAll === 'function' ? root : documentApi;
  const elements = [];
  if (root && root.nodeType === 1 && root.matches?.('[data-i18n], [data-i18n-placeholder], [data-i18n-title], [data-i18n-aria-label], [data-i18n-label], [data-label-i18n], [data-language-label]')) {
    elements.push(root);
  }
  if (typeof scope.querySelectorAll === 'function') {
    elements.push(...scope.querySelectorAll('[data-i18n], [data-i18n-placeholder], [data-i18n-title], [data-i18n-aria-label], [data-i18n-label], [data-label-i18n], [data-language-label]'));
  }
  for (const element of elements) {
    const textKey = element.getAttribute('data-i18n');
    if (textKey) {
      element.textContent = t(textKey);
    }
    const placeholderKey = element.getAttribute('data-i18n-placeholder');
    if (placeholderKey) {
      element.setAttribute('placeholder', t(placeholderKey));
    }
    const titleKey = element.getAttribute('data-i18n-title');
    if (titleKey) {
      element.setAttribute('title', t(titleKey));
    }
    const ariaKey = element.getAttribute('data-i18n-aria-label') || element.getAttribute('data-i18n-label') || element.getAttribute('data-label-i18n');
    if (ariaKey) {
      element.setAttribute('aria-label', t(ariaKey));
    }
    if (element.hasAttribute('data-language-label')) {
      element.textContent = t(currentLanguage === 'ar' ? 'common.arabic' : 'common.english');
    }
  }
  return currentLanguage;
}

export async function initI18n(language) {
  if (initializationPromise) {
    return initializationPromise;
  }
  const selected = normalizeLanguage(language || readStoredLanguage());
  currentLanguage = selected;
  const requestId = ++languageRequest;
  initializationPromise = (async () => {
    const [selectedData, fallbackData] = await Promise.all([
      fetchDictionary(selected),
      selected === 'ar' ? Promise.resolve(null) : fetchDictionary('ar')
    ]);
    if (requestId !== languageRequest) {
      return currentLanguage;
    }
    if (selectedData) {
      const bundled = selected === 'en' ? cloneDictionary(FALLBACK_DICTIONARY) : dictionaries[selected];
      dictionaries[selected] = mergeDictionary(bundled, selectedData);
    } else if (selected === 'en') {
      dictionaries.en = cloneDictionary(FALLBACK_DICTIONARY);
    }
    if (fallbackData) {
      dictionaries.ar = mergeDictionary(dictionaries.ar, fallbackData);
    }
    applyTranslations();
    return currentLanguage;
  })();
  try {
    return await initializationPromise;
  } catch (error) {
    initializationPromise = undefined;
    applyTranslations();
    return currentLanguage;
  }
}

export async function setLanguage(language) {
  const selected = normalizeLanguage(language);
  const requestId = ++languageRequest;
  currentLanguage = selected;
  persistLanguage(selected);
  applyTranslations();
  const loaded = await fetchDictionary(selected);
  if (requestId !== languageRequest) {
    return currentLanguage;
  }
  if (loaded) {
    const bundled = selected === 'en' ? cloneDictionary(FALLBACK_DICTIONARY) : dictionaries[selected];
    dictionaries[selected] = mergeDictionary(bundled, loaded);
    applyTranslations();
  } else if (selected === 'en') {
    dictionaries.en = cloneDictionary(FALLBACK_DICTIONARY);
    applyTranslations();
  }
  return currentLanguage;
}
