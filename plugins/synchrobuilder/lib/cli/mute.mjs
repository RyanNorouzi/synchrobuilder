// mute on|off: a flag file the hooks check first. Advisory guard, so muting is always allowed.
import fs from 'node:fs';
import path from 'node:path';
import { locate } from '../core/paths.mjs';

export async function run({ args, cwd, stdout, stderr }) {
  const loc = locate(cwd);
  if (!loc) { stderr.write('Not inside a git repository.\n'); return 1; }
  const flag = path.join(loc.checkoutDir, 'mute');
  const mode = (args[0] || 'on').toLowerCase();
  if (mode === 'off') { try { fs.unlinkSync(flag); } catch { /* already off */ } stdout.write('Synchrobuilder guard: unmuted for this checkout.\n'); return 0; }
  if (mode === 'status') { stdout.write(`Synchrobuilder guard: ${fs.existsSync(flag) ? 'muted' : 'active'} for this checkout.\n`); return 0; }
  fs.mkdirSync(path.dirname(flag), { recursive: true });
  fs.writeFileSync(flag, `muted at ${new Date().toISOString()}\n`);
  stdout.write('Synchrobuilder guard: muted for this checkout. Run "synchrobuilder mute off" to re-enable.\n');
  return 0;
}
