#!/usr/bin/env node
// Builds the Synchrobuilder site from site/src/ with nothing but the Node standard library.
//   node site/build.mjs                 -> site/dist/*.html + styles.css + site.js + fonts/
//   node site/build.mjs --single out.html  -> one self-contained file (used for the hosted preview)
// The Commands page is generated from docs/commands.md so it cannot drift from the reference.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const src = path.join(here, 'src');
const args = process.argv.slice(2);
const singleIndex = args.indexOf('--single');
const single = singleIndex !== -1;
const singleOut = single ? path.resolve(args[singleIndex + 1] || path.join(here, 'dist', 'preview.html')) : null;
const outDir = path.join(here, 'dist');

const PAGES = [
  { id: 'home', file: 'index.html', out: 'index.html', nav: 'Home' },
  { id: 'install', file: 'install.html', out: 'install.html', nav: 'Install' },
  { id: 'commands', file: 'commands.html', out: 'commands.html', nav: 'Commands' },
  { id: 'how-it-works', file: 'how-it-works.html', out: 'how-it-works.html', nav: 'How it works' },
  { id: 'security', file: 'security.html', out: 'security.html', nav: 'Security' },
  { id: 'pricing', file: 'pricing.html', out: 'pricing.html', nav: 'Pricing' },
  { id: 'manifest', file: 'manifest.html', out: 'manifest.html', nav: 'Manifest' },
];

const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function parseMeta(html) {
  const m = html.match(/^\s*<!--\s*([\s\S]*?)-->/);
  const meta = {};
  if (m) for (const part of m[1].split('|')) { const [k, ...v] = part.split(':'); if (k && v.length) meta[k.trim()] = v.join(':').trim(); }
  return { meta, body: m ? html.slice(m[0].length) : html };
}

function parseCommands(md) {
  const blocks = md.split(/^## /m).slice(1);
  return blocks.map((block) => {
    const lines = block.split('\n');
    const name = lines[0].trim();
    const fields = {};
    const paras = [];
    let i = 1;
    for (; i < lines.length; i++) {
      const line = lines[i];
      const f = line.match(/^- ([A-Za-z ]+): (.*)$/);
      if (f) fields[f[1].trim()] = f[2].trim(); else if (line.trim() === '' && Object.keys(fields).length === 0) continue; else break;
    }
    for (const line of lines.slice(i).join('\n').split(/\n\s*\n/)) { const t = line.trim(); if (t) paras.push(t); }
    return { name, fields, paras };
  });
}

function inlineCode(text) {
  return esc(text).replace(/`([^`]+)`/g, '<code>$1</code>');
}

function renderCommands() {
  const cmds = parseCommands(read(path.join(repo, 'docs', 'commands.md')));
  const groups = [['Portability', 'Pillar A: portability'], ['Multiplayer', 'Pillar B: multiplayer'], ['Both', 'Housekeeping']];
  let html = '';
  for (const [key, label] of groups) {
    const list = cmds.filter((c) => c.fields.Pillar === key);
    if (!list.length) continue;
    html += `<h3 class="eyebrow" style="margin-top:.5rem">${esc(label)}</h3>\n<div class="cmd-list">\n`;
    for (const c of list) {
      const status = (c.fields.Status || 'planned').toLowerCase();
      html += `<article class="cmd-item" id="cmd-${esc(c.name)}">\n<header><h3>${esc(c.fields.Slash && c.fields.Slash !== 'none' ? c.fields.Slash.split(' ')[0] : 'npx synchrobuilder ' + c.name)}</h3><span class="pill pill--${status === 'available' ? 'ok' : 'planned'}">${esc(status)}${c.fields.Phase ? ' · phase ' + esc(c.fields.Phase) : ''}</span></header>\n`;
      html += `<p>${inlineCode(c.fields.Summary || '')}</p>\n<dl>`;
      for (const k of ['Slash', 'Short form', 'CLI']) if (c.fields[k]) html += `<dt>${esc(k)}</dt><dd>${c.fields[k].startsWith('none') || c.fields[k].startsWith('/statusline is') ? inlineCode(c.fields[k]) : '<code>' + esc(c.fields[k]) + '</code>'}</dd>`;
      html += `</dl>\n`;
      for (const p of c.paras) html += `<p>${inlineCode(p)}</p>\n`;
      html += `</article>\n`;
    }
    html += `</div>\n`;
  }
  return { html, count: cmds.length };
}

function hrefFor(id) {
  const page = PAGES.find((p) => p.id === id);
  if (!page) throw new Error('unknown page id ' + id);
  return single ? '#' + id : page.out;
}

function resolveLinks(html) {
  // {{href:install}} tokens in partials and pages
  html = html.replace(/\{\{href:([a-z-]+)\}\}/g, (_, id) => hrefFor(id));
  if (single) {
    for (const p of PAGES) html = html.split(`href="${p.out}`).join(`href="#${p.id}`).replace(new RegExp(`href="#${p.id}#[a-z0-9-]+"`, 'g'), `href="#${p.id}"`);
  }
  return html;
}

