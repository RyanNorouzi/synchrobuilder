// Audit rules part 1: import-casing, case-duplicates, unix-scripts, shell-scripts.
// Positive cases run against tests/fixtures/audit/<rule>/bad, negative cases against .../good, plus the demo repository.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.SYNCHROBUILDER_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-rules1-'));

import { auditProject, auditFile, buildIndex } from '../../plugins/synchrobuilder/lib/audit/engine.mjs';
import importCasing from '../../plugins/synchrobuilder/lib/audit/rules/import-casing.mjs';
import caseDuplicates from '../../plugins/synchrobuilder/lib/audit/rules/case-duplicates.mjs';
import unixScripts, { analyzeScript } from '../../plugins/synchrobuilder/lib/audit/rules/unix-scripts.mjs';
import shellScripts from '../../plugins/synchrobuilder/lib/audit/rules/shell-scripts.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');
const FIXTURES = path.join(REPO, 'tests', 'fixtures', 'audit');
const DEMO = path.join(REPO, 'examples', 'demo-repo');
const RULES = [importCasing, caseDuplicates, unixScripts, shellScripts];

const fixture = (rule, kind) => path.join(FIXTURES, rule, kind);
async function run(rule, root) {
  const result = await auditProject(root, { only: [rule.id] });
  assert.deepEqual(result.rules, [rule.id], `only ${rule.id} runs`);
  return result.findings;
}
const byFile = (findings, file) => findings.filter((f) => f.file === file).sort((a, b) => (a.line || 0) - (b.line || 0));
const tokensOf = (finding) => finding.data.tokens.map((t) => t.token);
function assertFindingShape(f) {
  assert.equal(typeof f.file, 'string');
  assert.ok(f.file && !f.file.includes('\\') && !path.isAbsolute(f.file), `file is a relative posix path: ${f.file}`);
  assert.ok(typeof f.message === 'string' && f.message.length > 0, 'message is set');
  assert.ok(typeof f.fix === 'string' && f.fix.length > 0, 'fix is set');
  if (f.line !== undefined) assert.ok(Number.isInteger(f.line) && f.line >= 1, `line is a 1-based integer: ${f.line}`);
}

// --- rule contract ---------------------------------------------------------------------------------------------------

test('every rule matches the engine contract', () => {
  for (const rule of RULES) {
    assert.match(rule.id, /^[a-z]+(-[a-z]+)*$/, `${rule.id} is kebab-case`);
    assert.ok(['high', 'medium', 'low'].includes(rule.severity), `${rule.id} severity`);
    assert.ok(typeof rule.title === 'string' && rule.title.length > 0);
    assert.ok(typeof rule.explain === 'string' && rule.explain.length > 20);
    assert.ok(['file', 'project'].includes(rule.scope));
    assert.equal(typeof rule.check, 'function');
    if (rule.scope === 'file') assert.equal(typeof rule.appliesTo, 'function', `${rule.id} has appliesTo`);
  }
});

test('file rules keep appliesTo cheap: it decides on the path alone and never touches the disk', () => {
  assert.equal(importCasing.appliesTo('src/app.js'), true);
  assert.equal(importCasing.appliesTo('src/styles.css'), true);
  assert.equal(importCasing.appliesTo('README.md'), false);
  assert.equal(unixScripts.appliesTo('package.json'), true);
  assert.equal(unixScripts.appliesTo('sub/Makefile'), true);
  assert.equal(unixScripts.appliesTo('src/package.json.bak'), false);
  assert.equal(unixScripts.appliesTo('tsconfig.json'), false);
  const started = Date.now();
  for (let i = 0; i < 20000; i++) { importCasing.appliesTo(`dir${i}/file${i}.ts`); unixScripts.appliesTo(`dir${i}/package.json`); }
  assert.ok(Date.now() - started < 1000, 'forty thousand appliesTo calls stay well under a second');
});

test('rules never throw on malformed contexts', () => {
  const contexts = [{}, { index: null }, { relPath: 'a.js', content: null }, { relPath: 'package.json', content: '{not json' },
    { relPath: 'x.css', content: 42, index: buildIndex('/nowhere', []) }, { index: { files: 'nope' } }, { index: buildIndex('/nowhere', ['a/b.sh']) }];
  for (const rule of RULES) for (const ctx of contexts) assert.doesNotThrow(() => { const out = rule.check(ctx); assert.ok(Array.isArray(out)); }, `${rule.id} on ${JSON.stringify(ctx)}`);
});

