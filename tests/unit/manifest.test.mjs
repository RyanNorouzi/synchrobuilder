// The synchrobuilder.json validator, asserted directly. Until this file it was reached only through the setup
// planner, so its own rules (exact versions, limits, duplicate env names, no values in env) had no test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateManifest, shellSyntaxIn, forOs, currentOs } from '../../plugins/synchrobuilder/lib/manifest/schema.mjs';

const base = () => ({
  version: 1, name: 'demo',
  runtimes: [{ name: 'node', version: '24.16.0' }],
  packageManager: { name: 'pnpm', version: '10.22.0' },
  services: [{ name: 'postgres', version: '16', port: 5432 }],
  env: [{ name: 'DATABASE_URL', description: 'where the database lives', required: true }],
  commands: { install: 'pnpm install', test: 'pnpm test' },
  healthCheck: { type: 'http', url: 'http://localhost:3000/health' },
});
const errorsOf = (patch) => {
  const r = validateManifest({ ...base(), ...patch });
  assert.equal(r.ok, false, JSON.stringify(patch));
  assert.equal(r.manifest, null);
  return r.errors.join('\n');
};

test('a complete manifest is accepted and normalized with defaults', () => {
  const r = validateManifest(base());
  assert.deepEqual(r.errors, []);
  assert.equal(r.ok, true);
  assert.deepEqual(r.manifest.healthCheck, { type: 'http', url: 'http://localhost:3000/health', expectStatus: 200, timeoutSeconds: 60 });
  assert.deepEqual(r.manifest.os, {});
  const minimal = validateManifest({ version: 1 });
  assert.equal(minimal.ok, true);
  assert.deepEqual([minimal.manifest.runtimes, minimal.manifest.env, minimal.manifest.commands, minimal.manifest.healthCheck], [[], [], {}, null]);
});

test('junk never throws: it is reported', () => {
  for (const junk of [null, undefined, 42, 'x', [], [1]]) {
    const r = validateManifest(junk);
    assert.deepEqual([r.ok, r.manifest], [false, null]);
    assert.match(r.errors[0], /must be a JSON object/);
  }
  assert.match(errorsOf({ version: 2 }), /newer than this tool understands/);
  assert.match(errorsOf({ version: '1' }), /version: must be the integer 1/);
});

test('versions must be exact: ranges and bare majors are refused', () => {
  for (const v of ['^24', '>=20', '24', '24.x', '*', '~1.2.3', '1.2.3 || 2.0.0', 24]) {
    assert.match(errorsOf({ runtimes: [{ name: 'node', version: v }] }), /runtimes\[0\]\.version: must be an exact version/, String(v));
    assert.match(errorsOf({ packageManager: { name: 'pnpm', version: v } }), /packageManager\.version: must be an exact version/, String(v));
  }
  for (const v of ['24.16.0', '3.12', '10.22.0-beta.1']) {
    assert.equal(validateManifest({ ...base(), runtimes: [{ name: 'node', version: v }] }).ok, true, v);
  }
});

test('env entries hold names only: values, defaults and duplicates are refused', () => {
  assert.match(errorsOf({ env: [{ name: 'TOKEN', value: 'hunter2' }] }), /env\[0\]: has a "value" key/);
  assert.match(errorsOf({ env: [{ name: 'TOKEN', default: 'x' }] }), /env\[0\]: has a "default" key/);
  assert.match(errorsOf({ env: [{ name: 'TOKEN', default: 'x', value: 'y' }] }), /env\[0\]: has a "value" key/);
  assert.match(errorsOf({ env: [{ name: 'A' }, { name: 'A' }] }), /env\[1\]\.name: "A" is listed twice/);
  assert.match(errorsOf({ env: [{ name: '1BAD' }] }), /must be an environment variable name/);
  assert.match(errorsOf({ env: [{ name: 'A', required: 'yes' }] }), /required: must be true or false/);
});

