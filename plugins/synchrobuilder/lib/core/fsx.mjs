// Small filesystem helpers with the failure modes Synchrobuilder wants: never throw on read, atomic on write.
import fs from 'node:fs';
import path from 'node:path';

export function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

export function readText(file, fallback = null) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return fallback; }
}

export function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
  try {
    fs.renameSync(tmp, file);
  } catch (err) {
    // Windows can refuse to replace a file another process has open; retry once, then fall back to a plain write.
    try { fs.renameSync(tmp, file); } catch { fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n'); try { fs.unlinkSync(tmp); } catch { /* gone */ } }
  }
}

export function appendLine(file, line) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, line.replace(/\r?\n/g, ' ') + '\n');
}

export function readLines(file) {
  const text = readText(file, '');
  return text ? text.split(/\r?\n/).filter(Boolean) : [];
}

export function touch(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const now = new Date();
  try { fs.utimesSync(file, now, now); } catch { fs.writeFileSync(file, ''); }
}

export function exists(p) { try { fs.accessSync(p); return true; } catch { return false; } }

export function listFiles(dir, predicate = () => true) {
  try { return fs.readdirSync(dir).filter(predicate).map((n) => path.join(dir, n)); } catch { return []; }
}
