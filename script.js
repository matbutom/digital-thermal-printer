/* =====================================================
   DTP · Digital Thermal Printer — script.js
   ===================================================== */


/* === CONFIG === */

const CONFIG = {

  pressDurationMs: 220,

  /* Print strip animation */
  stripFeedMs:    1800,   /* total time for paper to exit the slot */

  /* Pause between chain prints (ms) */
  chainIntervalMs: 1200,

  /* Card layout — used when placing a new card on the desk */
  cardRotationMax: 6,     /* ± degrees of random tilt */

  buttons: [
    { id: 'color',   label: 'COLOR',    centerPct: { x: 32.5, y: 20 } },
    { id: 'print',   label: '* PRINT *', centerPct: { x: 81,   y: 20 } },
    { id: 'effects', label: 'EFFECTS',  centerPct: { x: 13,   y: 39 } },
    { id: 'size',    label: 'SIZE',     centerPct: { x: 32.5, y: 50 } },
    { id: 'add',     label: 'ADD',      centerPct: { x: 13,   y: 66 } },
  ],

  menus: {
    color:   ['Warm', 'Cold', 'Faded', 'Sepia', 'B&W'],
    effects: ['Grain', 'Blur', 'Vignette', 'Overexposed', 'Scratches'],
    size:    ['Wallet', 'Square', 'Postcard', 'Full'],
    add:     ['Upload Photo', 'Text', 'Sticker', 'Date Stamp', 'Frame'],
    print:   null,
  },

  /**
   * Size definitions:
   *   outW/outH — dither canvas resolution (px)
   *   cardW     — print card CSS width on the desk (px)
   * Postcard / Full use portrait aspect ratios.
   */
  sizes: {
    Wallet:   { outW: 200, outH: 200, cardW: 92  },
    Square:   { outW: 320, outH: 320, cardW: 150 },
    Postcard: { outW: 280, outH: 448, cardW: 150 }, /* 5:8  — 1:1.6  */
    Full:     { outW: 280, outH: 560, cardW: 150 }, /* 1:2  — receipt strip */
    _default: { outW: 320, outH: 320, cardW: 150 },
  },
};


/** Returns the size config for the current selection (falls back to _default) */
function getSizeConfig() {
  const sel = STATE && STATE.selections && STATE.selections.size;
  return CONFIG.sizes[sel] || CONFIG.sizes._default;
}


/* === STATE === */

const STATE = {
  activeBtn:   null,
  selections:  { color: null, effects: null, size: null, add: null },
  photos:      [],
  photoIndex:  0,
  isPrinting:  false,

  _pressTimer: null,
  _printTimer: null,
  _fadeTimer:  null,
};


/* === DOM REFS === */

const DOM = {
  deviceContainer: null,
  screenContent:   null,
  photoInput:      null,
  printStrip:      null,
  stripCanvas:     null,
  desk:            null,
  deskEmpty:       null,
  printOverlay:    null,
  overlayImage:    null,
  overlayDownload: null,
  overlayClose:    null,
};


/* === DESK — card z-index tracking === */

const DESK = {
  zCounter:     10,
  selectedCard: null,

  bringToFront(card) {
    card.style.zIndex = ++this.zCounter;
  },

  select(card) {
    if (this.selectedCard && this.selectedCard !== card) {
      this.selectedCard.classList.remove('is-selected');
    }
    this.selectedCard = card;
    card.classList.add('is-selected');
    this.bringToFront(card);
  },

  deselect() {
    if (this.selectedCard) {
      this.selectedCard.classList.remove('is-selected');
      this.selectedCard = null;
    }
  },
};


/* === BUTTON HANDLERS === */

function attachButtonListeners(btnEl) {
  const id = btnEl.dataset.btn;

  function handlePress(e) {
    if (STATE.isPrinting) return;
    if (e.type === 'touchstart') e.preventDefault();
    triggerButtonPress(btnEl, id);
  }

  btnEl.addEventListener('touchstart', handlePress, { passive: false });
  btnEl.addEventListener('click',      handlePress);

  btnEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (!STATE.isPrinting) triggerButtonPress(btnEl, id);
    }
  });
}

