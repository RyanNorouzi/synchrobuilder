// Executable bits and symlinks: both are carried by git but silently lost or mangled on Windows checkouts
// (no exec bit at all; symlinks become plain text files unless Developer Mode and core.symlinks are on).
// git core.fileMode is deliberately not consulted: we report what is on disk, nothing more.
import fs from 'node:fs';
import path from 'node:path';

const MAX_FINDINGS = 100;
const MAX_STAT_FILES = 20000;
// Only these can plausibly carry a shebang; extensionless files are checked too (bin/cli, scripts/deploy).
const SCRIPT_EXT = /\.(sh|bash|zsh|py|rb|pl|mjs|cjs|js|ts)$/i;
const MAX_SHEBANG_SIZE = 512 * 1024;

function baseOf(rel) { return rel.includes('/') ? rel.slice(rel.lastIndexOf('/') + 1) : rel; }

/** True when the file starts with "#!". Reads two bytes only, so a large repo stays cheap. */
export function hasShebang(repoRoot, rel) {
  let fd = null;
  try {
    fd = fs.openSync(path.join(repoRoot, rel), 'r');
    const buf = Buffer.alloc(2);
    const n = fs.readSync(fd, buf, 0, 2, 0);
    return n === 2 && buf[0] === 0x23 && buf[1] === 0x21;
  } catch { return false; } finally { if (fd !== null) { try { fs.closeSync(fd); } catch { /* already closed */ } } }
}

function symlinkFinding(rel) {
  return {
    file: rel,
    message: 'Symbolic link inside the repository: on a Windows checkout it becomes a plain text file containing the target path unless Developer Mode and core.symlinks are enabled, so anything that follows it breaks.',
    fix: 'Replace the link with a real file or directory, or create it at build time from a script; if it must stay a link, document the Windows requirement (git config core.symlinks true and Developer Mode).',
    data: { kind: 'symlink' },
  };
}

function execBitFinding(rel) {
  return {
    file: rel, line: 1,
    message: 'Script has a shebang line but no executable bit, so running it directly fails with "permission denied" on macOS and Linux.',
    fix: 'Run "chmod +x <file>" and "git update-index --chmod=+x <file>" so git carries the bit, or document invoking it through the interpreter (node, python3, sh).',
    data: { kind: 'exec-bit' },
  };
}

// Windows has no exec bit to inspect; say so once instead of pretending every script is fine.
// The engine currently stamps the rule's severity on every finding; the low severity here is a hint for it.
function windowsNotice() {
  return {
    file: '.', severity: 'low',
    message: 'Cannot check executable bits on Windows: the file system has no exec bit, so scripts with a shebang may still lack it in git (mode 100644).',
    fix: 'Run this audit once on macOS or Linux, or check "git ls-files -s" for shebang scripts stored as 100644 and fix them with "git update-index --chmod=+x <file>".',
    data: { kind: 'exec-bit-unavailable', informational: true },
  };
}

export default {
  id: 'exec-bits-symlinks',
  severity: 'medium',
  title: 'Shebang scripts without executable bit, or symlinks in the repository',
  explain: 'Git stores executable bits and symlinks, but Windows has neither: scripts lose their bit and symlinks turn into text files, so a checkout that works on one OS fails on another.',
  scope: 'project',
  check({ repoRoot, index }) {
    const findings = [];
    const canCheckExec = process.platform !== 'win32';
    let seen = 0;
    for (const rel of index.files) {
      if (findings.length >= MAX_FINDINGS || seen++ >= MAX_STAT_FILES) break;
      const st = index.stat(rel);
      if (!st) continue;
      if (st.isSymbolicLink()) { findings.push(symlinkFinding(rel)); continue; }
      if (!canCheckExec || !st.isFile() || st.size < 2 || st.size > MAX_SHEBANG_SIZE) continue;
      if ((st.mode & 0o111) !== 0) continue;
      const base = baseOf(rel);
      if (!SCRIPT_EXT.test(base) && base.includes('.')) continue;
      if (hasShebang(repoRoot, rel)) findings.push(execBitFinding(rel));
    }
    if (!canCheckExec) findings.push(windowsNotice());
    return findings;
  },
};
