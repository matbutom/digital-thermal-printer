/* =====================================================
   DTP · Digital Thermal Printer — script.js
   ===================================================== */


/* === CONFIG === */

/**
 * All tuneable values in one place.
 * Button positions are expressed as the CENTER of each recess as a
 * percentage of the device-container dimensions, matching base@300x.png
 * (2534 × 2757 px native).
 *
 * CALIBRATION NOTE: if buttons look offset, adjust the `centerPct`
 * values here, then refresh. The CSS variables in style.css use the
 * same numbers — you can override them directly in DevTools too.
 */
const CONFIG = {

  /* Press-effect duration (ms) — matches --t-normal in CSS */
  pressDurationMs: 220,

  /* Print animation: tick count and speed */
  printLineCount:      22,
  printLineIntervalMs: 70,

  /* Pause between chain prints (ms) */
  chainIntervalMs: 1200,

  buttons: [
    {
      id:        'color',
      label:     'COLOR',
      /* Center of this recess in the base image (% of image W × H) */
      centerPct: { x: 32.5, y: 20 },
    },
    {
      id:        'print',
      label:     '* PRINT *',
      centerPct: { x: 81,   y: 20 },
    },
    {
      id:        'effects',
      label:     'EFFECTS',
      centerPct: { x: 13,   y: 39 },
    },
    {
      id:        'size',
      label:     'SIZE',
      centerPct: { x: 32.5, y: 50 },
    },
    {
      id:        'add',
      label:     'ADD',
      centerPct: { x: 13,   y: 66 },
    },
  ],

  menus: {
    color:   ['Warm', 'Cold', 'Faded', 'Sepia', 'B&W'],
    effects: ['Grain', 'Blur', 'Vignette', 'Overexposed', 'Scratches'],
    size:    ['Wallet', 'Square', 'Postcard', 'Full'],
    /* 'Upload Photo' is handled specially — see selectMenuOption() */
    add:     ['Upload Photo', 'Text', 'Sticker', 'Date Stamp', 'Frame'],
    print:   null, /* triggers animation rather than a menu */
  },

  /* CSS class applied to preview/result image per colour option */
  colorClasses: {
    Warm:        'thermal-warm',
    Cold:        'thermal-cold',
    Faded:       'thermal-faded',
    Sepia:       'thermal-sepia',
    'B&W':       'thermal-bw',
    _default:    'thermal',
  },

  /* CSS class applied to preview-wrap per effect option */
  effectClasses: {
    Grain:       'effect-grain',
    Blur:        'effect-blur',
    Vignette:    'effect-vignette',
    Overexposed: 'effect-overexposed',
    Scratches:   'effect-scratches',
  },
};


/* === STATE === */

const STATE = {
  /** Which button is currently active (shows its menu) — null = idle */
  activeBtn: null,

  /** Selected option per category */
  selections: {
    color:   null,
    effects: null,
    size:    null,
    add:     null,
  },

  /** Uploaded photos as data URLs (chain printing) */
  photos: [],

  /** Index of the photo currently being printed in a chain */
  photoIndex: 0,

  /** True while the print animation is running */
  isPrinting: false,

  /** Timer IDs for cleanup */
  _pressTimer: null,
  _printTimer: null,
  _fadeTimer:  null,
};


/* === DOM REFS === */
/* Populated by init() — avoids repeated querySelector calls */
const DOM = {
  deviceContainer: null,
  screenContent:   null,
  photoInput:      null,
};


/* === BUTTON HANDLERS === */

/**
 * Attach both `click` and `touchstart` to a button zone element.
 * touchstart fires earlier on iOS; we prevent the ghost click
 * with preventDefault when needed.
 */
function attachButtonListeners(btnEl) {
  const id = btnEl.dataset.btn;

  function handlePress(e) {
    if (STATE.isPrinting) return;
    if (e.type === 'touchstart') e.preventDefault();
    triggerButtonPress(btnEl, id);
  }

  btnEl.addEventListener('touchstart', handlePress, { passive: false });
  btnEl.addEventListener('click',      handlePress);

  /* Keyboard support */
  btnEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (!STATE.isPrinting) triggerButtonPress(btnEl, id);
    }
  });
}

