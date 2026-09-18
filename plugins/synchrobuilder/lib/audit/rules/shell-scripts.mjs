// Shell scripts the project needs (referenced from package scripts, CI, Dockerfile, Makefile or the README setup steps)
// that have no Windows or Node equivalent next to them.
import { lineOf } from '../engine.mjs';

const SCRIPT_EXT = /\.(sh|bash)$/i;
const EQUIVALENT_EXTS = ['.mjs', '.js', '.cjs', '.ps1', '.cmd', '.bat'];
const WORKFLOW = /^\.github\/workflows\/[^/]+\.ya?ml$/i;
const DOCKERFILE = /(^|\/)(Dockerfile|Dockerfile\.[^/]+|[^/]+\.Dockerfile)$/;
const MAKEFILE = /(^|\/)(Makefile|makefile|GNUmakefile)$/;
const PACKAGE = /(^|\/)package\.json$/;
const README = /^README(\.md|\.markdown|\.txt)?$/i;
const SETUP_HEADING = /install|setup|set up|getting started|quick ?start|usage|develop|running|run it|build|prerequisites|contributing/i;
const MAX_FINDINGS = 50;

/** Which project files may reference a script; README counts only through its setup-style sections. */
function referenceSources(index) {
  return index.files.filter((f) => PACKAGE.test(f) || WORKFLOW.test(f) || DOCKERFILE.test(f) || MAKEFILE.test(f) || README.test(f));
}

/** Only the sections of the README a newcomer follows to get the project running, so a mention under "History" does not count. */
function setupSections(text) {
  const lines = text.split('\n');
  const kept = [];
  let keep = false;
  let level = 0;
  for (const line of lines) {
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const depth = h[1].length;
      if (keep && depth <= level) keep = false;
      if (SETUP_HEADING.test(h[2])) { keep = true; level = depth; }
    }
    kept.push(keep ? line : '');
  }
  return kept.join('\n');
}

/** Line of the first mention of the script (full path preferred, then the basename as a whole word), or 0 when absent. */
function mentionLine(text, script) {
  let at = text.indexOf(script);
  if (at < 0) at = wholeWordIndex(text, script.slice(script.lastIndexOf('/') + 1));
  return at < 0 ? 0 : lineOf(text, at);
}

/** indexOf that refuses "mysetup.sh" as a hit for "setup.sh"; bounded so a pathological file cannot make it crawl. */
function wholeWordIndex(text, word) {
  let from = 0;
  for (let n = 0; n < 50; n++) {
    const at = text.indexOf(word, from);
    if (at < 0) return -1;
    if (at === 0 || !/[A-Za-z0-9_-]/.test(text[at - 1])) return at;
    from = at + 1;
  }
  return -1;
}

function equivalentsOf(script, index) {
  const stem = script.replace(SCRIPT_EXT, '');
  const out = [];
  for (const ext of EQUIVALENT_EXTS) if (index.hasCaseInsensitive(stem + ext)) out.push(stem + ext);
  return out;
}

export default {
  id: 'shell-scripts',
  severity: 'medium',
  title: 'Required shell script without a portable equivalent',
  explain: 'A .sh file that package scripts, CI, the Dockerfile, the Makefile or the README setup steps depend on cannot run on a Windows machine without WSL or Git Bash. Port it to a node script (.mjs) or provide a .ps1/.cmd sibling with the same name.',
  scope: 'project',
  check({ index }) {
    const findings = [];
    if (!index || !Array.isArray(index.files)) return findings;
    const scripts = index.files.filter((f) => SCRIPT_EXT.test(f));
    if (!scripts.length) return findings;
    const sources = [];
    for (const rel of referenceSources(index)) {
      const raw = index.read(rel);
      if (raw === null) continue;
      sources.push({ rel, text: README.test(rel) ? setupSections(raw) : raw });
    }
    for (const script of scripts) {
      if (findings.length >= MAX_FINDINGS) break;
      const references = [];
      for (const src of sources) {
        const line = mentionLine(src.text, script);
        if (line) references.push({ file: src.rel, line });
      }
      if (!references.length) continue;
      const equivalents = equivalentsOf(script, index);
      if (equivalents.length) continue;
      const by = references.map((r) => `${r.file}:${r.line}`).join(', ');
      const stem = script.replace(SCRIPT_EXT, '');
      findings.push({
        file: script,
        message: `${script} is required by ${by} and has no Windows or Node equivalent`,
        fix: `Port it to ${stem}.mjs and run it with node, or add ${stem}.ps1 (or .cmd) beside it and choose per platform`,
        data: { references, tried: EQUIVALENT_EXTS.map((e) => stem + e) },
      });
    }
    return findings;
  },
};
