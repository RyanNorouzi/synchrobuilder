// doctor (fingerprint, comparison, plugin checks) and the CI generator.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fingerprint, probePort } from '../../plugins/synchrobuilder/lib/doctor/fingerprint.mjs';
import { compare, installHint } from '../../plugins/synchrobuilder/lib/doctor/compare.mjs';
import { pluginChecks, fixForErrorClass } from '../../plugins/synchrobuilder/lib/doctor/plugin-checks.mjs';
import { generateWorkflow, badgeSnippet, inferRepoSlug } from '../../plugins/synchrobuilder/lib/ci/workflow.mjs';

const MANIFEST = {
  version: 1,
  name: 'shop',
  runtimes: [{ name: 'node', version: '20.11.0', detect: 'node --version' }],
  packageManager: { name: 'pnpm', version: '9.1.0' },
  services: [{ name: 'postgres', version: '16', port: 55432, hint: 'Any Postgres 16 at DATABASE_URL' }],
  env: [{ name: 'DATABASE_URL', description: 'Postgres connection string', required: true }, { name: 'DEBUG', description: 'verbose logs', required: false }],
  commands: { install: 'pnpm install --frozen-lockfile', build: 'pnpm build', test: 'pnpm test', start: 'pnpm dev' },
  healthCheck: { type: 'http', url: 'http://localhost:3000/health', expectStatus: 200, timeoutSeconds: 30 },
  os: { windows: { commands: { start: 'pnpm dev:win' } } },
};

const fp = (over = {}) => ({
  recordedAt: '2026-09-18T00:00:00.000Z', os: 'macos', platform: 'darwin', arch: 'arm64', release: '24.6.0', node: 'v20.11.0',
  tools: { node: { version: '20.11.0' }, pnpm: { version: '9.1.0' }, git: { version: '2.39.5' } },
  services: [{ name: 'postgres', port: 55432, reachable: true }],
  envNamesSet: ['DATABASE_URL'], envNamesMissing: [], ...over,
});

test('a matching machine produces no findings', () => {
  assert.deepEqual(compare(MANIFEST, fp()), []);
});

test('findings are ordered blocker, likely, note, and each carries an OS-specific fix', () => {
  const findings = compare(MANIFEST, fp({
    tools: { node: { version: '18.20.0' }, git: { version: '2.39.5' } },
    services: [{ name: 'postgres', port: 55432, reachable: false }],
    envNamesMissing: ['DATABASE_URL', 'DEBUG'],
  }), { osName: 'windows' });
  const severities = findings.map((f) => f.severity);
  assert.deepEqual([...severities].sort((a, b) => ({ blocker: 0, likely: 1, note: 2 }[a] - { blocker: 0, likely: 1, note: 2 }[b])), severities, 'already ordered');
  assert.equal(findings[0].severity, 'blocker');
  assert.ok(findings.some((f) => /pnpm is not installed/.test(f.title)));
  assert.ok(findings.some((f) => /node is 18\.20\.0/.test(f.title) && f.severity === 'likely'));
  assert.ok(findings.some((f) => /postgres is not answering/.test(f.title)));
  assert.ok(findings.some((f) => f.title === 'DATABASE_URL is not set' && f.severity === 'likely'));
  assert.ok(findings.some((f) => f.title === 'DEBUG is not set' && f.severity === 'note'), 'an optional variable is only a note');
  for (const f of findings) assert.ok(typeof f.fix === 'string' && f.fix.length, `${f.title} has a fix`);
  assert.ok(findings.find((f) => /pnpm/.test(f.title)).fix.includes('corepack'));
});

test('install hints differ per operating system', () => {
  assert.ok(installHint('node', '20.11.0', 'windows').includes('winget'));
  assert.ok(installHint('node', '20.11.0', 'macos').includes('brew'));
  assert.ok(installHint('node', '20.11.0', 'linux').includes('nvm'));
  assert.ok(installHint('python', '3.12.0', 'linux').includes('sudo'), 'a sudo step is shown as text, never run');
});

test('a missing manifest is itself the first finding', () => {
  const findings = compare(null, fp());
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, 'blocker');
  assert.ok(findings[0].fix.includes('synchrobuilder init'));
});

