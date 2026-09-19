// SessionStart: register the session, start the background worker if nobody is running it, and inject the team digest.
import path from 'node:path';
import { writeJsonAtomic, touch } from '../core/fsx.mjs';
import { hookContext, writeSession } from './context.mjs';
import { pluginVersion, PLUGIN_ROOT } from '../core/version.mjs';
import { paths } from '../state/layout.mjs';
import { appendEvent } from '../state/journal.mjs';
import { readBranch } from '../state/sessions.mjs';
import { logLine } from '../core/log.mjs';

export async function run(input, ctx) {
  const c = hookContext(input);
  if (!c.loc) return null;
  const branch = readBranch(c.loc.gitDir);
  try {
    writeJsonAtomic(paths.checkout(c.loc.checkoutDir).link, {
      commonDir: c.loc.commonDir, workTree: c.loc.workTree, gitDir: c.loc.gitDir, remoteUrl: c.loc.remoteUrl,
      repoName: c.loc.repoName, pluginVersion: pluginVersion(), updatedAt: new Date().toISOString(),
    });
  } catch (err) { logLine('hooks', `session-start: link.json ${err && err.message}`); }
  writeSession(c, { pid: process.ppid || null, source: input.source || 'startup', closed: false, cwd: c.cwd, branch });
  try { appendEvent(c.loc.checkoutDir, { type: 'session-start', sid: c.sessionId, branch }); } catch { /* fail open */ }

  if (c.loc.remoteDir) {
    try {
      const { registerCheckout, lockHeldByLive } = await import('../worker/loop.mjs');
      registerCheckout(c.loc.remoteDir, { checkoutDir: c.loc.checkoutDir, workTree: c.loc.workTree, gitDir: c.loc.gitDir, remoteUrl: c.loc.remoteUrl });
      touch(paths.checkout(c.loc.checkoutDir).kick);
      // SYNCHROBUILDER_NO_WORKER=1 keeps the background sync from starting: useful in tests and in CI, and for
      // anyone who wants the portability features without the team features. Registration still happens, so
      // "synchrobuilder worker --once" and the status command still work.
      const off = process.env.SYNCHROBUILDER_NO_WORKER === '1';
      if (!off && !lockHeldByLive(paths.remote(c.loc.remoteDir).lock)) {
        const { spawnDetached } = await import('../core/proc.mjs');
        spawnDetached(path.join(PLUGIN_ROOT, 'bin', 'synchrobuilder.mjs'), ['worker', c.loc.checkoutDir, c.loc.remoteDir], { cwd: c.loc.workTree });
      }
    } catch (err) { logLine('hooks', `session-start: worker ${err && err.message}`); }
  }

  try {
    const { digest } = await import('../features/digest.mjs');
    const text = await digest(c);
    if (text) return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } };
  } catch (err) { logLine('hooks', `session-start: digest ${err && err.message}`); }
  return null;
}
