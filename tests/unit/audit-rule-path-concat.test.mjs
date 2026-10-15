// The path-concat detection rule. Its fixer is covered in fix.test.mjs, but the rule that finds the problem in
// the first place had no fixtures, so "twelve rules with positive and negative fixtures" was one rule short.
// The rule is deliberately narrow, so the negative cases matter as much as the positive ones: a slash inside a
// URL, an import specifier, a regular expression or a string method is not a path separator.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.SYNCHROBUILDER_HOME = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'sb-pathconcat-'));

const rule = (await import('../../plugins/synchrobuilder/lib/audit/rules/path-concat.mjs')).default;

const check = (content, relPath = 'src/app.mjs') => rule.check({ relPath, content });
const lines = (content) => check(content).map((f) => f.line).sort((a, b) => a - b);

test('path-concat: it applies to JavaScript and TypeScript sources, and skips built output', () => {
  for (const ok of ['src/app.mjs', 'src/app.js', 'a/b.ts', 'c.tsx', 'd.cjs', 'e.mts']) {
    assert.equal(rule.appliesTo(ok), true, `${ok} should be audited`);
  }
  for (const skip of ['node_modules/x/index.js', 'dist/bundle.js', 'build/out.js', 'README.md', 'styles.css']) {
    assert.equal(rule.appliesTo(skip), false, `${skip} should be skipped`);
  }
});

test('path-concat: a separator standing between two operands is reported', () => {
  const found = check([
    'const a = dir + "/" + name;',
    'const b = dir + "\\\\" + name;',
  ].join('\n'));
  assert.equal(found.length, 2, JSON.stringify(found, null, 2));
  assert.deepEqual(found.map((f) => f.line), [1, 2]);
  assert.match(found[0].message, /string concatenation/);
  assert.match(found[0].fix, /path\.join/);
  assert.equal(found[0].file, 'src/app.mjs');
});

test('path-concat: a separator riding on either end of a literal is reported', () => {
  assert.deepEqual(lines('const p = base + "/config.json";'), [1], 'leading separator on the literal');
  assert.deepEqual(lines('const p = "assets/" + file;'), [1], 'trailing separator on the literal');
  assert.deepEqual(lines('return root + "/src/index.ts";'), [1], 'after return');
});

test('path-concat: one finding per line, however many matches that line holds', () => {
  const found = check('const p = a + "/" + b + "/" + c;');
  assert.equal(found.length, 1, 'the line is reported once, not once per separator');
  assert.equal(found[0].line, 1);
});

test('path-concat: slashes that are not path separators are left alone', () => {
  const negatives = [
    'const u = "https:" + "//example.com/" + host;',
    'const u = new URL("/x" + id, base);',
    'import x from "./a/" + "b";',
    'const m = require("./a/" + name);',
    'if (p.startsWith(prefix + "/")) return;',
    'if (p.endsWith("/" + suffix)) return;',
    'if (p.includes(a + "/")) return;',
    'const parts = s.split(a + "/");',
    'const j = list.join(sep + "/");',
    'const r = s.replace(a + "/", "");',
    'const ok = s.match(a + "/");',
    'const t = re.test(a + "/");',
    'const re2 = new RegExp(a + "/");',
    'const n = a + "\\n" + b;',
    'const tabbed = a + "\\t" + b;',
    'console.log(a + "/" + b);',
    'process.stdout.write(a + "/" + b);',
  ];
  for (const line of negatives) {
    assert.deepEqual(check(line), [], `should not fire: ${line}`);
  }
});

test('path-concat: a plain string sum with no separator is not a finding', () => {
  assert.deepEqual(check('const greeting = "hello " + name + "!";'), []);
  assert.deepEqual(check('const total = count + 1;'), []);
  assert.deepEqual(check('const q = "SELECT * FROM " + table;'), []);
});

test('path-concat: the whole rule runs over a real tree and finds only the bad file', async () => {
  const { auditProject } = await import('../../plugins/synchrobuilder/lib/audit/engine.mjs');
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'sb-pc-tree-'));
  try {
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'bad.mjs'), 'export function resolve(dir, name) {\n  const full = dir + "/" + name;\n  return full;\n}\n');
    fs.writeFileSync(path.join(root, 'src', 'good.mjs'), 'import path from "node:path";\nexport function resolve(dir, name) {\n  const full = path.join(dir, name);\n  return full;\n}\n');
    const result = await auditProject(root, { only: ['path-concat'] });
    assert.deepEqual(result.rules, ['path-concat']);
    const files = [...new Set(result.findings.map((f) => f.file))];
    assert.deepEqual(files, ['src/bad.mjs'], `only the concatenating file should fire: ${JSON.stringify(result.findings)}`);
    assert.equal(result.findings[0].line, 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
