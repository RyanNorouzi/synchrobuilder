// Fixer: replace Unix-only commands in package.json scripts with Node one-liners that run the same everywhere.
// Only the simple, unquoted forms are rewritten (rm -rf X, mkdir -p X, cp -r A B, mv A B). Everything else is reported
// with a reason instead of being guessed at, because a wrong rewrite of a build script is worse than none.
// finding.data.script names the script to rewrite; without it every script in the file is examined.
const SAFE_PATH = /^(\.{1,2}\/)*[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)*\/?$/;
const ENV_PREFIX = /^(export\s+|[A-Za-z_][A-Za-z0-9_]*=)/;

function nodeE(code) { return `node -e "${code}"`; }
function q(p) { return `'${p}'`; }

/** One command (no && inside). Returns { command, note } where note explains why it was left alone. */
export function rewriteCommand(segment) {
  const text = segment.trim();
  if (!text) return { command: segment, note: null };
  if (ENV_PREFIX.test(text)) return { command: segment, note: `"${text}" sets an environment variable with shell syntax; that needs a cross-env style wrapper or a Node script (TODO, not rewritten because it would add a dependency).` };
  const words = text.split(/\s+/);
  const [cmd, ...rest] = words;
  const flags = rest.filter((w) => w.startsWith('-')).join('');
  const args = rest.filter((w) => !w.startsWith('-'));
  const safe = args.every((a) => SAFE_PATH.test(a));
  const unsafe = () => ({ command: segment, note: `"${text}" uses quoting, globs or shell syntax the fixer does not rewrite; convert it to a Node script by hand.` });
  if (cmd === 'rm' && /r/i.test(flags) && args.length) {
    if (!safe) return unsafe();
    const force = flags.includes('f') ? ',force:true' : '';
    return { command: nodeE(args.map((a) => `require('fs').rmSync(${q(a)},{recursive:true${force}})`).join(';')), note: null };
  }
  if (cmd === 'mkdir' && flags.includes('p') && args.length) {
    if (!safe) return unsafe();
    return { command: nodeE(args.map((a) => `require('fs').mkdirSync(${q(a)},{recursive:true})`).join(';')), note: null };
  }
  if (cmd === 'cp' && /r/i.test(flags) && args.length === 2) {
    if (!safe) return unsafe();
    return { command: nodeE(`require('fs').cpSync(${q(args[0])},${q(args[1])},{recursive:true})`), note: null };
  }
  if (cmd === 'mv' && !flags && args.length === 2) {
    if (!safe) return unsafe();
    return { command: nodeE(`require('fs').renameSync(${q(args[0])},${q(args[1])})`), note: null };
  }
  if (['rm', 'mkdir', 'cp', 'mv', 'touch', 'cat', 'ls', 'chmod', 'ln', 'find', 'sed', 'grep', 'sh', 'bash'].includes(cmd)) return unsafe();
  return { command: segment, note: null };
}

/** A whole script value. Splits on && only; other operators are left to rewriteCommand to flag. */
export function rewriteScript(value) {
  const parts = value.split(/\s*&&\s*/);
  const notes = [];
  const out = parts.map((p) => { const r = rewriteCommand(p); if (r.note) notes.push(r.note); return r.command.trim(); });
  if (parts.length > 1 && parts.every((p) => /^(npm|pnpm|yarn)\s+run\b/.test(p.trim()))) {
    notes.push(`"${value}" chains npm scripts with &&; npm runs scripts through cmd.exe on Windows, where && works, so it is left as is. Use a single Node script if you need one portable entry point.`);
  }
  return { value: out.join(' && '), notes };
}

function detectIndent(text) { const m = text.match(/^(\s+)"/m); return m ? m[1] : '  '; }

/** Replace one script's JSON string literal in place so the rest of package.json keeps its formatting. */
function replaceLiteral(text, name, oldValue, newValue) {
  const key = JSON.stringify(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const val = JSON.stringify(oldValue).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(${key}\\s*:\\s*)${val}`);
  return re.test(text) ? text.replace(re, `$1${JSON.stringify(newValue)}`) : null;
}

export default {
  id: 'unix-scripts',
  rules: ['unix-scripts'],
  fix({ content, finding }) {
    if (content === null) return { content, notes: [`${finding.file}: file not found; left unchanged.`] };
    let pkg;
    try { pkg = JSON.parse(content); } catch { return { content, notes: [`${finding.file}: not valid JSON; left unchanged.`] }; }
    if (!pkg || typeof pkg.scripts !== 'object' || !pkg.scripts) return { content, notes: [`${finding.file}: no "scripts" section; left unchanged.`] };
    const only = finding.data && typeof finding.data.script === 'string' ? [finding.data.script] : Object.keys(pkg.scripts);
    const notes = [];
    let text = content;
    let reserialize = false;
    for (const name of only) {
      const old = pkg.scripts[name];
      if (typeof old !== 'string') continue;
      const r = rewriteScript(old);
      notes.push(...r.notes.map((n) => `${finding.file} script "${name}": ${n}`));
      if (r.value === old) continue;
      const replaced = replaceLiteral(text, name, old, r.value);
      if (replaced !== null) text = replaced; else reserialize = true;
      pkg.scripts[name] = r.value;
    }
    if (reserialize) text = JSON.stringify(pkg, null, detectIndent(content)) + '\n';
    if (text === content && notes.length === 0) notes.push(`${finding.file}: no Unix-only command the fixer recognizes; left unchanged.`);
    return { content: text, notes };
  },
};
