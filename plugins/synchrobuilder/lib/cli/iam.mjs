// iam: show or override the handle Synchrobuilder uses for this checkout on this machine.
import { locate } from '../core/paths.mjs';
import { readTeam } from '../core/config.mjs';
import { resolveIdentity, setOverride, readIdentityFile, describeIdentity } from '../state/identity.mjs';

export async function run({ args, flags, cwd, stdout, stderr }) {
  const loc = locate(cwd);
  if (!loc) { stderr.write('Not inside a git repository.\n'); return 1; }
  const team = readTeam(loc.workTree);
  const handle = args[0];
  if (!handle) {
    const identity = readIdentityFile(loc.checkoutDir) || resolveIdentity({ workTree: loc.workTree, checkoutDir: loc.checkoutDir });
    if (flags.json) { stdout.write(JSON.stringify({ identity, members: Object.keys(team.members) }, null, 2) + '\n'); return 0; }
    stdout.write(describeIdentity(identity, team) + '\n');
    if (Object.keys(team.members).length) stdout.write(`team handles: ${Object.keys(team.members).join(', ')}\n`);
    stdout.write('To use a different handle here: synchrobuilder iam <handle>\n');
    return identity ? 0 : 1;
  }
  const r = setOverride(loc.checkoutDir, handle);
  if (!r.ok) { stderr.write(r.error + '\n'); return 1; }
  stdout.write(`You are "${r.identity.handle}" in this checkout (device ${r.identity.device}).\n`);
  if (Object.keys(team.members).length && !team.members[r.identity.handle]) {
    stdout.write(`Note: "${r.identity.handle}" is not listed in .synchrobuilder/team.json, so teammates will see it as unverified.\n`);
  }
  return 0;
}