const partial = (name) => read(path.join(src, 'partials', name + '.html'));
const css = read(path.join(src, 'styles.css'));
const js = read(path.join(src, 'site.js'));

const pages = PAGES.map((p) => {
  let raw = read(path.join(src, 'pages', p.file));
  const { meta, body } = parseMeta(raw);
  let content = body;
  if (p.id === 'commands') {
    const { html, count } = renderCommands();
    content = content.replace('<!-- @commands -->', html).replace('<!-- @count -->', String(count));
  }
  return { ...p, title: meta.title || p.nav, description: meta.description || '', content };
});

function navHtml(activeId) {
  return pages.filter((p) => p.id !== 'home').map((p) => `<a href="${hrefFor(p.id)}"${!single && p.id === activeId ? ' aria-current="page"' : ''}>${esc(p.nav)}</a>`).join('\n      ');
}

function shell(page, inner) {
  const header = partial('header').replace('<!-- @nav -->', navHtml(page.id));
  return resolveLinks(partial('banner') + header + `<main id="main">\n${inner}\n</main>\n` + partial('footer'));
}

if (!single) {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(outDir, 'fonts'), { recursive: true });
  fs.writeFileSync(path.join(outDir, 'styles.css'), css);
  fs.writeFileSync(path.join(outDir, 'site.js'), js);
  for (const f of fs.readdirSync(path.join(src, 'fonts'))) fs.copyFileSync(path.join(src, 'fonts', f), path.join(outDir, 'fonts', f));
  for (const page of pages) {
    const doc = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(page.id === 'home' ? 'Synchrobuilder' : page.title + ' · Synchrobuilder')}</title>
<meta name="description" content="${esc(page.description)}">
<meta name="color-scheme" content="light dark">
<link rel="stylesheet" href="styles.css">
<script defer src="site.js"></script>
</head>
<body>
${shell(page, `<div class="page" id="page-${page.id}">\n${page.id === 'home' ? '' : `<h1 class="visually-hidden">${esc(page.title)}</h1>\n`}${page.content}\n</div>`)}
</body>
</html>
`;
    fs.writeFileSync(path.join(outDir, page.out), doc);
  }
  console.log(`built ${pages.length} pages into ${path.relative(repo, outDir)}/`);
} else {
  const fontPath = path.join(src, 'fonts', 'BricolageGrotesque-latin.woff2');
  const fontUri = 'data:font/woff2;base64,' + fs.readFileSync(fontPath).toString('base64');
  const cssInline = css.replace('url("fonts/BricolageGrotesque-latin.woff2")', `url("${fontUri}")`);
  const inner = pages.map((p) => `<section class="page${p.id === 'home' ? ' is-active' : ''}" id="page-${p.id}" aria-label="${esc(p.nav)}">\n${p.content}\n</section>`).join('\n');
  const doc = `<title>Synchrobuilder</title>
<style>
${cssInline}
.single .page { display: none; }
.single .page.is-active { display: block; }
</style>
<div class="single" data-mode="single">
${shell({ id: 'home' }, inner)}
</div>
<script>
${js.replace("document.body.getAttribute('data-mode') === 'single'", "document.querySelector('.single') !== null")}
</script>
`;
  fs.mkdirSync(path.dirname(singleOut), { recursive: true });
  fs.writeFileSync(singleOut, doc);
  console.log(`built single-file preview at ${path.relative(repo, singleOut)} (${(doc.length / 1024).toFixed(0)} KB)`);
}