function triggerButtonPress(btnEl, id) {
  applyPressEffect(btnEl);

  if (STATE.activeBtn === id) {
    STATE.activeBtn = null;
    deactivateAllButtons();
    renderIdle();
    return;
  }

  deactivateAllButtons();
  STATE.activeBtn = id;
  btnEl.classList.add('is-active');

  if (id === 'print') {
    renderPrintSequence();
  } else {
    renderMenu(id);
  }
}

function applyPressEffect(btnEl) {
  btnEl.classList.add('is-pressed');
  clearTimeout(STATE._pressTimer);
  STATE._pressTimer = setTimeout(() => {
    btnEl.classList.remove('is-pressed');
  }, CONFIG.pressDurationMs);
}

function deactivateAllButtons() {
  document.querySelectorAll('.btn-zone').forEach((el) => {
    el.classList.remove('is-active');
  });
}


/* === SCREEN RENDERER === */

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

function formatDateStamp() {
  const d      = new Date();
  const months = ['JAN','FEB','MAR','APR','MAY','JUN',
                  'JUL','AUG','SEP','OCT','NOV','DEC'];
  return `${String(d.getDate()).padStart(2,'0')} ${months[d.getMonth()]} ${d.getFullYear()}`;
}


/* === FILE UPLOAD === */

function triggerFileUpload() {
  if (DOM.photoInput) DOM.photoInput.click();
}

function handleFileChange(e) {
  const files = Array.from(e.target.files);
  if (!files.length) return;

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
  STATE.photos = [];

  files.forEach((file) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      STATE.photos.push(ev.target.result);
      loaded++;

      const counter = DOM.screenContent.querySelector('.px-status');
      if (counter) counter.textContent = `${loaded} / ${files.length}`;

      if (loaded === files.length) {
        STATE.activeBtn = null;
        deactivateAllButtons();
        renderIdle();
        DOM.photoInput.value = '';
      }
    };
    reader.readAsDataURL(file);
  });
}


/* === FLOYD-STEINBERG DITHERING === */

/**
 * Draws a photo data URL onto a canvas, applies the selected colour filter
 * via CSS-style operations, then runs Floyd-Steinberg dithering to produce
 * a 1-bit (black/white) thermal-print look.
 *
 * @param {string} dataUrl  — source image data URL
 * @param {number} outW     — output pixel width  (e.g. 320)
 * @param {number} outH     — output pixel height (e.g. 320)
 * @returns {Promise<HTMLCanvasElement>}
 */
function createDitheredCanvas(dataUrl, outW, outH) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      /* 1 — draw source at output size into a temp canvas */
      const tmp = document.createElement('canvas');
      tmp.width  = outW;
      tmp.height = outH;
      const ctx  = tmp.getContext('2d');

      /* Centre-crop to match output aspect ratio */
      const outAspect = outW / outH;
      const srcAspect = img.naturalWidth / img.naturalHeight;
      let srcX, srcY, srcCropW, srcCropH;
      if (srcAspect > outAspect) {
        srcCropH = img.naturalHeight;
        srcCropW = srcCropH * outAspect;
        srcX     = (img.naturalWidth - srcCropW) / 2;
        srcY     = 0;
      } else {
        srcCropW = img.naturalWidth;
        srcCropH = srcCropW / outAspect;
        srcX     = 0;
        srcY     = (img.naturalHeight - srcCropH) / 2;
      }
      ctx.drawImage(img, srcX, srcY, srcCropW, srcCropH, 0, 0, outW, outH);

      /* 2 — apply colour grading then effects before dithering */
      applyColorGrade(ctx, outW, outH);
      applyEffect(ctx, outW, outH);

      /* 3 — extract pixel data and convert to greyscale floats [0..1] */
      const imgData = ctx.getImageData(0, 0, outW, outH);
      const src     = imgData.data;
      const grey    = new Float32Array(outW * outH);

      for (let i = 0; i < grey.length; i++) {
        const r = src[i * 4];
        const g = src[i * 4 + 1];
        const b = src[i * 4 + 2];
        /* Luminance (BT.601) */
        grey[i] = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      }

      /* 4 — Floyd-Steinberg error diffusion */
      for (let y = 0; y < outH; y++) {
        for (let x = 0; x < outW; x++) {
          const idx   = y * outW + x;
          const old   = grey[idx];
          const nw    = old < 0.5 ? 0.0 : 1.0;
          grey[idx]   = nw;
          const err   = old - nw;

          if (x + 1 < outW)                 grey[idx + 1]       += err * 7 / 16;
          if (y + 1 < outH && x > 0)        grey[idx + outW - 1] += err * 3 / 16;
          if (y + 1 < outH)                 grey[idx + outW]     += err * 5 / 16;
          if (y + 1 < outH && x + 1 < outW) grey[idx + outW + 1] += err * 1 / 16;
        }
      }

      /* 5 — write dithered result back onto canvas */
      const out = document.createElement('canvas');
      out.width  = outW;
      out.height = outH;
      const octx = out.getContext('2d');
      const oData = octx.createImageData(outW, outH);

      for (let i = 0; i < grey.length; i++) {
        const v = grey[i] >= 0.5 ? 255 : 0;
        /* Paper colour for white pixels, black for dark — warm thermal look */
        const r = grey[i] >= 0.5 ? 243 : 0;
        const g = grey[i] >= 0.5 ? 237 : 0;
        const b = grey[i] >= 0.5 ? 224 : 0;
        oData.data[i * 4]     = r;
        oData.data[i * 4 + 1] = g;
        oData.data[i * 4 + 2] = b;
        oData.data[i * 4 + 3] = 255;
      }

      octx.putImageData(oData, 0, 0);
      resolve(applyTornEdges(applyPhotoBorder(out)));
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

