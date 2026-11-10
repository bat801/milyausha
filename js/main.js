/**
 * main.js — UI logic for the portfolio.
 *
 * The module is deliberately dependency-free. It handles:
 * - language switcher rendering
 * - fetching and rendering the document gallery
 * - category filtering
 * - the document lightbox, download and print actions
 * - the contact modal and contact links
 * - mobile navigation, active section highlighting and reveal animations
 */

import {
  initI18n,
  setLanguage,
  getLanguage,
  getLocaleLabel,
  onLanguageChange,
  t,
  localize
} from './i18n.js';

/* --------------------------------------------------------------------------
   Configuration — edit this block when links or content change.
   -------------------------------------------------------------------------- */
const CONFIG = {
  defaultLanguage: 'ru',
  documentsUrl: 'data/documents.json',

  /**
   * Languages shown in the public switcher.
   * Serbian is intentionally hidden: the translation exists in
   * locales/sr.json and the i18n layer supports it, but it is not exposed
   * in the UI until the Serbian version is ready.
   */
  availableLanguages: [
    'ru',
    'en',
    'ba',
    'de'
    // 'sr',
  ],

  /**
   * Contact links. Email and WhatsApp are taken from the resume.
   * MAX has no public phone-number deep link, so the link opens MAX
   * while the contact card shows the same phone number as WhatsApp.
   */
  contacts: [
    {
      id: 'email',
      href: 'mailto:amirken@mail.ru',
      icon: 'icon-mail',
      external: false
    },
    {
      id: 'telegram',
      href: 'https://t.me/+79279632494',
      icon: 'icon-telegram',
      external: true
    },
    {
      id: 'whatsapp',
      href: 'https://wa.me/79279632494',
      icon: 'icon-whatsapp',
      external: true
    },
    {
      id: 'max',
      href: 'https://max.ru/',
      icon: 'icon-max',
      external: true
    },
    {
      id: 'vk',
      href: 'https://vk.ru/id68968635',
      icon: 'icon-vk',
      external: true
    }
  ],

  categories: ['all', 'certificates', 'diplomas', 'courses', 'publications']
};

