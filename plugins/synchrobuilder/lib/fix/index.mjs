// The fixer registry. A fixer declares which audit rules it can repair and rewrites one file's content.
// Nothing here writes to disk unless the caller asks: the CLI shows diffs first and applies only with consent.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readText } from '../core/fsx.mjs';
import { logLine } from '../core/log.mjs';
import { unifiedDiff } from './diff.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

export async function loadFixers() {
  const out = [];
  for (const name of fs.readdirSync(here).filter((n) => n.endsWith('.mjs') && !['index.mjs', 'diff.mjs'].includes(n)).sort()) {
    try {
      const mod = await import(`./${name}`);
      if (mod.default && mod.default.id && typeof mod.default.fix === 'function') out.push(mod.default);
    } catch (err) { logLine('fix', `fixer ${name} failed to load: ${err && err.message}`); }
  }
  return out;
}

export function fixerFor(fixers, finding) {
  return fixers.find((f) => (f.rules || []).includes(finding.rule)) || null;
}

/** Findings a fixer claims, in report order. Everything else is reported as manual work. */
export async function listFixable(findings, fixers = null) {
  const list = fixers || (await loadFixers());
  const fixable = [];
  const manual = [];
  for (const f of findings) (fixerFor(list, f) ? fixable : manual).push(f);
  return { fixable, manual, fixers: list };
}

function targetOf(fixer, finding) {
  return typeof fixer.targetFile === 'function' ? fixer.targetFile(finding) : finding.file;
}

/**
 * Compute one file's change for a finding. Returns { rule, file, before, after, diff, changed, notes }.
 * With dryRun false the caller still has to call writeFix; computing and writing stay separate so a
 * command can show every diff before touching anything.
 */
export async function planFix(finding, { repoRoot, fixers = null } = {}) {
  const list = fixers || (await loadFixers());
  const fixer = fixerFor(list, finding);
  if (!fixer) return { rule: finding.rule, file: finding.file, changed: false, notes: [`no fixer for rule ${finding.rule}`] };
  const rel = targetOf(fixer, finding);
  const abs = path.join(repoRoot, rel);
  if (!path.resolve(abs).startsWith(path.resolve(repoRoot))) return { rule: finding.rule, file: rel, changed: false, notes: ['path escapes the repository; refused'] };
  const before = readText(abs, null);
  let result;
  try {
    result = fixer.fix({ content: before === null ? '' : before, finding, repoRoot, file: rel });
  } catch (err) {
    logLine('fix', `${fixer.id} threw on ${rel}: ${err && err.message}`);
    return { rule: finding.rule, file: rel, changed: false, notes: [`the ${fixer.id} fixer failed: ${err && err.message}`] };
  }
  const after = result && typeof result.content === 'string' ? result.content : before;
  const changed = after !== null && after !== before;
  return {
    rule: finding.rule, fixer: fixer.id, file: rel, before, after, changed,
    diff: changed ? unifiedDiff(rel, before === null ? '' : before, after) : '',
    notes: (result && result.notes) || [],
  };
}

/** Apply a computed plan. Returns true when the file was written. */
export function writeFix(plan, { repoRoot }) {
  if (!plan || !plan.changed) return false;
  const abs = path.join(repoRoot, plan.file);
  try {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, plan.after);
    return true;
  } catch (err) {
    logLine('fix', `write ${plan.file} failed: ${err && err.message}`);
    return false;
  }
}

/**
 * Plan every fixable finding. Findings that touch the same file are applied in sequence, each seeing the previous
 * result, so two fixes to one file do not overwrite each other.
 */
export async function planAll(findings, { repoRoot } = {}) {
  const fixers = await loadFixers();
  const { fixable, manual } = await listFixable(findings, fixers);
  const byFile = new Map();
  const plans = [];
  for (const finding of fixable) {
    const plan = await planFix(finding, { repoRoot, fixers });
    const pending = byFile.get(plan.file);
    if (pending && plan.changed) {
      // Re-run this fixer against the text the earlier fix produced.
      const fixer = fixerFor(fixers, finding);
      let result = null;
      try { result = fixer.fix({ content: pending.after, finding, repoRoot, file: plan.file }); } catch { result = null; }
      const after = result && typeof result.content === 'string' ? result.content : pending.after;
      const merged = { ...plan, before: pending.before, after, changed: after !== pending.before, diff: after !== pending.before ? unifiedDiff(plan.file, pending.before === null ? '' : pending.before, after) : '' };
      plans[plans.indexOf(pending)] = merged;
      byFile.set(plan.file, merged);
      continue;
    }
    plans.push(plan);
    if (plan.changed) byFile.set(plan.file, plan);
  }
  return { plans, manual, fixers };
}
