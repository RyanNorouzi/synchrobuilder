// File names that Windows refuses: reserved device names, trailing dots or spaces, forbidden characters,
// and paths long enough to hit MAX_PATH once a checkout prefix is added. A single such file makes "git clone" fail.
const MAX_FINDINGS = 200;
export const MAX_REL_LENGTH = 200;
const WINDOWS_LIMIT = 260;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
// eslint-disable-next-line no-control-regex
const FORBIDDEN_CHARS = /[<>:"|?*\x00-\x1f]/g;

function describeChar(ch) {
  const code = ch.charCodeAt(0);
  return code < 0x20 ? `control character U+${code.toString(16).toUpperCase().padStart(4, '0')}` : `"${ch}"`;
}

/** Reasons one path segment is illegal on Windows; empty when it is fine. */
export function segmentProblems(seg) {
  const problems = [];
  if (RESERVED.test(seg)) problems.push(`"${seg.split('.')[0]}" is a reserved device name on Windows`);
  if (/[. ]$/.test(seg)) problems.push(`ends with a ${seg.endsWith('.') ? 'dot' : 'space'}, which Windows strips or rejects`);
  const chars = new Set();
  for (const m of seg.match(FORBIDDEN_CHARS) || []) chars.add(describeChar(m));
  if (chars.size) problems.push(`contains ${[...chars].slice(0, 5).join(', ')}, forbidden in Windows file names`);
  return problems;
}

/** Findings for one repo-relative POSIX path: the first bad segment (deduplicated by directory) and the length. */
function checkPath(rel, reported) {
  const findings = [];
  const segs = rel.split('/');
  for (let i = 0; i < segs.length; i++) {
    const problems = segmentProblems(segs[i]);
    if (!problems.length) continue;
    const prefix = segs.slice(0, i + 1).join('/');
    if (reported.has(prefix)) break;
    reported.add(prefix);
    const isDir = i < segs.length - 1;
    findings.push({
      file: prefix,
      message: `${isDir ? 'Directory' : 'File'} name "${segs[i]}" ${problems.join('; ')}. Git cannot create it on Windows, so the whole clone fails.`,
      fix: 'Rename it to a name that is legal on every OS: letters, digits, dot, dash and underscore, no trailing dot or space, and not a device name.',
      data: { segment: segs[i], problems },
    });
    break;
  }
  if (rel.length > MAX_REL_LENGTH) {
    findings.push({
      file: rel,
      message: `Path is ${rel.length} characters from the repo root; the Windows limit is ${WINDOWS_LIMIT} including the checkout prefix (C:\\Users\\name\\projects\\repo\\ and similar), so a deep checkout fails.`,
      fix: 'Shorten directory and file names or flatten the tree so every path stays under 200 characters; enabling core.longpaths on every Windows machine is not a fix others can rely on.',
      data: { length: rel.length, limit: WINDOWS_LIMIT, margin: MAX_REL_LENGTH },
    });
  }
  return findings;
}

export default {
  id: 'illegal-filenames',
  severity: 'high',
  title: 'File names or paths that Windows cannot check out',
  explain: 'Windows rejects reserved device names (con, nul, com1...), names ending in a dot or space, the characters < > : " | ? * and control characters, and paths near 260 characters. Git clone stops at the first such file.',
  scope: 'project',
  check({ index }) {
    const findings = [];
    const reported = new Set();
    for (const rel of index.files) {
      if (findings.length >= MAX_FINDINGS) break;
      findings.push(...checkPath(rel, reported));
    }
    return findings;
  },
};
