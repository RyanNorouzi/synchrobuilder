// SessionStart: register the session and, once the transport exists, inject the team digest (Phase 6).
import { writeJsonAtomic } from '../core/fsx.mjs';
import path from 'node:path';
import { hookContext, writeSession } from './context.mjs';
import { pluginVersion } from '../core/version.mjs';

export async function run(input, ctx) {
  const c = hookContext(input);
  if (!c.loc) return null;
  try {
    writeJsonAtomic(path.join(c.loc.checkoutDir, 'link.json'), {
      commonDir: c.loc.commonDir, workTree: c.loc.workTree, remoteUrl: c.loc.remoteUrl, repoName: c.loc.repoName,
      pluginVersion: pluginVersion(), updatedAt: new Date().toISOString(),
    });
  } catch { /* fail open */ }
  writeSession(c, { pid: process.ppid || null, source: input.source || 'startup', closed: false, cwd: c.cwd });
  return null;
}
