#!/usr/bin/env node
// Static checks on the built site: structure, accessibility basics, honesty rules. Exit 1 on any failure.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, 'dist');
const problems = [];
const banned = [/testimonial/i, /trusted by \d/i, /\b\d[\d,]* (developers|teams|users|companies) (use|trust|rely)/i, /lorem ipsum/i, /★|⭐/];
for (const f of fs.readdirSync(dist).filter((n) => n.endsWith('.html') && n !== 'preview.html')) {
  const html = fs.readFileSync(path.join(dist, f), 'utf8');
  const need = (re, msg) => { if (!re.test(html)) problems.push(`${f}: ${msg}`); };
  need(/<title>[^<]{3,}<\/title>/, 'missing <title>');
  need(/<meta name="viewport"/, 'missing viewport meta');
  need(/<main id="main">/, 'missing <main id="main">');
  need(/<h1[\s>]/, 'missing <h1>');
  need(/<nav class="site-nav" aria-label/, 'missing labelled nav');
  need(/class="skip-link"/, 'missing skip link');
  if ((html.match(/<h1[\s>]/g) || []).length > 1) problems.push(`${f}: more than one <h1>`);
  for (const m of html.matchAll(/<img\b[^>]*>/g)) if (!/\balt=/.test(m[0])) problems.push(`${f}: <img> without alt`);
  for (const m of html.matchAll(/<svg\b[^>]*>/g)) if (!/aria-hidden="true"|role="img"/.test(m[0])) problems.push(`${f}: <svg> without aria-hidden or role=img`);
  for (const m of html.matchAll(/<button\b[^>]*>/g)) if (!/type="button"/.test(m[0])) problems.push(`${f}: <button> without type`);
  for (const m of html.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>/g)) { const href = m[1]; if (href.endsWith('.html') && !fs.existsSync(path.join(dist, href.split('#')[0]))) problems.push(`${f}: broken link ${href}`); }
  for (const m of html.matchAll(/<a\b[^>]*>(\s*)<\/a>/g)) problems.push(`${f}: empty link text`);
  for (const re of banned) if (re.test(html)) problems.push(`${f}: banned pattern ${re}`);
  const allowed = /^(https:\/\/code\.claude\.com\/|https:\/\/github\.com\/OWNER\/REPO|https:\/\/github\.com\/worklab-studio\/claude-code-relay|https:\/\/synchrobuilder\.dev\/schema\/|https:\/\/fonts\.googleapis\.com\/|http:\/\/localhost)/;
  for (const m of html.matchAll(/https?:\/\/[^"'\s<)]+/g)) if (!allowed.test(m[0])) problems.push(`${f}: external URL not on the allowlist ${m[0]}`);
  // heading order: no jump larger than one level
  let last = 1;
  for (const m of html.matchAll(/<h([1-6])[\s>]/g)) { const n = Number(m[1]); if (n > last + 1) problems.push(`${f}: heading jumps from h${last} to h${n}`); last = n; }
}
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
console.log('site check passed');
