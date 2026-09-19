// Fixers: each one on a fixture, the registry's per-file sequencing, and the guarantee that a fixer never
// rewrites something it does not understand.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { planFix, planAll, writeFix, loadFixers, listFixable } from '../../plugins/synchrobuilder/lib/fix/index.mjs';
import { joinOperands, rewriteLine, ensurePathImport, splitComment } from '../../plugins/synchrobuilder/lib/fix/path-concat.mjs';
import { unifiedDiff } from '../../plugins/synchrobuilder/lib/fix/diff.mjs';
import { auditProject } from '../../plugins/synchrobuilder/lib/audit/engine.mjs';
import { realPath } from '../../plugins/synchrobuilder/lib/core/paths.mjs';

function tempRepo(files) {
  const root = realPath(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-fix-')));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return root;
}

test('path-concat: operand shapes it accepts and refuses', () => {
  assert.deepEqual(joinOperands(['dir', "'/'", 'name']), ['dir', 'name']);
  assert.deepEqual(joinOperands(['DATA_DIR', "'/orders.json'"]), ['DATA_DIR', "'orders.json'"]);
  assert.deepEqual(joinOperands(['root', '"/a/b.txt"']), ['root', '"a"', '"b.txt"']);
  assert.equal(joinOperands(["'/'", 'name']), null, 'a leading separator changes the meaning');
  assert.equal(joinOperands(['dir', "'/'"]), null, 'a trailing separator changes the meaning');
  assert.equal(joinOperands(['dir', "'sub/'", 'name']), null, 'a string that carries its own separator is ambiguous');
  assert.equal(joinOperands(['`${a}`', "'/'", 'b']), null, 'template literals are left alone');
});

test('path-concat: rewrites a statement and keeps its trailing comment', () => {
  assert.equal(rewriteLine("const f = dir + '/' + name; // keep me"), "const f = path.join(dir, name); // keep me");
  assert.equal(rewriteLine("  return base + '/orders.json';"), "  return path.join(base, 'orders.json');");
  assert.equal(rewriteLine('const url = origin + "/api";  // http'), 'const url = path.join(origin, "api");  // http');
  assert.equal(rewriteLine('const x = a + b;'), null);
  assert.deepEqual(splitComment("const a = '//not a comment'; // real"), ["const a = '//not a comment'; ", '// real']);
});

test('path-concat: adds the node:path import only when it is missing', () => {
  const esm = ensurePathImport("import fs from 'node:fs';\nconst x = 1;\n");
  assert.ok(esm.includes("import path from 'node:path';"));
  assert.equal(ensurePathImport("import path from 'node:path';\n"), "import path from 'node:path';\n");
  assert.ok(ensurePathImport('const fs = require("fs");\n').includes("require('node:path')"));
});

test('import-casing fixer rewrites the specifier to the real spelling', async () => {
  const root = tempRepo({ 'src/index.js': "import { a } from './utils/Helper.js';\n", 'src/utils/helper.js': 'export const a = 1;\n' });
  const finding = { rule: 'import-casing', file: 'src/index.js', line: 1, data: { specifier: './utils/Helper.js', expected: './utils/helper.js' } };
  const plan = await planFix(finding, { repoRoot: root });
  assert.equal(plan.changed, true, JSON.stringify(plan.notes));
  assert.ok(plan.after.includes("'./utils/helper.js'"));
  assert.ok(plan.diff.includes('--- a/src/index.js'));
  assert.equal(writeFix(plan, { repoRoot: root }), true);
  assert.ok(fs.readFileSync(path.join(root, 'src/index.js'), 'utf8').includes('helper.js'));
});

test('gitattributes fixer creates the file and is idempotent', async () => {
  const root = tempRepo({ 'README.md': '# x\n' });
  const finding = { rule: 'line-endings', file: '.gitattributes', message: 'missing' };
  const first = await planFix(finding, { repoRoot: root });
  assert.equal(first.changed, true);
  assert.ok(first.after.includes('text=auto'));
  writeFix(first, { repoRoot: root });
  const second = await planFix(finding, { repoRoot: root });
  assert.equal(second.changed, false, 'running fix twice changes nothing the second time');
});

test('unix-scripts fixer replaces shell commands with node equivalents', async () => {
  const pkg = { name: 'x', scripts: { clean: 'rm -rf dist', build: 'mkdir -p out && node build.js' } };
  const root = tempRepo({ 'package.json': JSON.stringify(pkg, null, 2) });
  const finding = { rule: 'unix-scripts', file: 'package.json', line: 3, data: { script: 'clean' } };
  const plan = await planFix(finding, { repoRoot: root });
  assert.equal(plan.changed, true, JSON.stringify(plan.notes));
  const after = JSON.parse(plan.after);
  assert.ok(!after.scripts.clean.includes('rm -rf'), after.scripts.clean);
  assert.ok(after.scripts.clean.includes('node -e'), after.scripts.clean);
});

test('a fixer never touches a file it cannot parse, and never escapes the repository', async () => {
  const root = tempRepo({ 'a.txt': 'nothing to fix\n' });
  const plan = await planFix({ rule: 'path-concat', file: 'a.txt', line: 1 }, { repoRoot: root });
  assert.equal(plan.changed, false);
  assert.ok(plan.notes.join(' ').includes('JavaScript'));
  const escape = await planFix({ rule: 'import-casing', file: '../../etc/passwd', line: 1, data: { expected: 'x' } }, { repoRoot: root });
  assert.equal(escape.changed, false);
});

test('planAll sequences several fixes to one file and reports what needs a human', async () => {
  const root = tempRepo({
    'src/index.js': "import { a } from './Helper.js';\nconst f = dir + '/' + name;\n",
    'src/helper.js': 'export const a = 1;\n',
    'build.sh': '#!/bin/sh\necho hi\n',
  });
  const audit = await auditProject(root);
  const { plans, manual } = await planAll(audit.findings, { repoRoot: root });
  const indexPlan = plans.find((p) => p.file === 'src/index.js' && p.changed);
  assert.ok(indexPlan, 'src/index.js has a planned fix');
  assert.ok(indexPlan.after.includes('path.join(dir, name)'), indexPlan.after);
  assert.ok(Array.isArray(manual));
  const { fixable } = await listFixable(audit.findings, await loadFixers());
  assert.ok(fixable.length >= 1);
});

test('unifiedDiff renders a readable patch header', () => {
  const d = unifiedDiff('a.txt', 'one\ntwo\n', 'one\nTWO\n');
  assert.ok(d.startsWith('--- a/a.txt'));
  assert.ok(d.includes('+TWO'));
  assert.ok(d.includes('-two'));
});
