// Checks about Synchrobuilder itself: can it run at all here, and is the sync transport healthy.
import fs from 'node:fs';
import path from 'node:path';
import { homeDir, locate } from '../core/paths.mjs';
import { readJson } from '../core/fsx.mjs';
import { paths } from '../state/layout.mjs';
import { toolVersion } from '../manifest/tools.mjs';
import { readIdentityFile } from '../state/identity.mjs';
import { readTeam } from '../core/config.mjs';

const NODE_FLOOR = 20;

export function pluginChecks(cwd, { env = process.env, probe } = {}) {
  const out = [];
  const add = (ok, title, detail, fix = null) => out.push({ ok, title, detail, fix });

  const major = Number(String(process.versions.node).split('.')[0]);
  add(major >= NODE_FLOOR, `Node ${process.versions.node}`,
    major >= NODE_FLOOR ? 'Meets the Node 20 floor.' : `Synchrobuilder needs Node ${NODE_FLOOR} or newer.`,
    major >= NODE_FLOOR ? null : 'Install a newer Node and make sure it is the one on PATH when Claude Code starts.');

  const gitProbe = toolVersion('git', { probe, env });
  const git = gitProbe && gitProbe.present ? gitProbe : null;
  add(!!git, git ? `git ${git.version || '(version unknown)'}` : 'git is not on PATH',
    git ? 'Marketplace installs and the multiplayer transport both need git.' : 'Without git, plugin updates and team sync cannot run.',
    git ? null : 'Install git and restart Claude Code so it inherits the new PATH.');

  const home = homeDir();
  let writable = false;
  try { fs.mkdirSync(home, { recursive: true }); fs.accessSync(home, fs.constants.W_OK); writable = true; } catch { writable = false; }
  add(writable, `State directory ${home}`, writable ? 'Writable.' : 'Not writable, so nothing can be cached or synced.', writable ? null : `Check permissions on ${home}, or set SYNCHROBUILDER_HOME to a writable directory.`);

  const monitorsOff = env.DISABLE_TELEMETRY || env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC;
  add(true, monitorsOff ? 'Background monitors unavailable' : 'Background monitors available',
    monitorsOff ? 'DISABLE_TELEMETRY or CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC is set, so Claude Code does not run plugin monitors. Teammate messages still arrive at your next prompt.' : 'Claude Code can run plugin monitors here.',
    null);

  const loc = locate(cwd);
  if (!loc) { add(false, 'Not inside a git repository', 'The multiplayer features need a repository with a remote.', 'Run this inside your project.'); return out; }
  add(!!loc.remoteUrl, loc.remoteUrl ? `Remote ${loc.remoteUrl}` : 'This repository has no remote',
    loc.remoteUrl ? 'Team state travels through this remote.' : 'Without a remote there is nobody to sync with; everything else still works.',
    loc.remoteUrl ? null : 'Add a remote with: git remote add origin <url>');

  const identity = readIdentityFile(loc.checkoutDir);
  const team = readTeam(loc.workTree);
  if (!identity) add(false, 'No handle resolved yet', 'Synchrobuilder could not work out who you are in this repository.', 'Set git config user.email, or run: synchrobuilder iam <handle>');
  else {
    const known = Object.prototype.hasOwnProperty.call(team.members, identity.handle);
    add(true, `Handle ${identity.handle} (${identity.source})`, known ? 'Listed in .synchrobuilder/team.json.' : 'Not listed in .synchrobuilder/team.json, so teammates see you as unverified.', known ? null : `Add "${identity.handle}" to .synchrobuilder/team.json, or run: synchrobuilder iam <handle>`);
  }

  if (loc.remoteDir) {
    const status = readJson(paths.remote(loc.remoteDir).status, null);
    const snapshot = readJson(paths.remote(loc.remoteDir).snapshot, null);
    if (!status) add(false, 'The sync worker has not run yet', 'No status file under the state directory.', 'Start a Claude Code session in this repository, or run: synchrobuilder worker --once');
    else {
      const ok = !status.lastErrorClass;
      add(ok, `Sync ${ok ? 'healthy' : `failing (${status.lastErrorClass})`}`,
        ok ? `Mode ${status.mode}, last success ${status.lastOkAt || 'unknown'}.` : `${status.lastError || ''} Next attempt ${status.nextAttemptAt || 'soon'}.`,
        ok ? null : fixForErrorClass(status.lastErrorClass));
    }
    if (snapshot) add(true, `Team snapshot: ${(snapshot.writers || []).length} writer(s)`, `Fetched ${snapshot.fetchedAt || 'never'}.`, null);
  }
  return out;
}

export function fixForErrorClass(cls) {
  switch (cls) {
    case 'auth': return 'Your git credentials cannot reach the remote from a background process. Try a fetch by hand, and for HTTPS remotes make sure a credential helper is configured.';
    case 'ssh-hostkey': return 'The host key is unknown or changed. Run a git fetch by hand once and accept the host key.';
    case 'policy': return 'The remote refused the state ref. Synchrobuilder falls back to a branch; if that is also blocked, ask for push access to refs/synchrobuilder/* or a synchrobuilder/* branch.';
    case 'network': return 'The remote was unreachable. Work keeps queueing locally and syncs when the network comes back.';
    case 'rejected': return 'Another machine published at the same moment; the next tick resolves it.';
    case 'no-ref': return 'Nothing is published yet, or the refs were deleted (a mirror push does that). The next tick recreates them.';
    default: return 'See ~/.synchrobuilder/logs/transport.log for the exact git output.';
  }
}
