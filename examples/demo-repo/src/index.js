// Entry point of the demo order service.
import fs from 'node:fs';
import { formatOrder } from './utils/Helper.js'; // planted: the file on disk is utils/helper.js (import-casing)
import { DATA_DIR } from './config.js';

const ordersFile = DATA_DIR + '/orders.json'; // planted: string concatenation instead of path.join

export function loadOrders() {
  try { return JSON.parse(fs.readFileSync(ordersFile, 'utf8')); } catch { return []; }
}

export function main() {
  const orders = loadOrders();
  for (const order of orders) process.stdout.write(formatOrder(order) + '\n');
  return orders.length;
}

if (process.argv[1] && process.argv[1].endsWith('index.js')) main();
