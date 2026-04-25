import Anthropic from '@anthropic-ai/sdk';
import { applyToolCall, ZONE_TOOL_SCHEMAS } from './tools';
import type { ToolCall, ToolResult } from './tools';
import { PROPERTY_DEFAULTS } from '../all_types';
import type { City, PropertyName, TileName } from '../all_types';

// ============================================================
// MODEL + AGENT CONFIG
// ============================================================

export const ZONE_MODEL = 'claude-sonnet-4-6';
const ZONE_AGENT_NAME = 'MetroPrompt Zone';
const MAX_ZONE_TOOL_USES = 70;

export type Bbox = { x1: number; y1: number; x2: number; y2: number };

const ZONE_SYSTEM = `You are a Zone agent in MetroPrompt, a pixel-art city builder.

YOUR JOB
A Mayor agent is building a 50×50 city and has delegated one region to you. You will receive:
- A bounding box (x1, y1, x2, y2). This is the ONLY region you own.
- Free-text instructions from the Mayor describing what should go inside your region — including any spatial context you need (road borders, neighboring zones, etc).

Focus on your bbox. You do NOT see the rest of the city — trust the Mayor's instructions for any context about the surroundings. Place buildings inside your bbox that realize the Mayor's brief. Be creative within it.

HARD BBOX RULE (enforced server-side — violations are rejected)
Every building's full footprint must fit ENTIRELY inside your bbox:
  - For a 3×3 building anchored at (x, y): x >= bbox.x1 AND y >= bbox.y1 AND x+2 <= bbox.x2 AND y+2 <= bbox.y2
  - For a 2×2 building: x+1 <= bbox.x2, y+1 <= bbox.y2
  - place_tile_rect corners must all be inside bbox
If you attempt to place outside your bbox, you'll get a clear error back — correct and retry within your region.

TOOLS
- place_property(property, x, y): anchor one building.
- place_properties(properties: [...]): MANY buildings in one call — preferred for efficiency.
- place_tile_rect / place_tile_rects: add pavement, crosswalks, or sidewalks inside your bbox. (Roads between zones are the Mayor's job — don't re-lay them.)
- finish(reason): signal your zone is done.

3×3 footprints: park, hospital, school, grocery_store, apartment, office, fire_station, police_station, power_plant, shopping_mall, theme_park.
2×2 footprints: house, restaurant.

STRATEGY
1. Read your bbox, the Mayor's instructions, and the ASCII snapshot.
2. Briefly plan in one message — what buildings, roughly where, how they realize the brief.
3. Emit ONE place_properties call with the whole list. Fall back to individual place_property only if you need to adapt after a partial failure.
4. Call finish when your region is populated to match the brief.
5. Important: Don't leave large empty regions. Fill it up with things!

Do not explain at length. The city speaks for itself.`;

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

  const sendResult = async (useId: string, text: string, isError: boolean) => {
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
        } else if (event.name === 'finish') {
          call = { name: 'finish', input: event.input as { reason: string } };
        }

        const result: ToolResult = call
          ? applyToolCall(city, call)
          : {
              ok: false,
              error: `unknown tool '${event.name}'. Zone tools: place_property, place_properties, place_tile_rect, place_tile_rects, finish`,
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
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      summary: `zone ${zoneIndex} errored: ${msg}`,
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
      ? `zone ${zoneIndex} (${bbox.x1},${bbox.y1})–(${bbox.x2},${bbox.y2}): no buildings placed${finished ? ' (finished cleanly)' : ' (loop exited)'}`
      : `zone ${zoneIndex} (${bbox.x1},${bbox.y1})–(${bbox.x2},${bbox.y2}): ${total} buildings — ${breakdown}`;

  return {
    ok: true,
    summary,
    bbox,
    counts,
  };
}
