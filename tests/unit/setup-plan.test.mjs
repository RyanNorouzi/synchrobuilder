// buildPlan is pure: manifest + fingerprint in, ordered steps out. These tests feed fake fingerprints for each OS and
// check the recipes, the consent flags, that sudo/shell-function steps are manual, and version-manager preference.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPlan, toolVersion, toolPresent, normalizeVersion, resolveForOs } from '../../plugins/synchrobuilder/lib/setup/plan.mjs';
import { osKey, majorOf, versionManagerRecipe, nativeRuntimeRecipe, serviceRecipe } from '../../plugins/synchrobuilder/lib/setup/installers.mjs';
import { formatPlan, stepMarker } from '../../plugins/synchrobuilder/lib/setup/format.mjs';
import { tokenizeCommand } from '../fixtures/setup/manifest-stub.mjs';

process.env.SYNCHROBUILDER_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-setup-plan-'));
const here = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST = JSON.parse(fs.readFileSync(path.join(here, '..', 'fixtures', 'setup', 'full.json'), 'utf8'));

function fp(tools = {}, extra = {}) { return { tools, services: {}, envPresent: [], ...extra }; }
function plan(platform, fingerprint, extra = {}) { return buildPlan({ manifest: MANIFEST, fingerprint, platform, tokenize: tokenizeCommand, ...extra }); }
function byId(steps, id) { const s = steps.find((x) => x.id === id); assert.ok(s, `step ${id} missing from ${steps.map((x) => x.id).join(',')}`); return s; }

test('win32 plan: winget pins node exactly, corepack activates pnpm, services are manual, os.windows overrides start', () => {
  const steps = plan('win32', fp({ winget: { version: '1.9.25180', found: true }, npm: '10.9.2' }));
  assert.deepEqual(steps.map((s) => s.id), ['runtime:node', 'packageManager:pnpm', 'service:postgres', 'env:DATABASE_URL', 'env:SESSION_SECRET', 'command:install', 'command:migrate', 'command:seed', 'command:start', 'health']);
  const node = byId(steps, 'runtime:node');
  assert.deepEqual(node.command, ['winget', 'install', '--id', 'OpenJS.NodeJS.LTS', '--version', '24.16.0', '--exact', '--accept-package-agreements', '--accept-source-agreements']);
  assert.equal(node.needsConsent, true);
  assert.equal(node.alreadySatisfied, false);
  assert.match(node.why, /was not found on PATH/);
  const pnpm = byId(steps, 'packageManager:pnpm');
  assert.deepEqual(pnpm.command, ['corepack', 'prepare', 'pnpm@10.22.0', '--activate']);
  assert.equal(pnpm.needsConsent, true);
  const pg = byId(steps, 'service:postgres');
  assert.equal(pg.command, null);
  assert.equal(pg.manual, 'winget install --id PostgreSQL.PostgreSQL.16 --exact');
  assert.equal(pg.needsConsent, false);
  assert.match(pg.why, /port 5432/);
  assert.deepEqual(byId(steps, 'command:start').command, ['pnpm', 'run', 'dev:win']);
  assert.equal(byId(steps, 'command:start').background, true);
  assert.deepEqual(byId(steps, 'command:install').command, ['pnpm', 'install', '--frozen-lockfile']);
  const health = steps[steps.length - 1];
  assert.equal(health.kind, 'health');
  assert.equal(health.healthCheck.url, 'http://localhost:3000/health');
  assert.equal(health.needsConsent, false);
});

test('win32 without winget on PATH turns the runtime install into a manual step', () => {
  const node = byId(plan('win32', fp({})), 'runtime:node');
  assert.equal(node.command, null);
  assert.match(node.manual, /^winget install --id OpenJS\.NodeJS\.LTS --version 24\.16\.0 --exact/);
  assert.equal(node.needsConsent, false);
});