/**
 * Applies colour-grade adjustments to a canvas context in-place,
 * based on STATE.selections.color.  Manipulates pixel data directly
 * since we can't apply CSS filters to CanvasRenderingContext2D.
 */
function applyColorGrade(ctx, w, h) {
  const mode = STATE.selections.color;
  if (!mode) return;

  const d = ctx.getImageData(0, 0, w, h);
  const p = d.data;

  for (let i = 0; i < p.length; i += 4) {
    let r = p[i], g = p[i+1], b = p[i+2];

    switch (mode) {
      case 'Warm':
        r = Math.min(255, r * 1.08);
        b = Math.max(0,   b * 0.85);
        break;
      case 'Cold':
        b = Math.min(255, b * 1.12);
        r = Math.max(0,   r * 0.88);
        break;
      case 'Faded': {
        /* desaturate + lighten */
        const lum = 0.299*r + 0.587*g + 0.114*b;
        r = lum + (r - lum) * 0.5;
        g = lum + (g - lum) * 0.5;
        b = lum + (b - lum) * 0.5;
        r = Math.min(255, r * 1.15);
        g = Math.min(255, g * 1.15);
        b = Math.min(255, b * 1.15);
        break;
      }
      case 'Sepia': {
        const sr = r * 0.393 + g * 0.769 + b * 0.189;
        const sg = r * 0.349 + g * 0.686 + b * 0.168;
        const sb = r * 0.272 + g * 0.534 + b * 0.131;
        r = sr; g = sg; b = sb;
        break;
      }
      case 'B&W': {
        const bw = 0.299*r + 0.587*g + 0.114*b;
        r = g = b = bw;
        break;
      }
    }

    p[i]   = Math.round(Math.min(255, Math.max(0, r)));
    p[i+1] = Math.round(Math.min(255, Math.max(0, g)));
    p[i+2] = Math.round(Math.min(255, Math.max(0, b)));
  }

  ctx.putImageData(d, 0, 0);
}


/* === PHOTO BORDER === */

/**
 * Wraps the dithered canvas in a paper-coloured border,
 * matching the white margin visible on real thermal prints.
 * Returns a NEW, larger canvas.
 *
 * Border = 9% of the shorter edge on each side.
 */
function applyPhotoBorder(src) {
  const sw     = src.width;
  const sh     = src.height;
  const border = Math.round(Math.min(sw, sh) * 0.09);

  const out = document.createElement('canvas');
  out.width  = sw + border * 2;
  out.height = sh + border * 2;
  const ctx  = out.getContext('2d');

  /* Paper background — same warm white as dithered highlight pixels */
  ctx.fillStyle = '#F3EDE0';
  ctx.fillRect(0, 0, out.width, out.height);

  /* Dithered image sits centred inside the border */
  ctx.drawImage(src, border, border);

  return out;
}


/* === TORN PAPER EDGES === */

