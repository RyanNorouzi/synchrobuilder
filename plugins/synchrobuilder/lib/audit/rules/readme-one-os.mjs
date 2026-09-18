// Setup instructions written for one operating system: a README whose install section only says "brew install"
// or "sudo apt" or "winget install" leaves every other teammate to guess. One finding per heading, listing the
// OS-specific tokens that section uses and which platforms it leaves out.
const MAX_FINDINGS = 30;
// Each token maps to the platform family it serves. "posix" covers macOS and Linux together.
const TOKENS = [
  { re: /\bbrew\s+(install|tap|services|cask)\b/g, os: 'mac' },
  { re: /\b(sudo\s+)?apt(-get)?\s+(install|update|upgrade)\b/g, os: 'linux' },
  { re: /\b(sudo\s+)?(dnf|yum|pacman|zypper|apk)\s+(install|-S|add)\b/g, os: 'linux' },
  { re: /\bsource\s+~\/\.(bashrc|zshrc|profile|bash_profile|zprofile)\b/g, os: 'posix' },
  { re: /\bchmod\s+\+x\b/g, os: 'posix' },
  { re: /(^|[\s$;&|`])export\s+[A-Za-z_][A-Za-z0-9_]*=/gm, os: 'posix' },
  { re: /\b(winget|choco|scoop)\s+install\b/g, os: 'windows' },
  { re: /\bsetx\s+[A-Za-z_][A-Za-z0-9_]*\b/g, os: 'windows' },
  { re: /\$env:[A-Za-z_][A-Za-z0-9_]*\s*=/g, os: 'windows' },
];
const LABEL = { mac: 'macOS', linux: 'Linux', posix: 'macOS/Linux shell', windows: 'Windows' };
// A heading that names an OS ("### macOS", "## On Windows") is a deliberate per-OS section, not an omission.
const OS_HEADING = /\b(mac ?os|os x|darwin|homebrew|linux|ubuntu|debian|fedora|arch|windows|win(?:10|11)?|wsl|powershell|unix|posix)\b/i;

/** Split Markdown into sections by heading; the text before the first heading is its own section. */
export function splitSections(content) {
  const lines = content.split('\n');
  const sections = [];
  let current = { heading: '(top of file)', line: 1, lines: [] };
  let fenced = false;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].replace(/\r$/, '');
    if (/^\s*(```|~~~)/.test(t)) fenced = !fenced;
    const h = !fenced && t.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    if (h) {
      if (current.lines.length) sections.push(current);
      current = { heading: h[1], line: i + 1, lines: [] };
      continue;
    }
    current.lines.push(t);
  }
  if (current.lines.length) sections.push(current);
  return sections;
}

function tokensIn(text) {
  const found = new Map();
  for (const { re, os } of TOKENS) {
    re.lastIndex = 0;
    let m;
    let n = 0;
    while ((m = re.exec(text)) && n++ < 50) {
      const token = m[0].replace(/^[\s$;&|`]+/, '').trim();
      if (!found.has(os)) found.set(os, new Set());
      found.get(os).add(token);
    }
  }
  return found;
}

/** Which platforms a section covers and which it leaves out; null when the section is portable or has no commands. */
export function missingPlatforms(found) {
  if (!found.size) return null;
  const hasWindows = found.has('windows');
  const hasMac = found.has('mac') || found.has('posix');
  const hasLinux = found.has('linux') || found.has('posix');
  const missing = [];
  if (!hasMac) missing.push('macOS');
  if (!hasLinux) missing.push('Linux');
  if (!hasWindows) missing.push('Windows');
  // Only "one OS" sections count: a section that already covers both sides is portable enough.
  if (hasWindows && (hasMac || hasLinux)) return null;
  return missing.length ? missing : null;
}

function sectionFinding(rel, section) {
  if (OS_HEADING.test(section.heading)) return null;
  const found = tokensIn(section.lines.join('\n'));
  const missing = missingPlatforms(found);
  if (!missing) return null;
  const covered = [...found.keys()].map((k) => LABEL[k]).join(', ');
  const tokens = [...found.values()].flatMap((s) => [...s]).slice(0, 6);
  return {
    file: rel, line: section.line,
    message: `Section "${section.heading}" only has ${covered} commands (${tokens.join(', ')}); nothing for ${missing.join(' or ')}.`,
    fix: `Add the equivalent steps for ${missing.join(' and ')} (winget/choco, apt, brew; setx or $env: for environment variables), or replace the section with "npx synchrobuilder setup" which runs the right steps per OS.`,
    data: { heading: section.heading, tokens, missing },
  };
}

export default {
  id: 'readme-one-os',
  severity: 'low',
  title: 'Setup instructions for one operating system only',
  explain: 'A README that only shows brew, apt or winget commands, or POSIX-only steps like "source ~/.bashrc", "chmod +x" and "export FOO=", leaves teammates on the other operating systems without a working setup path.',
  scope: 'file',
  appliesTo: (rel) => /(^|\/)(readme|install|installation|setup|getting[-_]?started|contributing|development|onboarding)\.(md|markdown)$/i.test(rel) || /(^|\/)docs\/.*\.(md|markdown)$/i.test(rel),
  check({ relPath, content }) {
    const findings = [];
    for (const section of splitSections(content)) {
      if (findings.length >= MAX_FINDINGS) break;
      const f = sectionFinding(relPath, section);
      if (f) findings.push(f);
    }
    return findings;
  },
};