test('fingerprint records names and versions, never values', async () => {
  const f = await fingerprint({ ...MANIFEST, services: [] }, { env: { PATH: process.env.PATH, DATABASE_URL: 'postgres://user:secret@host/db' } });
  const text = JSON.stringify(f);
  assert.ok(!text.includes('secret'), 'no environment variable value appears anywhere');
  assert.deepEqual(f.envNamesSet, ['DATABASE_URL']);
  assert.deepEqual(f.envNamesMissing, ['DEBUG']);
  assert.ok(f.tools.node && f.tools.node.version, 'node is detected');
});

test('probePort reports reachable and unreachable honestly', async () => {
  const server = http.createServer((req, res) => res.end('ok'));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  assert.equal(await probePort(port), true);
  await new Promise((r) => server.close(r));
  assert.equal(await probePort(port, { timeoutMs: 300 }), false);
});

test('plugin checks explain what is missing for Synchrobuilder itself', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-doc-'));
  const previous = process.env.SYNCHROBUILDER_HOME;
  process.env.SYNCHROBUILDER_HOME = home;
  try {
    const checks = pluginChecks(process.cwd(), { env: { ...process.env, DISABLE_TELEMETRY: '1' } });
    assert.ok(checks.some((c) => /^Node /.test(c.title) && c.ok));
    assert.ok(checks.some((c) => /monitors unavailable/i.test(c.title)), 'telemetry opt-out disables monitors');
    assert.ok(checks.every((c) => c.ok || typeof c.fix === 'string'), 'every failure has a fix');
  } finally { if (previous === undefined) delete process.env.SYNCHROBUILDER_HOME; else process.env.SYNCHROBUILDER_HOME = previous; }
  for (const cls of ['auth', 'policy', 'network', 'no-ref', 'rejected', 'ssh-hostkey', 'weird']) assert.ok(fixForErrorClass(cls).length > 10);
});

test('the generated workflow covers three operating systems and pins exact versions', () => {
  const yaml = generateWorkflow(MANIFEST);
  for (const runner of ['ubuntu-latest', 'macos-latest', 'windows-latest']) assert.ok(yaml.includes(runner), runner);
  assert.ok(yaml.includes("node-version: '20.11.0'"), 'exact node version');
  assert.ok(yaml.includes('corepack prepare pnpm@9.1.0'), 'package manager pinned');
  assert.ok(yaml.includes('DATABASE_URL'), 'required env vars are called out');
  assert.ok(yaml.includes('image: postgres:16'), 'declared services become containers');
  assert.ok(/if: matrix.os == 'windows'/.test(yaml), 'per-OS overrides become guarded steps');
  assert.ok(yaml.includes('"pnpm","dev:win"'), 'the Windows start override is carried as an argument vector, not a shell string');
  assert.ok(yaml.includes('Start the app in the background'), 'an http health check needs the app running');
});

test('the health check step cannot be broken by quoting', () => {
  const yaml = generateWorkflow(MANIFEST);
  const line = yaml.split('\n').find((l) => l.includes('SB_HEALTH_URL:'));
  assert.ok(line.includes("'http://localhost:3000/health'"), line);
  const runLine = yaml.split('\n').find((l) => l.trim().startsWith('run: node -e'));
  const quotes = (runLine.match(/"/g) || []).length;
  assert.equal(quotes % 2, 0, 'balanced double quotes');
  assert.ok(!/run: node -e ".*".*"/.test(runLine.replace(/'[^']*'/g, '')), 'no nested double quotes');
});

test('the badge points at the repository the remote names, and says what it proves', () => {
  assert.deepEqual(inferRepoSlug('git@github.com:acme/shop.git'), { owner: 'acme', repo: 'shop' });
  assert.deepEqual(inferRepoSlug('https://github.com/acme/shop'), { owner: 'acme', repo: 'shop' });
  assert.deepEqual(inferRepoSlug(''), { owner: 'OWNER', repo: 'REPO' });
  const badge = badgeSnippet(MANIFEST, { owner: 'acme', repo: 'shop' });
  assert.ok(badge.includes('acme/shop/actions/workflows/verify.yml/badge.svg'));
  assert.ok(badge.includes('only while the workflow passes'));
});
