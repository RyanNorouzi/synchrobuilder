// Per-line neutralization of markup that imitates conversation structure (ADR-005 step 9) and URL defanging (step 10).
// Input lines are already normalized, control-free and trimmed. Output is still raw text: HTML escaping happens later.

export const FENCE_TOKEN = '[fence removed]';
export const MARKER_TOKEN = '[marker removed]';
export const URL_TOKEN = '[url removed]';
export const MAX_URLS = 3;

const FENCE = /`{3,}|~{3,}/g;
const HEADING = /^#{1,6}(?:\s+|$)/;
const QUOTE = /^(?:>\s*)+/;
// Horizontal rules and YAML front-matter fences: only rule characters and spaces, at least three of them.
const RULE_ONLY = /^[-*_= ]+$/;
const LEADING_EQ = /^=+/;
const EQ_RUN = /={3,}/g;
// A role label at line start, optionally wrapped in [], () or <>, followed by a separator so prose such as
// "Note the following" is left alone. Longer alternatives first so "claude code:" is matched as one label.
const ROLE = /^[[(<]?\s*(?:claude code|human|assistant|system|user|claude|ai|tool|function|observation|action|thought|instructions?|note|important|warning|admin|anthropic)\s*[:>\])]/i;
const MARKER = /synchrobuilder:(?:begin|end)/gi;

/** Neutralize one line. Returns the new line, or null when the line should be dropped. `stats` counters are optional. */
export function neutralizeLine(line, stats = {}) {
  let s = line;
  if (FENCE.test(s)) { FENCE.lastIndex = 0; stats.fences = (stats.fences || 0) + 1; s = s.replace(FENCE, FENCE_TOKEN); }
  // Headings and blockquotes can nest ("> # title"); three rounds cover any realistic stacking without looping on input.
  for (let i = 0; i < 3; i++) {
    const before = s;
    s = s.replace(QUOTE, '').replace(HEADING, '').trim();
    if (s !== before) stats.headings = (stats.headings || 0) + 1; else break;
  }
  if (!s) return null;
  if (RULE_ONLY.test(s) && s.replace(/ /g, '').length >= 3) { stats.rules = (stats.rules || 0) + 1; return null; }
  s = s.replace(LEADING_EQ, '[=]').replace(EQ_RUN, '[=]');
  if (ROLE.test(s)) { stats.roleLabels = (stats.roleLabels || 0) + 1; s = '~ ' + s; }
  if (MARKER.test(s)) { MARKER.lastIndex = 0; stats.markers = (stats.markers || 0) + 1; s = s.replace(MARKER, MARKER_TOKEN); }
  return s || null;
}

// http(s) URL: optional userinfo, host up to the first / ? # then the rest. Quotes and angle brackets end a URL.
const HTTP_URL = /https?:\/\/(?:[^\s<>"'/@]*@)?([^\s<>"'/?#]+)([^\s<>"']*)/gi;
// Any other scheme with an authority, and the schemes that carry a payload or a target without "//".
const OTHER_SCHEME_URL = /\b[a-z][a-z0-9+.-]{1,15}:\/\/[^\s<>"']+/gi;
const PAYLOAD_SCHEME_URL = /\b(?:data|javascript|vbscript|file|mailto|tel|sms|ftp|ssh|git|smb|ws|wss):[^\s<>"']+/gi;
const WWW = /\bwww\./gi;

/** Defang every URL in one line. `state.count` carries the per-field URL budget across lines. */
export function defangUrls(line, state = { count: 0 }, stats = {}) {
  let s = line.replace(HTTP_URL, (_m, host, rest) => {
    stats.urls = (stats.urls || 0) + 1;
    state.count = (state.count || 0) + 1;
    if (state.count > MAX_URLS) { stats.urlsRemoved = (stats.urlsRemoved || 0) + 1; return URL_TOKEN; }
    return host.replace('.', '[.]') + rest;
  });
  s = s.replace(OTHER_SCHEME_URL, () => { stats.urlsRemoved = (stats.urlsRemoved || 0) + 1; return URL_TOKEN; });
  s = s.replace(PAYLOAD_SCHEME_URL, () => { stats.urlsRemoved = (stats.urlsRemoved || 0) + 1; return URL_TOKEN; });
  return s.replace(WWW, 'www[.]');
}

/** HTML-escape for the block (step 13): '&' first so pre-escaped attacker text can never decode into a tag. */
export function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
