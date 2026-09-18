// statusline [install|remove] [--plan] [--yes]: a plugin cannot ship a status line, so this shows the exact change to the
// user's ~/.claude/settings.json (or $CLAUDE_CONFIG_DIR/settings.json) and applies it only with --yes, keeping a backup.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toPosix } from '../core/paths.mjs';
import { readText, writeJsonAtomic } from '../core/fsx.mjs';

export const RENDERER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'statusline', 'render.mjs');
const MARK = 'synchrobuilder';

export function settingsFile() {
  const dir = process.env.CLAUDE_CONFIG_DIR && process.env.CLAUDE_CONFIG_DIR.trim() ? path.resolve(process.env.CLAUDE_CONFIG_DIR) : path.join(os.homedir(), '.claude');
  return path.join(dir, 'settings.json');
}
export function backupFile(file = settingsFile()) { return `${file}.${MARK}-backup`; }

/** The statusLine block, with forward slashes so it reads the same on every OS; quoted only when the path has whitespace. */
export function plannedChange(renderer = RENDERER) {
  const p = toPosix(renderer);
  return { statusLine: { type: 'command', command: `node ${/\s/.test(p) ? `"${p}"` : p}`, refreshInterval: 20 } };
}

function isOurs(statusLine) {
  return Boolean(statusLine && typeof statusLine.command === 'string' && statusLine.command.includes(MARK) && statusLine.command.includes('render.mjs'));
}

function readSettings(file) {
  const text = readText(file, null);
  if (text === null) return { settings: {}, missing: true };
  try { const v = JSON.parse(text); return { settings: v && typeof v === 'object' && !Array.isArray(v) ? v : null }; } catch { return { settings: null }; }
}

export async function run({ flags, args, stdout, stderr }) {
  const mode = (args[0] || 'plan').toLowerCase();
  const file = settingsFile();
  const change = plannedChange();
  const { settings, missing } = readSettings(file);
  if (settings === null) { stderr.write(`${file} is not valid JSON; fix it by hand before installing the status line.\n`); return 1; }
  const current = settings.statusLine;
  if (mode === 'plan' || flags.plan || (mode === 'install' && !flags.yes)) {
    stdout.write(`Settings file: ${file}${missing ? ' (will be created)' : ''}\n`);
    stdout.write(current ? `Current statusLine (will be replaced, backup kept at ${backupFile(file)}):\n${JSON.stringify({ statusLine: current }, null, 2)}\n` : 'No statusLine is configured today.\n');
    stdout.write(`Change to merge into the settings file:\n${JSON.stringify(change, null, 2)}\n`);
    stdout.write(mode === 'install' ? 'Re-run with --yes to apply: synchrobuilder statusline install --yes\n' : 'Apply with: synchrobuilder statusline install --yes\nRemove with: synchrobuilder statusline remove --yes\n');
    return mode === 'install' ? 1 : 0;
  }
  if (mode === 'install') {
    if (!missing && !isOurs(current)) fs.copyFileSync(file, backupFile(file)); // keep the user's own settings once, before we touch them
    writeJsonAtomic(file, { ...settings, ...change });
    stdout.write(`Installed the Synchrobuilder status line in ${file}${!missing && !isOurs(current) ? ` (backup: ${backupFile(file)})` : ''}. Restart Claude Code to see it.\n`);
    return 0;
  }
  if (mode === 'remove') {
    if (!flags.yes) { stderr.write(`This restores ${backupFile(file)} over ${file} (or removes our statusLine entry). Re-run with --yes to confirm.\n`); return 1; }
    if (fs.existsSync(backupFile(file))) {
      const { settings: backup } = readSettings(backupFile(file));
      if (backup === null) { stderr.write(`Backup ${backupFile(file)} is not valid JSON; not restoring.\n`); return 1; }
      // Restore only the statusLine key: settings the user changed after installing must survive the removal.
      const { statusLine, ...rest } = settings;
      void statusLine;
      writeJsonAtomic(file, backup.statusLine ? { ...rest, statusLine: backup.statusLine } : rest);
      fs.unlinkSync(backupFile(file));
      stdout.write(`Restored the previous statusLine in ${file} from the backup.\n`);
      return 0;
    }
    if (isOurs(current)) { const { statusLine, ...rest } = settings; void statusLine; writeJsonAtomic(file, rest); stdout.write(`Removed the Synchrobuilder statusLine entry from ${file}.\n`); return 0; }
    stdout.write('Nothing to remove: no backup and no Synchrobuilder statusLine entry found.\n');
    return 0;
  }
  stderr.write('Usage: synchrobuilder statusline [install|remove] [--plan] [--yes]\n');
  return 1;
}
