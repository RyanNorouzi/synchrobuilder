// Local-only logging. Never throws, never prints to stdout (stdout is the hook protocol).
import fs from 'node:fs';
import path from 'node:path';
import { homeDir } from './paths.mjs';

const MAX_BYTES = 1024 * 1024;

export function logLine(channel, message) {
  try {
    const dir = path.join(homeDir(), 'logs');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${channel}.log`);
    try { if (fs.statSync(file).size > MAX_BYTES) fs.renameSync(file, file + '.1'); } catch { /* no file yet */ }
    fs.appendFileSync(file, `${new Date().toISOString()} ${String(message).replace(/\r?\n/g, ' ')}\n`);
  } catch { /* logging must never fail the caller */ }
}
