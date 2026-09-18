// audit [path] [--json] [--strict] [--only ids] [--report file] [--no-report] [--no-color]
//   path      directory to audit (default: current directory) or a single file (audited with the file-scope rules only)
//   --json    print the JSON report instead of the terminal report
//   --strict  exit 1 when the score is below 100 (every finding lowers the score, so any high finding fails too)
//   --only    comma-separated rule ids to run
//   --report  where to write the JSON report (default <root>/.synchrobuilder/audit-report.json); --no-report skips it
// Exit codes: 0 audited (and, with --strict, score 100); 1 --strict and score below 100; 2 bad arguments or unreadable target.
// The report is always written, whichever output format is printed, so the skill and CI can read the same file.
import fs from 'node:fs';
import path from 'node:path';
import { auditProject, auditFile, listProjectFiles, loadRules, scoreFor } from '../audit/engine.mjs';
import { renderTerminal, renderJson } from '../audit/report.mjs';
import { readConfig, matchesAny } from '../core/config.mjs';
import { writeJsonAtomic } from '../core/fsx.mjs';
import { logLine } from '../core/log.mjs';
import { findGitEntry, toPosix } from '../core/paths.mjs';

const RULE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The generic parser treats `--no-color src` as a value; give such positionals back to the argument list. */
function booleanFlag(flags, args, name) {
  const v = flags[name];
  if (typeof v === 'string') { args.push(v); flags[name] = true; }
  return Boolean(flags[name]);
}

function parseOnly(value, stderr) {
  if (value === undefined || value === true) return undefined;
  const ids = String(value).split(',').map((s) => s.trim()).filter(Boolean);
  const bad = ids.filter((id) => !RULE_ID.test(id));
  if (bad.length) { stderr.write(`Invalid rule id(s): ${bad.join(', ')}. Rule ids are kebab-case, like hardcoded-paths.\n`); return null; }
  return ids.length ? ids : undefined;
}

/** Resolve the target argument. Returns { root, relFile } where relFile is set for a single-file target. */
function resolveTarget(arg, cwd) {
  const target = path.resolve(cwd, arg || '.');
  let st;
  try { st = fs.statSync(target); } catch { return { error: `Path does not exist: ${target}` }; }
  if (st.isDirectory()) return { root: target };
  if (!st.isFile()) return { error: `Not a file or directory: ${target}` };
  // A single file: the project root is the enclosing git work tree, or the file's directory outside a repository.
  const entry = findGitEntry(path.dirname(target));
  const root = entry ? entry.workTree : path.dirname(target);
  return { root, relFile: toPosix(path.relative(root, target)) };
}

function resolveReportPath(flags, root, cwd, stderr) {
  if (flags['no-report']) return null;
  if (flags.report === undefined) return path.join(root, '.synchrobuilder', 'audit-report.json');
  if (flags.report === true || !String(flags.report).trim()) { stderr.write('--report needs a file path (or use --no-report).\n'); return false; }
  return path.resolve(cwd, String(flags.report));
}

async function auditSingleFile(root, relFile, only, ignore) {
  const rules = (await loadRules({ only })).filter((r) => r.scope !== 'project').map((r) => r.id);
  const findings = matchesAny(relFile, ignore) ? [] : (await auditFile(root, relFile, { only })).findings;
  return { score: scoreFor(findings), findings, files: 1, rules, durationMs: 0, root };
}

export async function run({ flags, args, cwd, stdout, stderr }) {
  const positionals = [...args];
  const noColor = booleanFlag(flags, positionals, 'no-color');
  booleanFlag(flags, positionals, 'no-report');
  const only = parseOnly(flags.only, stderr);
  if (only === null) return 2;
  const target = resolveTarget(positionals[0], cwd);
  if (target.error) { stderr.write(`${target.error}\n`); return 2; }
  const { root, relFile } = target;
  const reportPath = resolveReportPath(flags, root, cwd, stderr);
  if (reportPath === false) return 2;

  const config = readConfig(root);
  const ignore = config.audit.ignore;
  const started = Date.now();
  let result;
  if (relFile) {
    result = await auditSingleFile(root, relFile, only, ignore);
  } else {
    const files = listProjectFiles(root).filter((f) => !matchesAny(f, ignore));
    result = { ...(await auditProject(root, { only, files })), root };
  }
  result.durationMs = Date.now() - started;
  if (only) {
    const missing = only.filter((id) => !result.rules.includes(id));
    if (missing.length) stderr.write(`Unknown rule id(s) ignored: ${missing.join(', ')}\n`);
  }

  const report = renderJson(result, { root });
  if (reportPath) {
    try { writeJsonAtomic(reportPath, report); }
    catch (err) { logLine('audit', `report write failed: ${err.message}`); stderr.write(`Could not write the report to ${reportPath}: ${err.message}\n`); }
  }

  if (flags.json) {
    stdout.write(JSON.stringify(report, null, 2) + '\n');
    if (reportPath) stderr.write(`Report written to ${reportPath}\n`);
  } else {
    const color = !noColor && !process.env.NO_COLOR && Boolean(stdout.isTTY);
    stdout.write(renderTerminal(result, { color }));
    if (reportPath) stdout.write(`Report written to ${reportPath}\n`);
  }

  const strict = Boolean(flags.strict) || config.audit.strict === true;
  return strict && result.score < 100 ? 1 : 0;
}