// --- import-casing ---------------------------------------------------------------------------------------------------

test('import-casing: every wrongly cased relative import in the bad fixture is reported with the real spelling', async () => {
  const findings = await run(importCasing, fixture('import-casing', 'bad'));
  findings.forEach(assertFindingShape);
  const app = byFile(findings, 'src/app.js');
  assert.deepEqual(app.map((f) => [f.line, f.data.actual, f.data.expected]), [
    [2, './utils/helper', './utils/Helper'],
    [3, './Utils/other.js', './utils/other.js'],
    [4, './components/Button.vue', './components/button.vue'],
    [5, './Theme/vars.css', './theme/vars.css'],
    [6, './utils/HELPER.js', './utils/Helper.js'],
    [7, './types/model.js', './types/Model.js'],
  ]);
  assert.equal(app[0].data.resolved, 'src/utils/Helper.js', 'data.resolved is the file on disk');
  assert.match(app[0].message, /src\/utils\/Helper\.js/);
  assert.match(app[0].fix, /'\.\/utils\/Helper'/);
  assert.ok(!app.some((f) => /ignored/.test(f.data.actual)), 'imports inside comments are not checked');
  const css = byFile(findings, 'src/styles.css');
  assert.deepEqual(css.map((f) => [f.line, f.data.actual, f.data.expected]), [
    [1, './Theme/vars.css', './theme/vars.css'],
    [2, './theme/Vars.css', './theme/vars.css'],
    [3, './img/Logo.png', './img/logo.png'],
  ]);
  assert.equal(findings.length, app.length + css.length, 'nothing else in the fixture is reported');
});

test('import-casing: correct casing, bare packages, urls, directory indexes and missing files are not findings', async () => {
  assert.deepEqual(await run(importCasing, fixture('import-casing', 'good')), []);
});

test('import-casing: the single-file guard path (auditFile) sees the file directory only and reports a sibling mismatch', async () => {
  const root = fixture('import-casing', 'bad');
  const wrong = "import './Styles.css';\nimport { help } from './utils/helper';\n";
  const { findings } = await auditFile(root, path.join('src', 'app.js'), { content: wrong, only: ['import-casing'] });
  assert.deepEqual(findings.map((f) => [f.rule, f.file, f.line, f.data.expected]), [['import-casing', 'src/app.js', 1, './styles.css']],
    'the sibling is caught; the nested ./utils/helper is not, because auditFile indexes only the directory of the file');
  const right = await auditFile(root, 'src/app.js', { content: "import './styles.css';\n", only: ['import-casing'] });
  assert.deepEqual(right.findings, [], 'content passed in overrides the disk');
});

test('import-casing: specifiers escaping the project and paths with query strings are handled', () => {
  const index = buildIndex('/nowhere', ['src/a.js', 'src/B.js']);
  const check = (content) => importCasing.check({ relPath: 'src/a.js', content, index });
  assert.deepEqual(check("import x from '../../outside/File.js';"), []);
  assert.equal(check("import x from './b.js?raw';")[0].data.expected, './B.js');
  assert.equal(check("import x from './b';")[0].data.expected, './B');
  const many = Array.from({ length: 80 }, (_, i) => `import x${i} from './b.js#${i}';`).join('\n');
  assert.equal(check(many).length, 1, 'the same wrong specifier is reported once');
});

// --- case-duplicates ---------------------------------------------------------------------------------------------------

test('case-duplicates: names that differ only by case are grouped per directory, files and directories alike', () => {
  const index = buildIndex('/nowhere', ['README.md', 'Readme.md', 'readme.md', 'src/a.js', 'SRC/b.js', 'src/Lib/x.js', 'src/lib/y.js', 'docs/Guide.md', 'other/guide.md']);
  const findings = caseDuplicates.check({ index });
  findings.forEach(assertFindingShape);
  assert.deepEqual(findings.map((f) => [f.file, f.data.dir, f.data.names]), [
    ['README.md', '', ['README.md', 'Readme.md', 'readme.md']],
    ['SRC', '', ['SRC', 'src']],
    ['src/Lib', 'src', ['Lib', 'lib']],
  ]);
  assert.deepEqual(findings[0].data.paths, ['README.md', 'Readme.md', 'readme.md']);
  assert.match(findings[0].message, /Directory \. has 3 entries/);
  assert.match(findings[2].message, /Directory src has 2 entries/);
  assert.match(findings[0].fix, /git mv/);
  assert.equal(findings[0].line, undefined, 'a whole-file finding carries no line');
});

