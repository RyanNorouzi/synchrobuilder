import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { seatsNotice, activeHandles, PRICING_URL } from '../../plugins/synchrobuilder/lib/features/seats.mjs';

const NOW = Date.parse('2026-09-18T12:00:00Z');
const day = 24 * 3600 * 1000;
const writer = (handle, ageDays) => ({ handle, device: 'aaaaaaaa', firstSeenAt: new Date(NOW - ageDays * day).toISOString(), presence: { lastSeen: new Date(NOW - ageDays * day).toISOString() } });

function stateFile() { return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-seats-')), 'seats.json'); }

test('no notice for three or fewer active handles, or when the only extra handles are older than 30 days', () => {
  const file = stateFile();
  assert.equal(seatsNotice({ writers: [writer('a', 0), writer('b', 1), writer('c', 2)] }, NOW, file), null);
  assert.equal(seatsNotice({ writers: [writer('a', 0), writer('b', 1), writer('c', 2), writer('d', 31)] }, NOW, file), null);
  assert.equal(seatsNotice(null, NOW, file), null);
  assert.ok(!fs.existsSync(file), 'nothing recorded when no notice was shown');
  assert.equal(activeHandles({ writers: [writer('a', 0), writer('a', 5), writer('b', 29)] }, NOW).size, 2, 'distinct handles across devices');
});

test('notice once per interval for more than three active handles, recorded in the state file', () => {
  const file = stateFile();
  const snap = { writers: [writer('a', 0), writer('b', 1), writer('c', 2), writer('d', 20)] };
  const note = seatsNotice(snap, NOW, file);
  assert.ok(note && note.includes('4 people') && note.includes(PRICING_URL) && note.includes('placeholder'));
  assert.ok(!/disabled|limit(ed)? to/i.test(note.replace('nothing is limited or disabled', '')), 'friendly, no threats');
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).lastNoticeAt, new Date(NOW).toISOString());
  assert.equal(seatsNotice(snap, NOW + 6 * day, file), null, 'not repeated inside the interval');
  assert.ok(seatsNotice(snap, NOW + 8 * day, file), 'shown again after 7 days');
  assert.equal(seatsNotice(snap, NOW + 9 * day, file, { noticeEveryDays: 30 }), null, 'config interval honoured');
});
