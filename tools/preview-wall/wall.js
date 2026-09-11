import {
  HARDWARE,
  presetMap,
  validWallData,
} from './wall-model.mjs';

const wall = document.getElementById('wall');
const heading = document.getElementById('wall-title');
const orgSelect = document.getElementById('wall-org');
const fits = new WeakMap();
const framesByLaunch = new Map();
const resizeObserver = new ResizeObserver((entries) => {
  for (const { target } of entries) fits.get(target)?.();
});

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function fault(message, detail) {
  const note = element('p', 'fault');
  const code = element('code', '', detail);
  note.setAttribute('role', 'alert');
  note.append(message, ' ', code);
  wall.appendChild(note);
}

function surfaceUrl(surface, organization) {
  const fromOrg = organization?.surfaces?.[surface.launch];
  if (typeof fromOrg === 'string' && fromOrg.length > 0) return fromOrg;
  if (typeof surface.url === 'string' && surface.url.length > 0) return surface.url;
  const hostname = window.location.hostname.includes(':')
    ? `[${window.location.hostname}]`
    : window.location.hostname;
  return `${window.location.protocol}//${hostname}:${surface.port}${surface.path}`;
}

function createSelector(surface, presets, selected, onChange) {
  const fieldset = element('fieldset', 'device-toggle');
  fieldset.appendChild(element('legend', 'sr-only', `${surface.name} preview device`));
  for (const preset of presets) {
    const label = element('label', 'device-option');
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = `device-${surface.launch}`;
    input.value = preset.id;
    input.checked = preset.id === selected;
    input.addEventListener('change', () => {
      if (input.checked) onChange(preset.id);
    });
    label.append(input, element('span', '', preset.label));
    fieldset.appendChild(label);
  }
  return fieldset;
}

function createCell(surface, url) {
  const cell = element('figure', 'cell');
  const caption = document.createElement('figcaption');
  const name = element('span', 'name', surface.name);
  const meta = element('span', 'meta');
  const link = element('a', '', new URL(url, window.location.href).host || url);
  const note = element('span', 'note');
  const stage = element('div', 'stage');
  const device = element('div', 'device');
  const viewport = element('div', 'viewport');
  const frame = element('iframe', 'screen');
  link.href = url;
  link.target = '_blank';
  link.rel = 'noreferrer';
  meta.append(link, ' · ', note);
  frame.src = url;
  frame.referrerPolicy = 'no-referrer';
  frame.setAttribute('sandbox', 'allow-forms allow-popups allow-same-origin allow-scripts');
  viewport.appendChild(frame);
  device.appendChild(viewport);
  stage.appendChild(device);
  caption.appendChild(name);
  cell.append(caption, stage);
  cell.dataset.span = String(surface.span);
  return { caption, cell, device, frame, link, meta, note, stage };
}

function mount(surface, presetsById, organization) {
  const url = surfaceUrl(surface, organization);
  let selected = surface.activeDevice;
  let preset = presetsById.get(selected);
  const available = surface.devices.map((id) => presetsById.get(id));
  if (!preset || available.some((item) => !item)) return fault('Invalid device profile for', surface.name);
  const view = createCell(surface, url);
  framesByLaunch.set(surface.launch, view);

  const fit = () => {
    const hardware = HARDWARE[preset.frame];
    const outerWidth = preset.width + (hardware.x * 2);
    const outerHeight = preset.height + (hardware.y * 2) + hardware.base;
    if (view.stage.clientWidth === 0 || view.stage.clientHeight === 0) return;
    const scale = Math.min(view.stage.clientWidth / outerWidth, view.stage.clientHeight / outerHeight);
    view.device.style.left = `${Math.round((view.stage.clientWidth - (outerWidth * scale)) / 2)}px`;
    view.device.style.top = `${Math.round((view.stage.clientHeight - (outerHeight * scale)) / 2)}px`;
    view.device.style.transform = `scale(${scale})`;
  };
  const apply = (id) => {
    const next = presetsById.get(id);
    if (!next || !surface.devices.includes(id)) return;
    selected = id;
    preset = next;
    const hardware = HARDWARE[preset.frame];
    view.device.className = `device device--${preset.frame}`;
    view.device.style.setProperty('--screen-w', `${preset.width}px`);
    view.device.style.setProperty('--screen-h', `${preset.height}px`);
    view.device.style.setProperty('--frame-x', `${hardware.x}px`);
    view.device.style.setProperty('--frame-y', `${hardware.y}px`);
    view.device.style.width = `${preset.width + (hardware.x * 2)}px`;
    view.device.style.height = `${preset.height + (hardware.y * 2)}px`;
    view.frame.width = String(preset.width);
    view.frame.height = String(preset.height);
    view.frame.title = `${surface.name}, ${preset.device}, ${preset.width} by ${preset.height}`;
    view.note.textContent = `${preset.device} · ${preset.width}×${preset.height}`;
    fit();
  };
  const selector = createSelector(surface, available, selected, apply);
  view.caption.append(selector, view.meta);
  wall.appendChild(view.cell);
  fits.set(view.stage, fit);
  resizeObserver.observe(view.stage);
  apply(selected);
}

function retarget(data, organization) {
  heading.textContent = `${organization.organizationName} · five apps`;
  for (const surface of data.surfaces) {
    const view = framesByLaunch.get(surface.launch);
    if (!view) continue;
    const url = surfaceUrl(surface, organization);
    if (view.frame.src !== url) view.frame.src = url;
    view.link.href = url;
    view.link.textContent = new URL(url, window.location.href).host || url;
  }
}

fetch('./wall-surfaces.json', { signal: AbortSignal.timeout(10_000) })
  .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`))))
  .then((data) => {
    if (!validWallData(data)) throw new Error('Invalid wall data');
    const organizations = Array.isArray(data.organizations) && data.organizations.length > 0
      ? data.organizations
      : [{
        tenantKey: data.context.tenantKey,
        organizationName: data.context.organizationName,
        surfaces: Object.fromEntries(data.surfaces.map((surface) => [surface.launch, surfaceUrl(surface)])),
      }];
    let current = organizations.find((org) => org.tenantKey === data.context.tenantKey) ?? organizations[0];
    heading.textContent = `${current.organizationName} · five apps`;
    if (orgSelect) {
      orgSelect.replaceChildren();
      for (const org of organizations) {
        const option = document.createElement('option');
        option.value = org.tenantKey;
        option.textContent = org.organizationName;
        option.selected = org.tenantKey === current.tenantKey;
        orgSelect.appendChild(option);
      }
      orgSelect.hidden = organizations.length < 2;
      orgSelect.addEventListener('change', () => {
        const next = organizations.find((org) => org.tenantKey === orgSelect.value);
        if (!next) return;
        current = next;
        retarget(data, current);
      });
    }
    const presetsById = presetMap(data);
    data.surfaces.forEach((surface) => mount(surface, presetsById, current));
    window.addEventListener('message', (event) => {
      const payload = event.data;
      if (!payload || payload.type !== 'platform-org-changed') return;
      const next = organizations.find((org) => org.tenantKey === payload.tenantKey
        || org.organizationId === payload.organizationId);
      if (!next) return;
      current = next;
      if (orgSelect) orgSelect.value = next.tenantKey;
      retarget(data, current);
    });
  })
  .catch(() => fault('Could not read the surface list — re-publish the wall with', 'pnpm preview'));

document.getElementById('reload').addEventListener('click', () => {
  for (const frame of document.querySelectorAll('iframe.screen')) frame.src = frame.src;
});
