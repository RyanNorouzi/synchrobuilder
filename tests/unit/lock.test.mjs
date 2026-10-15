// The worker's mutual exclusion. Two workers publishing one writer's ref let an older tree win the push,
// so these are the assertions that keep exactly one worker per remote.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { acquireLock, heartbeatLock, releaseLock, lockHolder, lockHeldByLive, ownsLock } from '../../plugins/synchrobuilder/lib/state/lock.mjs';
import { runWorker } from '../../plugins/synchrobuilder/lib/worker/loop.mjs';

const tmp = () => fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'sb-lock-'));

/** A real process that stays alive, so pidAlive() is true without assuming pid 1 exists on this platform.
 *  stop() waits for the exit event: a killed child stays a zombie until this parent reaps it, and
 *  process.kill(pid, 0) still succeeds on a zombie. */
function liveProcess() {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
  const exited = new Promise((resolve) => child.once('exit', resolve));
  return {
    pid: child.pid,
    stop: async () => { try { child.kill(); } catch { /* already gone */ } await exited; },
  };
}

test('a live holder keeps the lock; a dead holder is taken over', async () => {
  const dir = tmp();
  const lock = path.join(dir, 'worker.lock');
  const other = liveProcess();
  try {
    assert.equal(acquireLock(lock, other.pid).ok, true, 'first acquire succeeds');
    assert.equal(lockHolder(lock), other.pid);
    assert.equal(lockHeldByLive(lock), true);

    const refused = acquireLock(lock, process.pid);
    assert.equal(refused.ok, false, 'a second pid cannot take a lock held by a live process');
    assert.equal(refused.holder, other.pid);

    await other.stop();
    // Reaped above, so pidAlive() now answers honestly, so pidAlive() reports honestly rather than racing the exit.
    assert.equal(lockHeldByLive(lock), false, 'holder is gone');

    const took = acquireLock(lock, process.pid);
    assert.equal(took.ok, true, 'a dead holder is taken over');
    assert.equal(took.tookOver, other.pid);
    assert.equal(ownsLock(lock), true);
  } finally {
    await other.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('heartbeat and release both refuse when this pid is not the holder', () => {
  const dir = tmp();
  const lock = path.join(dir, 'worker.lock');
  try {
    assert.equal(acquireLock(lock, 999_001).ok, true);
    assert.equal(heartbeatLock(lock, process.pid), false, 'a non-owner cannot refresh the heartbeat');
    assert.equal(releaseLock(lock, process.pid), false, 'a non-owner cannot delete the lock');
    assert.equal(fs.existsSync(lock), true, 'the lock survives the non-owner');
    assert.equal(heartbeatLock(lock, 999_001), true, 'the owner can refresh');
    assert.equal(releaseLock(lock, 999_001), true, 'the owner can release');
    assert.equal(fs.existsSync(lock), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Regression: runWorker tested the result object instead of its .ok field. An object is always truthy, so the
// guard never fired and a second worker started beside the first.
test('runWorker refuses to start while a live worker holds the lock', async () => {
  const dir = tmp();
  const remoteDir = path.join(dir, 'remotes', 'r1');
  fs.mkdirSync(remoteDir, { recursive: true });
  const other = liveProcess();
  try {
    assert.equal(acquireLock(path.join(remoteDir, 'worker.lock'), other.pid).ok, true);
    const r = await runWorker({ remoteDir });
    assert.equal(r.ok, false, 'the second worker must not run');
    assert.equal(r.reason, 'another worker holds the lock');
    assert.equal(r.holder, other.pid);
    assert.equal(lockHolder(path.join(remoteDir, 'worker.lock')), other.pid, 'the first worker still holds it');
  } finally {
    await other.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('runWorker takes the lock when the previous holder died, and releases it on exit', async () => {
  const dir = tmp();
  const remoteDir = path.join(dir, 'remotes', 'r1');
  fs.mkdirSync(remoteDir, { recursive: true });
  const lock = path.join(remoteDir, 'worker.lock');
  try {
    assert.equal(acquireLock(lock, 999_002).ok, true, 'a stale lock from a dead pid');
    // No registered checkout, so the loop finds no live session and leaves after its idle ticks.
    const r = await runWorker({ remoteDir, sleep: async () => {} });
    assert.equal(r.ok, true);
    assert.equal(r.reason, 'no live sessions');
    assert.equal(fs.existsSync(lock), false, 'the lock is released on the way out');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Regression: the loop called heartbeatLock() and discarded the answer, so a worker whose lock had been taken
// over kept ticking and publishing next to the new holder.
test('the loop stops when its lock is taken over mid-run', async () => {
  const dir = tmp();
  const remoteDir = path.join(dir, 'remotes', 'r1');
  fs.mkdirSync(remoteDir, { recursive: true });
  const lock = path.join(remoteDir, 'worker.lock');
  const thief = liveProcess();
  let slept = 0;
  try {
    const r = await runWorker({
      remoteDir,
      sleep: async () => {
        slept += 1;
        // Between the first and second tick, another worker decides this one is dead and takes the lock.
        if (slept === 1) { fs.rmSync(lock, { recursive: true, force: true }); acquireLock(lock, thief.pid); }
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.reason, 'lost the lock to another worker');
    assert.equal(lockHolder(lock), thief.pid, 'the new holder is left alone');
  } finally {
    await thief.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Regression: sleepUntilKick snapshotted kick mtimes only after the tick returned, so a hook that kicked while
// the tick was still running had its wake-up swallowed and its work waited out a whole interval.
test('a kick that lands during a tick is not swallowed', async () => {
  const { sleepUntilKick, registerCheckout } = await import('../../plugins/synchrobuilder/lib/worker/loop.mjs');
  const dir = tmp();
  const remoteDir = path.join(dir, 'remotes', 'r1');
  const checkoutDir = path.join(dir, 'checkouts', 'c1');
  fs.mkdirSync(remoteDir, { recursive: true });
  fs.mkdirSync(checkoutDir, { recursive: true });
  registerCheckout(remoteDir, { checkoutDir, workTree: path.join(dir, 'wt'), remoteUrl: null });
  try {
    const tickStartedAt = Date.now();
    await new Promise((r) => setTimeout(r, 12));
    fs.writeFileSync(path.join(checkoutDir, 'kick'), 'during the tick');

    let slept = 0;
    const began = Date.now();
    await sleepUntilKick({
      remoteDir, waitFor: 60_000, since: tickStartedAt,
      sleep: async (ms) => { slept += ms; await new Promise((r) => setTimeout(r, 1)); },
    });
    assert.equal(slept, 0, 'it must return without sleeping at all');
    assert.ok(Date.now() - began < 1000, 'and return promptly');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('with no pending kick it still sleeps, and wakes when one arrives', async () => {
  const { sleepUntilKick, registerCheckout } = await import('../../plugins/synchrobuilder/lib/worker/loop.mjs');
  const dir = tmp();
  const remoteDir = path.join(dir, 'remotes', 'r1');
  const checkoutDir = path.join(dir, 'checkouts', 'c1');
  fs.mkdirSync(remoteDir, { recursive: true });
  fs.mkdirSync(checkoutDir, { recursive: true });
  fs.writeFileSync(path.join(checkoutDir, 'kick'), 'old');
  registerCheckout(remoteDir, { checkoutDir, workTree: path.join(dir, 'wt'), remoteUrl: null });
  try {
    // mtimeMs carries sub-millisecond precision while Date.now() is whole milliseconds, so a file written in
    // the same millisecond as the baseline reads as newer. Let real time pass before taking the baseline.
    await new Promise((r) => setTimeout(r, 8));
    let steps = 0;
    await sleepUntilKick({
      remoteDir, waitFor: 10_000, since: Date.now(),
      sleep: async () => {
        steps += 1;
        // Real time has to pass between the setup write and the kick, or both land in the same millisecond
        // and the mtime comparison cannot tell them apart.
        await new Promise((r) => setTimeout(r, 6));
        // Nothing pending at first: it sleeps. On the third step a hook kicks and it must wake.
        if (steps === 3) fs.writeFileSync(path.join(checkoutDir, 'kick'), 'fresh');
      },
    });
    assert.equal(steps, 3, `expected to wake on the kick, slept ${steps} steps`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