test('case-duplicates: the good fixture and same-named files in different directories are clean', async () => {
  assert.deepEqual(await run(caseDuplicates, fixture('case-duplicates', 'good')), []);
  assert.deepEqual(caseDuplicates.check({ index: buildIndex('/nowhere', ['a/index.js', 'b/index.js', 'a/x.js']) }), []);
});

test('case-duplicates: fires on a real checkout that holds both spellings', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-casedup-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'helper.js'), 'export const a = 1;\n');
  fs.writeFileSync(path.join(root, 'src', 'Helper.js'), 'export const b = 2;\n');
  if (fs.readdirSync(path.join(root, 'src')).length < 2) { t.skip('this file system cannot hold both spellings'); return; }
  const findings = await run(caseDuplicates, root);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].file, 'src/Helper.js');
  assert.deepEqual(findings[0].data.paths, ['src/Helper.js', 'src/helper.js']);
});

// --- unix-scripts -----------------------------------------------------------------------------------------------------

test('unix-scripts: each package.json script in the bad fixture is reported with the shell feature it relies on', async () => {
  const findings = await run(unixScripts, fixture('unix-scripts', 'bad'));
  findings.forEach(assertFindingShape);
  const pkg = byFile(findings, 'package.json');
  const expected = {
    clean: ['rm -rf'], copy: ['&&', 'mkdir -p', 'cp -r'], env: ['NODE_ENV='], export: [';', 'export API_URL='],
    expand: ['$OUT_DIR', '${VERSION}'], quotes: ["'console.log(1)'"], chain: ['&&', '||'], pipe: ['|', '>', 'cat'],
    backtick: ['`'], subst: ['$('], silence: ['2>', '/dev/null'], link: ['ln -s'], mode: ['chmod'], touch: ['touch'], shell: ['bash'],
  };
  assert.deepEqual(Object.fromEntries(pkg.map((f) => [f.data.script, tokensOf(f)])), expected);
  assert.ok(!pkg.some((f) => f.data.script === 'fine'), 'a plain node invocation is not reported');
  const lines = fs.readFileSync(path.join(fixture('unix-scripts', 'bad'), 'package.json'), 'utf8').split('\n');
  for (const f of pkg) assert.ok(lines[f.line - 1].includes(`"${f.data.script}"`), `${f.data.script} points at its own line`);
  const clean = pkg.find((f) => f.data.script === 'clean');
  assert.match(clean.message, /Script "clean" relies on a POSIX shell: rm -rf/);
  assert.match(clean.fix, /fs\.rmSync/);
  assert.match(pkg.find((f) => f.data.script === 'quotes').fix, /double quotes/);
});

test('unix-scripts: composer.json reports shell commands but not @aliases or PHP callbacks', async () => {
  const findings = byFile(await run(unixScripts, fixture('unix-scripts', 'bad')), 'composer.json');
  assert.deepEqual(findings.map((f) => [f.data.script, tokensOf(f)]), [['post-install-cmd', ['rm -rf']]]);
});

test('unix-scripts: Makefile recipes are checked per target; make variables and node runners are fine', async () => {
  const findings = byFile(await run(unixScripts, fixture('unix-scripts', 'bad')), 'Makefile');
  assert.deepEqual(findings.map((f) => [f.data.script, f.line, tokensOf(f)]), [
    ['clean', 8, ['rm -rf', '&&', 'mkdir -p', 'touch']],
    ['release', 12, ['|']],
  ]);
});

