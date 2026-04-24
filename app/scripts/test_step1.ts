// Smoke test for Step 1 of the Mayor agent plan.
// Run: cd app && npx tsx scripts/test_step1.ts
//
// Verifies:
//   1. Valid tool calls apply and mutate the city.
//   2. Invalid tool calls (OOB, overlap, unknown name) return structured errors.
//   3. Observation builder stringifies the city + errors cleanly.

import { initCity } from '../lib/all_types';
import { applyBatch, applyToolCall } from '../lib/agent/tools';
import type { ToolCall } from '../lib/agent/tools';
import { buildObservation } from '../lib/agent/observation';

function assert(cond: unknown, msg: string) {
  if (!cond) { console.error('FAIL:', msg); process.exit(1); }
  console.log('OK:  ', msg);
}

// Fresh 20x20 city for compact output
const city = initCity(20);

// 1. Lay a horizontal two-way road band (rows 8-9, full width).
let r = applyToolCall(city, {
  name: 'place_tile_rect',
  input: { tile: 'road_two_way', x1: 0, y1: 8, x2: 19, y2: 9 },
});
assert(r.ok, 'lay horizontal road');

// 2. Sidewalks above and below.
r = applyToolCall(city, {
  name: 'place_tile_rect',
  input: { tile: 'sidewalk', x1: 0, y1: 7, x2: 19, y2: 7 },
});
assert(r.ok, 'lay top sidewalk');
r = applyToolCall(city, {
  name: 'place_tile_rect',
  input: { tile: 'sidewalk', x1: 0, y1: 10, x2: 19, y2: 10 },
});
assert(r.ok, 'lay bottom sidewalk');

// 3. Place a hospital anchor (3x3 at 0,0).
r = applyToolCall(city, {
  name: 'place_property',
  input: { property: 'hospital', x: 0, y: 0 },
});
assert(r.ok, 'place hospital at (0,0)');

// 4. Overlap attempt — should fail with structured error.
r = applyToolCall(city, {
  name: 'place_property',
  input: { property: 'apartment', x: 2, y: 2 },
});
assert(!r.ok && 'error' in r && r.error.includes('overlaps'), 'overlap rejected with clean error');
if (!r.ok) console.log('      msg:', r.error);

// 5. Out-of-bounds property.
r = applyToolCall(city, {
  name: 'place_property',
  input: { property: 'apartment', x: 18, y: 18 },
});
assert(!r.ok && 'error' in r && r.error.includes('out of bounds'), 'OOB property rejected');
if (!r.ok) console.log('      msg:', r.error);

// 6. Out-of-bounds tile rect.
r = applyToolCall(city, {
  name: 'place_tile_rect',
  input: { tile: 'pavement', x1: 10, y1: 10, x2: 25, y2: 15 },
});
assert(!r.ok && 'error' in r && r.error.includes('out of bounds'), 'OOB tile rect rejected');
if (!r.ok) console.log('      msg:', r.error);

// 7. Unknown property name.
r = applyToolCall(city, {
  name: 'place_property',
  input: { property: 'castle' as any, x: 5, y: 5 },
});
assert(!r.ok && 'error' in r && r.error.includes('unknown property'), 'unknown property rejected');
if (!r.ok) console.log('      msg:', r.error);

// 8. Batch apply with mixed success/failure.
const batch: ToolCall[] = [
  { name: 'place_property', input: { property: 'house', x: 4, y: 0 } },      // ok
  { name: 'place_property', input: { property: 'house', x: 4, y: 0 } },      // overlap with prev
  { name: 'place_property', input: { property: 'park', x: 10, y: 0 } },      // ok
];
const batchResults = applyBatch(city, batch);
assert(batchResults[0].result.ok, 'batch[0] ok');
assert(!batchResults[1].result.ok, 'batch[1] overlap');
assert(batchResults[2].result.ok, 'batch[2] ok despite prior failure');

// 9. Finish.
r = applyToolCall(city, { name: 'finish', input: { reason: 'done testing' } });
assert(r.ok && 'done' in r && r.done === true, 'finish returns done=true');

// 10. Observation builder — smoke check.
const failed = batchResults
  .filter(b => !b.result.ok)
  .map(b => ({ call: b.call, error: (b.result as { ok: false; error: string }).error }));
const obs = buildObservation(city, failed);
assert(obs.includes('## ASCII map'), 'observation has ASCII map header');
assert(obs.includes('## Legend'), 'observation has legend');
assert(obs.includes('## Building counts'), 'observation has counts');
assert(obs.includes('hospital: 1'), 'observation counts hospital');
assert(obs.includes('house: 1'), 'observation counts house');
assert(obs.includes('## Errors from your last turn'), 'observation has errors section');
assert(obs.includes('overlaps'), 'observation surfaces overlap error');

console.log('\n----- sample observation -----\n');
console.log(obs);
console.log('\n----- all tests passed -----');
