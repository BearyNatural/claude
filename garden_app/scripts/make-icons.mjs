// Generates app icons from an original SVG emblem (seedling under a rising sun).
// Run: node scripts/make-icons.mjs   (requires `sharp`)
import sharp from 'sharp';
import { writeFileSync } from 'node:fs';

const emblem = (bg) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  ${bg ? `<rect width="1024" height="1024" rx="0" fill="${bg}"/>` : ''}
  <circle cx="512" cy="600" r="250" fill="#F2C14E" opacity="0.95"/>
  <rect x="0" y="600" width="1024" height="424" fill="${bg ?? 'none'}"/>
  <path d="M150 640 Q512 590 874 640 L874 700 Q512 660 150 700 Z" fill="#8B5E3C"/>
  <path d="M512 640 C512 560 512 470 512 400" stroke="#F6F4EE" stroke-width="34" stroke-linecap="round" fill="none"/>
  <path d="M512 470 C430 470 350 420 330 330 C420 320 500 370 512 470 Z" fill="#F6F4EE"/>
  <path d="M512 420 C590 420 680 370 700 270 C600 262 520 320 512 420 Z" fill="#DDEBDD"/>
</svg>`;

const icon = emblem('#2F6B3F');
await sharp(Buffer.from(icon)).resize(1024, 1024).png().toFile('assets/icon.png');
await sharp(Buffer.from(icon)).resize(48, 48).png().toFile('assets/favicon.png');
// Adaptive icon foreground: transparent background, emblem within the safe zone.
const fg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><g transform="translate(192 192) scale(0.625)">${emblem('#2F6B3F').replace(/<\/?svg[^>]*>/g, '')}</g></svg>`;
await sharp(Buffer.from(fg)).resize(1024, 1024).png().toFile('assets/adaptive-icon.png');
const splash = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1284 2778"><defs><clipPath id="r"><rect width="1024" height="1024" rx="220"/></clipPath></defs><rect width="1284" height="2778" fill="#F6F4EE"/><g transform="translate(386 1133) scale(0.5)" clip-path="url(#r)">${emblem('#2F6B3F').replace(/<\/?svg[^>]*>/g, '')}</g></svg>`;
await sharp(Buffer.from(splash)).png().toFile('assets/splash.png');
writeFileSync('assets/emblem.svg', icon);
console.log('icons written');
