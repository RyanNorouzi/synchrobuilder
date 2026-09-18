// clean: remove everything under ~/.synchrobuilder (or SYNCHROBUILDER_HOME). Asks unless --yes.
import fs from 'node:fs';
import { homeDir } from '../core/paths.mjs';

export async function run({ flags, stdout, stderr }) {
  const dir = homeDir();
  if (!fs.existsSync(dir)) { stdout.write(`Nothing to remove: ${dir} does not exist.\n`); return 0; }
  if (!flags.yes) { stderr.write(`This removes ${dir} (hidden sync repos, local journals, logs). Re-run with --yes to confirm.\n`); return 1; }
  fs.rmSync(dir, { recursive: true, force: true });
  stdout.write(`Removed ${dir}.\n`);
  return 0;
}
