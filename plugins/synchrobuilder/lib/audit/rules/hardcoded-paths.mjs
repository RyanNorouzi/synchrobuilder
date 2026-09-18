// Example rule and reference for the rule contract: absolute paths, home directories and hard-coded separators in source and config.
import { lineOf } from '../engine.mjs';

const PATTERNS = [
  { re: /(^|[\s"'`=(,:])(\/Users\/[A-Za-z0-9._-]+|\/home\/[A-Za-z0-9._-]+|C:\\\\Users\\\\[A-Za-z0-9._-]+|C:\\Users\\[A-Za-z0-9._-]+)/g, what: 'a hard-coded home directory' },
  { re: /(^|[\s"'`=(,:])(\/opt\/homebrew\/|\/usr\/local\/(?!bin\/env)|\/tmp\/|\/var\/folders\/|C:\\\\Program Files|C:\\Program Files|D:\\\\|D:\\)/g, what: 'an absolute, machine-specific path' },
  { re: /(['"])[A-Za-z0-9_.-]+(?:\\\\[A-Za-z0-9_.-]+){2,}\1/g, what: 'a path built with backslashes' },
];

export default {
  id: 'hardcoded-paths',
  severity: 'medium',
  title: 'Hard-coded absolute or home-directory paths',
  explain: 'A path that only exists on one machine or one operating system breaks the project for everyone else. Build paths from os.homedir(), os.tmpdir(), process.cwd() and path.join, and read machine-specific locations from configuration.',
  scope: 'file',
  appliesTo: (rel) => /\.(mjs|cjs|js|jsx|ts|tsx|mts|json|jsonc|yml|yaml|toml|ini|cfg|env|py|rb|go|rs|java|kt|cs|php|sh|ps1)$/i.test(rel) && !/(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/.test(rel),
  check({ relPath, content }) {
    const findings = [];
    const lines = content.split('\n');
    // A path inside a comment is documentation (an example, an explanation), not something the program uses.
    const commented = new Set();
    let inBlock = false;
    lines.forEach((text, i) => {
      const trimmed = text.trim();
      if (inBlock) { commented.add(i + 1); if (trimmed.includes('*/')) inBlock = false; return; }
      if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*')) { commented.add(i + 1); return; }
      if (/^\s*\/\*/.test(text)) { commented.add(i + 1); if (!trimmed.includes('*/')) inBlock = true; }
    });
    for (const { re, what } of PATTERNS) {
      re.lastIndex = 0;
      let m;
      let count = 0;
      while ((m = re.exec(content)) && count < 20) {
        count++;
        const offset = m.index + (m[1] ? m[1].length : 0);
        const line = lineOf(content, offset);
        if (commented.has(line)) continue;
        findings.push({ file: relPath, line, message: `Contains ${what}: ${m[2] || m[0].trim()}`, fix: 'Derive the path at runtime (os.homedir(), os.tmpdir(), path.join) or move it to configuration that each machine sets.' });
      }
    }
    return findings;
  },
};