/**
 * Applies the press animation, updates STATE, and renders
 * the appropriate screen content.
 */
function triggerButtonPress(btnEl, id) {
  applyPressEffect(btnEl);

  /* Toggle off if already active — return to idle */
  if (STATE.activeBtn === id) {
    STATE.activeBtn = null;
    deactivateAllButtons();
    renderIdle();
    return;
  }

  /* Mark new button as active */
  deactivateAllButtons();
  STATE.activeBtn = id;
  btnEl.classList.add('is-active');

  if (id === 'print') {
    renderPrintSequence();
  } else {
    renderMenu(id);
  }
}

/** Briefly adds the pressed class, removes after animation duration */
function applyPressEffect(btnEl) {
  btnEl.classList.add('is-pressed');
  clearTimeout(STATE._pressTimer);
  STATE._pressTimer = setTimeout(() => {
    btnEl.classList.remove('is-pressed');
  }, CONFIG.pressDurationMs);
}

/** Removes is-active from all buttons */
function deactivateAllButtons() {
  document.querySelectorAll('.btn-zone').forEach((el) => {
    el.classList.remove('is-active');
  });
}


/* === SCREEN RENDERER === */

/**
 * Fades out the current screen content, runs renderFn, then fades in.
 * Returns a Promise that resolves after the new content is visible.
 */
function transitionScreen(renderFn) {
  return new Promise((resolve) => {
    const content = DOM.screenContent;
    content.classList.add('is-fading');

    clearTimeout(STATE._fadeTimer);
    STATE._fadeTimer = setTimeout(() => {
      renderFn();
      content.classList.remove('is-fading');
      resolve();
    }, 180);
  });
}

/**
 * Render idle state — pure pixel-art text, no images on screen.
 * Shows photo count if photos have been loaded.
 */
function renderIdle() {
  transitionScreen(() => {
    DOM.screenContent.innerHTML = buildIdleHTML();
  });
}

function buildIdleHTML() {
  const n    = STATE.photos.length;
  const size = STATE.selections.size  || '--';
  const col  = STATE.selections.color || '--';

  const photoLine = n > 0
    ? `<div class="px-info">&#9632; ${n} PHOTO${n > 1 ? 'S' : ''}</div>`
    : `<div class="px-info">&#9633; NO PHOTO</div>`;

  const chainLine = n > 1
    ? `<div class="px-info">CHAIN: ${n}x</div>`
    : '';

  const settingsLine = (STATE.selections.color || STATE.selections.size)
    ? `<div class="px-hint">${col} / ${size}</div>`
    : '';

  return `
    <div class="screen-idle">
      <div class="px-header">DTP v1.0</div>
      <div class="px-divider">──────────────</div>
      <div class="px-status">READY<span class="blink">_</span></div>
      <div class="px-spacer"></div>
      ${photoLine}
      ${chainLine}
      ${settingsLine}
      <div class="px-spacer"></div>
      <div class="px-hint">ADD  &gt; load</div>
      <div class="px-hint">PRNT &gt; run</div>
    </div>
  `;
}

/** Render a menu list for the given button id */
function renderMenu(btnId) {
  const options   = CONFIG.menus[btnId];
  const btnConfig = CONFIG.buttons.find((b) => b.id === btnId);
  const label     = btnConfig ? btnConfig.label : btnId.toUpperCase();
  const current   = STATE.selections[btnId];

  transitionScreen(() => {
    DOM.screenContent.innerHTML = buildMenuHTML(btnId, label, options, current);
    attachMenuItemListeners(btnId);
  });
}

