#!/usr/bin/env node
// Renders the social card (site/src/og-image.png, 1200x630) and the touch icon from an HTML template,
// using whichever Chrome is installed. Run it when the wording or the palette changes; the PNGs are
// committed, so neither the site build nor CI needs a browser.
//   node scripts/og-image.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(repo, 'site', 'src');

const CHROME = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  'google-chrome', 'chromium', 'chromium-browser',
];

function findChrome() {
  for (const c of CHROME) {
    if (c.startsWith('/')) { if (fs.existsSync(c)) return c; continue; }
    const r = spawnSync('command', ['-v', c], { encoding: 'utf8', shell: false });
    if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  }
  return null;
}

const card = ({ width, height, body }) => `<!doctype html><html><head><meta charset="utf-8"><style>
  @font-face { font-family: 'Bricolage'; src: url('fonts/BricolageGrotesque-latin.woff2') format('woff2'); font-weight: 500 800; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: ${width}px; height: ${height}px; background: #0f1b19; color: #e7efec;
         font-family: 'Bricolage', system-ui, sans-serif; display: flex; overflow: hidden; }
  ${body}
</style></head><body>${body.includes('.card') ? '' : ''}<div class="card"></div></body></html>`;

const og = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: 'Bricolage'; src: url('fonts/BricolageGrotesque-latin.woff2') format('woff2'); font-weight: 500 800; font-display: block; }
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 1200px; height: 630px; }
body { background: #0f1b19; color: #e7efec; font-family: 'Bricolage', system-ui, -apple-system, sans-serif;
       padding: 72px 80px; display: flex; flex-direction: column; justify-content: space-between; overflow: hidden; }
.mark { display: flex; align-items: center; gap: 18px; }
.mark svg { width: 64px; height: 38px; }
.mark span { font-size: 34px; font-weight: 800; letter-spacing: -0.02em; }
h1 { font-size: 78px; font-weight: 800; line-height: 1.02; letter-spacing: -0.03em; max-width: 17ch; }
h1 em { font-style: normal; color: #3fcdb4; }
.cmd { font-family: ui-monospace, 'SF Mono', Menlo, monospace; font-size: 30px; color: #8ce6d5;
       background: rgba(63,205,180,0.10); border: 1px solid rgba(63,205,180,0.32); border-radius: 10px;
       padding: 16px 24px; display: inline-block; }
.foot { display: flex; justify-content: space-between; align-items: flex-end; font-size: 24px; color: #8ea39d; }
</style></head><body>
<div class="mark">
  <svg viewBox="0 0 34 20"><circle cx="5" cy="10" r="4" fill="#3fcdb4"/><circle cx="29" cy="10" r="4" fill="#3fcdb4"/><path d="M9 10h16" stroke="#3fcdb4" stroke-width="2" stroke-dasharray="3 3" fill="none"/></svg>
  <span>Synchrobuilder</span>
</div>
<h1>Multiplayer Claude Code for teams on <em>any laptop</em>.</h1>
<div class="foot">
  <span class="cmd">npx synchrobuilder@latest install</span>
  <span>No server. MIT.</span>
</div>
</body></html>`;

const icon = `<!doctype html><html><head><meta charset="utf-8"><style>
* { margin:0; padding:0 } html,body { width:180px; height:180px }
body { background:#0f1b19; display:flex; align-items:center; justify-content:center; border-radius:40px; }
svg { width:120px; height:70px }
</style></head><body><svg viewBox="0 0 34 20"><circle cx="5" cy="10" r="4" fill="#3fcdb4"/><circle cx="29" cy="10" r="4" fill="#3fcdb4"/><path d="M9 10h16" stroke="#3fcdb4" stroke-width="2" stroke-dasharray="3 3" fill="none"/></svg></body></html>`;

const chrome = findChrome();
if (!chrome) {
  console.error('No Chrome, Chromium or Edge found. The committed PNGs are unchanged.');
  process.exit(1);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-og-'));
fs.mkdirSync(path.join(tmp, 'fonts'), { recursive: true });
fs.copyFileSync(path.join(out, 'fonts', 'BricolageGrotesque-latin.woff2'), path.join(tmp, 'fonts', 'BricolageGrotesque-latin.woff2'));

for (const [name, html, size] of [['og-image.png', og, '1200,630'], ['apple-touch-icon.png', icon, '180,180']]) {
  const page = path.join(tmp, name.replace('.png', '.html'));
  fs.writeFileSync(page, html);
  const shot = path.join(tmp, name);
  const r = spawnSync(chrome, ['--headless', '--disable-gpu', '--hide-scrollbars', '--no-sandbox',
    `--screenshot=${shot}`, `--window-size=${size}`, `file://${page}`], { encoding: 'utf8', timeout: 60000 });
  if (!fs.existsSync(shot)) { console.error(`failed to render ${name}: ${(r.stderr || '').split('\n').slice(0, 3).join(' ')}`); continue; }
  fs.copyFileSync(shot, path.join(out, name));
  console.log(`wrote site/src/${name} (${Math.round(fs.statSync(shot).size / 1024)} KB)`);
}
