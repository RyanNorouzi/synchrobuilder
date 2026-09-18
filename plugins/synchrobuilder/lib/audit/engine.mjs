// Audit engine: walks a project, builds an index, runs every rule, returns findings and a score.
// Rule contract (lib/audit/rules/*.mjs), one default-exported object per file:
//   {
//     id: 'unix-scripts',                 // kebab-case, stable, used in reports and by /synchrobuilder:fix
//     severity: 'high' | 'medium' | 'low',
//     title: 'Unix-only commands in package scripts',
//     explain: 'Plain-English sentence or two for humans',
//     scope: 'file' | 'project',          // file: check() is called per file; project: once with the whole index
//     appliesTo(relPath) => boolean,      // file rules only; keep it cheap (extension or basename test)
//     check(ctx) => Finding[]             // file rules get { repoRoot, relPath, content, index }; project rules get { repoRoot, index }
//   }
//   Finding: { file: 'relative/path', line?: number, column?: number, message: 'what is wrong here', fix?: 'what to do', data?: {} }
// Rules must never throw; the engine catches and logs anyway. Rules must never read outside repoRoot or run subprocesses.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toPosix } from '../core/paths.mjs';
import { git } from '../core/proc.mjs';
import { logLine } from '../core/log.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SKIP_DIRS = new Set(['.git', 'node_modules', '.synchrobuilder', 'dist', 'build', 'coverage', '.next', '.nuxt', 'target', 'vendor', '.venv', 'venv', '__pycache__', '.cache']);
const MAX_FILE_BYTES = 512 * 1024;
const TEXT_EXT = /\.(mjs|cjs|js|jsx|ts|tsx|mts|cts|json|jsonc|md|markdown|txt|yml|yaml|toml|ini|cfg|env|sh|bash|zsh|ps1|cmd|bat|py|rb|go|rs|java|kt|cs|php|html|css|scss|vue|svelte|astro|dockerfile|gitattributes|gitignore|editorconfig|npmrc|nvmrc)$/i;
const SEVERITY_WEIGHT = { high: 8, medium: 4, low: 1 };

/** Lists repo files. Uses `git ls-files` when the directory is a git repository (respects .gitignore), else walks the tree. Returns POSIX relative paths. */
export function listProjectFiles(repoRoot) {
  const r = git(['-C', repoRoot, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], { timeoutMs: 10000 });
  let files = [];
  if (r.code === 0 && r.stdout) files = r.stdout.split('\0').filter(Boolean);
  else files = walk(repoRoot, repoRoot);
  return files.map(toPosix).filter((f) => !f.split('/').some((seg) => SKIP_DIRS.has(seg)));
}

function walk(root, dir, out = []) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(root, p, out); else if (e.isFile() || e.isSymbolicLink()) out.push(path.relative(root, p));
  }
  return out;
}

/** The index every rule can use: all paths, a lower-cased lookup, per-directory listings, and lazy file stats. */
export function buildIndex(repoRoot, files) {
  const set = new Set(files);
  const lower = new Map();
  const byDir = new Map();
  for (const f of files) {
    const l = f.toLowerCase();
    if (!lower.has(l)) lower.set(l, []);
    lower.get(l).push(f);
    const dir = f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '';
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir).push(f);
  }
  const statCache = new Map();
  return {
    repoRoot, files, set, lower, byDir,
    has: (rel) => set.has(rel),
    hasCaseInsensitive: (rel) => lower.has(rel.toLowerCase()),
    stat(rel) {
      if (!statCache.has(rel)) { try { statCache.set(rel, fs.lstatSync(path.join(repoRoot, rel))); } catch { statCache.set(rel, null); } }
      return statCache.get(rel);
    },
    read(rel) {
      const st = this.stat(rel);
      if (!st || !st.isFile() || st.size > MAX_FILE_BYTES) return null;
      try { return fs.readFileSync(path.join(repoRoot, rel), 'utf8'); } catch { return null; }
    },
  };
}

export async function loadRules({ only } = {}) {
  const dir = path.join(here, 'rules');
  const rules = [];
  for (const name of fs.readdirSync(dir).filter((n) => n.endsWith('.mjs') && !n.startsWith('_')).sort()) {
    try {
      const mod = await import(`./rules/${name}`);
      const rule = mod.default;
      if (rule && rule.id && typeof rule.check === 'function') { if (!only || only.includes(rule.id)) rules.push(rule); }
    } catch (err) { logLine('audit', `rule ${name} failed to load: ${err.message}`); }
  }
  return rules;
}

function safeCheck(rule, ctx) {
  try { return (rule.check(ctx) || []).filter((f) => f && f.file).map((f) => ({ ...f, rule: rule.id, severity: rule.severity, title: rule.title })); }
  catch (err) { logLine('audit', `rule ${rule.id} threw on ${ctx.relPath || 'project'}: ${err.message}`); return []; }
}

export function scoreFor(findings) {
  let penalty = 0;
  for (const f of findings) penalty += SEVERITY_WEIGHT[f.severity] || 1;
  return Math.max(0, 100 - penalty);
}

/** Audit a whole project. Returns { score, findings, files, rules, durationMs }. */
export async function auditProject(repoRoot, { only, files } = {}) {
  const started = Date.now();
  const rules = await loadRules({ only });
  const list = files || listProjectFiles(repoRoot);
  const index = buildIndex(repoRoot, list);
  const findings = [];
  for (const rule of rules) {
    if (rule.scope === 'project') { findings.push(...safeCheck(rule, { repoRoot, index })); continue; }
    for (const rel of list) {
      if (!rule.appliesTo || !rule.appliesTo(rel)) continue;
      if (!TEXT_EXT.test(rel) && !/(^|\/)(Dockerfile|Makefile|Procfile|\.[a-z]+rc)$/i.test(rel)) continue;
      const content = index.read(rel);
      if (content === null) continue;
      findings.push(...safeCheck(rule, { repoRoot, relPath: rel, content, index }));
    }
  }
  findings.sort((a, b) => (SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity]) || a.file.localeCompare(b.file) || (a.line || 0) - (b.line || 0));
  return { score: scoreFor(findings), findings, files: list.length, rules: rules.map((r) => r.id), durationMs: Date.now() - started };
}

/** Audit one file (the guard hook). Project-scope rules are skipped; the index is built cheaply from the file's directory only. */
export async function auditFile(repoRoot, relPath, { content, only } = {}) {
  const rules = (await loadRules({ only })).filter((r) => r.scope !== 'project');
  const rel = toPosix(relPath);
  const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
  let siblings = [];
  try { siblings = fs.readdirSync(path.join(repoRoot, dir)).map((n) => (dir ? `${dir}/${n}` : n)); } catch { siblings = [rel]; }
  const index = buildIndex(repoRoot, siblings.includes(rel) ? siblings : [...siblings, rel]);
  const text = content !== undefined ? content : index.read(rel);
  if (text === null) return { findings: [] };
  const findings = [];
  for (const rule of rules) if (!rule.appliesTo || rule.appliesTo(rel)) findings.push(...safeCheck(rule, { repoRoot, relPath: rel, content: text, index }));
  return { findings };
}

/** Line number (1-based) of a character offset. */
export function lineOf(content, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < content.length; i++) if (content.charCodeAt(i) === 10) line++;
  return line;
}
