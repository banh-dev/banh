import type { InspectedRun, RunRecord } from './client.js';

const duration = (ms: number | null) => ms === null ? '—' : `${Math.round(ms)} ms`;

export function formatRuns(workflow: string, runs: RunRecord[]): string {
  if (!runs.length) return `No runs found for ${workflow}.`;
  const rows = [['RUN', 'STATUS', 'VERSION', 'DURATION', 'CREATED'],
    ...runs.map(run => [run.id, run.status, `v${run.version}`, duration(run.durationMs), run.createdAt])];
  const widths = rows[0]!.map((_, index) => Math.max(...rows.map(row => row[index]!.length)));
  return rows.map(row => row.map((cell, index) => cell.padEnd(widths[index]!)).join('  ').trimEnd()).join('\n');
}

export function formatInspection(run: InspectedRun): string {
  return [
    `${run.workflow} v${run.version} — ${run.status}`,
    `Run: ${run.id}`, `Created: ${run.createdAt}`,
    `Completed: ${run.completedAt ?? '—'}`, `Duration: ${duration(run.durationMs)}`,
    ...(run.error ? [`Error: ${run.error.code} — ${run.error.message}`] : []),
    '', 'Input', JSON.stringify(run.input, null, 2),
    '', 'Decisions', JSON.stringify(run.decisions, null, 2),
    '', 'Output', JSON.stringify(run.output, null, 2),
    '', 'Trace', JSON.stringify(run.trace, null, 2),
  ].join('\n');
}