/**
 * Clips a dithered canvas to a serrated/perforated shape at the top and
 * bottom edges — mimicking a thermal receipt torn from a roll.
 * Left and right edges stay straight (= paper roll width).
 * Returns a NEW canvas with transparent pixels outside the torn shape.
 *
 * Tooth geometry (at canvas resolution):
 *   toothW  ~w/44  → ~44 teeth across a 320px image
 *   toothH  ~0.75× toothW, ±40% random variation per tooth
 */
function applyTornEdges(src) {
  const w = src.width;
  const h = src.height;

  const toothW = Math.max(5, Math.round(w / 44));
  const maxH   = Math.round(toothW * 0.85);
  const pad    = maxH + 2; /* space reserved for the teeth zone */

  const out = document.createElement('canvas');
  out.width  = w;
  out.height = h;
  const ctx  = out.getContext('2d');

  /* Build the clip path — a closed polygon with jagged top and bottom */
  ctx.beginPath();

  /* ── Top edge: V-notches pointing upward ── */
  ctx.moveTo(0, pad);
  for (let x = 0; x < w; x += toothW) {
    const th = Math.round((0.4 + Math.random() * 0.6) * maxH);
    ctx.lineTo(Math.min(x + toothW * 0.5, w), pad - th); /* tip */
    ctx.lineTo(Math.min(x + toothW,       w), pad);       /* valley */
  }

  /* ── Right side: straight ── */
  ctx.lineTo(w, h - pad);

  /* ── Bottom edge: V-notches pointing downward ── */
  for (let x = w; x > 0; x -= toothW) {
    const th = Math.round((0.4 + Math.random() * 0.6) * maxH);
    ctx.lineTo(Math.max(x - toothW * 0.5, 0), h - pad + th); /* tip */
    ctx.lineTo(Math.max(x - toothW,       0), h - pad);       /* valley */
  }

  /* ── Left side: straight ── */
  ctx.closePath();
  ctx.clip();

  ctx.drawImage(src, 0, 0);
  return out;
}


/* === EFFECTS (applied to canvas before dithering) === */

/**
 * Dispatches to the selected effect helper.
 * All helpers manipulate the canvas context in-place.
 */
function applyEffect(ctx, w, h) {
  switch (STATE.selections.effects) {
    case 'Grain':       effectGrain(ctx, w, h);       break;
    case 'Blur':        effectBlur(ctx, w, h);        break;
    case 'Vignette':    effectVignette(ctx, w, h);    break;
    case 'Overexposed': effectOverexposed(ctx, w, h); break;
    case 'Scratches':   effectScratches(ctx, w, h);   break;
  }
}

/** Adds random luminance noise — simulates film grain */
function effectGrain(ctx, w, h) {
  const d = ctx.getImageData(0, 0, w, h);
  const p = d.data;
  const strength = 55; /* ± pixel value variance */
  for (let i = 0; i < p.length; i += 4) {
    const n = (Math.random() - 0.5) * strength;
    p[i]   = Math.min(255, Math.max(0, p[i]   + n));
    p[i+1] = Math.min(255, Math.max(0, p[i+1] + n));
    p[i+2] = Math.min(255, Math.max(0, p[i+2] + n));
  }
  ctx.putImageData(d, 0, 0);
}

/** Gaussian-style blur via temporary canvas — softens the dither pattern */
function effectBlur(ctx, w, h) {
  const tmp = document.createElement('canvas');
  tmp.width = w; tmp.height = h;
  const tc = tmp.getContext('2d');
  tc.filter = 'blur(2.5px)';
  tc.drawImage(ctx.canvas, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(tmp, 0, 0);
}

/** Radial gradient darkens the edges — classic vignette */
function effectVignette(ctx, w, h) {
  const cx = w / 2, cy = h / 2;
  const r  = Math.sqrt(cx * cx + cy * cy);
  const grad = ctx.createRadialGradient(cx, cy, r * 0.35, cx, cy, r);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.72)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
}

/** Boosts brightness sharply — blown-out highlights */
function effectOverexposed(ctx, w, h) {
  const d = ctx.getImageData(0, 0, w, h);
  const p = d.data;
  for (let i = 0; i < p.length; i += 4) {
    p[i]   = Math.min(255, p[i]   * 1.75);
    p[i+1] = Math.min(255, p[i+1] * 1.75);
    p[i+2] = Math.min(255, p[i+2] * 1.75);
  }
  ctx.putImageData(d, 0, 0);
}

