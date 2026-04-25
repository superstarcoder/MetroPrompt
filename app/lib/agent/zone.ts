import Anthropic from '@anthropic-ai/sdk';
import { applyToolCall, ZONE_TOOL_SCHEMAS } from './tools';
import type { ToolCall, ToolResult } from './tools';
import { PROPERTY_DEFAULTS } from '../all_types';
import type { City, NatureName, PropertyName, TileName } from '../all_types';

// ============================================================
// MODEL + AGENT CONFIG
// ============================================================
// Haiku 4.5 for Zones: their job ("place buildings in this bbox per the
// Mayor's brief") is a constrained, low-ambiguity task that doesn't reward
// the heavy extended thinking Sonnet 4.6 does by default. Sonnet was burning
// 20k+ output tokens deliberating on simple zone fills, occasionally hitting
// internal limits mid-tool-call and stranding the session in `requires_action`.
// Haiku is faster, cheaper, doesn't over-think this kind of task, and the
// quality is plenty for "drop 15 buildings in a 10x10 bbox."
// The Mayor stays on Sonnet 4.6 — partition + delegation strategy benefits
// from the deeper reasoning.
export const ZONE_MODEL = 'claude-haiku-4-5';
const ZONE_AGENT_NAME = 'MetroPrompt Zone';
const MAX_ZONE_TOOL_USES = 70;

export type Bbox = { x1: number; y1: number; x2: number; y2: number };

const ZONE_SYSTEM = `<role>
You are a Zone Agent in MetroPrompt, a pixel-art city builder. A Mayor agent has delegated one region to you. You will receive a bounding box and free-text instructions describing what to build inside it.
</role>

<context>
- You own ONLY your bounding box (x1, y1, x2, y2).
- You do NOT see the rest of the city. Trust the Mayor's instructions for surrounding context.
- Be creative within your bbox. Realize the Mayor's brief.
</context>

<rules>
Enforced server-side. Violations are rejected with error coordinates.

1. GRASS-ONLY: Every cell of a building footprint must be grass. Buildings cannot sit on roads, sidewalks, crosswalks, intersections, or pavement. Nature (tree, flower_patch, bush) is also grass-only.

2. BBOX BOUNDS: Every building's full footprint must fit ENTIRELY inside your bbox.
   - 3×3 building at (x, y): x >= bbox.x1 AND y >= bbox.y1 AND x+2 <= bbox.x2 AND y+2 <= bbox.y2
   - 2×2 building at (x, y): x+1 <= bbox.x2 AND y+1 <= bbox.y2
   - place_tile_rect corners must all be inside bbox.
   If you place outside your bbox, you'll get an error. Correct and retry.

3. NO ROAD LAYING: Roads between zones are the Mayor's job. You may only place pavement, crosswalks, or sidewalks inside your bbox.
</rules>

<tools>
- place_property(property, x, y): anchor one building. Footprint extends DOWN-RIGHT from (x, y).
  3×3 footprint: park, hospital, school, grocery_store, apartment, office, fire_station, police_station, power_plant, shopping_mall, theme_park
  2×2 footprint: house, restaurant
- place_properties([...]): MANY buildings in one call. PREFERRED.
- place_tile_rect(tile, x1, y1, x2, y2) / place_tile_rects([...]): fill a rectangle of ground tiles (corners inclusive). Valid tiles: grass, pavement, road_one_way, road_two_way, road_intersection, crosswalk, sidewalk. A single cell is x1=x2, y1=y2. Use for pavement, crosswalks, or sidewalks inside your bbox. Roads between zones are the Mayor's job — don't re-lay them.
- place_nature(nature, x, y) / place_natures([...]): drop 1×1 decorative greenery (tree, flower_patch, bush) on free GRASS cells only. Anything not on grass — roads, sidewalks, crosswalks, intersections, pavement, or building footprints — is rejected. Use to line streets (place on the grass strip BESIDE the sidewalk, never ON it), soften zone edges, decorate parks, and fill gaps. Prefer the batch variant.
- finish(reason): signal your zone is done. Call exactly ONCE.
</tools>

<strategy>
1. Read your bbox, the Mayor's instructions, and the ASCII snapshot.
2. Plan briefly: what buildings, roughly where, how they realize the brief.
3. Emit ONE place_properties call with the whole list. Fall back to individual calls only after partial failure.
4. Emit ONE place_natures call with ~10–25 items for a typical 10×10 to 15×15 zone. Cluster greenery around buildings and along sidewalk edges, not uniform noise.
5. Call finish when your region matches the brief.
</strategy>

<density_guidelines>
- Pack properties densely (unless otherwise specified). However, ensure that every building is next to at least one tile of UNCOVERED grass
- Do NOT leave large empty patches of grass. Fill with properties or nature.
- Place emergency services (fire station, hospital, police station) next to roads for accessibility. Do not clump them together.
- Place a LOT of properties unless the Mayor says otherwise. Dense and vibrant is the goal. However, don't keep them completely edge to edge (leave 1 tile gaps to prevent a wall of buildings).
</density_guidelines>

<output_style>
Do not explain at length. The city speaks for itself.
</output_style>`;

