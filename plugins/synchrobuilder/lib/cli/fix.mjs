// fix: show what can be repaired automatically, as diffs, and apply only when asked.
//   synchrobuilder fix [path] [--dry-run] [--yes] [--only rule-ids-or-paths] [--json]
import path from 'node:path';
import fs from 'node:fs';
import { auditProject } from '../audit/engine.mjs';
import { planAll, writeFix } from '../fix/index.mjs';
import { readConfig, matchesAny } from '../core/config.mjs';
import { locate } from '../core/paths.mjs';

function selected(finding, only) {
  if (!only.length) return true;
  return only.some((s) => finding.rule === s || finding.file === s || finding.file.startsWith(s.replace(/\/+$/, '') + '/'));
}

export async function run({ args, flags, cwd, stdout, stderr }) {
  const target = path.resolve(cwd, args[0] || '.');
  if (!fs.existsSync(target)) { stderr.write(`No such directory: ${target}\n`); return 1; }
  const loc = locate(target);
  const repoRoot = loc ? loc.workTree : target;
  const config = readConfig(repoRoot);
  const only = typeof flags.only === 'string' ? flags.only.split(',').map((s) => s.trim()).filter(Boolean) : [];

  const audit = await auditProject(repoRoot);
  const findings = audit.findings.filter((f) => !matchesAny(f.file, config.audit.ignore)).filter((f) => selected(f, only));
  const { plans, manual } = await planAll(findings, { repoRoot });
  const changing = plans.filter((p) => p.changed);

  if (flags.json) {
    stdout.write(JSON.stringify({
      score: audit.score,
      willChange: changing.map((p) => ({ rule: p.rule, fixer: p.fixer, file: p.file, diff: p.diff })),
      notes: plans.flatMap((p) => p.notes),
      manual: manual.map((f) => ({ rule: f.rule, file: f.file, line: f.line, message: f.message, fix: f.fix })),
    }, null, 2) + '\n');
    if (!flags.yes) return 0;
  }

  if (!flags.json) {
    stdout.write(`Audit score ${audit.score}/100 with ${findings.length} finding${findings.length === 1 ? '' : 's'}${only.length ? ` (filtered by ${only.join(', ')})` : ''}.\n\n`);
    if (!changing.length) stdout.write('Nothing can be fixed automatically.\n');
    for (const p of changing) {
      stdout.write(`--- ${p.file}  (rule ${p.rule}, fixer ${p.fixer})\n`);
      stdout.write(p.diff.endsWith('\n') ? p.diff : p.diff + '\n');
      stdout.write('\n');
    }
    const notes = plans.flatMap((p) => p.notes);
    if (notes.length) { stdout.write('Left alone:\n'); for (const n of notes) stdout.write(`  ${n}\n`); stdout.write('\n'); }
    if (manual.length) {
      stdout.write(`${manual.length} finding${manual.length === 1 ? '' : 's'} need a human:\n`);
      for (const f of manual.slice(0, 20)) stdout.write(`  ${f.rule} ${f.file}${f.line ? `:${f.line}` : ''} — ${f.message}\n`);
      if (manual.length > 20) stdout.write(`  ... and ${manual.length - 20} more (see synchrobuilder audit)\n`);
      stdout.write('\n');
    }
  }

  if (!changing.length) return 0;
  if (flags['dry-run'] || !flags.yes) {
    if (!flags.json) stdout.write(`Nothing was changed. To apply these ${changing.length} edit${changing.length === 1 ? '' : 's'}:\n  synchrobuilder fix${only.length ? ` --only ${only.join(',')}` : ''} --yes\n`);
    return 0;
  }

  let written = 0;
  for (const p of changing) if (writeFix(p, { repoRoot })) written++;
  const after = await auditProject(repoRoot);
  if (flags.json) stdout.write(JSON.stringify({ written, scoreBefore: audit.score, scoreAfter: after.score }, null, 2) + '\n');
  else stdout.write(`Applied ${written} file change${written === 1 ? '' : 's'}. Audit score ${audit.score} → ${after.score}.\nReview with: git diff\n`);
  return 0;
}