test('commands are plain argument strings: shell syntax is refused everywhere a command can appear', () => {
  const shelly = ['a && b', 'a || b', 'a | b', 'a; b', 'a > out', 'a < in', 'echo `id`', 'a &', 'echo ${HOME}', 'echo $(id)', 'echo $HOME', 'a\nb'];
  for (const cmd of shelly) {
    assert.ok(shellSyntaxIn(cmd), cmd);
    assert.match(errorsOf({ commands: { build: cmd } }), /commands\.build: contains /, cmd);
  }
  assert.equal(shellSyntaxIn('pnpm run build --filter web'), null);
  assert.match(errorsOf({ runtimes: [{ name: 'node', version: '24.16.0', detect: 'node -v | cat' }] }), /runtimes\[0\]\.detect: contains/);
  assert.match(errorsOf({ healthCheck: { type: 'command', command: 'curl x && true' } }), /healthCheck\.command: contains/);
  assert.match(errorsOf({ os: { windows: { commands: { build: 'a && b' } } } }), /os\.windows\.commands\.build: contains/);
  assert.match(errorsOf({ commands: { build: '' } }), /must be a non-empty string/);
  assert.match(errorsOf({ commands: { build: 'x'.repeat(1001) } }), /longer than 1000 characters/);
  assert.match(errorsOf({ commands: { 'Bad Name': 'x' } }), /command names are lower-case identifiers/);
});

test('length, count and range limits', () => {
  assert.match(errorsOf({ name: 'n'.repeat(101) }), /name: must be a string of at most 100 characters/);
  assert.match(errorsOf({ name: 'bad\u0007bell' }), /name: must be a string/);
  assert.match(errorsOf({ services: [{ name: 'db', port: 0 }] }), /port: must be an integer between 1 and 65535/);
  assert.match(errorsOf({ services: [{ name: 'db', port: 70000 }] }), /port: must be an integer/);
  assert.match(errorsOf({ services: [{ name: 'db', hint: 'h'.repeat(501) }] }), /hint: must be a short string/);
  assert.match(errorsOf({ healthCheck: { type: 'http', url: 'http://x', timeoutSeconds: 3601 } }), /timeoutSeconds: must be an integer between 1 and 3600/);
  assert.match(errorsOf({ healthCheck: { type: 'http', url: 'file:///etc/passwd' } }), /healthCheck\.url: must be an http or https URL/);
  assert.match(errorsOf({ healthCheck: { type: 'tcp' } }), /healthCheck\.type: must be "http" or "command"/);
  // Past the item cap, entries are dropped rather than validated: 64 runtimes survive out of 70.
  const many = validateManifest({ version: 1, runtimes: Array.from({ length: 70 }, (_, i) => ({ name: `r${i}`, version: '1.0.0' })) });
  assert.equal(many.ok, true);
  assert.equal(many.manifest.runtimes.length, 64);
});

test('unknown keys are refused unless they are x- extensions, which are kept', () => {
  assert.match(errorsOf({ surprise: 1 }), /manifest: unknown key "surprise"/);
  assert.match(errorsOf({ runtimes: [{ name: 'node', version: '24.16.0', extra: 1 }] }), /runtimes\[0\]: unknown key "extra"/);
  const r = validateManifest({ ...base(), 'x-team': 'core', runtimes: [{ name: 'node', version: '24.16.0', 'x-note': 'lts' }] });
  assert.equal(r.ok, true);
  assert.equal(r.manifest['x-team'], 'core');
  assert.equal(r.manifest.runtimes[0]['x-note'], 'lts');
});

test('per-OS blocks override commands and runtimes only, and forOs layers them on the base', () => {
  assert.match(errorsOf({ os: { solaris: {} } }), /os\.solaris: only windows, macos, linux can be overridden/);
  assert.match(errorsOf({ os: { windows: { env: [] } } }), /os\.windows\.env: only "commands" and "runtimes" may be overridden/);
  const r = validateManifest({
    ...base(),
    runtimes: [{ name: 'node', version: '24.16.0' }, { name: 'python', version: '3.12' }],
    os: { windows: { commands: { test: 'pnpm test:win' }, runtimes: [{ name: 'python', version: '3.11' }] } },
  });
  assert.equal(r.ok, true, r.errors.join('\n'));
  const win = forOs(r.manifest, 'windows');
  assert.deepEqual(win.commands, { install: 'pnpm install', test: 'pnpm test:win' });
  assert.deepEqual(win.runtimes, [{ name: 'python', version: '3.11' }, { name: 'node', version: '24.16.0' }]);
  assert.deepEqual(forOs(r.manifest, 'linux').commands, { install: 'pnpm install', test: 'pnpm test' });
  assert.deepEqual([currentOs('win32'), currentOs('darwin'), currentOs('freebsd')], ['windows', 'macos', 'linux']);
});
