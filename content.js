// Unified Video Control — content script.
// Runs in every frame. Finds the media element the user most likely means and
// applies the speed/volume changes the background worker sends to this frame.
(() => {
  const prev = globalThis.__uvc;
  if (prev?.isAlive()) return;
  prev?.dispose(); // left behind by an extension reload or update

  const api = globalThis.browser ?? globalThis.chrome;
  const DEFAULTS = globalThis.UVC_DEFAULTS;

  const MIN_SPEED = 0.1;
  const MAX_SPEED = 16;
  const FIGHT_LIMIT = 5; // re-applies per second before we let the site win
  const USER_INPUT_GRACE = 1000; // ms after a page click/key in which a rate change is the user's own

  const SPEED_KEY = 'speed'; // storage.local key shared by every tab and frame
  const tracked = new WeakSet();
  const fights = new WeakMap();
  const boosts = new WeakMap(); // media element -> GainNode

  let settings = { ...DEFAULTS };
  let desiredRate = null; // the shared speed; null (1×) leaves the site in charge
  let lastActive = null;
  let lastUserInput = -Infinity;
  let audioCtx = null;
  let overlay = null;
  let overlayTimer = 0;
  let disposed = false;

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const round2 = (v) => Math.round(v * 100) / 100;
  // Step to the next multiple of `step`, so 1.1 goes to 1.25 rather than 1.35.
  const stepUp = (v, step) => (Math.floor(v / step + 1e-6) + 1) * step;
  const stepDown = (v, step) => (Math.ceil(v / step - 1e-6) - 1) * step;
  const isMedia = (el) => el instanceof HTMLMediaElement;
  const fmtSpeed = (rate) => `${+rate.toFixed(2)}×`;

  // ---- Finding the target -------------------------------------------------

  // Includes media inside open shadow roots, which many custom players use.
  function findMedia(root = document, out = []) {
    for (const el of root.querySelectorAll('video, audio')) out.push(el);
    for (const el of root.querySelectorAll('*')) if (el.shadowRoot) findMedia(el.shadowRoot, out);
    return out;
  }

  function score(el) {
    if (!el.isConnected || (el.readyState === 0 && !el.currentSrc && !el.srcObject)) return -1;
    let s = 0;
    if (!el.paused && !el.ended) s += 1e7;
    if (el === lastActive) s += 1e6;
    if (el instanceof HTMLVideoElement) {
      const r = el.getBoundingClientRect();
      const w = Math.min(r.right, innerWidth) - Math.max(r.left, 0);
      const h = Math.min(r.bottom, innerHeight) - Math.max(r.top, 0);
      if (w > 0 && h > 0) s += Math.min(w * h, 9e5); // capped below the "last played" bonus
    }
    return s;
  }

  function pickTarget() {
    let best = null;
    let bestScore = -1;
    for (const el of findMedia()) {
      const s = score(el);
      if (s > bestScore) [best, bestScore] = [el, s];
    }
    if (!best) return null;
    track(best);
    return { el: best, score: bestScore };
  }

  // ---- Speed --------------------------------------------------------------

  function track(el) {
    if (tracked.has(el)) return;
    tracked.add(el);
    el.addEventListener('ratechange', () => onRateChange(el));
    el.addEventListener('play', () => {
      lastActive = el;
      applyRate(el);
    });
    el.addEventListener('loadedmetadata', () => applyRate(el));
  }

  function applyRate(el) {
    if (disposed || desiredRate == null || Math.abs(el.playbackRate - desiredRate) < 0.001) return;
    try {
      el.playbackRate = desiredRate;
    } catch {
      // some live streams reject rate changes
    }
  }

  // Sites often reset speed to 1× on new videos, ads or quality switches.
  function onRateChange(el) {
    if (disposed || desiredRate == null || Math.abs(el.playbackRate - desiredRate) < 0.001) return;
    const now = performance.now();
    if (now - lastUserInput < USER_INPUT_GRACE && el.playbackRate !== 1) {
      // The user picked a speed from the site's own menu; adopt it everywhere.
      desiredRate = el.playbackRate;
      publishRate(desiredRate);
      return;
    }
    if (!settings.forceSpeed) return;
    let f = fights.get(el);
    if (!f || now - f.start > 1000) fights.set(el, (f = { start: now, count: 0 }));
    if (++f.count <= FIGHT_LIMIT) applyRate(el);
  }

  // Apply a speed to every media element in this frame.
  function applySpeed(rate) {
    desiredRate = rate === 1 ? null : rate;
    for (const el of findMedia()) {
      track(el);
      try {
        el.playbackRate = el.defaultPlaybackRate = rate;
      } catch {
        // see applyRate
      }
    }
  }

  // Every other tab and frame picks this up through storage.onChanged.
  const publishRate = (rate) => api.storage.local.set({ [SPEED_KEY]: rate }).catch(() => {});

  function setSpeed(rate) {
    rate = round2(clamp(rate || 1, MIN_SPEED, MAX_SPEED));
    applySpeed(rate);
    publishRate(rate);
  }

  // ---- Volume -------------------------------------------------------------

  const getLevel = (el) => round2(el.volume * (boosts.get(el)?.gain.value ?? 1));

  // Routing media through Web Audio silences it when the browser can't read the
  // samples (DRM, or cross-origin without CORS), so only boost when that's safe.
  function canBoost(el) {
    if (el.mediaKeys) return false;
    if (el.srcObject) return true;
    const src = el.currentSrc;
    if (src.startsWith('blob:')) return true; // Media Source players (YouTube, Twitch, most others)
    if (el.crossOrigin != null) return true; // loaded with CORS
    try {
      return new URL(src).origin === location.origin;
    } catch {
      return false;
    }
  }

  async function enableBoost(el) {
    const unavailable = 'Volume boost isn’t available for this video';
    if (!canBoost(el)) return unavailable;
    try {
      audioCtx ??= new AudioContext();
      // resume() stays pending until the page has had a user gesture, so don't wait on it forever.
      await Promise.race([audioCtx.resume(), new Promise((r) => setTimeout(r, 300))]);
      if (audioCtx.state !== 'running') return 'Click the page once, then boost again';
      const gain = audioCtx.createGain();
      audioCtx.createMediaElementSource(el).connect(gain).connect(audioCtx.destination);
      boosts.set(el, gain);
      return null;
    } catch {
      return unavailable; // e.g. the page already routes this element through its own Web Audio graph
    }
  }

  async function setLevel(el, level) {
    level = round2(clamp(level || 0, 0, settings.allowBoost ? settings.maxBoost : 1));
    let note = null;
    if (level > 1 && !boosts.has(el)) {
      note = await enableBoost(el);
      if (note) level = 1;
    }
    el.volume = Math.min(level, 1);
    const gain = boosts.get(el);
    if (gain) gain.gain.value = Math.max(level, 1);
    return note;
  }

  // ---- On-screen indicator ------------------------------------------------

  function flash(el, text) {
    if (!settings.showOverlay) return;
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'uvc-overlay';
    }
    // In fullscreen only the fullscreen element's subtree is visible.
    const fs = document.fullscreenElement;
    const parent = fs && !isMedia(fs) ? fs : document.documentElement;
    if (overlay.parentNode !== parent) parent.append(overlay);

    const r = el instanceof HTMLVideoElement ? el.getBoundingClientRect() : null;
    const onVideo = r && r.width > 0 && r.height > 0;
    overlay.style.setProperty('top', `${onVideo ? Math.max(r.top, 0) + 12 : 12}px`, 'important');
    overlay.style.setProperty('left', `${onVideo ? Math.max(r.left, 0) + 12 : 12}px`, 'important');
    overlay.textContent = text;
    overlay.classList.add('uvc-visible');
    clearTimeout(overlayTimer);
    overlayTimer = setTimeout(() => overlay.classList.remove('uvc-visible'), 1000);
  }

  function label(action, el) {
    if (action.includes('speed')) return fmtSpeed(el.playbackRate);
    return el.muted ? 'Muted' : `Volume ${Math.round(getLevel(el) * 100)}%`;
  }

  // ---- Commands -----------------------------------------------------------

  const stateOf = (el, note = null) => ({
    hasMedia: true,
    speed: el.playbackRate,
    volume: getLevel(el),
    muted: el.muted,
    maxVolume: settings.allowBoost ? settings.maxBoost : 1,
    note,
  });

  async function handle(action, value) {
    const target = pickTarget();
    if (!target) return { hasMedia: false };
    const { el } = target;
    const { speedStep, volumeStep } = settings;
    let note = null;
    switch (action) {
      case 'speed-up':
        setSpeed(stepUp(el.playbackRate, speedStep));
        break;
      case 'speed-down':
        setSpeed(stepDown(el.playbackRate, speedStep));
        break;
      case 'speed-reset':
        setSpeed(1);
        break;
      case 'set-speed':
        setSpeed(Number(value));
        break;
      case 'volume-up':
        if (el.muted) el.muted = false;
        else note = await setLevel(el, stepUp(getLevel(el), volumeStep));
        break;
      case 'volume-down':
        note = await setLevel(el, stepDown(getLevel(el), volumeStep));
        break;
      case 'set-volume':
        el.muted = false;
        note = await setLevel(el, Number(value));
        break;
      case 'toggle-mute':
        el.muted = !el.muted;
        break;
      default: // 'get-state'
        return stateOf(el);
    }
    flash(el, note ?? label(action, el));
    return stateOf(el, note);
  }

  const onMessage = (msg, _sender, sendResponse) => {
    if (disposed || msg?.type !== 'uvc') return;
    handle(msg.action, msg.value).then(sendResponse, (err) =>
      sendResponse({ hasMedia: false, error: String(err) }),
    );
    return true; // async response
  };
  api.runtime.onMessage.addListener(onMessage);

  // The background worker calls probe() in every frame to decide which one to send a command to.
  globalThis.__uvc = {
    isAlive: () => !disposed && !!api.runtime?.id,
    probe: () => {
      const target = disposed ? null : pickTarget();
      return target && { score: target.score };
    },
    dispose() {
      disposed = true;
      overlay?.remove();
      try {
        api.runtime.onMessage.removeListener(onMessage);
      } catch {
        // extension context already gone
      }
    },
  };

  // ---- Wiring -------------------------------------------------------------

  // Media events don't bubble, but capture still sees them for light-DOM elements,
  // which picks up players created after load without a MutationObserver.
  for (const type of ['play', 'loadedmetadata']) {
    document.addEventListener(
      type,
      (e) => {
        const el = e.target;
        if (disposed || !isMedia(el) || tracked.has(el)) return;
        track(el);
        if (type === 'play') lastActive = el;
        applyRate(el);
      },
      true,
    );
  }

  const noteInput = (e) => {
    if (e.isTrusted) lastUserInput = performance.now();
  };
  addEventListener('pointerdown', noteInput, true);
  addEventListener('keydown', noteInput, true);

  api.storage.onChanged.addListener((changes, area) => {
    if (disposed) return;
    if (area === 'local' && SPEED_KEY in changes) {
      const rate = changes[SPEED_KEY].newValue ?? 1;
      if (rate !== (desiredRate ?? 1)) applySpeed(rate); // already applied in the frame that set it
    }
    if (area !== 'sync') return;
    for (const [key, { newValue }] of Object.entries(changes)) {
      if (key in DEFAULTS) settings[key] = newValue ?? DEFAULTS[key];
    }
  });

  (async () => {
    settings = await api.storage.sync.get(DEFAULTS);
    const { [SPEED_KEY]: rate } = await api.storage.local.get(SPEED_KEY);
    if (typeof rate === 'number' && rate !== 1 && desiredRate == null) applySpeed(rate);
  })().catch(() => {});
})();
