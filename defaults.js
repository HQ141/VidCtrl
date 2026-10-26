// Shared defaults, loaded by the content script and the options page.
// Volume values are fractions: 1 = 100%, 3 = 300%.
globalThis.UVC_DEFAULTS ??= Object.freeze({
  speedStep: 0.25,
  volumeStep: 0.1,
  forceSpeed: true,
  allowBoost: true,
  maxBoost: 3,
  showOverlay: true,
});
