// Runs the real CLI on a temporary copy of examples/demo-repo and checks that every planted bug is reported.
// Every rule the demo plants must be loaded and must fire. Two of the eleven are planted at test time because a
// git repository cannot carry them on every operating system; those are skipped where the file system refuses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const cli = path.join(repo, 'plugins', 'synchrobuilder', 'bin', 'synchrobuilder.mjs');
const demoSource = path.join(repo, 'examples', 'demo-repo');

// Every planted rule id (README.md in the demo explains each one). Two are planted at test time because the
// repository itself cannot hold them on every OS: case-duplicates and illegal-filenames.
const PLANTED = ['import-casing', 'case-duplicates', 'unix-scripts', 'hardcoded-paths', 'shell-scripts', 'line-endings', 'exec-bits-symlinks', 'illegal-filenames', 'python-assumptions', 'native-deps', 'readme-one-os'];
const ALWAYS = ['hardcoded-paths'];

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-home-'));
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-demo-'));
const demo = path.join(work, 'demo-repo');
fs.cpSync(demoSource, demo, { recursive: true, verbatimSymlinks: true });

function caseInsensitive(dir) {
  const probe = path.join(dir, 'CaseProbe.tmp');
  fs.writeFileSync(probe, 'x');
  const insensitive = fs.existsSync(path.join(dir, 'caseprobe.tmp'));
  fs.unlinkSync(probe);
  return insensitive;
}

// Plant the two bugs the repository cannot carry. Skipped where the file system cannot represent them.
const planted = { 'case-duplicates': false, 'illegal-filenames': false };
if (!caseInsensitive(demo)) {
  // A pair that differs only by case. It must not be utils/helper.js: src/index.js deliberately imports
  // './utils/Helper.js', and creating that exact spelling would make the import resolve and silence the
  // import-casing plant. Use a file nothing imports.
  fs.writeFileSync(path.join(demo, 'src', 'format.js'), 'export const lower = true;\n');
  fs.writeFileSync(path.join(demo, 'src', 'Format.js'), 'export const upper = true;\n');
  planted['case-duplicates'] = true;
}
if (process.platform !== 'win32') {
  fs.writeFileSync(path.join(demo, 'src', 'aux.js'), 'export const reserved = true;\n');
  fs.writeFileSync(path.join(demo, 'NOTES .md'), 'trailing space in the file name\n');
  planted['illegal-filenames'] = true;
}

function audit(args, cwd = work) {
  const r = spawnSync(process.execPath, [cli, 'audit', ...args], { cwd, encoding: 'utf8', env: { ...process.env, SYNCHROBUILDER_HOME: home, NO_COLOR: '1' }, timeout: 60000 });
  return { ...r, stdout: r.stdout || '', stderr: r.stderr || '' };
}

let report;

test('audit --json runs on the demo repo, prints the JSON report and writes it under .synchrobuilder', () => {
  const r = audit([demo, '--json']);
  assert.equal(r.status, 0, `exit ${r.status}, stderr: ${r.stderr}`);
  report = JSON.parse(r.stdout);
  assert.equal(report.version, 1);
  assert.equal(report.root, demo.replace(/\\/g, '/'));
  assert.ok(report.fileCount >= 10, `expected the demo files to be audited, got ${report.fileCount}`);
  assert.ok(Array.isArray(report.rules) && report.rules.length >= 1);
  const file = path.join(demo, '.synchrobuilder', 'audit-report.json');
  assert.ok(fs.existsSync(file), 'report file written');
  const written = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(written.findings, report.findings, 'the file and stdout hold the same report');
  assert.match(r.stderr, /Report written to /);
  for (const f of report.findings) assert.ok(!path.isAbsolute(f.file) && !f.file.includes('\\'), `finding path is repo-relative POSIX: ${f.file}`);
});