const FALLBACK_PREVIEW = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="720" height="540" viewBox="0 0 720 540">' +
  '<rect width="720" height="540" fill="#F3F4F6"/>' +
  '<rect x="270" y="190" width="180" height="160" rx="10" fill="none" stroke="#1A365D" stroke-width="6"/>' +
  '<path d="M300 230h120M300 270h120M300 310h80" fill="none" stroke="#1A365D" stroke-width="6" stroke-linecap="round"/>' +
  '</svg>'
)}`;

const state = {
  documents: [],
  activeCategory: 'all',
  currentDocument: null,
  isLoading: true,
  error: null,
  lastFocusedElement: null,
  toastTimer: null
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const els = {
  header: $('#site-header'),
  nav: $('#primary-nav'),
  menuToggle: $('#menu-toggle'),
  languageSwitchers: $$('[data-language-switcher]'),
  filters: $('#document-filters'),
  gallery: $('#document-gallery'),
  galleryCount: $('#gallery-count'),
  galleryEmpty: $('#gallery-empty'),
  galleryReset: $('#gallery-reset'),
  contactLinks: $('#contact-links'),
  contactModalLinks: $('#contact-modal-links'),
  contactModal: $('#contact-modal'),
  documentModal: $('#document-modal'),
  documentTitle: $('#document-modal-title'),
  documentCategory: $('#document-modal-category'),
  documentYear: $('#document-modal-year'),
  documentStatus: $('#document-status'),
  documentMedia: $('#document-media'),
  documentHint: $('#document-hint'),
  documentDownload: $('#document-download'),
  documentOpenNew: $('#document-open-new'),
  documentPrint: $('#document-print'),
  toast: $('#toast'),
  toastMessage: $('#toast-message')
};

/* --------------------------------------------------------------------------
   Small utilities
   -------------------------------------------------------------------------- */
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    const entities = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    };
    return entities[character];
  });
}

function isPdf(file) {
  return /\.pdf(?:[?#]|$)/i.test(file);
}

function getFileName(file) {
  return file.split('/').pop().split(/[?#]/)[0];
}

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function showToast(message) {
  if (!els.toast || !els.toastMessage) {
    return;
  }

  els.toastMessage.textContent = message;
  els.toast.hidden = false;
  window.clearTimeout(state.toastTimer);
  state.toastTimer = window.setTimeout(() => {
    els.toast.hidden = true;
  }, 5200);
}

function getLocalizedCategory(category) {
  return t(`categories.${category}`, category);
}

/* --------------------------------------------------------------------------
   Language switcher
   -------------------------------------------------------------------------- */
function renderLanguageSwitchers() {
  els.languageSwitchers.forEach((container) => {
    container.innerHTML = '';

    CONFIG.availableLanguages.forEach((language) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'lang-switch__btn';
      button.dataset.language = language;
      button.textContent = language.toUpperCase();
      button.setAttribute('aria-label', `${language.toUpperCase()} — ${getLocaleLabel(language)}`);
      button.setAttribute('title', getLocaleLabel(language));
      button.setAttribute('aria-pressed', String(language === getLanguage()));
      button.addEventListener('click', () => handleLanguageSwitch(language));
      container.appendChild(button);
    });
  });
}

function updateLanguageSwitchers() {
  $$('.lang-switch__btn').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.language === getLanguage()));
  });
}

async function handleLanguageSwitch(language) {
  if (language === getLanguage()) {
    return;
  }

  const buttons = $$('.lang-switch__btn');
  buttons.forEach((button) => {
    button.disabled = true;
  });

  try {
    await setLanguage(language);
  } catch (error) {
    console.error('[main] Could not switch language.', error);
  } finally {
    buttons.forEach((button) => {
      button.disabled = false;
    });
    updateLanguageSwitchers();
  }
}

/* --------------------------------------------------------------------------
   Documents: loading, filtering and cards
   -------------------------------------------------------------------------- */
async function loadDocuments() {
  els.gallery.setAttribute('aria-busy', 'true');

  try {
    const response = await fetch(CONFIG.documentsUrl, { cache: 'no-cache' });
    if (!response.ok) {
      throw new Error(`Documents request failed with HTTP ${response.status}.`);
    }

    const data = await response.json();
    if (!Array.isArray(data)) {
      throw new Error('Documents data must be an array.');
    }

    state.documents = data.filter((document) => {
      return document && document.id !== undefined && document.file && document.category;
    });
    state.error = null;
  } catch (error) {
    console.error('[main] Could not load documents.', error);
    state.documents = [];
    state.error = error;
  } finally {
    state.isLoading = false;
    els.gallery.setAttribute('aria-busy', 'false');
  }
}

function getCategoryCounts() {
  const counts = { all: state.documents.length };
  CONFIG.categories.forEach((category) => {
    if (category !== 'all') {
      counts[category] = 0;
    }
  });

  state.documents.forEach((document) => {
    counts[document.category] = (counts[document.category] || 0) + 1;
  });

  return counts;
}

function updateFilterButtons() {
  if (!els.filters) {
    return;
  }

  $$('.filter-btn', els.filters).forEach((button) => {
    button.setAttribute('aria-pressed', String(state.activeCategory === button.dataset.category));
  });
}

function renderFilters() {
  if (!els.filters) {
    return;
  }

  const counts = getCategoryCounts();
  els.filters.innerHTML = '';

  CONFIG.categories.forEach((category) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'filter-btn';
    button.dataset.category = category;
    button.setAttribute('aria-pressed', String(state.activeCategory === category));

    const label = document.createElement('span');
    label.textContent = getLocalizedCategory(category);

    const count = document.createElement('span');
    count.className = 'filter-btn__count';
    count.textContent = String(counts[category] || 0);

    button.append(label, count);
    button.addEventListener('click', () => {
      state.activeCategory = category;
      // Update in place so the clicked button keeps keyboard focus.
      updateFilterButtons();
      renderGallery();
    });

    els.filters.appendChild(button);
  });
}

function getFilteredDocuments() {
  if (state.activeCategory === 'all') {
    return state.documents;
  }
  return state.documents.filter((document) => document.category === state.activeCategory);
}

function createDocumentCard(doc) {
  const title = localize(doc.title) || `Document ${doc.id}`;
  const category = getLocalizedCategory(doc.category);

  const card = document.createElement('article');
  card.className = 'doc-card';

  // Preview link. It is decorative for keyboard users because the title link
  // below is the accessible, focusable target; without JavaScript both links
  // simply open the original file.
  const media = document.createElement('a');
  media.className = 'doc-card__media';
  media.href = doc.file;
  media.setAttribute('data-document-link', String(doc.id));
  media.setAttribute('aria-hidden', 'true');
  media.tabIndex = -1;

  const image = document.createElement('img');
  image.src = doc.preview || doc.file;
  image.alt = '';
  image.width = 720;
  image.height = 540;
  image.loading = 'lazy';
  image.decoding = 'async';

  let imageFallbackStage = 0;
  image.addEventListener('error', () => {
    if (imageFallbackStage === 0 && doc.preview && doc.preview !== doc.file) {
      imageFallbackStage = 1;
      image.src = doc.file;
      return;
    }
    imageFallbackStage = 2;
    image.src = FALLBACK_PREVIEW;
    image.classList.add('doc-card__img--fallback');
  });

  media.appendChild(image);

  const body = document.createElement('div');
  body.className = 'doc-card__body';

  const categoryLabel = document.createElement('span');
  categoryLabel.className = 'doc-card__category';
  categoryLabel.textContent = category;

  const heading = document.createElement('h3');
  heading.className = 'doc-card__title';

  const titleLink = document.createElement('a');
  titleLink.href = doc.file;
  titleLink.textContent = title;
  titleLink.setAttribute('data-document-link', String(doc.id));
  titleLink.setAttribute('aria-label', `${title} — ${category}, ${doc.year}`);
  heading.appendChild(titleLink);

  const year = document.createElement('span');
  year.className = 'doc-card__year';
  year.textContent = doc.year;

  body.append(categoryLabel, heading, year);

  const arrow = document.createElement('span');
  arrow.className = 'doc-card__arrow';
  arrow.setAttribute('aria-hidden', 'true');
  arrow.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#icon-arrow-up-right"></use></svg>';

  card.append(media, body, arrow);
  return card;
}

function showGalleryEmpty(isError = false) {
  if (!els.galleryEmpty) {
    return;
  }

  const title = $('h3', els.galleryEmpty);
  const text = $('p', els.galleryEmpty);

  if (isError) {
    title.textContent = t('document.error', 'Не удалось загрузить документ. Откройте его в новой вкладке.');
    text.textContent = t('achievements.emptyText', 'Выберите другую категорию или вернитесь ко всем достижениям.');
    els.galleryReset.hidden = true;
  } else {
    title.textContent = t('achievements.emptyTitle', 'В этой категории пока нет документов');
    text.textContent = t('achievements.emptyText', 'Выберите другую категорию или вернитесь ко всем достижениям.');
    els.galleryReset.hidden = false;
  }

  els.galleryEmpty.hidden = false;
}

function hideGalleryEmpty() {
  if (els.galleryEmpty) {
    els.galleryEmpty.hidden = true;
  }
}

function renderGallery() {
  if (!els.gallery) {
    return;
  }

  const documents = getFilteredDocuments();
  els.gallery.innerHTML = '';

  if (els.galleryCount) {
    els.galleryCount.textContent = String(documents.length);
  }

  if (state.isLoading) {
    return;
  }

  if (state.error) {
    showGalleryEmpty(true);
    return;
  }

  if (!documents.length) {
    showGalleryEmpty(false);
    return;
  }

  hideGalleryEmpty();
  documents.forEach((document) => {
    els.gallery.appendChild(createDocumentCard(document));
  });
}

/* --------------------------------------------------------------------------
   Document lightbox
   -------------------------------------------------------------------------- */
function openDialog(dialog) {
  if (!dialog) {
    return;
  }

  if (typeof dialog.showModal === 'function') {
    dialog.showModal();
  } else {
    dialog.setAttribute('open', '');
  }

  document.body.classList.add('modal-open');
}

function finalizeDialogClose(dialog) {
  if (!dialog) {
    return;
  }

  const doc = dialog.ownerDocument;
  const hasOpenDialog = Boolean(doc.querySelector('dialog[open]'));

  if (!hasOpenDialog) {
    doc.body.classList.remove('modal-open');
  }

  if (dialog === els.documentModal) {
    state.currentDocument = null;
    if (els.documentMedia) {
      els.documentMedia.innerHTML = '';
    }
    if (els.documentHint) {
      els.documentHint.hidden = true;
    }
  }

  if (!hasOpenDialog) {
    if (state.lastFocusedElement && typeof state.lastFocusedElement.focus === 'function') {
      const target = state.lastFocusedElement;
      if (doc.contains(target)) {
        target.focus();
      }
    }
    state.lastFocusedElement = null;
  }
}

function closeDialog(dialog) {
  if (!dialog) {
    return;
  }

  if (typeof dialog.close === 'function' && dialog.open) {
    dialog.close();
  } else {
    dialog.removeAttribute('open');
  }

  // The native `close` event is asynchronous (and can be delayed in a
  // background tab), so unlock the page immediately instead of waiting.
  finalizeDialogClose(dialog);
}

function openDocument(doc, trigger) {
  if (!els.documentModal) {
    return;
  }

  state.currentDocument = doc;
  state.lastFocusedElement = trigger || document.activeElement;

  const title = localize(doc.title) || `Document ${doc.id}`;
  const category = getLocalizedCategory(doc.category);

  els.documentTitle.textContent = title;
  els.documentCategory.textContent = category;
  els.documentYear.textContent = doc.year || '';
  els.documentStatus.hidden = false;
  els.documentMedia.innerHTML = '';
  els.documentHint.hidden = true;
  els.documentHint.textContent = '';

  els.documentDownload.href = doc.file;
  els.documentDownload.setAttribute('download', getFileName(doc.file));
  els.documentOpenNew.href = doc.file;

  if (isPdf(doc.file)) {
    const iframe = document.createElement('iframe');
    iframe.src = `${doc.file}#toolbar=1&navpanes=0&view=FitH`;
    iframe.title = title;
    iframe.loading = 'eager';
    iframe.addEventListener('load', () => {
      els.documentStatus.hidden = true;
    });
    els.documentMedia.appendChild(iframe);

    els.documentHint.textContent = t('document.pdfHint');
    els.documentHint.hidden = false;

    // Some browser PDF viewers do not fire a useful load event.
    window.setTimeout(() => {
      if (state.currentDocument === doc) {
        els.documentStatus.hidden = true;
      }
    }, 2600);
  } else {
    const image = document.createElement('img');
    image.src = doc.file;
    image.alt = title;
    image.decoding = 'async';
    image.addEventListener('load', () => {
      els.documentStatus.hidden = true;
    });
    image.addEventListener('error', () => {
      els.documentStatus.hidden = true;
      els.documentHint.textContent = t('document.error');
      els.documentHint.hidden = false;
    });
    els.documentMedia.appendChild(image);
  }

  openDialog(els.documentModal);
}

