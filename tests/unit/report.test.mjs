import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { renderTerminal, renderJson, cleanText } from '../../plugins/synchrobuilder/lib/audit/report.mjs';

const ROOT = path.resolve('demo-root');
const RESULT = {
  score: 71,
  files: 9,
  rules: ['unix-scripts', 'hardcoded-paths', 'line-endings'],
  durationMs: 12,
  root: ROOT,
  findings: [
    { rule: 'hardcoded-paths', severity: 'medium', title: 'Hard-coded paths', file: 'src/config.js', line: 2, message: 'Contains /Users/alice', fix: 'Use os.homedir()' },
    { rule: 'unix-scripts', severity: 'high', title: 'Unix-only commands', file: 'package.json', line: 7, message: 'rm -rf in "clean"', fix: 'Use a Node script', data: { script: 'clean' } },
    { rule: 'line-endings', severity: 'low', title: 'CRLF', file: path.join(ROOT, 'scripts', 'test.sh'), message: 'CRLF line endings' },
    { rule: 'hardcoded-paths', severity: 'medium', title: 'Hard-coded paths', file: 'scripts\\migrate.py', line: 4, message: 'Contains /home/deploy\x1b[2Jtricky\x07' },
  ],
};

test('renderJson produces the versioned report with repo-relative POSIX paths only', () => {
  const report = renderJson(RESULT, { generatedAt: '2026-09-18T00:00:00.000Z' });
  assert.equal(report.version, 1);
  assert.equal(report.generatedAt, '2026-09-18T00:00:00.000Z');
  assert.equal(report.root, ROOT.replace(/\\/g, '/'));
  assert.equal(report.score, 71);
  assert.equal(report.fileCount, 9);
  assert.deepEqual(report.rules, ['unix-scripts', 'hardcoded-paths', 'line-endings']);
  assert.equal(report.findings.length, 4);
  assert.deepEqual(Object.keys(report.findings[0]), ['rule', 'severity', 'title', 'file', 'line', 'message', 'fix', 'data']);
  assert.deepEqual(report.findings[1].data, { script: 'clean' });
  assert.equal(report.findings[0].data, null);
  assert.equal(report.findings[2].line, null);
  assert.equal(report.findings[2].fix, null);
  assert.equal(report.findings[2].file, 'scripts/test.sh', 'an absolute path under root becomes relative');
  assert.equal(report.findings[3].file, 'scripts/migrate.py', 'backslashes become forward slashes');
  assert.equal(report.findings[3].message, 'Contains /home/deploytricky', 'control characters and escape sequences are stripped');
  const withoutRoot = JSON.stringify({ ...report, root: '' });
  assert.ok(!withoutRoot.includes(report.root), 'no absolute path anywhere except root');
});

test('renderJson defaults are safe on an empty or malformed result', () => {
  const report = renderJson({ findings: [{ rule: 'x', severity: 'weird', file: 'a.js', message: 1 }] });
  assert.equal(report.score, 0);
  assert.equal(report.fileCount, 0);
  assert.deepEqual(report.rules, []);
  assert.equal(report.findings[0].severity, 'low', 'unknown severities are downgraded to low');
  assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(report.generatedAt));
  assert.equal(renderJson(null).findings.length, 0);
});

test('renderTerminal groups by severity then rule, shows file:line, message, fix and a summary', () => {
  const out = renderTerminal(RESULT, { color: false });
  assert.ok(!/\x1b\[/.test(out), 'no ANSI without color');
  assert.match(out, /^Synchrobuilder audit {2}score 71\/100 {2}files 9 {2}rules 3/);
  const high = out.indexOf('HIGH (1)');
  const medium = out.indexOf('MEDIUM (2)');
  const low = out.indexOf('LOW (1)');
  assert.ok(high > 0 && medium > high && low > medium, 'severity sections in order');
  assert.ok(out.indexOf('unix-scripts  Unix-only commands') > high && out.indexOf('unix-scripts') < medium);
  assert.match(out, /package\.json:7 {2}rm -rf in "clean"\n {6}fix: Use a Node script/);
  assert.match(out, /src\/config\.js:2 {2}Contains \/Users\/alice/);
  assert.match(out, /scripts\/test\.sh {2}CRLF line endings/, 'a finding without a line number has no colon suffix');
  assert.match(out, /scripts\/migrate\.py:4 {2}Contains \/home\/deploytricky/);
  assert.ok(!out.includes('\x07'), 'control characters are stripped from messages');
  assert.match(out, /Summary: 4 findings \(1 high, 2 medium, 1 low\)\. Score 71\/100\.\n$/);
  assert.equal((out.match(/hardcoded-paths {2}Hard-coded paths/g) || []).length, 1, 'one rule header per rule');
});

test('renderTerminal uses ANSI only when asked and reports a clean project', () => {
  const colored = renderTerminal(RESULT, { color: true });
  assert.ok(/\x1b\[31m/.test(colored), 'high findings are red when color is on');
  assert.ok(/\x1b\[1mSynchrobuilder audit/.test(colored));
  const clean = renderTerminal({ score: 100, files: 3, rules: ['a'], findings: [] });
  assert.match(clean, /score 100\/100/);
  assert.match(clean, /No findings\./);
  assert.match(clean, /Summary: 0 findings\. Score 100\/100\./);
  assert.ok(!/\x1b\[/.test(clean), 'color defaults to off');
});

test('cleanText strips escapes and control characters and bounds length', () => {
  assert.equal(cleanText('a\x1b[31mb\x00c\r\nd'), 'abc d');
  assert.equal(cleanText('x'.repeat(500)).length, 400);
  assert.equal(cleanText(undefined), '');
});
