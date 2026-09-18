// Smoke test for the formatter. This one uses the correct casing, so it runs on every OS.
import { formatOrder } from '../src/utils/helper.js';

const line = formatOrder({ id: 1, total: 12.5 });
if (line !== '#1 12.50') { process.stderr.write(`unexpected: ${line}\n`); process.exit(1); }
process.stdout.write('ok\n');