function openContactModal(trigger) {
  if (!els.contactModal) {
    return;
  }

  const mobileNavWasOpen = els.nav && els.nav.classList.contains('is-open');
  if (mobileNavWasOpen) {
    closeMobileNav();
  }

  state.lastFocusedElement = mobileNavWasOpen ? els.menuToggle : (trigger || document.activeElement);
  openDialog(els.contactModal);
}

/* --------------------------------------------------------------------------
   Print helpers
   -------------------------------------------------------------------------- */
function openPrintFallback(fileUrl) {
  // Do not pass "noopener" as a window feature here: browsers then always
  // return null, which would look like a blocked pop-up. Detach the opener
  // after opening instead.
  const printWindow = window.open(fileUrl, '_blank');
  if (!printWindow) {
    showToast(t('document.printBlocked', 'Браузер заблокировал окно печати. Разрешите всплывающие окна и попробуйте снова.'));
    return;
  }

  try {
    printWindow.opener = null;
  } catch (error) {
    // Cross-origin windows may not allow this; the tab is already open.
  }

  showToast(t('document.printFallback', 'Если печать не началась автоматически, используйте кнопку печати в открывшемся PDF-файле.'));
}

/**
 * PDF printing: load the PDF into a hidden iframe and call print() on its
 * content window. This prints only the document, never the page itself.
 */
