import { mkdirSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { join } from 'node:path';

import sharp from 'sharp';

const root = process.cwd();
const assets = join(root, 'tenants', 'stillpoint-builders', 'assets');

const palette = {
  ink: '#161B22', steel: '#22303C', blue: '#4C7DA6', paper: '#F4F6F8', white: '#FFFFFF',
};

const serviceArt = [
  ['project-consultation', 'CONSULT', 'M 190 590 L 430 350 L 670 590'],
  ['preconstruction-plan', 'PLAN', 'M 170 575 H 690 V 260 H 170 Z M 270 260 V 575 M 500 260 V 575'],
  ['kitchen-renovation', 'KITCHEN', 'M 170 570 H 690 V 360 H 170 Z M 430 360 V 570 M 235 435 H 365'],
  ['bathroom-renovation', 'BATH', 'M 175 475 H 685 V 560 H 175 Z M 245 475 V 340 H 335'],
  ['warranty-service-visit', 'WARRANTY', 'M 430 205 L 650 300 V 445 C 650 555 555 635 430 675 C 305 635 210 555 210 445 V 300 Z'],
];

const supportArt = [
  ['hero/stones.webp', 'BUILD WITH CLARITY', 'PROJECT DELIVERY'],
  ['gift/birthday-cake.webp', 'NEW HOME', 'MILESTONE'],
  ['gift/birthday-confetti.webp', 'BREAK GROUND', 'MILESTONE'],
  ['gift/congrats-bloom.webp', 'PROJECT WON', 'MILESTONE'],
  ['gift/congrats-gold.webp', 'HANDOFF READY', 'MILESTONE'],
  ['gift/grateful.webp', 'THANK YOUR CREW', 'RECOGNITION'],
  ['gift/healing-oil.webp', 'SAFETY FIRST', 'RECOGNITION'],
  ['gift/quiet-hour.webp', 'FOCUS TIME', 'RECOGNITION'],
  ['gift/thank-you.webp', 'CLIENT THANKS', 'RECOGNITION'],
  ['rewards/liquid-nebula.webp', 'BUILD REWARDS', 'CLIENT BENEFITS'],
];

function svgFrame(title, subtitle, path = 'M 170 590 L 430 245 L 690 590') {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="860" height="760" viewBox="0 0 860 760">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${palette.ink}"/><stop offset="1" stop-color="${palette.steel}"/></linearGradient></defs>
    <rect width="860" height="760" rx="48" fill="url(#g)"/>
    <path d="M0 610 L300 420 L500 520 L860 260 V760 H0Z" fill="${palette.blue}" opacity=".22"/>
    <g fill="none" stroke="${palette.blue}" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"/><path d="M125 650 H735"/></g>
    <text x="72" y="92" fill="${palette.paper}" font-family="Arial, sans-serif" font-size="28" font-weight="700" letter-spacing="7">STILLPOINT BUILDERS</text>
    <text x="72" y="675" fill="${palette.white}" font-family="Arial, sans-serif" font-size="42" font-weight="700">${title}</text>
    <text x="72" y="716" fill="${palette.blue}" font-family="Arial, sans-serif" font-size="20" font-weight="700" letter-spacing="5">${subtitle}</text>
  </svg>`);
}

async function writeWebp(relative, image, width = 1200, height = 900) {
  const output = join(assets, relative);
  mkdirSync(join(output, '..'), { recursive: true });
  await sharp(image).resize(width, height, { fit: 'cover' }).webp({ quality: 88 }).toFile(output);
}

await Promise.all(serviceArt.map(([slug, title, path]) => (
  writeWebp(`menu/${slug}.webp`, svgFrame(title, 'PROJECT SERVICE', path))
)));
await Promise.all(supportArt.map(([relative, title, subtitle]) => (
  writeWebp(relative, svgFrame(title, subtitle), 1400, 1000)
)));

console.log('Generated Stillpoint construction media.');
