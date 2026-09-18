import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export function pluginVersion() {
  try { return JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json'), 'utf8')).version || '0.0.0'; } catch { return '0.0.0'; }
}