/** Draws a handful of thin random vertical scratches */
function effectScratches(ctx, w, h) {
  const count = 4 + Math.floor(Math.random() * 7);
  for (let i = 0; i < count; i++) {
    const x    = Math.random() * w;
    const lean = (Math.random() - 0.5) * 10;
    const lite = Math.random() > 0.4; /* light or dark scratch */
    ctx.strokeStyle = lite
      ? `rgba(255,255,255,${0.4 + Math.random() * 0.4})`
      : `rgba(0,0,0,${0.3 + Math.random() * 0.3})`;
    ctx.lineWidth = 0.4 + Math.random() * 0.7;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + lean, h);
    ctx.stroke();
  }
}


/* === MOBILE PRINT OVERLAY === */

const isMobile = () => window.matchMedia('(max-width: 700px)').matches;

/**
 * Shows the full-screen result overlay on mobile.
 * If the overlay is already visible (chain print), just swaps the image.
 * @param {string} imgSrc  — PNG data URL (with transparent torn edges)
 * @param {string} dateStr
 */
function showPrintOverlay(imgSrc, dateStr) {
  const overlay = DOM.printOverlay;
  const img     = DOM.overlayImage;
  const dlBtn   = DOM.overlayDownload;

  img.src = imgSrc;
  overlay.classList.add('is-visible');
  overlay.setAttribute('aria-hidden', 'false');

  /* Re-bind download each time (different image per print in a chain) */
  dlBtn.onclick = () => downloadCard(imgSrc, dateStr);
}

function hidePrintOverlay() {
  DOM.printOverlay.classList.remove('is-visible');
  DOM.printOverlay.setAttribute('aria-hidden', 'true');
}


/* === PRINT STRIP ANIMATION === */

/**
 * Renders a dithered image onto the strip canvas and animates
 * it growing out of the printer slot.
 * @param {string} dataUrl — source photo
 * @returns {Promise} resolves when strip is fully extended
 */
function animatePrintStrip(dataUrl) {
  return new Promise((resolve) => {
    const strip    = DOM.printStrip;
    const canvas   = DOM.stripCanvas;
    const sizeCfg  = getSizeConfig();
    const stripW   = strip.offsetWidth || 120;

    /* Scale outH to match the strip's physical width */
    const scale  = stripW / sizeCfg.outW;
    const outW   = sizeCfg.outW;
    const outH   = sizeCfg.outH;

    createDitheredCanvas(dataUrl, outW, outH).then((dithered) => {
      /* Paint dithered result onto the visible strip canvas */
      canvas.width  = outW;
      canvas.height = outH;
      canvas.getContext('2d').drawImage(dithered, 0, 0);

      /* Show strip */
      strip.style.height = '0px';
      strip.classList.add('is-visible');

      const targetH = Math.round(outH * scale); /* respects aspect ratio */
      const start   = performance.now();
      const dur     = CONFIG.stripFeedMs;

      function step(now) {
        const t  = Math.min(1, (now - start) / dur);
        const ease = 1 - Math.pow(1 - t, 3); /* ease-out cubic */
        strip.style.height = `${Math.round(ease * targetH)}px`;

        if (t < 1) {
          requestAnimationFrame(step);
        } else {
          strip.style.height = `${targetH}px`;
          resolve(dithered);
        }
      }

      requestAnimationFrame(step);
    });
  });
}

/** Hides and resets the print strip */
function resetPrintStrip() {
  const strip  = DOM.printStrip;
  strip.classList.remove('is-visible');
  strip.style.height = '0px';
}


/* === PRINT CARDS (desk output) === */

/**
 * Adds a new print card to the desk.
 * @param {HTMLCanvasElement} ditheredCanvas — already dithered output
 * @param {string} dateStr
 */
