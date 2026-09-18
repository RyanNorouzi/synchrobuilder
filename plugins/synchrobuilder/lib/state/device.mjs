// Per-machine device id (ADR-001 section 1, ADR-002 section 4): 8 random hex characters generated once and stored in
// ~/.synchrobuilder/device.json. Never the hostname, so nothing about the machine leaves it.
import crypto from 'node:crypto';
import { paths } from './layout.mjs';
import { readJson, writeJsonAtomic } from '../core/fsx.mjs';
import { isDevice } from '../core/schema.mjs';

export function readDevice() {
  const d = readJson(paths.device(), null);
  return d && isDevice(d.device) ? d.device : null;
}

export function getOrCreateDevice() {
  const existing = readDevice();
  if (existing) return existing;
  const device = crypto.randomBytes(4).toString('hex');
  writeJsonAtomic(paths.device(), { device, createdAt: new Date().toISOString() });
  // Two processes may race on first use; whichever file landed last is the machine's id from now on.
  return readDevice() || device;
}