function printPdf(fileUrl) {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
  frame.src = fileUrl;

  let printAttempted = false;

  frame.addEventListener('load', () => {
    window.setTimeout(() => {
      printAttempted = true;
      try {
        frame.contentWindow.focus();
        frame.contentWindow.print();
      } catch (error) {
        console.warn('[main] PDF print failed, opening a new tab.', error);
        openPrintFallback(fileUrl);
      }
    }, 650);
  });

  document.body.appendChild(frame);

  // If the PDF viewer never fires load, offer the reliable fallback.
  window.setTimeout(() => {
    if (!printAttempted) {
      openPrintFallback(fileUrl);
    }
  }, 7000);

  window.setTimeout(() => frame.remove(), 60000);
}

/**
 * Image printing: open a clean window with only the image and trigger print.
 * The window is opened synchronously from the click handler to avoid popup
 * blockers.
 */
function printImage(fileUrl, title) {
  const printWindow = window.open('', '_blank', 'width=960,height=1040');
  if (!printWindow) {
    showToast(t('document.printBlocked', 'Браузер заблокировал окно печати. Разрешите всплывающие окна и попробуйте снова.'));
    return;
  }

  const absoluteUrl = new URL(fileUrl, window.location.href).href;
  const safeTitle = escapeHtml(title);
  const safeUrl = escapeHtml(absoluteUrl);

  printWindow.document.open();
  printWindow.document.write(
    '<!doctype html><html><head><meta charset="utf-8">' +
    `<title>${safeTitle}</title>` +
    '<style>' +
    '@page{margin:12mm}' +
    'html,body{margin:0;min-height:100%;background:#fff}' +
    'body{display:flex;align-items:center;justify-content:center}' +
    'img{display:block;max-width:100%;max-height:calc(100vh - 24mm);object-fit:contain}' +
    '@media print{body{display:block}img{width:100%;max-height:none}}' +
    '</style></head><body>' +
    `<img src="${safeUrl}" alt="${safeTitle}">` +
    '</body></html>'
  );
  printWindow.document.close();

  const image = printWindow.document.querySelector('img');
  const triggerPrint = () => {
    window.setTimeout(() => {
      try {
        printWindow.focus();
        printWindow.print();
      } catch (error) {
        console.warn('[main] Image print failed.', error);
        showToast(t('document.printFallback', 'Если печать не началась автоматически, используйте кнопку печати в открывшемся PDF-файле.'));
      }
    }, 250);
  };

  if (image.complete) {
    triggerPrint();
  } else {
    image.addEventListener('load', triggerPrint, { once: true });
  }

  image.addEventListener('error', () => {
    printWindow.close();
    showToast(t('document.error', 'Не удалось загрузить документ. Откройте его в новой вкладке.'));
  }, { once: true });

  printWindow.addEventListener('afterprint', () => {
    printWindow.close();
  }, { once: true });
}