test('every finding path is inside the demo and audit.ignore globs are honoured', () => {
  assert.ok(report, 'previous test produced a report');
  assert.ok(report.findings.every((f) => !f.file.startsWith('vendor-copy/')), 'vendor-copy/** is ignored by .synchrobuilder/config.json');
  assert.ok(report.findings.every((f) => !f.file.startsWith('.synchrobuilder/')), 'the report itself is never audited');
});

for (const id of PLANTED) {
  test(`planted rule ${id} is reported`, (t) => {
    assert.ok(report, 'previous test produced a report');
    if (!report.rules.includes(id)) {
      assert.ok(!ALWAYS.includes(id), `${id} must be loaded in every checkout`);
      t.diagnostic(`${id}: not loaded`);
      return;
    }
    if (id in planted && !planted[id]) { t.diagnostic(`${id}: loaded, but not plantable on this file system`); return; }
    const hits = report.findings.filter((f) => f.rule === id);
    assert.ok(hits.length >= 1, `${id}: loaded but reported nothing`);
  });
}

test('hardcoded-paths findings point at the planted files and lines', () => {
  const hits = report.findings.filter((f) => f.rule === 'hardcoded-paths');
  const where = new Set(hits.map((f) => `${f.file}:${f.line}`));
  assert.ok(where.has('src/config.js:2'), '/Users/alice in src/config.js');
  assert.ok(where.has('src/config.js:3'), 'C:\\Users\\alice in src/config.js');
  assert.ok(where.has('scripts/migrate.py:4'), '/home/deploy in scripts/migrate.py');
  assert.ok(hits.every((f) => f.severity === 'medium' && f.message && f.fix));
});

test('the demo repo scores below 50 once every planted rule is loaded', (t) => {
  assert.ok(report.score < 100, 'the demo never scores 100');
  const missing = PLANTED.filter((id) => !report.rules.includes(id));
  if (missing.length) { t.diagnostic(`score ${report.score}; not asserting < 50 while rules are missing: ${missing.join(', ')}`); return; }
  assert.ok(report.score < 50, `score ${report.score} should be below 50`);
});

test('--strict exits 1 on findings, plain run exits 0, and terminal output has no ANSI', () => {
  const strict = audit([demo, '--strict', '--no-report']);
  assert.equal(strict.status, 1, `stderr: ${strict.stderr}`);
  const plain = audit([demo, '--no-report']);
  assert.equal(plain.status, 0);
  assert.ok(!/\x1b\[/.test(plain.stdout), 'no ANSI when stdout is not a TTY');
  assert.match(plain.stdout, /hardcoded-paths/);
  assert.match(plain.stdout, /Summary: \d+ findings? \(\d+ high, \d+ medium, \d+ low\)\. Score \d+\/100\./);
  assert.ok(!plain.stdout.includes('Report written'), '--no-report writes nothing');
});

test('--report writes to the given path, --only limits rules, and a relative path argument works', () => {
  const out = path.join(work, 'custom-report.json');
  const r = audit(['demo-repo', '--json', '--only', 'hardcoded-paths,no-such-rule', '--report', out], work);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(out));
  const j = JSON.parse(r.stdout);
  assert.deepEqual(j.rules, ['hardcoded-paths']);
  assert.match(r.stderr, /Unknown rule id\(s\) ignored: no-such-rule/);
  const bad = audit([demo, '--only', 'Not Valid!', '--no-report']);
  assert.equal(bad.status, 2);
});

test('a single file argument audits that file with the file-scope rules', () => {
  const r = audit([path.join(demo, 'src', 'config.js'), '--json', '--no-report']);
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.equal(j.fileCount, 1);
  assert.ok(j.findings.some((f) => f.rule === 'hardcoded-paths'));
  assert.ok(j.findings.every((f) => f.file.endsWith('config.js')));
});

test('a missing path exits 2 with a message', () => {
  const r = audit([path.join(work, 'does-not-exist'), '--no-report']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /does not exist/);
});