function buildMenuHTML(btnId, label, options, currentSelection) {
  const items = options.map((opt) => {
    const isSelected = opt === currentSelection;
    const prefix     = isSelected ? '&#9658; ' : '  ';
    return `
      <li
        class="menu-item${isSelected ? ' is-selected' : ''}"
        data-btn="${btnId}"
        data-opt="${opt}"
      >${prefix}${opt}</li>
    `;
  }).join('');

  return `
    <p class="screen-title">${label}</p>
    <ul class="menu-list">${items}</ul>
  `;
}

/** Wire click/touch on rendered menu items */
function attachMenuItemListeners(btnId) {
  DOM.screenContent.querySelectorAll('.menu-item').forEach((item) => {
    function handleSelect(e) {
      if (e.type === 'touchstart') e.preventDefault();
      selectMenuOption(btnId, item.dataset.opt);
    }
    item.addEventListener('touchstart', handleSelect, { passive: false });
    item.addEventListener('click',      handleSelect);
  });
}

/**
 * Records the selected option and re-renders the menu with the
 * new selection highlighted.
 * 'Upload Photo' for the add button triggers the file picker instead.
 */
function selectMenuOption(btnId, option) {
  if (btnId === 'add' && option === 'Upload Photo') {
    triggerFileUpload();
    return;
  }
  STATE.selections[btnId] = option;
  renderMenu(btnId);
}


/* === THERMAL FILTERS === */

function getCurrentColorClass() {
  if (!STATE.selections.color) return CONFIG.colorClasses._default;
  return CONFIG.colorClasses[STATE.selections.color] || CONFIG.colorClasses._default;
}

function getCurrentEffectClass() {
  if (!STATE.selections.effects) return '';
  return CONFIG.effectClasses[STATE.selections.effects] || '';
}