function printCurrentDocument() {
  const doc = state.currentDocument;
  if (!doc) {
    return;
  }

  const title = localize(doc.title) || `Document ${doc.id}`;
  if (isPdf(doc.file)) {
    printPdf(doc.file);
  } else {
    printImage(doc.file, title);
  }
}

/* --------------------------------------------------------------------------
   Contact links
   -------------------------------------------------------------------------- */
function createContactLink(contact) {
  const label = t(`contact.label.${contact.id}`, contact.id.toUpperCase());
  const hint = t(`contact.hint.${contact.id}`, contact.href.replace(/^mailto:/, ''));
  const externalNote = contact.external ? `. ${t('a11y.external', 'Открывается в новой вкладке')}` : '';

  const link = document.createElement('a');
  link.className = 'contact-card';
  link.href = contact.href;
  link.setAttribute('aria-label', `${label} — ${hint}${externalNote}`);

  if (contact.external) {
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  }

  const icon = document.createElement('span');
  icon.className = 'contact-card__icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = `<svg class="icon" aria-hidden="true"><use href="#${contact.icon}"></use></svg>`;

  const body = document.createElement('span');
  body.className = 'contact-card__body';

  const labelElement = document.createElement('span');
  labelElement.className = 'contact-card__label';
  labelElement.textContent = label;

  const hintElement = document.createElement('span');
  hintElement.className = 'contact-card__hint';
  hintElement.textContent = hint;

  body.append(labelElement, hintElement);

  const arrow = document.createElement('span');
  arrow.className = 'contact-card__arrow';
  arrow.setAttribute('aria-hidden', 'true');
  arrow.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#icon-arrow-up-right"></use></svg>';

  link.append(icon, body, arrow);
  return link;
}

