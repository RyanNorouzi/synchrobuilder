// PLACEHOLDER: the safety agent replaces this file with the full outbound secret redactor (shared with the sanitizer).
//   redact(text) -> { text, count }
const PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
  /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g,
  /(https?:\/\/)[^\s/@:]+:[^\s/@]+@/g,
];
export function redact(text) {
  let s = String(text ?? '');
  let count = 0;
  for (const re of PATTERNS) s = s.replace(re, (m, scheme) => { count++; return scheme ? `${scheme}[redacted]@` : '[redacted]'; });
  return { text: s, count };
}