/** Formats today's date in a thermal-receipt style: DD MMM YYYY */
function formatDateStamp() {
  const d      = new Date();
  const months = ['JAN','FEB','MAR','APR','MAY','JUN',
                  'JUL','AUG','SEP','OCT','NOV','DEC'];
  return `${String(d.getDate()).padStart(2,'0')} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

/**
 * Builds a text progress bar: e.g. [████████░░░░] 8/12
 * @param {number} done  — steps completed
 * @param {number} total — total steps
 * @param {number} width — bar width in chars
 */
function buildProgressBar(done, total, width) {
  const filled = Math.round((done / total) * width);
  const empty  = width - filled;
  return '[' + '█'.repeat(filled) + '░'.repeat(empty) + ']';
}


/* === FILE UPLOAD === */

/** Opens the hidden file picker */
function triggerFileUpload() {
  if (DOM.photoInput) DOM.photoInput.click();
}

/**
 * Handles file selection — reads each file as a data URL
 * and stores it in STATE.photos.
 */
function handleFileChange(e) {
  const files = Array.from(e.target.files);
  if (!files.length) return;

  /* Show loading indicator */
  transitionScreen(() => {
    DOM.screenContent.innerHTML = `
      <div class="screen-idle">
        <div class="px-header">LOADING</div>
        <div class="px-divider">──────────────</div>
        <div class="px-status px-info">0 / ${files.length}<span class="blink">_</span></div>
      </div>
    `;
  });

  let loaded = 0;
  STATE.photos = []; /* reset on new upload */

  files.forEach((file) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      STATE.photos.push(ev.target.result);
      loaded++;

      /* Update counter while loading */
      const counter = DOM.screenContent.querySelector('.px-status');
      if (counter) counter.textContent = `${loaded} / ${files.length}`;

      if (loaded === files.length) {
        /* All loaded — go back to idle so user sees the count */
        STATE.activeBtn = null;
        deactivateAllButtons();
        renderIdle();
        /* Reset the input so the same files can be picked again */
        DOM.photoInput.value = '';
      }
    };
    reader.readAsDataURL(file);
  });
}


/* === PRINT ANIMATION === */

/**
 * Runs the full print sequence for all photos in STATE.photos.
 * If photos array is empty, prints a placeholder "test strip".
 */
function renderPrintSequence() {
  STATE.isPrinting  = true;
  STATE.photoIndex  = 0;

  printNextPhoto();
}

/** Prints the photo at STATE.photoIndex, then chains to the next */
function printNextPhoto() {
  const total     = Math.max(STATE.photos.length, 1);
  const idx       = STATE.photoIndex;

  transitionScreen(() => {
    DOM.screenContent.innerHTML = buildPrintingHTML(idx, total);
  }).then(() => {
    runPaperFeed(idx, total);
  });
}

/** Builds the "PRINTING..." screen for photo idx/total */
function buildPrintingHTML(idx, total) {
  const label = total > 1 ? `${idx + 1} / ${total}` : '1 / 1';
  return `
    <div class="screen-print">
      <div class="paper-feed" id="paper-feed">
        ${buildPaperLines()}
      </div>
      <div class="print-result" id="print-result">
        <div class="px-header">&#9632; DONE</div>
        <div class="px-divider">──────────────</div>
        <div class="px-info">${label}</div>
        <div class="px-info">${formatDateStamp()}</div>
        <div class="px-spacer"></div>
        <div class="px-hint">DTP &#9642; PRINT</div>
      </div>
    </div>
  `;
}

function buildPaperLines() {
  let html = '';
  for (let i = 0; i < CONFIG.printLineCount; i++) {
    html += '<div class="paper-line"></div>';
  }
  return html;
}

/**
 * Animates paper-feed lines, updates a text progress bar,
 * then reveals the print result confirmation.
 */
function runPaperFeed(idx, total) {
  const feedEl   = document.getElementById('paper-feed');
  const resultEl = document.getElementById('print-result');
  if (!feedEl || !resultEl) return;

  let linesDone = 0;
  const steps   = CONFIG.printLineCount;

  clearTimeout(STATE._printTimer);

  function tick() {
    linesDone++;

    /* Shrink the feed to simulate paper exiting the slot */
    const progress = linesDone / steps;
    if (feedEl) {
      feedEl.style.maxHeight = `${(1 - progress) * 100}%`;
      feedEl.style.opacity   = `${Math.max(0, 1 - progress * 1.4)}`;
    }

    if (linesDone >= steps) {
      if (feedEl)   feedEl.style.display = 'none';
      if (resultEl) resultEl.classList.add('is-visible');

      /* Chain to next photo or reset to idle */
      const nextIdx = idx + 1;
      if (nextIdx < total) {
        /* Pause briefly, then print the next one */
        STATE._printTimer = setTimeout(() => {
          STATE.photoIndex = nextIdx;
          printNextPhoto();
        }, CONFIG.chainIntervalMs);
      } else {
        /* All done — reset after 3s */
        STATE._printTimer = setTimeout(() => {
          STATE.isPrinting = false;
          STATE.activeBtn  = null;
          deactivateAllButtons();
          renderIdle();
        }, 3000);
      }
      return;
    }

    STATE._printTimer = setTimeout(tick, CONFIG.printLineIntervalMs);
  }

  STATE._printTimer = setTimeout(tick, CONFIG.printLineIntervalMs);
}


/* === INIT === */

/**
 * Bootstrap the app:
 *  1. Cache DOM references
 *  2. Attach button event listeners
 *  3. Set up file input handler
 *  4. Render initial idle screen
 */
function init() {
  DOM.deviceContainer = document.getElementById('device-container');
  DOM.screenContent   = document.getElementById('screen-content');
  DOM.photoInput      = document.getElementById('photo-input');

  if (!DOM.deviceContainer || !DOM.screenContent) {
    console.error('DTP: required DOM elements not found.');
    return;
  }

  /* Wire up all five button zones */
  document.querySelectorAll('.btn-zone').forEach(attachButtonListeners);

  /* File upload handler */
  if (DOM.photoInput) {
    DOM.photoInput.addEventListener('change', handleFileChange);
  }

  /* Render default screen */
  renderIdle();

  console.log('DTP · Digital Thermal Printer · ready');
}

document.addEventListener('DOMContentLoaded', init);
