// Audit report renderers: a terminal report for humans and a JSON report for tools, the skill and CI.
// Input is the result of auditProject / auditFile: { score, findings, files, rules, durationMs, root? }.
// Finding text comes from rules that read local files, so it can contain anything a file contains; the
// terminal renderer strips control characters and the JSON renderer keeps every path repo-relative.
import path from 'node:path';
import { toPosix } from '../core/paths.mjs';

const SEVERITIES = ['high', 'medium', 'low'];
const ANSI = { reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m', red: '\x1b[31m', yellow: '\x1b[33m', green: '\x1b[32m', cyan: '\x1b[36m' };
const SEVERITY_COLOR = { high: 'red', medium: 'yellow', low: 'cyan' };

/** Remove control characters and escape sequences so a finding can never restyle or clear the terminal. */
export function cleanText(value, max = 400) {
  // eslint-disable-next-line no-control-regex
  return String(value ?? '').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').replace(/\r?\n/g, ' ').trim().slice(0, max);
}

/** Repo-relative POSIX path for a finding. Absolute paths are made relative to root (or dropped to their basename). */
function relativeFile(file, root) {
  let s = String(file ?? '');
  if (path.isAbsolute(s) || /^[A-Za-z]:[\\/]/.test(s)) s = root ? path.relative(root, s) : path.basename(s);
  return toPosix(s).replace(/^\.\/+/, '');
}

function normalizeSeverity(s) { return SEVERITIES.includes(s) ? s : 'low'; }

function countBySeverity(findings) {
  const counts = { high: 0, medium: 0, low: 0 };
  for (const f of findings) counts[normalizeSeverity(f.severity)]++;
  return counts;
}

/** The JSON report. `root` is the only absolute path in it; every finding path is repo-relative. */
export function renderJson(result, { root, generatedAt } = {}) {
  const r = result || {};
  const base = root || r.root || '';
  const findings = (Array.isArray(r.findings) ? r.findings : []).map((f) => ({
    rule: cleanText(f.rule, 80),
    severity: normalizeSeverity(f.severity),
    title: cleanText(f.title, 160),
    file: relativeFile(f.file, base),
    line: Number.isInteger(f.line) && f.line > 0 ? f.line : null,
    message: cleanText(f.message),
    fix: f.fix ? cleanText(f.fix) : null,
    data: f.data && typeof f.data === 'object' && !Array.isArray(f.data) ? f.data : null,
  }));
  return {
    version: 1,
    generatedAt: generatedAt || new Date().toISOString(),
    root: base ? toPosix(base) : '',
    score: Number.isFinite(r.score) ? r.score : 0,
    fileCount: Number.isInteger(r.files) ? r.files : 0,
    rules: (Array.isArray(r.rules) ? r.rules : []).map((id) => cleanText(id, 80)),
    findings,
  };
}

/** Group findings by severity (high first), then by rule id in first-seen order. */
function groupFindings(findings) {
  const groups = new Map(SEVERITIES.map((s) => [s, new Map()]));
  for (const f of findings) {
    const byRule = groups.get(normalizeSeverity(f.severity));
    const id = cleanText(f.rule, 80) || 'unknown';
    if (!byRule.has(id)) byRule.set(id, { title: cleanText(f.title, 160), findings: [] });
    byRule.get(id).findings.push(f);
  }
  return groups;
}

function scoreColor(score) { return score >= 100 ? 'green' : score >= 50 ? 'yellow' : 'red'; }

/** The terminal report. ANSI colour only when `color` is true; the CLI passes the TTY / --no-color decision. */
export function renderTerminal(result, { color = false } = {}) {
  const r = result || {};
  const paint = (name, text) => (color ? `${ANSI[name]}${text}${ANSI.reset}` : text);
  const findings = Array.isArray(r.findings) ? r.findings : [];
  const score = Number.isFinite(r.score) ? r.score : 0;
  const fileCount = Number.isInteger(r.files) ? r.files : 0;
  const ruleCount = Array.isArray(r.rules) ? r.rules.length : 0;
  const lines = [];
  const duration = Number.isFinite(r.durationMs) ? `  ${paint('dim', `(${r.durationMs} ms)`)}` : '';
  lines.push(`${paint('bold', 'Synchrobuilder audit')}  score ${paint(scoreColor(score), `${score}/100`)}  files ${fileCount}  rules ${ruleCount}${duration}`);
  if (r.root) lines.push(paint('dim', `root ${toPosix(r.root)}`));
  lines.push('');
  if (findings.length === 0) {
    lines.push(paint('green', 'No findings.'));
    lines.push('', `Summary: 0 findings. Score ${score}/100.`);
    return lines.join('\n') + '\n';
  }
  const counts = countBySeverity(findings);
  const groups = groupFindings(findings);
  for (const severity of SEVERITIES) {
    const byRule = groups.get(severity);
    if (byRule.size === 0) continue;
    lines.push(paint(SEVERITY_COLOR[severity], paint('bold', `${severity.toUpperCase()} (${counts[severity]})`)));
    for (const [id, group] of byRule) {
      lines.push(`  ${paint('bold', id)}${group.title ? `  ${group.title}` : ''}`);
      for (const f of group.findings) {
        const where = relativeFile(f.file, r.root) + (Number.isInteger(f.line) && f.line > 0 ? `:${f.line}` : '');
        lines.push(`    ${paint('cyan', where)}  ${cleanText(f.message)}`);
        if (f.fix) lines.push(`      ${paint('dim', 'fix:')} ${cleanText(f.fix)}`);
      }
    }
    lines.push('');
  }
  lines.push(`Summary: ${findings.length} finding${findings.length === 1 ? '' : 's'} (${counts.high} high, ${counts.medium} medium, ${counts.low} low). Score ${paint(scoreColor(score), `${score}/100`)}.`);
  return lines.join('\n') + '\n';
}
