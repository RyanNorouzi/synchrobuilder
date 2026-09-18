// Character-level cleaning shared by the sanitizer and by human-visible surfaces (ADR-005 section 2, steps 3 to 7).
// Every regex here is a single-pass character-class scan: hostile input cannot make them backtrack.
// Nothing in this module looks at meaning; it only removes bytes that a terminal or a tokenizer would interpret.

// Terminal escape families (ADR-005 step 4). CSI: ESC [ params intermediates final. OSC: ESC ] ... BEL or ST.
// DCS/SOS/PM/APC: ESC P|X|^|_ ... ST. Anything else after ESC is a two-byte sequence at most.
const CSI = /\x1b\[[0-?]*[ -/]*[@-~]/g;
const OSC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?/g;
const STRING_COMMAND = /\x1b[PX^_][^\x1b]*(?:\x1b\\)?/g;
const BARE_ESC = /\x1b[@-_]?/g;
// C1 controls include 8-bit CSI (U+009B) and 8-bit OSC (U+009D); they are deleted rather than parsed.
const C1 = /[\x80-\x9f]/g;
// Cc except LF and TAB (step 5). TAB is mapped to a space separately so column alignment survives as one space.
const CC = /[\x00-\x08\x0b-\x1f\x7f]/g;
// Format (zero-width, bidi, tags, BOM, soft hyphen), private use and unassigned code points (step 6).
const INVISIBLE = /[\p{Cf}\p{Co}\p{Cn}]/gu;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
// Horizontal whitespace runs inside one line (everything \s matches except LF).
const HSPACE = /[^\S\n]+/g;

/** NFC so composed and decomposed spellings compare the same; lone surrogates become U+FFFD (step 3). */
export function normalizeUnicode(text) {
  const s = String(text).normalize('NFC');
  return typeof s.toWellFormed === 'function' ? s.toWellFormed() : s.replace(LONE_SURROGATE, '�');
}

/** Remove every terminal escape sequence and every C1 control. Returns the text and how many UTF-16 units went away. */
export function stripEscapes(text) {
  const out = text.replace(CSI, '').replace(OSC, '').replace(STRING_COMMAND, '').replace(BARE_ESC, '').replace(C1, '');
  return { text: out, removed: text.length - out.length };
}

/** Delete C0 controls and DEL, keep LF, turn TAB into one space (step 5). CR goes too, so CRLF collapses to LF. */
export function stripControls(text) {
  const out = text.replace(/\t/g, ' ').replace(CC, '');
  return { text: out, removed: text.length - out.length };
}

/** Delete Cf, Co and Cn code points (step 6): zero-width joiners, bidi overrides, tag characters, BOM, private use. */
export function stripInvisible(text) {
  const out = text.replace(INVISIBLE, '');
  return { text: out, removed: text.length - out.length };
}

/** Split on LF, collapse horizontal whitespace to one space, trim, and drop blank lines (step 7).
 *  Blank lines are dropped outright rather than collapsed: a blank body line would render as a bare '  | ',
 *  which ADR-005 step 14 forbids, and line counts are policy limits that padding must not consume. */
export function splitLines(text) {
  const out = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(HSPACE, ' ').trim();
    if (line) out.push(line);
  }
  return out;
}

/** One pass of steps 3 to 6 for callers that need a clean string but no line shaping. */
export function stripAll(text) {
  const a = stripEscapes(normalizeUnicode(text));
  const b = stripControls(a.text);
  const c = stripInvisible(b.text);
  return { text: c.text, escapes: a.removed, controls: b.removed, invisible: c.removed };
}

/** Printable ASCII only, single line, capped: the only form in which teammate text may reach a fixed human-visible
 *  template such as the status line (ADR-005 section 4). Never throws; non-strings give ''. */
export function toPrintableAscii(text, max = 40) {
  if (typeof text !== 'string') return '';
  const clean = stripAll(text.slice(0, max * 8)).text.replace(/[^\x20-\x7e]+/g, ' ').replace(/ +/g, ' ').trim();
  return clean.length > max ? clean.slice(0, max) : clean;
}
