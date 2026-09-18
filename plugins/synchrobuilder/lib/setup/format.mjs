// Human-readable rendering of a setup plan and its results. Pure string building, no side effects.
import { formatCommand } from './exec.mjs';
import { osKey } from './installers.mjs';

export function stepMarker(step) {
  if (step.alreadySatisfied) return 'ok    ';
  if (step.kind === 'health') return 'check ';
  if (step.command) return step.background ? 'start ' : 'run   ';
  return 'manual';
}

export function formatPlan(steps, { platform = process.platform, manifestName = '' } = {}) {
  const lines = [`Setup plan for ${osKey(platform)}${manifestName ? ` (${manifestName})` : ''}: ${steps.length} step${steps.length === 1 ? '' : 's'}`, ''];
  steps.forEach((step, i) => {
    lines.push(`${String(i + 1).padStart(2)}. [${stepMarker(step)}] ${step.title}`);
    lines.push(`      why: ${step.why}`);
    if (step.alreadySatisfied) lines.push('      already satisfied on this machine');
    else if (step.command) lines.push(`      ${step.needsConsent ? 'asks first, then runs' : 'runs'}: ${formatCommand(step.command)}`);
    else if (step.manual) lines.push(`      you run: ${step.manual}`);
  });
  const consent = steps.filter((s) => s.needsConsent && !s.alreadySatisfied).length;
  const manual = steps.filter((s) => !s.command && s.manual && !s.alreadySatisfied).length;
  lines.push('', `${consent} step${consent === 1 ? '' : 's'} will ask before running; ${manual} step${manual === 1 ? '' : 's'} are for you to run by hand.`);
  return lines.join('\n');
}

const STATUS_LABEL = { satisfied: 'already satisfied', ran: 'done', failed: 'FAILED', skipped: 'skipped', declined: 'declined', manual: 'manual', started: 'started in the background' };

export function formatResult(step, result) {
  return `[${STATUS_LABEL[result.status] || result.status}] ${step.title}${Number.isInteger(result.code) && result.status === 'failed' ? ` (exit code ${result.code})` : ''}`;
}

export function formatHealth(health) {
  const lines = [`Health check: ${health.ok ? 'PASS' : 'FAIL'}`];
  for (const line of health.evidence || []) lines.push(`  evidence: ${line}`);
  return lines.join('\n');
}