function renderContacts() {
  [els.contactLinks, els.contactModalLinks].forEach((container) => {
    if (!container) {
      return;
    }

    container.innerHTML = '';
    CONFIG.contacts.forEach((contact) => {
      container.appendChild(createContactLink(contact));
    });
  });
}

/* --------------------------------------------------------------------------
   Mobile navigation
   -------------------------------------------------------------------------- */
function setMenuToggleLabel(isOpen) {
  if (!els.menuToggle) {
    return;
  }

  const key = isOpen ? 'a11y.closeMenu' : 'a11y.openMenu';
  const fallback = isOpen ? 'Закрыть меню' : 'Открыть меню';
  els.menuToggle.setAttribute('data-i18n-aria-label', key);
  els.menuToggle.setAttribute('aria-label', t(key, fallback));
}

function closeMobileNav() {
  if (!els.nav || !els.nav.classList.contains('is-open')) {
    return;
  }

  els.nav.classList.remove('is-open');
  if (els.menuToggle) {
    els.menuToggle.setAttribute('aria-expanded', 'false');
  }
  setMenuToggleLabel(false);
  document.body.classList.remove('nav-open');
}

function initNavigation() {
  if (!els.nav || !els.menuToggle) {
    return;
  }

  els.menuToggle.addEventListener('click', () => {
    const isOpen = els.nav.classList.toggle('is-open');
    els.menuToggle.setAttribute('aria-expanded', String(isOpen));
    setMenuToggleLabel(isOpen);
    document.body.classList.toggle('nav-open', isOpen);
  });

  $$('#primary-nav a').forEach((link) => {
    link.addEventListener('click', closeMobileNav);
  });

  document.addEventListener('click', (event) => {
    if (!els.nav.classList.contains('is-open')) {
      return;
    }
    if (els.nav.contains(event.target) || els.menuToggle.contains(event.target)) {
      return;
    }
    closeMobileNav();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeMobileNav();
    }
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth >= 900) {
      closeMobileNav();
    }
  });
}

function initHeaderScroll() {
  if (!els.header) {
    return;
  }

  const update = () => {
    els.header.classList.toggle('is-scrolled', window.scrollY > 8);
  };

  update();
  window.addEventListener('scroll', update, { passive: true });
}

/* --------------------------------------------------------------------------
   Active section highlighting and reveal animations
   -------------------------------------------------------------------------- */
function initActiveNavigation() {
  const links = $$('[data-nav-link]');
  const sections = links
    .map((link) => $(link.getAttribute('href')))
    .filter(Boolean);

  if (!sections.length || !('IntersectionObserver' in window)) {
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) {
        return;
      }

      links.forEach((link) => link.removeAttribute('aria-current'));
      const activeLink = links.find((link) => link.getAttribute('href') === `#${entry.target.id}`);
      if (activeLink) {
        activeLink.setAttribute('aria-current', 'page');
      }
    });
  }, {
    rootMargin: '-35% 0px -55% 0px',
    threshold: 0
  });

  sections.forEach((section) => observer.observe(section));
}

function initReveal() {
  const elements = $$('[data-reveal]');
  if (!elements.length) {
    return;
  }

  if (prefersReducedMotion() || !('IntersectionObserver' in window)) {
    elements.forEach((element) => element.classList.add('is-visible'));
    return;
  }

  const observer = new IntersectionObserver((entries, revealObserver) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) {
        return;
      }
      entry.target.classList.add('is-visible');
      revealObserver.unobserve(entry.target);
    });
  }, {
    threshold: 0.12,
    rootMargin: '0px 0px -40px 0px'
  });

  elements.forEach((element) => observer.observe(element));
}

