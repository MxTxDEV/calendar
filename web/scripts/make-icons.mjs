// Gera os ícones PNG do PWA a partir de public/icons/icon.svg (usa o Chromium do Playwright)
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import fs from 'node:fs';

// usa o Playwright do projeto, se existir, ou o instalado globalmente
const require = createRequire(import.meta.url);
const globalRoot = execSync('npm root -g').toString().trim();
const { chromium } = require(require.resolve('playwright', { paths: [process.cwd(), globalRoot] }));

const svg = fs.readFileSync('public/icons/icon.svg', 'utf8');
const maskable = svg
  .replace(/<rect width="512" height="512" rx="112" fill="url\(#g\)"\/>/, '<rect width="512" height="512" fill="url(#g)"/>')
  .replace('viewBox="0 0 512 512"', 'viewBox="-64 -64 640 640"');
const jobs = [
  ['icon-192.png', svg, 192],
  ['icon-512.png', svg, 512],
  ['apple-touch-icon.png', maskable, 180],
  ['maskable-512.png', maskable, 512],
];
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, src, size] of jobs) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{width:${size}px;height:${size}px;display:block}</style>${src}`);
  await page.screenshot({ path: `public/icons/${name}`, omitBackground: true });
}
await browser.close();
console.log('ícones gerados');
