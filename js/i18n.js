/**
 * i18n.js — lightweight translation layer for the portfolio.
 *
 * Responsibilities:
 * - load JSON dictionaries from /locales/*.json
 * - remember the selected language in localStorage
 * - translate elements marked with data-i18n* attributes
 * - localise dynamic values such as document titles
 * - emit a `languagechange` event so the gallery can re-render
 *
 * Serbian is fully supported here. It is hidden from the UI by the
 * `availableLanguages` array in main.js, but can still be previewed with
 * `?lang=sr`.
 */

const SUPPORTED_LOCALES = ['ru', 'en', 'ba', 'de', 'sr'];
const DEFAULT_LOCALE = 'ru';
const STORAGE_KEY = 'milyausha:language';

const LOCALE_LABELS = {
  ru: 'Русский',
  en: 'English',
  ba: 'Башҡортса',
  de: 'Deutsch',
  sr: 'Српски'
};

const OG_LOCALES = {
  ru: 'ru_RU',
  en: 'en_US',
  ba: 'ba_RU',
  de: 'de_DE',
  sr: 'sr_RS'
};

const dictionaryCache = new Map();
let currentLanguage = DEFAULT_LOCALE;
let dictionary = {};
let initialized = false;

function isSupported(language) {
  return SUPPORTED_LOCALES.includes(language);
}

function readNestedValue(source, key) {
  return key.split('.').reduce((value, part) => {
    if (value && Object.prototype.hasOwnProperty.call(value, part)) {
      return value[part];
    }
    return undefined;
  }, source);
}

function resolveInitialLanguage(defaultLanguage = DEFAULT_LOCALE) {
  // A query parameter is intentionally supported for previewing a locale
  // (for example Serbian) without adding it to the public switcher.
  const queryLanguage = new URLSearchParams(window.location.search).get('lang');
  if (isSupported(queryLanguage)) {
    return queryLanguage;
  }

  try {
    const savedLanguage = window.localStorage.getItem(STORAGE_KEY);
    if (isSupported(savedLanguage)) {
      return savedLanguage;
    }
  } catch (error) {
    // localStorage can be unavailable in strict privacy modes.
    console.warn('[i18n] localStorage is unavailable.', error);
  }

  return isSupported(defaultLanguage) ? defaultLanguage : DEFAULT_LOCALE;
}

async function loadLocale(language) {
  if (dictionaryCache.has(language)) {
    return dictionaryCache.get(language);
  }

  const response = await fetch(`locales/${language}.json`, { cache: 'no-cache' });
  if (!response.ok) {
    throw new Error(`Could not load locale "${language}" (HTTP ${response.status}).`);
  }

  const data = await response.json();
  dictionaryCache.set(language, data);
  return data;
}

/**
 * Translate a dot-separated key. If the key is missing, the supplied fallback
 * is returned — this keeps the Russian HTML usable even before JSON arrives.
 */
export function t(key, fallback = '') {
  const value = readNestedValue(dictionary, key);
  if (value === undefined || value === null) {
    return fallback;
  }
  return String(value);
}

/**
 * Localise a value that may be a plain string or an object keyed by locale.
 * Used for document titles in data/documents.json.
 */
export function localize(value) {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'object') {
    return value[currentLanguage] || value[DEFAULT_LOCALE] || Object.values(value)[0] || '';
  }
  return String(value);
}

function applyTranslations(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((element) => {
    const key = element.getAttribute('data-i18n');
    const fallback = element.textContent ? element.textContent.trim() : '';
    const value = t(key, fallback);
    if (value) {
      element.textContent = value;
    }
  });

  const attributeBindings = [
    ['data-i18n-aria-label', 'aria-label'],
    ['data-i18n-title', 'title'],
    ['data-i18n-alt', 'alt'],
    ['data-i18n-placeholder', 'placeholder']
  ];

  attributeBindings.forEach(([dataAttribute, targetAttribute]) => {
    root.querySelectorAll(`[${dataAttribute}]`).forEach((element) => {
      const key = element.getAttribute(dataAttribute);
      const fallback = element.getAttribute(targetAttribute) || '';
      const value = t(key, fallback);
      if (value) {
        element.setAttribute(targetAttribute, value);
      }
    });
  });

  document.documentElement.lang = currentLanguage;
  document.title = t('meta.title', document.title);

  const description = document.querySelector('meta[name="description"]');
  if (description) {
    description.setAttribute('content', t('meta.description', description.getAttribute('content') || ''));
  }

  const ogTitle = document.querySelector('meta[property="og:title"]');
  if (ogTitle) {
    ogTitle.setAttribute('content', t('meta.title', ogTitle.getAttribute('content') || ''));
  }

  const ogDescription = document.querySelector('meta[property="og:description"]');
  if (ogDescription) {
    ogDescription.setAttribute('content', t('meta.description', ogDescription.getAttribute('content') || ''));
  }

  const ogLocale = document.querySelector('meta[property="og:locale"]');
  if (ogLocale) {
    ogLocale.setAttribute('content', OG_LOCALES[currentLanguage] || OG_LOCALES[DEFAULT_LOCALE]);
  }
}

export function getLanguage() {
  return currentLanguage;
}

export function getLocaleLabel(language) {
  return LOCALE_LABELS[language] || String(language).toUpperCase();
}

export function getSupportedLocales() {
  return [...SUPPORTED_LOCALES];
}

/**
 * Switch the whole page to a locale. Falls back to Russian if a dictionary
 * cannot be fetched, so the site never ends up in a half-translated state.
 */
export async function setLanguage(language, options = {}) {
  const { persist = true, silent = false } = options;
  const targetLanguage = isSupported(language) ? language : DEFAULT_LOCALE;

  let nextDictionary;
  try {
    nextDictionary = await loadLocale(targetLanguage);
  } catch (error) {
    if (targetLanguage !== DEFAULT_LOCALE) {
      console.warn(`[i18n] Falling back to "${DEFAULT_LOCALE}".`, error);
      return setLanguage(DEFAULT_LOCALE, options);
    }
    throw error;
  }

  currentLanguage = targetLanguage;
  dictionary = nextDictionary;

  if (persist) {
    try {
      window.localStorage.setItem(STORAGE_KEY, targetLanguage);
    } catch (error) {
      console.warn('[i18n] Could not save the language preference.', error);
    }
  }

  applyTranslations();

  if (!silent) {
    document.dispatchEvent(new CustomEvent('languagechange', {
      detail: { language: targetLanguage }
    }));
  }

  return targetLanguage;
}

export async function initI18n(options = {}) {
  if (initialized) {
    return currentLanguage;
  }

  const { defaultLanguage = DEFAULT_LOCALE } = options;
  const initialLanguage = resolveInitialLanguage(defaultLanguage);
  await setLanguage(initialLanguage, { persist: false, silent: true });
  initialized = true;
  return currentLanguage;
}

export function onLanguageChange(handler) {
  document.addEventListener('languagechange', handler);
  return () => document.removeEventListener('languagechange', handler);
}