function createPrintCard(ditheredCanvas, dateStr) {
  const desk = DOM.desk;

  /* Random position within the visible desk area */
  const deskW   = desk.offsetWidth  || 600;
  const deskH   = desk.offsetHeight || 700;
  const sizeCfg = getSizeConfig();
  const cardW   = sizeCfg.cardW;
  const cardH   = Math.round(cardW * (sizeCfg.outH / sizeCfg.outW)) + 24; /* +24 footer */
  const margin  = Math.round(cardW * 0.12);

  const x = margin + Math.random() * Math.max(0, deskW - cardW - margin * 2);
  const y = margin + Math.random() * Math.max(0, deskH - cardH - margin * 2);
  const rot = (Math.random() * 2 - 1) * CONFIG.cardRotationMax;

  /* Create img from dithered canvas */
  const imgSrc = ditheredCanvas.toDataURL('image/png');

  const card = document.createElement('div');
  card.className = 'print-card is-entering';
  card.style.left      = `${x}px`;
  card.style.top       = `${y}px`;
  card.style.width     = `${cardW}px`;
  card.style.transform = `rotate(${rot.toFixed(2)}deg)`;
  card.style.zIndex    = DESK.zCounter + 1;

  card.innerHTML = `
    <img class="card-image" src="${imgSrc}" alt="thermal print" draggable="false" />
    <div class="card-footer">
      <span class="card-date">${dateStr}</span>
      <button class="download-btn" aria-label="Download">SAVE</button>
    </div>
  `;

  desk.appendChild(card);

  /* Hide "no prints yet" message */
  if (DOM.deskEmpty) DOM.deskEmpty.style.opacity = '0';

  /* Wire up interactions */
  makeDraggable(card);

  card.addEventListener('click', (e) => {
    if (!card._wasDragged) DESK.select(card);
    card._wasDragged = false;
  });

  const dlBtn = card.querySelector('.download-btn');
  dlBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    downloadCard(imgSrc, dateStr);
  });

  /* Remove entrance class after animation */
  card.addEventListener('animationend', () => {
    card.classList.remove('is-entering');
  }, { once: true });
}

/** Save / download the card image.
 *  On mobile: uses Web Share API (opens native share sheet →
 *  "Save Image" saves directly to the camera roll on iOS/Android).
 *  On desktop or if share is unavailable: regular browser download.
 */
async function downloadCard(dataUrl, dateStr) {
  const filename = `DTP_${dateStr.replace(/\s/g, '_')}.png`;

  if (isMobile() && navigator.share) {
    try {
      const res  = await fetch(dataUrl);
      const blob = await res.blob();
      const file = new File([blob], filename, { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'DTP Print' });
        return;
      }
    } catch (err) {
      if (err.name === 'AbortError') return; /* user dismissed sheet */
      /* fall through to <a> download */
    }
  }

  const a = document.createElement('a');
  a.href     = dataUrl;
  a.download = filename;
  a.click();
}


/* === DRAG & DROP === */

function makeDraggable(el) {
  let startX, startY, origLeft, origTop, dragging = false;

  function onStart(e) {
    e.stopPropagation();
    if (e.type === 'touchstart') e.preventDefault();
    dragging = true;
    el._wasDragged = false;

    const touch = e.touches ? e.touches[0] : e;
    startX   = touch.clientX;
    startY   = touch.clientY;
    origLeft = parseInt(el.style.left, 10) || 0;
    origTop  = parseInt(el.style.top,  10) || 0;

    DESK.bringToFront(el);

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onEnd);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend',  onEnd);
  }

  function onMove(e) {
    if (!dragging) return;
    if (e.type === 'touchmove') e.preventDefault();
    const touch = e.touches ? e.touches[0] : e;
    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;

    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) el._wasDragged = true;

    el.style.left = `${origLeft + dx}px`;
    el.style.top  = `${origTop  + dy}px`;
  }

  function onEnd() {
    dragging = false;
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup',   onEnd);
    document.removeEventListener('touchmove', onMove);
    document.removeEventListener('touchend',  onEnd);
  }

  el.addEventListener('mousedown',  onStart);
  el.addEventListener('touchstart', onStart, { passive: false });
  el.style.cursor = 'grab';
}


/* === PRINT SEQUENCE === */

function renderPrintSequence() {
  /* Guard: nothing to print */
  if (STATE.photos.length === 0) {
    transitionScreen(() => {
      DOM.screenContent.innerHTML = `
        <div class="screen-idle">
          <div class="px-header">&#9632; ERROR</div>
          <div class="px-divider">──────────────</div>
          <div class="px-status">NO PHOTO</div>
          <div class="px-spacer"></div>
          <div class="px-hint">ADD &gt; upload</div>
        </div>
      `;
    });
    /* Return to idle after 2s */
    STATE._printTimer = setTimeout(() => {
      STATE.activeBtn = null;
      deactivateAllButtons();
      renderIdle();
    }, 2000);
    STATE.isPrinting = false;
    return;
  }

  STATE.isPrinting = true;
  STATE.photoIndex = 0;
  printNextPhoto();
}

