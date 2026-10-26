// Unified Video Control — popup. The background worker does the work; this
// sends actions and draws the state that comes back.
const api = globalThis.browser ?? globalThis.chrome;
const $ = (id) => document.getElementById(id);
const fmtSpeed = (rate) => `${+rate.toFixed(2)}×`;

let tabId = null;
let frameId = null;

async function send(action, value) {
  let state = null;
  try {
    state = await api.runtime.sendMessage({ type: 'uvc-popup', tabId, frameId, action, value });
  } catch {
    // background unavailable; fall through to the empty state
  }
  render(state);
}

// Don't move a slider out from under the user's pointer while replies are in flight.
function setRange(input, value) {
  if (!input.matches(':active')) input.value = value;
}

function render(state) {
  const hasMedia = !!state?.hasMedia;
  $('controls').hidden = !hasMedia;
  $('empty').hidden = hasMedia;
  if (!hasMedia) return;
  frameId = state.frameId;

  $('speed-value').textContent = fmtSpeed(state.speed);
  setRange($('speed-range'), state.speed);
  for (const button of document.querySelectorAll('[data-speed]')) {
    button.classList.toggle('active', Math.abs(Number(button.dataset.speed) - state.speed) < 0.001);
  }

  const volume = $('volume-range');
  volume.max = state.maxVolume;
  setRange(volume, state.volume);
  $('volume-value').textContent = state.muted ? 'Muted' : `${Math.round(state.volume * 100)}%`;
  $('mute').textContent = state.muted ? 'Unmute' : 'Mute';
  $('mute').setAttribute('aria-pressed', String(state.muted));

  $('note').hidden = !state.note;
  $('note').textContent = state.note ?? '';
}

$('speed-down').addEventListener('click', () => send('speed-down'));
$('speed-up').addEventListener('click', () => send('speed-up'));
$('speed-range').addEventListener('input', (e) => send('set-speed', e.target.valueAsNumber));
$('presets').addEventListener('click', (e) => {
  const button = e.target.closest('[data-speed]');
  if (button) send('set-speed', Number(button.dataset.speed));
});
$('volume-range').addEventListener('input', (e) => send('set-volume', e.target.valueAsNumber));
$('mute').addEventListener('click', () => send('toggle-mute'));

$('open-options').addEventListener('click', (e) => {
  e.preventDefault();
  api.runtime.openOptionsPage();
});
$('open-shortcuts').addEventListener('click', (e) => {
  e.preventDefault();
  if (api.commands.openShortcutSettings) api.commands.openShortcutSettings(); // Firefox
  else api.tabs.create({ url: 'chrome://extensions/shortcuts' });
});

(async () => {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id ?? null;
  if (tabId == null) render(null);
  else send('get-state');
})();
