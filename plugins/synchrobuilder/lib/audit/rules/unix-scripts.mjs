// Unix-only commands and shell syntax in package.json scripts (plus Makefile recipes and composer.json scripts).
// npm runs scripts through cmd.exe on Windows, where rm, cp, $VAR, single quotes and friends do not exist.
import { lineOf } from '../engine.mjs';

const RUNNERS = new Set(['node', 'npm', 'npx', 'pnpm', 'yarn', 'bun', 'deno', 'tsc', 'tsx', 'vite', 'vitest', 'jest', 'mocha', 'eslint', 'prettier', 'next', 'nuxt', 'astro', 'webpack', 'rollup', 'esbuild', 'nodemon', 'ts-node', 'cross-env', 'rimraf', 'npm-run-all', 'run-s', 'run-p', 'concurrently']);
const SHELL_CHARS = /[&|;<>$`']/;
const COMMANDS = {
  rm: 'delete with fs.rmSync(p, { recursive: true, force: true }) from a small node script (rimraf-style) or "node -e"',
  cp: 'copy with fs.cpSync(src, dest, { recursive: true }) from a node script',
  mv: 'move with fs.renameSync from a node script',
  mkdir: 'create with fs.mkdirSync(p, { recursive: true }) from a node script',
  touch: 'create the file with fs.writeFileSync(p, "", { flag: "a" }) from a node script',
  cat: 'read and concatenate with fs.readFileSync from a node script',
  ln: 'avoid symlinks in scripts; if needed, fs.symlinkSync from a node script (Windows needs a privilege for them)',
  chmod: 'drop it (Windows has no mode bits) or call fs.chmodSync from a node script guarded by process.platform',
  chown: 'drop it; Windows has no owner bits that a script should set',
  export: 'set the variable from a cross-env-style node wrapper (process.env.X = ...; then spawn the command) instead of export',
  source: 'read the values inside a node script instead of sourcing a shell file',
  sh: 'port the shell script to a node script (.mjs) and run it with node',
  bash: 'port the shell script to a node script (.mjs) and run it with node',
  sed: 'edit text with a node script (fs.readFileSync, String.replace, fs.writeFileSync)',
  find: 'walk directories with fs.readdirSync({ recursive: true }) in a node script',
  xargs: 'loop inside a node script instead of xargs',
};
const SYNTAX = {
  'env-prefix': 'VAR=value prefixes are a POSIX shell feature; use a cross-env-style node wrapper that sets process.env before spawning',
  'expansion': '$VAR expansion does not happen in cmd.exe (%VAR% there); read process.env inside a node script',
  'substitution': 'command substitution $(...) and backticks are POSIX only; compute the value in a node script',
  'single-quotes': 'cmd.exe passes single quotes literally; use double quotes (escaped as \\" in package.json)',
  'chain': 'split into separate npm scripts and run them in sequence from a node runner (npm-run-all style) or with pre/post scripts',
  'pipe': 'pipes belong to the shell; connect the steps inside a node script with child_process',
  'redirection': 'redirection belongs to the shell; write files from a node script with fs.writeFileSync',
  'dev-null': '/dev/null does not exist on Windows; discard output with stdio: "ignore" in a node script',
};

/** Splits a command line into simple commands at &&, ||, ; and | (outside double quotes) and records the shell syntax it meets on the way. */
function tokenize(text) {
  const tokens = [];
  const segments = [];
  let seg = '';
  let quote = '';
  let single = '';
  const push = (kind, token) => { if (!tokens.some((t) => t.kind === kind && t.token === token)) tokens.push({ kind, token }); };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    if (quote) {
      if (c === quote) {
        if (quote === "'") push('single-quotes', `'${single}'`);
        quote = '';
      } else if (quote === "'") single += c;
      else if (c === '$') noteDollar(text, i, push);
      seg += c;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; single = ''; seg += c; continue; }
    if (c === '`') { push('substitution', '`'); seg += c; continue; }
    if (c === '$') { noteDollar(text, i, push); seg += c; continue; }
    if ((c === '&' && next === '&') || (c === '|' && next === '|')) { push('chain', c + next); segments.push(seg); seg = ''; i++; continue; }
    if (c === ';') { push('chain', ';'); segments.push(seg); seg = ''; continue; }
    if (c === '|') { push('pipe', '|'); segments.push(seg); seg = ''; continue; }
    if (c === '>' || c === '<') {
      let tok = c;
      if (c === '>' && next === '>') { tok = '>>'; i++; }
      else if (c === '>' && next === '&') { tok = '>&'; i++; if (/\d/.test(text[i + 1] || '')) { tok += text[i + 1]; i++; } }
      if (/\d$/.test(seg)) tok = seg.slice(-1) + tok;
      push('redirection', tok); seg += c; continue;
    }
    seg += c;
  }
  segments.push(seg);
  if (text.includes('/dev/null')) push('dev-null', '/dev/null');
  return { tokens, segments };
}

function noteDollar(text, i, push) {
  const next = text[i + 1];
  if (next === '(') push('substitution', '$(');
  else if (next === '{') push('expansion', text.slice(i, Math.min(text.length, text.indexOf('}', i) + 1) || i + 2));
  else if (next && /[A-Za-z_]/.test(next)) {
    let j = i + 1;
    while (j < text.length && /[A-Za-z0-9_]/.test(text[j])) j++;
    push('expansion', text.slice(i, j));
  }
}

/** Looks at the leading words of one simple command: env prefixes, then the command name. */
function inspectSegment(segment, push) {
  const words = segment.trim().split(/\s+/).filter(Boolean);
  let k = 0;
  while (k < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[k])) { push('env-prefix', words[k].split('=')[0] + '='); k++; }
  const cmd = words[k];
  if (!cmd) return;
  const base = cmd.replace(/^.*\//, '');
  if (base === '.') { push('command', 'source'); return; }
  if (Object.hasOwn(COMMANDS, base)) push('command', commandToken(base, words[k + 1]));
}

/** "rm -rf", "export FOO=" or plain "cat": the command plus the part of its first argument that matters for the report. */
function commandToken(base, arg) {
  if (base === 'export') return arg ? `export ${arg.split('=')[0]}=` : 'export';
  return arg && arg.startsWith('-') ? `${base} ${arg}` : base;
}

/** Every portability problem in one script, or an empty list when it is already a plain runner invocation. */
export function analyzeScript(text) {
  const s = String(text || '').trim();
  if (!s) return [];
  const first = s.split(/\s+/)[0].replace(/^.*\//, '');
  if (RUNNERS.has(first) && !SHELL_CHARS.test(s)) return [];
  const { tokens, segments } = tokenize(s);
  const push = (kind, token) => { if (!tokens.some((t) => t.kind === kind && t.token === token)) tokens.push({ kind, token }); };
  for (const seg of segments) inspectSegment(seg, push);
  return tokens;
}

function hintFor(tokens) {
  const hints = [];
  for (const { kind, token } of tokens) {
    const h = kind === 'command' ? COMMANDS[token.split(' ')[0]] : SYNTAX[kind];
    if (h && !hints.includes(h)) hints.push(h);
  }
  return hints.join('; ');
}

function finding(relPath, content, name, tokens, where) {
  const at = content.indexOf(where);
  return {
    file: relPath,
    line: at >= 0 ? lineOf(content, at) : undefined,
    message: `Script "${name}" relies on a POSIX shell: ${tokens.map((t) => t.token).join(', ')}`,
    fix: hintFor(tokens),
    data: { script: name, tokens },
  };
}

function checkJsonScripts(relPath, content) {
  const composer = /composer\.json$/.test(relPath);
  let json;
  try { json = JSON.parse(content); } catch { return []; }
  const scripts = json && typeof json === 'object' && json.scripts && typeof json.scripts === 'object' ? json.scripts : {};
  const findings = [];
  for (const [name, value] of Object.entries(scripts)) {
    const list = Array.isArray(value) ? value : [value];
    const tokens = [];
    for (const v of list) {
      if (typeof v !== 'string') continue;
      if (composer && (v.startsWith('@') || /\\|::/.test(v))) continue; // composer: script aliases and PHP callbacks are not shell
      for (const t of analyzeScript(v)) if (!tokens.some((x) => x.kind === t.kind && x.token === t.token)) tokens.push(t);
    }
    if (tokens.length) findings.push(finding(relPath, content, name, tokens, JSON.stringify(name)));
  }
  return findings;
}

/** Makefile recipes: `$(VAR)` is make syntax and `$$` is a literal dollar for the shell, so neutralize those before looking for shell features. */
function checkMakefile(relPath, content) {
  const findings = [];
  const lines = content.split('\n');
  let target = null;
  let tokens = [];
  const flush = () => { if (target && tokens.length) findings.push(finding(relPath, content, target.name, tokens, target.text)); tokens = []; };
  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    if (line.startsWith('\t')) {
      if (!target) continue;
      const recipe = line.trim().replace(/^[@+-]+/, '').replace(/\$[({][^)}]*[)}]/g, 'MAKEVAR').replace(/\$\$/g, '$');
      for (const t of analyzeScript(recipe)) if (!tokens.some((x) => x.kind === t.kind && x.token === t.token)) tokens.push(t);
      continue;
    }
    const m = line.match(/^([^\s:#=]+)\s*:(?!=)/);
    if (m) { flush(); target = { name: m[1], text: line }; } else if (line.trim() && !line.startsWith('#') && !line.startsWith(' ')) { flush(); target = null; }
  }
  flush();
  return findings;
}

export default {
  id: 'unix-scripts',
  severity: 'high',
  title: 'Unix-only commands or shell syntax in package scripts',
  explain: 'npm runs package scripts through cmd.exe on Windows, where rm, cp, mkdir -p, $VAR, single quotes and other POSIX shell features do not exist. Move that logic into a small node script (.mjs) run with node, which works the same on every OS.',
  scope: 'file',
  appliesTo: (rel) => /(^|\/)(package\.json|composer\.json|Makefile|makefile|GNUmakefile)$/.test(rel),
  check({ relPath, content }) {
    if (typeof content !== 'string') return [];
    return /(^|\/)[Mm]akefile$|GNUmakefile$/.test(relPath) ? checkMakefile(relPath, content) : checkJsonScripts(relPath, content);
  },
};
