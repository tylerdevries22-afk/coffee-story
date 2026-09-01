const wall = document.getElementById('wall');

const HARDWARE = {
  tv: { x: 13, y: 13, base: 18 },
  desktop: { x: 12, y: 14, base: 26 },
  tablet: { x: 12, y: 12, base: 0 },
  phone: { x: 13, y: 14, base: 0 },
};

function fault(message, detail) {
  const note = document.createElement('p');
  const code = document.createElement('code');
  note.className = 'fault';
  note.append(message, ' ', code);
  code.textContent = detail;
  wall.appendChild(note);
}

function validSurface(value) {
  return value && typeof value === 'object'
    && typeof value.name === 'string'
    && typeof value.device === 'string'
    && typeof value.port === 'number'
    && typeof value.path === 'string'
    && Number.isInteger(value.width) && value.width > 0
    && Number.isInteger(value.height) && value.height > 0
    && Number.isInteger(value.span) && value.span > 0
    && Object.hasOwn(HARDWARE, value.frame);
}

function createCell(surface, url) {
  const cell = document.createElement('figure');
  cell.className = 'cell';
  cell.dataset.span = String(surface.span);
  cell.dataset.frame = surface.frame;
  cell.innerHTML = `
    <figcaption><span class="dot"></span><span class="name"></span>
    <span class="meta"><a target="_blank" rel="noreferrer"></a> · <span class="note"></span></span></figcaption>
    <div class="stage"><div class="device"><div class="viewport"><iframe class="screen"></iframe></div></div></div>`;
  cell.querySelector('.name').textContent = surface.name;
  cell.querySelector('.note').textContent = `${surface.device} · ${surface.width}×${surface.height}`;
  const link = cell.querySelector('.meta a');
  link.href = url;
  link.textContent = `:${surface.port}`;
  return cell;
}

function mount(surface) {
  if (!validSurface(surface)) {
    fault('Could not load a valid surface definition.', 'Check wall-surfaces.json.');
    return;
  }
  const url = `http://localhost:${surface.port}${surface.path}`;
  const hardware = HARDWARE[surface.frame];
  const cell = createCell(surface, url);
  const device = cell.querySelector('.device');
  const stage = cell.querySelector('.stage');
  const frame = cell.querySelector('iframe');
  const dot = cell.querySelector('.dot');
  device.classList.add(`device--${surface.frame}`);
  device.style.setProperty('--screen-w', `${surface.width}px`);
  device.style.setProperty('--screen-h', `${surface.height}px`);
  device.style.setProperty('--frame-x', `${hardware.x}px`);
  device.style.setProperty('--frame-y', `${hardware.y}px`);
  device.style.width = `${surface.width + (hardware.x * 2)}px`;
  device.style.height = `${surface.height + (hardware.y * 2)}px`;
  frame.width = surface.width;
  frame.height = surface.height;
  frame.src = url;
  frame.title = `${surface.name} at ${surface.width} by ${surface.height}`;
  frame.addEventListener('load', () => dot.classList.add('up'));
  wall.appendChild(cell);

  const fit = () => {
    const outerWidth = surface.width + (hardware.x * 2);
    const outerHeight = surface.height + (hardware.y * 2) + hardware.base;
    const scale = Math.min(stage.clientWidth / outerWidth, stage.clientHeight / outerHeight);
    device.style.left = `${Math.round((stage.clientWidth - (outerWidth * scale)) / 2)}px`;
    device.style.top = `${Math.round((stage.clientHeight - (outerHeight * scale)) / 2)}px`;
    device.style.transform = `scale(${scale})`;
  };
  new ResizeObserver(fit).observe(stage);
  fit();
}

fetch('./wall-surfaces.json')
  .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`))))
  .then((data) => {
    if (!data || !Array.isArray(data.surfaces)) throw new Error('Missing surfaces');
    data.surfaces.forEach(mount);
  })
  .catch(() => fault('Could not read the surface list — re-publish the wall with', 'pnpm preview --wall'));

document.getElementById('reload').addEventListener('click', () => {
  for (const frame of document.querySelectorAll('iframe.screen')) frame.src = frame.src;
});