/* --------------------------------------------------------------------------
   Dialogs and delegated events
   -------------------------------------------------------------------------- */
function initDialogs() {
  if (els.documentModal) {
    els.documentModal.addEventListener('click', (event) => {
      if (event.target === els.documentModal) {
        closeDialog(els.documentModal);
      }
    });

    els.documentModal.addEventListener('close', () => {
      finalizeDialogClose(els.documentModal);
    });

    els.documentModal.addEventListener('cancel', (event) => {
      event.preventDefault();
      closeDialog(els.documentModal);
    });
  }

  if (els.contactModal) {
    els.contactModal.addEventListener('click', (event) => {
      if (event.target === els.contactModal) {
        closeDialog(els.contactModal);
      }
    });

    els.contactModal.addEventListener('close', () => {
      finalizeDialogClose(els.contactModal);
    });

    els.contactModal.addEventListener('cancel', (event) => {
      event.preventDefault();
      closeDialog(els.contactModal);
    });
  }

  $$('[data-close-document]').forEach((button) => {
    button.addEventListener('click', () => closeDialog(els.documentModal));
  });

  $$('[data-close-contact]').forEach((button) => {
    button.addEventListener('click', () => closeDialog(els.contactModal));
  });

  $$('[data-open-contact]').forEach((button) => {
    button.addEventListener('click', () => openContactModal(button));
  });

  if (els.documentPrint) {
    els.documentPrint.addEventListener('click', printCurrentDocument);
  }

  if (els.gallery) {
    els.gallery.addEventListener('click', (event) => {
      const link = event.target.closest('[data-document-link]');
      if (!link) {
        return;
      }

      // Preserve normal browser behaviour for modified clicks (new tab, etc.).
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }

      const doc = state.documents.find((item) => String(item.id) === link.dataset.documentLink);
      if (!doc) {
        return;
      }

      event.preventDefault();
      openDocument(doc, link);
    });
  }

  if (els.galleryReset) {
    els.galleryReset.addEventListener('click', () => {
      state.activeCategory = 'all';
      renderFilters();
      renderGallery();

      // The reset button disappears together with the empty state, so move
      // keyboard focus to the newly active filter.
      const activeFilter = els.filters ? $('.filter-btn[aria-pressed="true"]', els.filters) : null;
      if (activeFilter) {
        activeFilter.focus();
      }
    });
  }
}

/* --------------------------------------------------------------------------
   Re-render dynamic content after a language change
   -------------------------------------------------------------------------- */
function renderDynamicContent() {
  updateLanguageSwitchers();
  renderFilters();
  renderGallery();
  renderContacts();

  if (state.currentDocument && els.documentModal && els.documentModal.open) {
    const title = localize(state.currentDocument.title);
    els.documentTitle.textContent = title;
    els.documentCategory.textContent = getLocalizedCategory(state.currentDocument.category);

    const mediaImage = $('#document-media img');
    if (mediaImage) {
      mediaImage.alt = title;
    }

    if (isPdf(state.currentDocument.file)) {
      els.documentHint.textContent = t('document.pdfHint');
    }
  }

  if (els.nav && els.nav.classList.contains('is-open')) {
    setMenuToggleLabel(true);
  }
}

/* --------------------------------------------------------------------------
   Initialisation
   -------------------------------------------------------------------------- */
async function init() {
  renderLanguageSwitchers();

  try {
    await initI18n({ defaultLanguage: CONFIG.defaultLanguage });
  } catch (error) {
    console.error('[main] Could not initialise translations.', error);
  }

  initNavigation();
  initHeaderScroll();
  initActiveNavigation();
  initDialogs();
  initReveal();

  await loadDocuments();
  renderDynamicContent();

  onLanguageChange(() => {
    renderDynamicContent();
  });

  // Lets the inline safety timeout in index.html know that the app started.
  window.__milyaushaReady = true;
}

init();
