// The two defaults that keep a developer's words and state from leaving the machine unasked:
// prompts are not shared as task summaries, and nothing is published to a public remote.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeRig } from './features-rig.mjs';
import { readConfig, DEFAULT_CONFIG } from '../../plugins/synchrobuilder/lib/core/config.mjs';
import { parseGitHubRemote, remoteVisibility } from '../../plugins/synchrobuilder/lib/transport/visibility.mjs';
import { publishHold } from '../../plugins/synchrobuilder/lib/worker/loop.mjs';
import { run as promptHook } from '../../plugins/synchrobuilder/lib/hooks/prompt.mjs';

const fakeFetch = (status, body, calls = { n: 0 }) => Object.assign(async () => { calls.n++; return { status, json: async () => body }; }, { calls });
const failingFetch = async () => { throw new Error('offline'); };
const GH = 'https://github.com/acme/widgets.git';

test('both sharing switches default to off, and only a literal true turns them on', async () => {
  assert.equal(DEFAULT_CONFIG.transport.allowPublic, false);
  assert.equal(DEFAULT_CONFIG.presence.shareTask, false);
  const off = await makeRig({ config: { version: 1, transport: { allowPublic: 'yes' }, presence: { shareTask: 1 } } });
  assert.deepEqual([readConfig(off.repo).transport.allowPublic, readConfig(off.repo).presence.shareTask], [false, false]);
  const on = await makeRig({ config: { version: 1, transport: { allowPublic: true }, presence: { shareTask: true } } });
  assert.deepEqual([readConfig(on.repo).transport.allowPublic, readConfig(on.repo).presence.shareTask], [true, true]);
});

test('the prompt hook records no prompt text unless presence.shareTask is on', async () => {
  const quiet = await makeRig({});
  await promptHook({ cwd: quiet.repo, session_id: 'sess-1', prompt: 'my private words about the bug' });
  assert.equal(quiet.readJournal().some((e) => e.type === 'task-summary'), false);
  assert.equal(JSON.stringify(quiet.readJournal()).includes('private words'), false);
  assert.ok(quiet.readJournal().some((e) => e.type === 'prompt'), 'the heartbeat still lands');

  const sharing = await makeRig({ config: { version: 1, presence: { shareTask: true } } });
  await promptHook({ cwd: sharing.repo, session_id: 'sess-1', prompt: 'Pagination for /users\nsecond line' });
  const summary = sharing.readJournal().find((e) => e.type === 'task-summary');
  assert.equal(summary && summary.text, 'Pagination for /users');
});

test('parseGitHubRemote reads https, ssh and scp forms and nothing else', () => {
  for (const url of [GH, 'https://github.com/acme/widgets', 'https://user@github.com/acme/widgets.git', 'git@github.com:acme/widgets.git', 'ssh://git@github.com/acme/widgets.git']) {
    assert.deepEqual(parseGitHubRemote(url), { owner: 'acme', repo: 'widgets' }, url);
  }
  for (const url of ['https://gitlab.com/acme/widgets.git', 'https://github.com.evil.example/acme/widgets', 'https://github.com/acme', '/srv/git/widgets.git', '', null]) {
    assert.equal(parseGitHubRemote(url), null, String(url));
  }
});

test('remoteVisibility: 200 and not private is public, 404 is private, anything else is unknown', async () => {
  assert.equal(await remoteVisibility(GH, { fetchImpl: fakeFetch(200, { private: false }) }), 'public');
  assert.equal(await remoteVisibility(GH, { fetchImpl: fakeFetch(200, { private: true }) }), 'private');
  assert.equal(await remoteVisibility(GH, { fetchImpl: fakeFetch(404, {}) }), 'private');
  assert.equal(await remoteVisibility(GH, { fetchImpl: fakeFetch(403, {}) }), 'unknown');
  assert.equal(await remoteVisibility(GH, { fetchImpl: failingFetch }), 'unknown');
  const never = fakeFetch(200, { private: false });
  assert.equal(await remoteVisibility('https://gitlab.com/acme/widgets.git', { fetchImpl: never }), 'unknown');
  assert.equal(never.calls.n, 0, 'a host that cannot be asked anonymously is never contacted');
});

test('remoteVisibility caches its answer per remote', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-vis-'));
  const f = fakeFetch(200, { private: false });
  const now = Date.parse('2026-11-16T12:00:00Z');
  assert.equal(await remoteVisibility(GH, { remoteDir: dir, now, fetchImpl: f }), 'public');
  assert.equal(await remoteVisibility(GH, { remoteDir: dir, now: now + 60_000, fetchImpl: failingFetch }), 'public');
  assert.equal(f.calls.n, 1);
  const later = fakeFetch(404, {});
  assert.equal(await remoteVisibility(GH, { remoteDir: dir, now: now + 25 * 3600_000, fetchImpl: later }), 'private');
  assert.equal(later.calls.n, 1, 'a day-old answer is asked again');
});

test('publishHold: a public remote is held unless the team opted in; private and unknown never are', async () => {
  const pub = fakeFetch(200, { private: false });
  assert.equal(await publishHold({ config: readConfigLike(false), remoteUrl: GH, fetchImpl: pub }), 'public-remote');
  const optedIn = fakeFetch(200, { private: false });
  assert.equal(await publishHold({ config: readConfigLike(true), remoteUrl: GH, fetchImpl: optedIn }), null);
  assert.equal(optedIn.calls.n, 0, 'opting in skips the question entirely');
  assert.equal(await publishHold({ config: readConfigLike(false), remoteUrl: GH, fetchImpl: fakeFetch(404, {}) }), null);
  assert.equal(await publishHold({ config: readConfigLike(false), remoteUrl: GH, fetchImpl: failingFetch }), null);
  assert.equal(await publishHold({ config: null, remoteUrl: GH, fetchImpl: pub }), 'public-remote');
});

function readConfigLike(allowPublic) { return { transport: { allowPublic } }; }
