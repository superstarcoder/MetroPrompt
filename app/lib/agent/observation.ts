import { cityToAscii } from '../all_types';
import type { City } from '../all_types';
import type { ToolCall } from './tools';

export type FailedCall = { call: ToolCall; error: string };

// ============================================================
// OBSERVATION BUILDER
// ============================================================
// The Mayor sees this string every turn. It's the whole-city
// context (ASCII grid) + counts + errors from the prior turn.

export function buildObservation(city: City, failed: FailedCall[] = []): string {
  const { grid, legend } = cityToAscii(city);

  const counts: Record<string, number> = {};
  for (const p of city.all_properties) counts[p.name] = (counts[p.name] ?? 0) + 1;
  const countsBlock = Object.keys(counts).length === 0
    ? '  (no buildings yet)'
    : Object.entries(counts)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `  ${k}: ${v}`)
        .join('\n');

  const errorsBlock = failed.length === 0
    ? '  (none)'
    : failed.map(f => `  ${formatCall(f.call)}\n    → ${f.error}`).join('\n');

  const gridH = city.tile_grid.length;
  const gridW = city.tile_grid[0]?.length ?? 0;

  return [
    `# City state — day ${city.day}, grid ${gridW}x${gridH}`,
    '',
    '## ASCII map',
    grid,
    '',
    '## Legend',
    legend,
    '',
    '## Building counts',
    countsBlock,
    '',
    '## Errors from your last turn',
    errorsBlock,
  ].join('\n');
}

function formatCall(call: ToolCall): string {
  const args = Object.entries(call.input as Record<string, unknown>)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(', ');
  return `${call.name}(${args})`;
}
