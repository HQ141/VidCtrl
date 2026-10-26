// Unified Video Control — options page. Each field saves as soon as it changes.
// Inputs with data-scale show a stored fraction as a percentage.
const api = globalThis.browser ?? globalThis.chrome;
const form = document.getElementById('form');
const status = document.getElementById('status');
const scaleOf = (input) => Number(input.dataset.scale ?? 1);

function syncDisabled() {
  form.elements.maxBoost.disabled = !form.elements.allowBoost.checked;
}

form.addEventListener('change', async (e) => {
  const input = e.target;
  let value;
  if (input.type === 'checkbox') {
    value = input.checked;
  } else {
    value = input.valueAsNumber / scaleOf(input);
    if (!input.checkValidity() || !Number.isFinite(value)) {
      status.textContent = `Not saved: ${input.validationMessage || 'enter a number'}`;
      return;
    }
  }
  await api.storage.sync.set({ [input.name]: value });
  syncDisabled();
  status.textContent = 'Saved';
});

form.addEventListener('submit', (e) => e.preventDefault());

(async () => {
  const settings = await api.storage.sync.get(UVC_DEFAULTS);
  for (const [key, value] of Object.entries(settings)) {
    const input = form.elements[key];
    if (!input) continue;
    if (input.type === 'checkbox') input.checked = value;
    else input.value = Math.round(value * scaleOf(input) * 100) / 100;
  }
  syncDisabled();
})();
