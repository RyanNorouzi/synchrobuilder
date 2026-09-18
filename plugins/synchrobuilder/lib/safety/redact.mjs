// Secret redaction (ADR-005 step 11), shared by the inbound sanitizer and by everything that leaves this machine,
// so the "what we accept" list and the "what we send" list in PRIVACY.md are the same list.
//   redact(text) -> { text, count }
// Patterns are Synchrobuilder's own. Each is a bounded, linear scan; none is anchored to a value's meaning, so a
// false positive costs a teammate a pasted string while a false negative would leak a credential. That trade is
// deliberate. The replacement token contains '[' and ']', which no pattern accepts, so a redacted span is never
// matched twice and the count stays honest.

export const REDACTED = '[redacted]';

// Names that are credentials by definition: any explicit assignment to one of these is redacted.
const SECRET_KEYS = 'api[_-]?key|access[_-]?key|private[_-]?key|secret[_-]?key|client[_-]?secret|auth[_-]?token|password|passwd|pwd|secret|token|credentials?';
// Wider set for the high-entropy rule, where the 32-character token itself carries most of the evidence.
const KEY_WORDS = `${SECRET_KEYS}|bearer|auth|key`;

// [regex, keepPrefix]: when keepPrefix is true only the last capture group is replaced and the rest of the match stays.
const RULES = [
  // PEM private keys, terminated or cut off at the end of the field.
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, false],
  // HTTP Authorization header values keep the scheme so the reader still sees what kind of header it was.
  [/\b(?:proxy-)?authorization[ \t]{0,4}[:=][ \t]{0,4}(?:(?:bearer|basic|token|digest|apikey)[ \t]{1,4})?([A-Za-z0-9+/=_.~-]{8,})/gi, true],
  // Vendor token formats.
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g, false],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, false],
  [/\bglpat-[A-Za-z0-9_-]{20,}/g, false],
  [/\bsk-ant-[A-Za-z0-9_-]{20,}/g, false],
  [/\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/g, false],
  [/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, false],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, false],
  [/\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}/g, false],
  [/\bnpm_[A-Za-z0-9]{30,}/g, false],
  [/\bAIza[0-9A-Za-z_-]{30,}/g, false],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/g, false],
  // Credentials embedded in a URL: scheme kept, user:password removed, host kept.
  [/\b([a-z][a-z0-9+.-]{1,15}:\/\/)[^\s/@:]+:[^\s/@]+@/gi, 'url'],
  // Explicit assignments to a secret-like key redact any value of six or more characters.
  [new RegExp(`\\b(?:${SECRET_KEYS})\\b[ \\t]{0,4}[:=][ \\t]{0,4}["'\`]?([^\\s"'\`,;]{6,})`, 'gi'), true],
  // Generic high-entropy tokens (32+ base64 or hex characters) that sit next to a key-like word.
  [new RegExp(`\\b(?:${KEY_WORDS})\\b[ \\t]{0,4}(?:[:=]|is|was)?[ \\t]{0,4}["'\`]?([A-Za-z0-9+/_-]{32,}={0,2})`, 'gi'), true],
];

export function redact(text) {
  if (typeof text !== 'string') return { text: '', count: 0 };
  let s = text;
  let count = 0;
  for (const [re, mode] of RULES) {
    s = s.replace(re, (m, g1) => {
      count++;
      if (mode === 'url') return `${g1}${REDACTED}@`;
      if (mode === true) return m.slice(0, m.length - g1.length) + REDACTED;
      return REDACTED;
    });
  }
  return { text: s, count };
}
