// worker: the background sync loop. Started automatically by the SessionStart hook; also runnable by hand for tests.
//   synchrobuilder worker <checkoutDir> <remoteDir> [--once] [--json]
import { runWorker } from '../worker/loop.mjs';
import { locate } from '../core/paths.mjs';

export async function run({ args, flags, cwd, stdout, stderr }) {
  let remoteDir = args[1];
  if (!remoteDir) {
    const loc = locate(cwd);
    if (!loc || !loc.remoteDir) { stderr.write('No git remote for this checkout; nothing to sync.\n'); return 1; }
    remoteDir = loc.remoteDir;
  }
  const result = await runWorker({ remoteDir, once: !!flags.once });
  if (flags.json) stdout.write(JSON.stringify(result, null, 2) + '\n');
  else if (flags.once) stdout.write(`sync: mode=${result.mode} published=${result.published} pulled=${result.pulled} writers=${result.writers}${result.errorClass ? ` error=${result.errorClass}` : ''}\n`);
  return result.ok === false ? 1 : 0;
}