// ============================================================
// SINGLETON CLIENT + AGENT BOOTSTRAP
// ============================================================

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) _client = new Anthropic();
  return _client;
}

let cachedZoneAgentId: string | undefined = process.env.ZONE_AGENT_ID;

export async function ensureZone(): Promise<string> {
  if (cachedZoneAgentId) return cachedZoneAgentId;
  const agent = await client().beta.agents.create({
    name: ZONE_AGENT_NAME,
    model: ZONE_MODEL,
    system: ZONE_SYSTEM,
    tools: ZONE_TOOL_SCHEMAS.map(s => ({ type: 'custom' as const, ...s })),
  });
  cachedZoneAgentId = agent.id;
  console.log(
    `\n[zone] ============================================================\n` +
    `[zone] Created zone agent. Add this to .env.local:\n` +
    `[zone]   ZONE_AGENT_ID=${cachedZoneAgentId}\n` +
    `[zone] ============================================================\n`
  );
  return cachedZoneAgentId;
}

// ============================================================
// BBOX VALIDATION HELPERS
// ============================================================

function bboxContainsProperty(
  bbox: Bbox,
  name: PropertyName,
  x: number,
  y: number,
): { ok: true } | { ok: false; error: string } {
  const def = PROPERTY_DEFAULTS[name];
  if (!def) return { ok: false, error: `unknown property '${name}'` };
  const w = def.width, h = def.height;
  if (x < bbox.x1 || y < bbox.y1 || x + w - 1 > bbox.x2 || y + h - 1 > bbox.y2) {
    return {
      ok: false,
      error:
        `'${name}' ${w}x${h} at (${x},${y}) — footprint (${x},${y})–(${x + w - 1},${y + h - 1}) is outside your zone bbox (${bbox.x1},${bbox.y1})–(${bbox.x2},${bbox.y2})`,
    };
  }
  return { ok: true };
}

function bboxContainsPosition(
  bbox: Bbox,
  x: number,
  y: number,
): { ok: true } | { ok: false; error: string } {
  if (x < bbox.x1 || y < bbox.y1 || x > bbox.x2 || y > bbox.y2) {
    return {
      ok: false,
      error:
        `(${x},${y}) is outside your zone bbox (${bbox.x1},${bbox.y1})–(${bbox.x2},${bbox.y2})`,
    };
  }
  return { ok: true };
}

function bboxContainsTileRect(
  bbox: Bbox,
  x1: number, y1: number,
  x2: number, y2: number,
): { ok: true } | { ok: false; error: string } {
  const lo_x = Math.min(x1, x2), hi_x = Math.max(x1, x2);
  const lo_y = Math.min(y1, y2), hi_y = Math.max(y1, y2);
  if (lo_x < bbox.x1 || lo_y < bbox.y1 || hi_x > bbox.x2 || hi_y > bbox.y2) {
    return {
      ok: false,
      error:
        `tile rect (${lo_x},${lo_y})–(${hi_x},${hi_y}) is outside your zone bbox (${bbox.x1},${bbox.y1})–(${bbox.x2},${bbox.y2})`,
    };
  }
  return { ok: true };
}