test('darwin plan: Homebrew installs node@24 with a warning about the exact pin, services use brew services', () => {
  const steps = plan('darwin', fp({ brew: '4.4.0', node: 'v22.1.0' }));
  const node = byId(steps, 'runtime:node');
  assert.deepEqual(node.command, ['brew', 'install', 'node@24']);
  assert.equal(node.needsConsent, true);
  assert.match(node.why, /this machine has 22\.1\.0/);
  assert.match(node.why, /may not be exactly 24\.16\.0/);
  assert.equal(byId(steps, 'service:postgres').manual, 'brew install postgresql@16 && brew services start postgresql@16');
  const noBrew = byId(plan('darwin', fp({})), 'runtime:node');
  assert.equal(noBrew.command, null);
  assert.match(noBrew.manual, /brew install node@24 {2}\(Homebrew was not found/);
});

test('linux plan: apt needs sudo so runtime and service steps are manual and never ask for consent', () => {
  const steps = plan('linux', fp({ 'apt-get': '2.7.14' }));
  const node = byId(steps, 'runtime:node');
  assert.equal(node.command, null);
  assert.equal(node.manual, 'sudo apt-get update && sudo apt-get install -y nodejs');
  assert.equal(node.needsConsent, false);
  assert.match(node.why, /needs sudo, so run it yourself/);
  const pg = byId(steps, 'service:postgres');
  assert.equal(pg.manual, 'sudo apt-get install -y postgresql-16 && sudo systemctl enable --now postgresql');
  assert.equal(pg.needsConsent, false);
  for (const s of steps) if (s.manual && /\bsudo\b/.test(s.manual)) assert.equal(s.command, null, `${s.id} must not spawn sudo`);
  assert.deepEqual(byId(steps, 'command:start').command, ['pnpm', 'run', 'dev'], 'no os.linux override, base command kept');
});

test('consent flags: exactly the steps with an argv ask first; manual, env and health steps never do', () => {
  for (const platform of ['win32', 'darwin', 'linux']) {
    const steps = plan(platform, fp({ winget: '1.9', brew: '4.4', docker: '27.0.0' }), { composeFile: 'compose.yaml' });
    for (const s of steps) {
      assert.equal(s.needsConsent, Boolean(s.command), `${platform} ${s.id}: needsConsent must mirror command`);
      assert.equal(typeof s.title, 'string');
      assert.equal(typeof s.why, 'string');
      assert.ok(s.command === null || (Array.isArray(s.command) && s.command.every((a) => typeof a === 'string')), `${s.id} argv`);
    }
    const compose = byId(steps, 'service:compose');
    assert.deepEqual(compose.command, ['docker', 'compose', '-f', 'compose.yaml', 'up', '-d']);
    assert.equal(compose.needsConsent, true);
    assert.match(byId(steps, 'service:postgres').why, /Docker Compose covers this/);
  }
  assert.equal(plan('linux', fp({ docker: '27.0.0' })).some((s) => s.id === 'service:compose'), false, 'no compose file, no compose step');
  assert.equal(plan('linux', fp({}), { composeFile: 'compose.yaml' }).some((s) => s.id === 'service:compose'), false, 'compose file but no docker');
});

test('version-manager preference: volta over fnm over nvm; nvm is manual on POSIX and a real command on Windows', () => {
  const all = { volta: '2.0.1', fnm: '1.38.1', nvm: { version: 'unknown', found: true }, brew: '4.4' };
  assert.deepEqual(byId(plan('darwin', fp(all)), 'runtime:node').command, ['volta', 'install', 'node@24.16.0']);
  assert.match(byId(plan('darwin', fp(all)), 'runtime:node').title, /with volta$/);
  const fnm = byId(plan('linux', fp({ fnm: '1.38.1', nvm: 'unknown' })), 'runtime:node');
  assert.deepEqual(fnm.command, ['fnm', 'install', '24.16.0']);
  assert.match(fnm.why, /fnm use 24\.16\.0/);
  const nvmPosix = byId(plan('linux', fp({ nvm: 'unknown', 'apt-get': '2.7' })), 'runtime:node');
  assert.equal(nvmPosix.command, null);
  assert.equal(nvmPosix.manual, 'nvm install 24.16.0 && nvm use 24.16.0');
  assert.equal(nvmPosix.needsConsent, false);
  assert.match(nvmPosix.why, /shell function/);
  const nvmWin = byId(plan('win32', fp({ nvm: '1.1.12', winget: '1.9' })), 'runtime:node');
  assert.deepEqual(nvmWin.command, ['nvm', 'install', '24.16.0']);
  assert.match(nvmWin.title, /nvm-windows/);
  assert.equal(versionManagerRecipe('python', '3.12', ['volta'], 'darwin'), null, 'version managers only cover node');
});

test('alreadySatisfied: matching runtime and package manager versions, present env names, reachable services', () => {
  const steps = plan('linux', fp({ node: { version: '24.16.0' }, pnpm: '10.22.0' }, { services: { postgres: { reachable: true } } }), { envPresent: ['DATABASE_URL'] });
  assert.equal(byId(steps, 'runtime:node').alreadySatisfied, true);
  assert.equal(byId(steps, 'packageManager:pnpm').alreadySatisfied, true);
  assert.equal(byId(steps, 'service:postgres').alreadySatisfied, true);
  assert.equal(byId(steps, 'env:DATABASE_URL').alreadySatisfied, true);
  assert.equal(byId(steps, 'env:SESSION_SECRET').alreadySatisfied, false);
  assert.equal(byId(steps, 'command:install').alreadySatisfied, false, 'commands always run');
  const off = plan('linux', fp({ node: 'v24.15.0', pnpm: '9.15.4' }));
  assert.equal(byId(off, 'runtime:node').alreadySatisfied, false);
  assert.match(byId(off, 'runtime:node').why, /this machine has 24\.15\.0/);
  assert.equal(byId(off, 'packageManager:pnpm').alreadySatisfied, false);
});

test('manifest commands with shell syntax become manual steps instead of being spawned', () => {
  const manifest = { ...MANIFEST, commands: { install: 'pnpm install && pnpm build', start: 'node "my server.js" --port 3000' }, os: undefined };
  const steps = buildPlan({ manifest, fingerprint: fp({}), platform: 'linux', tokenize: tokenizeCommand });
  const install = byId(steps, 'command:install');
  assert.equal(install.command, null);
  assert.equal(install.needsConsent, false);
  assert.match(install.why, /shell syntax/);
  assert.match(install.manual, /^pnpm install && pnpm build/);
  assert.deepEqual(byId(steps, 'command:start').command, ['node', 'my server.js', '--port', '3000']);
});

test('buildPlan never mutates the manifest, tolerates junk, and returns [] without a manifest', () => {
  const before = JSON.stringify(MANIFEST);
  plan('win32', fp({ winget: '1.9' }));
  plan('darwin', fp({ brew: '4.4' }));
  assert.equal(JSON.stringify(MANIFEST), before);
  assert.deepEqual(buildPlan({ manifest: null }), []);
  assert.deepEqual(buildPlan({ manifest: 'nope' }), []);
  const junk = buildPlan({ manifest: { version: 1, runtimes: [null, { name: 'node' }], services: [null, { name: 7 }], env: [null, { name: 'X' }], commands: { install: '' }, healthCheck: 'x' }, platform: 'linux', tokenize: tokenizeCommand });
  assert.deepEqual(junk.map((s) => s.id), ['env:X'], 'runtime without version, unnamed service, empty command and string healthCheck are skipped');
});

test('resolveForOs merges os overrides for commands and runtimes only', () => {
  const m = { commands: { start: 'a', test: 't' }, runtimes: [{ name: 'node', version: '1' }], os: { windows: { commands: { start: 'b' }, runtimes: [{ name: 'node', version: '2' }, { name: 'python', version: '3' }] } } };
  assert.deepEqual(resolveForOs(m, 'win32'), { commands: { start: 'b', test: 't' }, runtimes: [{ name: 'node', version: '2' }, { name: 'python', version: '3' }] });
  assert.deepEqual(resolveForOs(m, 'linux'), { commands: { start: 'a', test: 't' }, runtimes: [{ name: 'node', version: '1' }] });
  assert.deepEqual(resolveForOs({}, 'darwin'), { commands: {}, runtimes: [] });
  assert.deepEqual(['win32', 'darwin', 'linux', 'freebsd'].map(osKey), ['windows', 'macos', 'linux', 'linux']);
});

test('fingerprint spellings: strings, objects, found:false, booleans and missing entries', () => {
  const f = fp({ a: 'v1.2.3', b: { version: '2.0.0' }, c: { found: false }, d: { found: true }, e: true, f: null, g: false, h: '' });
  assert.equal(toolVersion(f, 'a'), '1.2.3');
  assert.equal(toolVersion(f, 'b'), '2.0.0');
  assert.equal(toolVersion(f, 'c'), null);
  assert.equal(toolVersion(f, 'd'), 'unknown');
  assert.equal(toolVersion(f, 'e'), 'unknown');
  assert.equal(toolVersion(f, 'f'), null);
  assert.equal(toolVersion(f, 'g'), null);
  assert.equal(toolVersion(f, 'h'), null);
  assert.equal(toolVersion(f, 'zzz'), null);
  assert.equal(toolVersion(null, 'a'), null);
  assert.equal(toolPresent(f, 'd'), true);
  assert.equal(normalizeVersion(undefined), null);
  assert.equal(normalizeVersion(' V3.1 '), '3.1');
  assert.equal(majorOf('v24.16.0'), 24);
  assert.equal(majorOf('nope'), null);
});

test('native recipes cover other runtimes and unknown ones degrade to a manual hint', () => {
  assert.deepEqual(nativeRuntimeRecipe('python', '3.12.4', 'win32', ['winget']).command.slice(0, 4), ['winget', 'install', '--id', 'Python.Python.3.12']);
  assert.deepEqual(nativeRuntimeRecipe('java', '21.0.2', 'darwin', ['brew']).command, ['brew', 'install', 'openjdk@21']);
  assert.equal(nativeRuntimeRecipe('java', '21', 'linux').manual, 'sudo apt-get update && sudo apt-get install -y openjdk-21-jdk');
  assert.match(nativeRuntimeRecipe('zig', '0.13.0', 'win32', ['winget']).manual, /winget search zig/);
  assert.match(nativeRuntimeRecipe('zig', '0.13.0', 'darwin', ['brew']).manual, /brew search zig/);
  assert.match(nativeRuntimeRecipe('zig', '0.13.0', 'linux').manual, /distribution's package manager/);
  assert.match(serviceRecipe({ name: 'redis' }, 'win32'), /Docker \/ WSL/, 'redis has no winget package');
  assert.equal(serviceRecipe({ name: 'Redis' }, 'darwin'), 'brew install redis && brew services start redis');
  assert.match(serviceRecipe({ name: 'kafka', version: '3' }, 'linux'), /kafka 3 with your distribution/);
});

test('formatPlan prints every step with its marker, why line and what will run, then the consent summary', () => {
  const steps = plan('linux', fp({ node: '24.16.0', 'apt-get': '2.7' }), { envPresent: ['SESSION_SECRET'] });
  const text = formatPlan(steps, { platform: 'linux', manifestName: 'demo-portal' });
  const lines = text.split('\n');
  assert.equal(lines[0], 'Setup plan for linux (demo-portal): 10 steps');
  assert.match(text, /^ 1\. \[ok {4}\] Install node 24\.16\.0$/m);
  assert.match(text, /already satisfied on this machine/);
  assert.match(text, /^ 2\. \[run {3}\] Activate pnpm 10\.22\.0$/m);
  assert.match(text, /asks first, then runs: corepack prepare pnpm@10\.22\.0 --activate/);
  assert.match(text, /^ 3\. \[manual\] Provide postgres 16 on port 5432$/m);
  assert.match(text, /you run: sudo apt-get install -y postgresql-16/);
  assert.match(text, /^ 9\. \[start \] Start: pnpm run dev$/m);
  assert.match(text, /^10\. \[check \] Health check: GET http:\/\/localhost:3000\/health$/m);
  assert.equal(lines[lines.length - 1], '5 steps will ask before running; 2 steps are for you to run by hand.');
  assert.deepEqual(steps.map(stepMarker), ['ok    ', 'run   ', 'manual', 'manual', 'ok    ', 'run   ', 'run   ', 'run   ', 'start ', 'check ']);
});
