// Unified Video Control — background worker.
// Routes keyboard shortcuts and popup requests to the one frame in the tab that
// holds the most relevant media (pages often embed players in iframes).
const api = globalThis.browser ?? globalThis.chrome;

api.action.setBadgeBackgroundColor({ color: '#3b5bdb' });

// Ask every frame's content script how likely it is to hold "the" video, pick the best.
async function findMediaFrame(tabId) {
  let results;
  try {
    results = await api.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => globalThis.__uvc?.probe() ?? null,
    });
  } catch {
    return null; // restricted page (browser settings, extension store, PDF viewer, …)
  }
  let best = null;
  for (const { frameId, result } of results ?? []) {
    if (result && (!best || result.score > best.score)) best = { frameId, score: result.score };
  }
  return best?.frameId ?? null;
}

async function send(tabId, frameId, action, value) {
  try {
    const state = await api.tabs.sendMessage(tabId, { type: 'uvc', action, value }, { frameId });
    return state && { ...state, frameId };
  } catch {
    return null; // frame navigated away or has no content script
  }
}

// `knownFrameId` lets the popup skip re-probing on every slider tick.
async function control(tabId, action, value, knownFrameId) {
  if (knownFrameId != null) {
    const state = await send(tabId, knownFrameId, action, value);
    if (state?.hasMedia) return state;
  }
  const frameId = await findMediaFrame(tabId);
  return (frameId != null && (await send(tabId, frameId, action, value))) || { hasMedia: false };
}

// Speed is shared by every tab (content.js keeps it in storage.local), so the badge is global too.
function updateBadge(rate = 1) {
  const text = Math.abs(rate - 1) < 0.001 ? '' : String(+rate.toFixed(2));
  api.action.setBadgeText({ text }).catch(() => {});
}
api.storage.local.get('speed').then(({ speed }) => updateBadge(speed));
api.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && 'speed' in changes) updateBadge(changes.speed.newValue);
});

// Command names in manifest.json match the content script's action names.
api.commands.onCommand.addListener(async (command, tab) => {
  tab ??= (await api.tabs.query({ active: true, currentWindow: true }))[0];
  if (tab?.id == null) return;
  await control(tab.id, command);
});

api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'uvc-popup' || msg.tabId == null) return;
  control(msg.tabId, msg.action, msg.value, msg.frameId).then(sendResponse);
  return true; // async response
});

// Chrome doesn't inject declared content scripts into tabs that were already open,
// so do it here; otherwise those tabs need a reload. content.js ignores a second injection.
api.runtime.onInstalled.addListener(async () => {
  const tabs = await api.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  for (const tab of tabs) {
    const target = { tabId: tab.id, allFrames: true };
    api.scripting.insertCSS({ target, files: ['content.css'] }).catch(() => {});
    api.scripting.executeScript({ target, files: ['defaults.js', 'content.js'] }).catch(() => {});
  }
});