// ============================================================
// ZONE EVENT (what we emit upstream to the Mayor's SSE channel)
// ============================================================
// Shape matches MayorStreamEvent.tool_applied so the frontend renders it with
// the existing handler — just tagged with `source: 'zone'` for labeling.

export type ZoneEvent =
  | {
      kind: 'tool_applied';
      tool_use_id: string;
      name: string;
      input: Record<string, unknown>;
      result: ToolResult;
      source: 'zone';
    }
  | { kind: 'zone_message'; text: string; source: 'zone' };

type PlacePropertyItem = { property: PropertyName; x: number; y: number };
type PlaceTileRectItem = { tile: TileName; x1: number; y1: number; x2: number; y2: number };
type PlaceNatureItem = { nature: NatureName; x: number; y: number };

// ============================================================
// ZONE BUILD — spawn session, run bbox-enforced loop, return summary
// ============================================================

export type ZoneBuildResult = {
  ok: boolean;
  summary: string; // human-readable, fed back to the Mayor as tool_result text
  bbox: Bbox;
  counts: Record<string, number>;
};

export async function runZoneBuild(
  bbox: Bbox,
  instructions: string,
  city: City,
  envId: string,
  zoneIndex: number,
  onEvent: (e: ZoneEvent) => void,
): Promise<ZoneBuildResult> {
  const agentId = await ensureZone();
  const c = client();

  const session = await c.beta.sessions.create({
    agent: agentId,
    environment_id: envId,
    title: `zone-${zoneIndex}-${new Date().toISOString()}`,
  });
  const sessionId = session.id;

  // Build kickoff message: bbox + Mayor's instructions. No full-city ASCII — the
  // Mayor's instructions should carry any spatial context the Zone needs.
  const kickoff =
    `Your zone bbox: (x1=${bbox.x1}, y1=${bbox.y1})–(x2=${bbox.x2}, y2=${bbox.y2}).\n\n` +
    `Mayor's instructions:\n${instructions}\n\n` +
    `Place buildings inside your bbox. Prefer place_properties (batch). Call finish when done.`;

  // STREAM-FIRST: open stream before sending kickoff.
  const stream = await c.beta.sessions.events.stream(sessionId);
  await c.beta.sessions.events.send(sessionId, {
    events: [{ type: 'user.message', content: [{ type: 'text', text: kickoff }] }],
  });

  const counts: Record<string, number> = {};
  let toolUseCount = 0;
  let finished = false;

  // Tool-use ledger. Every `agent.custom_tool_use` we receive is added here;
  // every `sendResult` removes its entry. Anything still in the set when the
  // loop exits is an unanswered tool_use that would otherwise strand the
  // session in `requires_action` forever — the finally below drains them with
  // a generic error response. sendResult is also a no-op for IDs not in the
  // set, so we can't accidentally double-respond.
  const pending = new Set<string>();

  const sendResult = async (useId: string, text: string, isError: boolean) => {
    if (!pending.has(useId)) return;
    pending.delete(useId);
    await c.beta.sessions.events.send(sessionId, {
      events: [
        {
          type: 'user.custom_tool_result',
          custom_tool_use_id: useId,
          content: [{ type: 'text', text }],
          is_error: isError,
        },
      ],
    });
  };

  const sendCapNudgeIfHit = async () => {
    if (toolUseCount < MAX_ZONE_TOOL_USES) return;
    await c.beta.sessions.events.send(sessionId, {
      events: [
        { type: 'user.interrupt' },
        {
          type: 'user.message',
          content: [
            {
              type: 'text',
              text: `You've reached the zone turn cap (${MAX_ZONE_TOOL_USES} tool calls). Call finish with a brief reason.`,
            },
          ],
        },
      ],
    });
  };

  const emitToolApplied = (
    useId: string,
    name: string,
    input: Record<string, unknown>,
    result: ToolResult,
  ) => {
    if (result.ok && name === 'place_property') {
      const prop = (input as PlacePropertyItem).property;
      counts[prop] = (counts[prop] ?? 0) + 1;
    } else if (result.ok && name === 'place_nature') {
      const nat = (input as PlaceNatureItem).nature;
      counts[nat] = (counts[nat] ?? 0) + 1;
    }
    onEvent({
      kind: 'tool_applied',
      tool_use_id: useId,
      name,
      input,
      result,
      source: 'zone',
    });
  };

  let errored: Error | null = null;
  try {
    for await (const event of stream) {
      if (event.type === 'agent.message') {
        // Forward the Zone's text reasoning upstream so the thoughts panel can show it.
        const text = event.content?.[0];
        if (text && text.type === 'text' && typeof text.text === 'string') {
          onEvent({ kind: 'zone_message', text: text.text, source: 'zone' });
        }
        continue;
      }

      if (event.type === 'agent.custom_tool_use') {
        pending.add(event.id);
        toolUseCount++;

        // BATCH: place_properties
        if (event.name === 'place_properties') {
          const items = (event.input as { properties?: PlacePropertyItem[] }).properties ?? [];
          let okCount = 0;
          const failures: string[] = [];
          for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const bboxCheck = bboxContainsProperty(bbox, item.property, item.x, item.y);
            let result: ToolResult;
            if (!bboxCheck.ok) {
              result = { ok: false, error: bboxCheck.error };
            } else {
              result = applyToolCall(city, { name: 'place_property', input: item });
            }
            emitToolApplied(`${event.id}#${i}`, 'place_property', item as unknown as Record<string, unknown>, result);
            if (result.ok) okCount++;
            else failures.push(`[${i}] place_property(${item.property}, ${item.x}, ${item.y}): ${result.error}`);
          }
          const text = failures.length === 0
            ? `ok: all ${items.length} placed`
            : `partial: ${okCount}/${items.length} placed\nfailed:\n${failures.join('\n')}`;
          await sendResult(event.id, text, failures.length > 0);
          await sendCapNudgeIfHit();
          continue;
        }

        // BATCH: place_tile_rects
        if (event.name === 'place_tile_rects') {
          const items = (event.input as { rects?: PlaceTileRectItem[] }).rects ?? [];
          let okCount = 0;
          const failures: string[] = [];
          for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const bboxCheck = bboxContainsTileRect(bbox, item.x1, item.y1, item.x2, item.y2);
            let result: ToolResult;
            if (!bboxCheck.ok) {
              result = { ok: false, error: bboxCheck.error };
            } else {
              result = applyToolCall(city, { name: 'place_tile_rect', input: item });
            }
            emitToolApplied(`${event.id}#${i}`, 'place_tile_rect', item as unknown as Record<string, unknown>, result);
            if (result.ok) okCount++;
            else failures.push(`[${i}] place_tile_rect(${item.tile}, ${item.x1},${item.y1}–${item.x2},${item.y2}): ${result.error}`);
          }
          const text = failures.length === 0
            ? `ok: all ${items.length} placed`
            : `partial: ${okCount}/${items.length} placed\nfailed:\n${failures.join('\n')}`;
          await sendResult(event.id, text, failures.length > 0);
          await sendCapNudgeIfHit();
          continue;
        }

        // BATCH: place_natures
        if (event.name === 'place_natures') {
          const items = (event.input as { natures?: PlaceNatureItem[] }).natures ?? [];
          let okCount = 0;
          const failures: string[] = [];
          for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const bboxCheck = bboxContainsPosition(bbox, item.x, item.y);
            let result: ToolResult;
            if (!bboxCheck.ok) {
              result = { ok: false, error: bboxCheck.error };
            } else {
              result = applyToolCall(city, { name: 'place_nature', input: item });
            }
            emitToolApplied(`${event.id}#${i}`, 'place_nature', item as unknown as Record<string, unknown>, result);
            if (result.ok) okCount++;
            else failures.push(`[${i}] place_nature(${item.nature}, ${item.x}, ${item.y}): ${result.error}`);
          }
          const text = failures.length === 0
            ? `ok: all ${items.length} placed`
            : `partial: ${okCount}/${items.length} placed\nfailed:\n${failures.join('\n')}`;
          await sendResult(event.id, text, failures.length > 0);
          await sendCapNudgeIfHit();
          continue;
        }

        // SINGLETON path
        let call: ToolCall | null = null;
        if (event.name === 'place_property') {
          const item = event.input as unknown as PlacePropertyItem;
          const bboxCheck = bboxContainsProperty(bbox, item.property, item.x, item.y);
          if (!bboxCheck.ok) {
            emitToolApplied(event.id, event.name, event.input, { ok: false, error: bboxCheck.error });
            await sendResult(event.id, bboxCheck.error, true);
            await sendCapNudgeIfHit();
            continue;
          }
          call = { name: 'place_property', input: item };
        } else if (event.name === 'place_tile_rect') {
          const item = event.input as unknown as PlaceTileRectItem;
          const bboxCheck = bboxContainsTileRect(bbox, item.x1, item.y1, item.x2, item.y2);
          if (!bboxCheck.ok) {
            emitToolApplied(event.id, event.name, event.input, { ok: false, error: bboxCheck.error });
            await sendResult(event.id, bboxCheck.error, true);
            await sendCapNudgeIfHit();
            continue;
          }
          call = { name: 'place_tile_rect', input: item };
        } else if (event.name === 'place_nature') {
          const item = event.input as unknown as PlaceNatureItem;
          const bboxCheck = bboxContainsPosition(bbox, item.x, item.y);
          if (!bboxCheck.ok) {
            emitToolApplied(event.id, event.name, event.input, { ok: false, error: bboxCheck.error });
            await sendResult(event.id, bboxCheck.error, true);
            await sendCapNudgeIfHit();
            continue;
          }
          call = { name: 'place_nature', input: item };
        } else if (event.name === 'finish') {
          call = { name: 'finish', input: event.input as { reason: string } };
        }

        const result: ToolResult = call
          ? applyToolCall(city, call)
          : {
              ok: false,
              error: `unknown tool '${event.name}'. Zone tools: place_property, place_properties, place_tile_rect, place_tile_rects, place_nature, place_natures, finish`,
            };

        emitToolApplied(event.id, event.name, event.input, result);
        await sendResult(event.id, result.ok ? 'ok' : result.error, !result.ok);

        if (result.ok && 'done' in result && result.done === true) {
          finished = true;
          break;
        }
        await sendCapNudgeIfHit();
        continue;
      }

      if (event.type === 'session.status_terminated') break;

      if (event.type === 'session.status_idle') {
        if (event.stop_reason.type === 'requires_action') continue;
        // end_turn or retries_exhausted → exit
        break;
      }
    }
  } catch (e) {
    errored = e instanceof Error ? e : new Error(String(e));
  } finally {
    // Drain any unanswered tool_use_ids. If a handler threw between receiving
    // the tool_use and sending its result, the session would otherwise sit in
    // `requires_action` forever waiting for a reply that never comes.
    for (const id of Array.from(pending)) {
      try {
        await c.beta.sessions.events.send(sessionId, {
          events: [
            {
              type: 'user.custom_tool_result',
              custom_tool_use_id: id,
              content: [{ type: 'text', text: 'internal error: tool handler did not return a result' }],
              is_error: true,
            },
          ],
        });
        console.warn(`[zone ${zoneIndex}] drained unanswered tool_use_id ${id}`);
      } catch {
        // Best-effort cleanup — if even this send fails, there's nothing more
        // we can do; let the session time out on Anthropic's side.
      }
    }
    pending.clear();
  }

  if (errored) {
    return {
      ok: false,
      summary: `zone ${zoneIndex} errored: ${errored.message}`,
      bbox,
      counts,
    };
  }

  // Compose summary.
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const breakdown = Object.entries(counts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, n]) => `${n} ${name}`)
    .join(', ');
  const summary =
    total === 0
      ? `zone ${zoneIndex} (${bbox.x1},${bbox.y1})–(${bbox.x2},${bbox.y2}): nothing placed${finished ? ' (finished cleanly)' : ' (loop exited)'}`
      : `zone ${zoneIndex} (${bbox.x1},${bbox.y1})–(${bbox.x2},${bbox.y2}): ${total} placements — ${breakdown}`;

  return {
    ok: true,
    summary,
    bbox,
    counts,
  };
}
