// notify <handle> <message...>: queue a short message for a teammate. The handle must be known (team.json or a snapshot
// writer); the text is redacted, stripped of control characters and capped at 400 code points before it leaves the machine.
import { ulid, isHandle, LIMITS } from '../core/schema.mjs';
import { redact } from '../safety/redact.mjs';
import { resolveContext } from '../features/common.mjs';
import { appendJournal } from '../features/journal-write.mjs';

const CONTROL_NOT_LF = /[\x00-\x09\x0b-\x1f\x7f-\x9f]/g; // schema's RE.control is not global and would keep LF out too

export function knownHandles(c) {
  const set = new Set(Object.keys(c.team.members));
  for (const w of c.snapshot ? c.snapshot.writers : []) set.add(w.handle);
  return set;
}

/** Multi-line allowed (LF only), controls and format characters removed, at most LIMITS.message code points. */
export function prepareMessage(text) {
  const r = redact(String(text ?? ''));
  let s = r.text.normalize('NFC').replace(/\r\n?/g, '\n').replace(/\t/g, ' ').replace(CONTROL_NOT_LF, '').replace(/\p{Cf}/gu, '')
    .split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
  const cps = Array.from(s);
  const truncated = cps.length > LIMITS.message;
  if (truncated) s = cps.slice(0, LIMITS.message).join('');
  return { text: s, redacted: r.count, truncated, chars: Math.min(cps.length, LIMITS.message) };
}

export async function run({ flags, args, cwd, stdout, stderr }) {
  const c = resolveContext(cwd);
  if (!c) { stderr.write('Not inside a git repository.\n'); return 1; }
  const to = (args[0] || '').trim().replace(/^@/, '');
  const body = args.slice(1).join(' ');
  if (!to || !body.trim()) { stderr.write('Usage: synchrobuilder notify <handle> <message...>\n'); return 1; }
  if (!isHandle(to)) { stderr.write(`"${to}" is not a valid handle (lowercase letters, digits and dashes, up to 32).\n`); return 1; }
  const known = knownHandles(c);
  if (!known.has(to)) {
    const list = [...known].sort().join(', ');
    stderr.write(`Unknown handle "${to}". Known handles: ${list || 'none yet (add .synchrobuilder/team.json or wait for the first sync)'}.\n`);
    return 1;
  }
  if (c.identity && c.identity.handle === to) { stderr.write('That handle is you.\n'); return 1; }
  const msg = prepareMessage(body);
  if (!msg.text) { stderr.write('The message is empty after cleaning.\n'); return 1; }
  const event = { type: 'notify', id: ulid(c.now), to, text: msg.text };
  if (!appendJournal(c.checkoutDir, event)) { stderr.write('Could not write to the local journal.\n'); return 1; }
  if (flags.json) { stdout.write(JSON.stringify({ ok: true, id: event.id, to, chars: msg.chars, redacted: msg.redacted, truncated: msg.truncated }, null, 2) + '\n'); return 0; }
  const extras = [];
  if (msg.redacted) extras.push(`${msg.redacted} secret${msg.redacted === 1 ? '' : 's'} redacted`);
  if (msg.truncated) extras.push(`cut to ${LIMITS.message} characters`);
  stdout.write(`Queued message to ${to} (${msg.chars} chars${extras.length ? '; ' + extras.join(', ') : ''}). It lands in their next prompt after both sides sync, labelled as untrusted teammate data; code fences, headings and links render plainly there.\n`);
  return 0;
}