test('unix-scripts: the good fixture is clean and analyzeScript accepts portable runner invocations', async () => {
  assert.deepEqual(await run(unixScripts, fixture('unix-scripts', 'good')), []);
  assert.deepEqual(analyzeScript('node scripts/build.mjs --out dist'), []);
  assert.deepEqual(analyzeScript('npx eslint . --ext .js,.mjs'), []);
  assert.deepEqual(analyzeScript('node -e "console.log(process.env.PATH)"'), []);
  assert.deepEqual(analyzeScript(''), []);
  assert.deepEqual(analyzeScript(null), []);
  assert.deepEqual(analyzeScript('./scripts/rm -rf x').map((t) => t.token), ['rm -rf'], 'a path to rm still counts');
  assert.deepEqual(analyzeScript('. ./env.sh').map((t) => t.token), ['source']);
});

// --- shell-scripts ----------------------------------------------------------------------------------------------------

test('shell-scripts: scripts required by package.json, CI, Dockerfile and README setup steps without a portable sibling', async () => {
  const findings = await run(shellScripts, fixture('shell-scripts', 'bad'));
  findings.forEach(assertFindingShape);
  const refs = Object.fromEntries(findings.map((f) => [f.file, f.data.references]));
  assert.deepEqual(refs, {
    'docker/entrypoint.sh': [{ file: 'Dockerfile', line: 2 }],
    'scripts/deploy.sh': [{ file: '.github/workflows/ci.yml', line: 8 }],
    'scripts/install.sh': [{ file: 'README.md', line: 7 }],
    'scripts/setup.sh': [{ file: 'package.json', line: 5 }],
  });
  assert.ok(!refs['tools/history.sh'], 'a mention outside the README setup sections does not count');
  const setup = findings.find((f) => f.file === 'scripts/setup.sh');
  assert.match(setup.message, /required by package\.json:5/);
  assert.match(setup.fix, /scripts\/setup\.mjs/);
  assert.deepEqual(setup.data.tried, ['scripts/setup.mjs', 'scripts/setup.js', 'scripts/setup.cjs', 'scripts/setup.ps1', 'scripts/setup.cmd', 'scripts/setup.bat']);
  assert.equal(setup.line, undefined, 'the finding is about the script file as a whole');
});

test('shell-scripts: a .mjs or .ps1 sibling satisfies the rule and unreferenced scripts are ignored', async () => {
  assert.deepEqual(await run(shellScripts, fixture('shell-scripts', 'good')), []);
});

test('shell-scripts: mysetup.sh is not a mention of setup.sh', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-shell-'));
  fs.writeFileSync(path.join(root, 'package.json'), '{ "scripts": { "a": "bash tools/mysetup.sh" } }\n');
  fs.mkdirSync(path.join(root, 'tools'));
  fs.writeFileSync(path.join(root, 'tools', 'setup.sh'), 'echo hi\n');
  fs.writeFileSync(path.join(root, 'tools', 'mysetup.sh'), 'echo hi\n');
  const findings = shellScripts.check({ repoRoot: root, index: buildIndex(root, ['package.json', 'tools/setup.sh', 'tools/mysetup.sh']) });
  assert.deepEqual(findings.map((f) => f.file), ['tools/mysetup.sh']);
  fs.rmSync(root, { recursive: true, force: true });
});

// --- demo repository ---------------------------------------------------------------------------------------------------

test('demo-repo: the four rules catch their planted bugs', async () => {
  const { findings } = await auditProject(DEMO, { only: RULES.map((r) => r.id) });
  const casing = findings.filter((f) => f.rule === 'import-casing');
  assert.deepEqual(casing.map((f) => [f.file, f.line, f.data.expected]), [['src/index.js', 3, './utils/helper.js']]);
  const unix = findings.filter((f) => f.rule === 'unix-scripts');
  assert.deepEqual(Object.fromEntries(unix.map((f) => [f.data.script, tokensOf(f)])), {
    clean: ['&&', 'rm -rf'], prebuild: ['&&', 'mkdir -p', 'cp'], build: ['&&', 'export NODE_ENV='], test: ['&&', 'NODE_ENV=', 'sh'],
  });
  const shell = findings.filter((f) => f.rule === 'shell-scripts').map((f) => f.file).sort();
  assert.deepEqual(shell, ['build.sh', 'scripts/test.sh']);
  assert.deepEqual(findings.filter((f) => f.rule === 'case-duplicates'), [], 'case duplicates cannot be committed; the README says the test plants them');
});