function printNextPhoto() {
  const idx   = STATE.photoIndex;
  const total = STATE.photos.length;
  const label = `${idx + 1} / ${total}`;
  const date  = formatDateStamp();

  /* Show PRINTING screen */
  transitionScreen(() => {
    DOM.screenContent.innerHTML = buildPrintingHTML(idx, total);
  }).then(() => {
    /* Animate strip with dithered image */
    animatePrintStrip(STATE.photos[idx]).then((ditheredCanvas) => {
      const imgSrc = ditheredCanvas.toDataURL('image/png');

      /* Place card on desk (desktop) */
      createPrintCard(ditheredCanvas, date);

      /* Mobile: show fullscreen overlay with download option */
      if (isMobile()) showPrintOverlay(imgSrc, date);

      /* Show DONE on screen */
      transitionScreen(() => {
        DOM.screenContent.innerHTML = buildDoneHTML(idx, total, date);
      });

      /* Short pause then collapse strip */
      STATE._printTimer = setTimeout(() => {
        resetPrintStrip();

        /* Chain or finish */
        const nextIdx = idx + 1;
        if (nextIdx < total) {
          STATE._printTimer = setTimeout(() => {
            STATE.photoIndex = nextIdx;
            printNextPhoto();
          }, CONFIG.chainIntervalMs);
        } else {
          STATE._printTimer = setTimeout(() => {
            STATE.isPrinting = false;
            STATE.activeBtn  = null;
            deactivateAllButtons();
            renderIdle();
          }, 2500);
        }
      }, 600);
    });
  });
}

function buildPrintingHTML(idx, total) {
  const label = `${idx + 1} / ${total}`;
  return `
    <div class="screen-print">
      <div class="px-header">&#9632; PRINT</div>
      <div class="px-divider">──────────────</div>
      <div class="px-status">${label}<span class="blink">_</span></div>
      <div class="px-spacer"></div>
      <div class="px-hint">PROCESSING</div>
      <div class="px-hint">PLEASE WAIT</div>
    </div>
  `;
}

function buildDoneHTML(idx, total, date) {
  const label = `${idx + 1} / ${total}`;
  return `
    <div class="screen-print">
      <div class="px-header">&#9632; DONE</div>
      <div class="px-divider">──────────────</div>
      <div class="px-info">${label}</div>
      <div class="px-info">${date}</div>
      <div class="px-spacer"></div>
      <div class="px-hint">DTP &#9642; PRINT</div>
    </div>
  `;
}


/* === DESK CLICK-AWAY === */

/* Clicking the bare desk deselects any selected card */
document.addEventListener('click', (e) => {
  if (DESK.selectedCard && !DESK.selectedCard.contains(e.target)) {
    DESK.deselect();
  }
});


/* === INIT === */

function init() {
  DOM.deviceContainer = document.getElementById('device-container');
  DOM.screenContent   = document.getElementById('screen-content');
  DOM.photoInput      = document.getElementById('photo-input');
  DOM.printStrip      = document.getElementById('print-strip');
  DOM.stripCanvas     = document.getElementById('strip-canvas');
  DOM.desk            = document.getElementById('desk');
  DOM.deskEmpty       = document.getElementById('desk-empty');
  DOM.printOverlay    = document.getElementById('print-overlay');
  DOM.overlayImage    = document.getElementById('overlay-image');
  DOM.overlayDownload = document.getElementById('overlay-download');
  DOM.overlayClose    = document.getElementById('overlay-close');

  if (!DOM.deviceContainer || !DOM.screenContent) {
    console.error('DTP: required DOM elements not found.');
    return;
  }

  document.querySelectorAll('.btn-zone').forEach(attachButtonListeners);

  if (DOM.photoInput) {
    DOM.photoInput.addEventListener('change', handleFileChange);
  }

  /* Print overlay — close button and backdrop tap */
  if (DOM.overlayClose) {
    DOM.overlayClose.addEventListener('click', hidePrintOverlay);
  }
  if (DOM.printOverlay) {
    DOM.printOverlay.addEventListener('click', (e) => {
      if (e.target === DOM.printOverlay) hidePrintOverlay();
    });
  }

  renderIdle();

  console.log('DTP · Digital Thermal Printer · ready');
}

document.addEventListener('DOMContentLoaded', init);
