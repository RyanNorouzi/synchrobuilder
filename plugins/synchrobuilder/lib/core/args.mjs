// Tiny argv parser: --flag, --key value, --key=value, positionals. No dependencies.
export function parseArgs(argv, { booleans = [] } = {}) {
  const flags = {};
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { positionals.push(...argv.slice(i + 1)); break; }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) { flags[a.slice(2, eq)] = a.slice(eq + 1); continue; }
      const name = a.slice(2);
      const next = argv[i + 1];
      if (booleans.includes(name) || next === undefined || next.startsWith('--')) flags[name] = true;
      else { flags[name] = next; i++; }
      continue;
    }
    positionals.push(a);
  }
  return { flags, positionals };
}
