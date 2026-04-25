import Anthropic from '@anthropic-ai/sdk';
import type { BetaManagedAgentsStreamSessionEvents } from '@anthropic-ai/sdk/resources/beta/sessions/events';
import { applyToolCall, TOOL_SCHEMAS } from './tools';
import type { ToolCall, ToolResult } from './tools';
import { runZoneBuild } from './zone';
import type { Bbox, ZoneEvent } from './zone';
import { initCity, CODE_TO_TILE } from '../all_types';
import type { City, NatureName, PropertyName, TileName } from '../all_types';

// Tile names the Mayor reserves for circulation infrastructure. Zone bboxes are
// auto-shrunk inward so the Zone never owns these — keeps Zone agents from
// overwriting (or trying to build on top of) the Mayor's road network.
const INFRA_TILES: ReadonlySet<TileName> = new Set<TileName>([
  'road_one_way',
  'road_two_way',
  'road_intersection',
  'crosswalk',
  'sidewalk',
  'pavement',
]);

function isInfrastructure(city: City, x: number, y: number): boolean {
  const tile = CODE_TO_TILE[city.tile_grid[y][x]];
  return tile ? INFRA_TILES.has(tile) : false;
}

// Greedy inward trim: while any of the bbox's four edges contains an infra tile,
// peel that edge off. Returns null if the bbox has no infra-free interior.
function trimInfrastructureFromBbox(city: City, bbox: Bbox): Bbox | null {
  let { x1, y1, x2, y2 } = bbox;
  let changed = true;
  while (changed) {
    if (x1 > x2 || y1 > y2) return null;
    changed = false;

    let topHas = false;
    for (let x = x1; x <= x2; x++) if (isInfrastructure(city, x, y1)) { topHas = true; break; }
    if (topHas) { y1++; changed = true; continue; }

    let botHas = false;
    for (let x = x1; x <= x2; x++) if (isInfrastructure(city, x, y2)) { botHas = true; break; }
    if (botHas) { y2--; changed = true; continue; }

    let leftHas = false;
    for (let y = y1; y <= y2; y++) if (isInfrastructure(city, x1, y)) { leftHas = true; break; }
    if (leftHas) { x1++; changed = true; continue; }

    let rightHas = false;
    for (let y = y1; y <= y2; y++) if (isInfrastructure(city, x2, y)) { rightHas = true; break; }
    if (rightHas) { x2--; changed = true; continue; }
  }
  return { x1, y1, x2, y2 };
}

// ============================================================
// MODEL SWAP — one line to flip for demo day.
// ============================================================
// Sonnet 4.6 for iteration (fast, cheap). Flip to 'claude-opus-4-7' for demo.
export const MAYOR_MODEL = 'claude-sonnet-4-6';

const AGENT_NAME = 'MetroPrompt Mayor';
const ENV_NAME_PREFIX = 'metroprompt-env';
const MAX_CUSTOM_TOOL_USES = 70;

const MAYOR_SYSTEM = `You are the Mayor of MetroPrompt, an AI city builder.

Given a goal, build a functional city on a 50×50 grid by emitting tool calls. If being asked to build a city, aim for a balanced mix of residential (house, apartment), commercial (restaurant, grocery_store, shopping_mall, theme_park, office), civic (school, hospital, park), and infrastructure (fire_station, police_station, power_plant) buildings connected by a road network (unless otherwise specified).

GRID
- 50 columns (x: 0-49) × 50 rows (y: 0-49). Origin (0,0) is top-left.
- Default terrain is grass; buildings sit on grass.

TOOLS
- place_property(property, x, y): anchor one building. Footprint extends DOWN-RIGHT from (x, y).
  * 3×3 footprint: park, hospital, school, grocery_store, apartment, office, fire_station, police_station, power_plant, shopping_mall, theme_park
  * 2×2 footprint: house, restaurant
- place_tile_rect(tile, x1, y1, x2, y2): fill a rectangle of ground tiles (corners inclusive). Tile names: grass, pavement, road_one_way, road_two_way, road_intersection, crosswalk, sidewalk. A single cell is x1=x2, y1=y2. Use this for roads and sidewalks — ONE call lays a whole band.
- place_nature(nature, x, y) / place_natures([...]): drop 1×1 decorative greenery (tree, flower_patch, bush) on free GRASS cells only. Anything not on grass — roads, sidewalks, crosswalks, intersections, pavement, or building footprints — is rejected. Use it to line streets (place trees on the grass strip BESIDE the sidewalk, never on the sidewalk itself), soften zone edges, decorate parks, and fill awkward gaps. Prefer the batch variant.
- finish(reason): signal the city is complete. Call exactly ONCE when you're satisfied.

RULES (enforced — violations return structured errors with coordinates)
1. Building footprints cannot overlap any existing building. Edge-to-edge contact is fine.
2. Footprints must fit in-bounds: x+w ≤ 50, y+h ≤ 50.
3. EVERY cell of a building footprint must be grass — placing a building on top of a road, sidewalk, crosswalk, intersection, or pavement is rejected. Plan your roads first, then place buildings on the grass between them.
4. Nature (tree / flower_patch / bush) can ONLY be placed on grass — never on roads, sidewalks, crosswalks, intersections, or pavement.
5. If a tool fails, read the coordinates in the error message and retry at a valid position.

The user may either want you to build out the whole city or may ask you to make improvements or build only a part of it. Based on the goal, decide on the right strategy and adapt as you go. The city evolves with each tool call, so always consider the current state when placing new elements.

STRATEGY (if asked to build the whole city)
You are the coordinator. You lay the infrastructure (roads + sidewalks) and partition the grid, then delegate each region to a Zone sub-agent that fills it in with specialized attention. You do NOT fill in buildings across the whole grid yourself — that's what delegate_zones is for.

1. Sketch the road grid + zoning plan mentally first. Decide: road positions, how to partition the grid into 4–8 non-overlapping zones along those roads, and the character of each zone (residential / commercial / civic / infrastructure / mixed).
2. Lay the ENTIRE road grid in ONE place_tile_rects call. Roads are typically 2 tiles wide — a full-width horizontal road is one item: { tile: "road_two_way", x1: 0, y1: 12, x2: 49, y2: 13 }. Include all road bands (horizontal and vertical) in this one call.
3. Lay 1-tile sidewalks on both sides of each road, plus optional crosswalks at intersections, in ONE more place_tile_rects call.
4. Call delegate_zones ONCE with the full list of zones. For each zone write SPECIFIC, CREATIVE instructions — not just "residential" but "dense walkable residential: apartments along the main road, houses in the interior, one small park at the north edge, a grocery store on the corner." The richer and more imaginative your instructions, the richer the zone's output. Zone sub-agents are specialists; they thrive on concrete direction.
   AUTO-TRIM: the server will automatically peel any roads / sidewalks / crosswalks / pavement off the edges of each bbox before passing it to the Zone — the Zone never sees those tiles inside its bbox. So you can size each bbox generously up to the road centerlines without worrying about the Zone overwriting your network; the trimmed grass interior is what the Zone actually owns.
   IMPORTANT: Zones do NOT see the rest of the city — they only see their bbox + your instructions. So INCLUDE SPATIAL CONTEXT in every zone's instructions: which edges of the bbox border roads (e.g. "main road on east edge at x=11-12, sidewalk on south at y=11"), and what the neighboring zones will contain ("commercial strip directly south, residential to the east"). Without this, zones can't orient their buildings toward roads or create natural gradients with neighbors.
5. Be sure to include infrastructure (for example: the center zone can be mostly civic with a hospital and school, but also has the power plant and fire station tucked in the southeast corner or spread throughout the zones so that there is more variety and less clumping). A zone with a mix of building types is more interesting to look at and explore.
6. Don't make the zones too big — 10×10 or 15×15 is a good size. Smaller zones with tight instructions yield denser, more coherent results.
6. Call finish(reason) when the city feels complete.
7. Tell each zone to scatter some greenery (trees, bushes, flower_patches) across its region — this is part of their job, not a Mayor-level pass.

Notes:
- Ensure that the zone agent understands that it should not leave large empty regions. 
- Zone bboxes must not overlap each other OR any previously-delegated zone in this session. The server rejects overlapping bboxes with a clear error listing the offending pair; just normalize and retry.
- You retain all your own tools (place_property, place_properties, place_tile_rect, place_tile_rects). Use them for cross-zone landmarks or post-delegation touch-ups, not for filling in zones directly.
- Adapt these guidelines as needed based on the user's prompt!

Defaults:
- Have the center zone be the most commercial/office heavy, put more residential zones on the outskirts zones
- Avoid large empty areas without any buildings
- Try to ensure police station, fire station, and hospitals are next to roads for accessibility, and not all clumped together

STRATEGY (if asked to build a specific building or amenity or small cluster or neighborhood or to make improvements)
1. Sketch mentally before placing anything.
2. Understand what has been done and what can be built around it — the city evolves, so adapt to the current state.
3. Feel free to use your singleton tools (place_property, place_tile_rect) or their batch variants for smaller, more targeted improvements

Be efficient. The city speaks for itself — no long explanations needed.`;

// ============================================================
// SINGLETON CLIENT
// ============================================================

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) _client = new Anthropic();
  return _client;
}

// ============================================================
// AGENT + ENVIRONMENT BOOTSTRAP (create once, reuse forever)
// ============================================================

// Populated either from env vars (.env.local) or on first create.
// Module-level so subsequent requests in the same process reuse.
let cachedAgentId: string | undefined = process.env.MAYOR_AGENT_ID;
let cachedEnvId: string | undefined = process.env.MAYOR_ENV_ID;

export async function ensureMayor(): Promise<{ agentId: string; envId: string }> {
  if (cachedAgentId && cachedEnvId) {
    return { agentId: cachedAgentId, envId: cachedEnvId };
  }
  const c = client();

  if (!cachedEnvId) {
    // Name must be unique per workspace — append timestamp to avoid 409 on replay.
    const env = await c.beta.environments.create({
      name: `${ENV_NAME_PREFIX}-${Date.now()}`,
      config: { type: 'cloud', networking: { type: 'unrestricted' } },
    });
    cachedEnvId = env.id;
    console.log(`[mayor] created environment ${cachedEnvId}`);
  }

  if (!cachedAgentId) {
    const agent = await c.beta.agents.create({
      name: AGENT_NAME,
      model: MAYOR_MODEL,
      system: MAYOR_SYSTEM,
      tools: TOOL_SCHEMAS.map(s => ({ type: 'custom' as const, ...s })),
    });
    cachedAgentId = agent.id;
    console.log(`[mayor] created agent ${cachedAgentId}`);
  }

  console.log(
    `\n[mayor] ============================================================\n` +
    `[mayor] Add these to .env.local so the next boot reuses them:\n` +
    `[mayor]   MAYOR_AGENT_ID=${cachedAgentId}\n` +
    `[mayor]   MAYOR_ENV_ID=${cachedEnvId}\n` +
    `[mayor] ============================================================\n`
  );

  return { agentId: cachedAgentId, envId: cachedEnvId };
}

// ============================================================
// PER-SESSION STATE (single-process demo)
// ============================================================
// sessionId → { city, pendingGoal, status }
// pendingGoal is set at createMayorSession and consumed by runMayorLoop
// after the stream is open (stream-first ordering).

type SessionState = {
  city: City;
  pendingGoal?: string;
  running: boolean;
  // Set true when the user sends an interrupt; cleared when they send a redirect
  // message. Used by the end_turn gate in runMayorLoop so the loop stays alive
  // across a pause, waiting for the redirect that resumes it.
  interrupted: boolean;
  // Bboxes of all zones the Mayor has previously delegated in THIS session.
  // Used to reject overlapping delegations on subsequent delegate_zones calls.
  completedZoneBboxes: Bbox[];
};
const sessions = new Map<string, SessionState>();

export function getSession(sessionId: string): SessionState | undefined {
  return sessions.get(sessionId);
}

export async function createMayorSession(goal: string): Promise<string> {
  const { agentId, envId } = await ensureMayor();
  const session = await client().beta.sessions.create({
    agent: agentId,
    environment_id: envId,
    title: `mayor-${new Date().toISOString()}`,
  });
  sessions.set(session.id, {
    city: initCity(50),
    pendingGoal: goal,
    running: false,
    interrupted: false,
    completedZoneBboxes: [],
  });
  return session.id;
}

// ============================================================
// USER-SENT EVENTS (interrupt / redirect from the UI)
// ============================================================

export async function sendInterrupt(sessionId: string): Promise<void> {
  const s = sessions.get(sessionId);
  if (s) s.interrupted = true;
  await client().beta.sessions.events.send(sessionId, {
    events: [{ type: 'user.interrupt' }],
  });
}

export async function sendRedirect(sessionId: string, text: string): Promise<void> {
  const s = sessions.get(sessionId);
  if (s) s.interrupted = false;
  await client().beta.sessions.events.send(sessionId, {
    events: [
      {
        type: 'user.message',
        content: [{ type: 'text', text }],
      },
    ],
  });
}

// ============================================================
// EVENT LOOP (stream forward + custom-tool handling)
// ============================================================

export type MayorStreamEvent =
  // Raw event passed through from Anthropic's stream (we forward these to the browser).
  | { kind: 'anthropic_event'; event: BetaManagedAgentsStreamSessionEvents }
  // Our synthetic event after applying a custom tool — useful for the browser to render
  // the ToolResult without reparsing the raw agent.custom_tool_use.
  // `source` is 'mayor' (default, omitted) for Mayor-originated tool calls, or 'zone'
  // when forwarded from a Zone agent's loop via delegate_zones.
  | {
      kind: 'tool_applied';
      tool_use_id: string;
      name: string;
      input: Record<string, unknown>;
      result: ToolResult;
      source?: 'mayor' | 'zone';
    }
  // Zone agent text (agent.message) forwarded through the Mayor's channel.
  | { kind: 'zone_message'; text: string }
  // Loop terminated.
  | { kind: 'done'; reason: string };

// Singleton tool calls — passed straight through to applyToolCall.
function parseToolCall(
  name: string,
  input: Record<string, unknown>,
): ToolCall | null {
  if (
    name === 'place_property' ||
    name === 'place_tile_rect' ||
    name === 'place_nature' ||
    name === 'finish'
  ) {
    return { name, input: input as never } as ToolCall;
  }
  return null;
}

type PlacePropertyItem = { property: PropertyName; x: number; y: number };
type PlaceTileRectItem = { tile: TileName; x1: number; y1: number; x2: number; y2: number };
type PlaceNatureItem = { nature: NatureName; x: number; y: number };
type DelegateZonesItem = { bbox: Bbox; instructions: string };

function formatProperty(item: PlacePropertyItem): string {
  return `place_property(${item.property}, ${item.x}, ${item.y})`;
}
function formatTileRect(item: PlaceTileRectItem): string {
  return `place_tile_rect(${item.tile}, ${item.x1},${item.y1}–${item.x2},${item.y2})`;
}
function formatNature(item: PlaceNatureItem): string {
  return `place_nature(${item.nature}, ${item.x}, ${item.y})`;
}
function formatBbox(b: Bbox): string {
  return `(${b.x1},${b.y1})–(${b.x2},${b.y2})`;
}

// Normalize bboxes so x1<=x2 and y1<=y2 (tolerate the LLM swapping corners).
function normalizeBbox(raw: { x1: number; y1: number; x2: number; y2: number }): Bbox {
  return {
    x1: Math.min(raw.x1, raw.x2),
    y1: Math.min(raw.y1, raw.y2),
    x2: Math.max(raw.x1, raw.x2),
    y2: Math.max(raw.y1, raw.y2),
  };
}

function bboxInGrid(b: Bbox): boolean {
  return b.x1 >= 0 && b.y1 >= 0 && b.x2 <= 49 && b.y2 <= 49;
}

function bboxesIntersect(a: Bbox, b: Bbox): boolean {
  return a.x1 <= b.x2 && a.x2 >= b.x1 && a.y1 <= b.y2 && a.y2 >= b.y1;
}

export async function runMayorLoop(
  sessionId: string,
  onEvent: (e: MayorStreamEvent) => void,
): Promise<void> {
  const state = sessions.get(sessionId);
  if (!state) throw new Error(`[mayor] unknown sessionId: ${sessionId}`);
  if (state.running) throw new Error(`[mayor] loop already running for ${sessionId}`);
  state.running = true;

  const c = client();
  // STREAM-FIRST: open the stream before sending the kickoff, so we don't miss early events.
  const stream = await c.beta.sessions.events.stream(sessionId);

  if (state.pendingGoal) {
    const goal = state.pendingGoal;
    state.pendingGoal = undefined;
    await c.beta.sessions.events.send(sessionId, {
      events: [{ type: 'user.message', content: [{ type: 'text', text: goal }] }],
    });
  }

  let customToolUseCount = 0;

  try {
    for await (const event of stream) {
      onEvent({ kind: 'anthropic_event', event });

      if (event.type === 'agent.custom_tool_use') {
        customToolUseCount++;

        // Helper: send a single text result back to MA.
        const sendResult = async (text: string, isError: boolean) => {
          await c.beta.sessions.events.send(sessionId, {
            events: [
              {
                type: 'user.custom_tool_result',
                custom_tool_use_id: event.id,
                content: [{ type: 'text', text }],
                is_error: isError,
              },
            ],
          });
        };

        // Helper: enforce the per-session tool-call cap (counts at the tool-call
        // level, not the per-item level — a batch counts as one call).
        const sendCapNudgeIfHit = async () => {
          if (customToolUseCount < MAX_CUSTOM_TOOL_USES) return;
          await c.beta.sessions.events.send(sessionId, {
            events: [
              { type: 'user.interrupt' },
              {
                type: 'user.message',
                content: [
                  {
                    type: 'text',
                    text: `You've reached the turn cap (${MAX_CUSTOM_TOOL_USES} tool calls). Call finish with a brief reason to conclude.`,
                  },
                ],
              },
            ],
          });
        };

        // ---- BATCH: place_properties ----
        if (event.name === 'place_properties') {
          const items =
            (event.input as { properties?: PlacePropertyItem[] }).properties ?? [];
          let okCount = 0;
          const failures: string[] = [];

          for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const result = applyToolCall(state.city, {
              name: 'place_property',
              input: item,
            });
            // Per-item synthetic event so the frontend renders progressively
            // and uses the existing place_property handler, not a new batch shape.
            onEvent({
              kind: 'tool_applied',
              tool_use_id: `${event.id}#${i}`,
              name: 'place_property',
              input: item as unknown as Record<string, unknown>,
              result,
            });
            if (result.ok) okCount++;
            else failures.push(`[${i}] ${formatProperty(item)}: ${result.error}`);
          }

          const text =
            failures.length === 0
              ? `ok: all ${items.length} placed`
              : `partial: ${okCount}/${items.length} placed\nfailed:\n${failures.join('\n')}`;
          await sendResult(text, failures.length > 0);
          await sendCapNudgeIfHit();
          continue;
        }

        // ---- BATCH: place_tile_rects ----
        if (event.name === 'place_tile_rects') {
          const items =
            (event.input as { rects?: PlaceTileRectItem[] }).rects ?? [];
          let okCount = 0;
          const failures: string[] = [];

          for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const result = applyToolCall(state.city, {
              name: 'place_tile_rect',
              input: item,
            });
            onEvent({
              kind: 'tool_applied',
              tool_use_id: `${event.id}#${i}`,
              name: 'place_tile_rect',
              input: item as unknown as Record<string, unknown>,
              result,
            });
            if (result.ok) okCount++;
            else failures.push(`[${i}] ${formatTileRect(item)}: ${result.error}`);
          }

          const text =
            failures.length === 0
              ? `ok: all ${items.length} placed`
              : `partial: ${okCount}/${items.length} placed\nfailed:\n${failures.join('\n')}`;
          await sendResult(text, failures.length > 0);
          await sendCapNudgeIfHit();
          continue;
        }

        // ---- BATCH: place_natures ----
        if (event.name === 'place_natures') {
          const items =
            (event.input as { natures?: PlaceNatureItem[] }).natures ?? [];
          let okCount = 0;
          const failures: string[] = [];

          for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const result = applyToolCall(state.city, {
              name: 'place_nature',
              input: item,
            });
            onEvent({
              kind: 'tool_applied',
              tool_use_id: `${event.id}#${i}`,
              name: 'place_nature',
              input: item as unknown as Record<string, unknown>,
              result,
            });
            if (result.ok) okCount++;
            else failures.push(`[${i}] ${formatNature(item)}: ${result.error}`);
          }

          const text =
            failures.length === 0
              ? `ok: all ${items.length} placed`
              : `partial: ${okCount}/${items.length} placed\nfailed:\n${failures.join('\n')}`;
          await sendResult(text, failures.length > 0);
          await sendCapNudgeIfHit();
          continue;
        }

        // ---- DELEGATE_ZONES: fan out to parallel Zone agents ----
        if (event.name === 'delegate_zones') {
          const rawZones =
            (event.input as { zones?: DelegateZonesItem[] }).zones ?? [];
          // Normalize every bbox upfront so downstream checks + Zone loops see
          // consistent corners (tolerates LLM swapping x1/x2 etc.).
          const zones: DelegateZonesItem[] = rawZones.map(z => ({
            bbox: normalizeBbox(z.bbox),
            instructions: z.instructions,
          }));

          // Validate bboxes before spawning anything. All-or-nothing validation —
          // partial spawning is more confusing than a single clear error.
          const validationErrors: string[] = [];
          for (let i = 0; i < zones.length; i++) {
            const b = zones[i].bbox;
            if (!bboxInGrid(b)) {
              validationErrors.push(
                `[${i}] bbox ${formatBbox(b)} is outside the 50x50 grid`,
              );
              continue;
            }
            // Intra-batch intersection
            for (let j = 0; j < i; j++) {
              if (bboxesIntersect(b, zones[j].bbox)) {
                validationErrors.push(
                  `[${i}] bbox ${formatBbox(b)} intersects [${j}] ${formatBbox(zones[j].bbox)}`,
                );
                break;
              }
            }
            // Prior-delegation intersection
            for (const prior of state.completedZoneBboxes) {
              if (bboxesIntersect(b, prior)) {
                validationErrors.push(
                  `[${i}] bbox ${formatBbox(b)} intersects previously-delegated zone ${formatBbox(prior)}`,
                );
                break;
              }
            }
          }

          if (validationErrors.length > 0) {
            const text =
              `delegate_zones rejected — fix the bboxes and retry:\n${validationErrors.join('\n')}`;
            await sendResult(text, true);
            await sendCapNudgeIfHit();
            continue;
          }

          // Auto-shrink each requested bbox so it excludes any roads/sidewalks
          // the Mayor laid. Zones never see those tiles inside their bbox, so
          // they can't overwrite them or try to build on top.
          const trimNotes: string[] = [];
          const trimmed: Array<{ original: Bbox; bbox: Bbox; instructions: string } | { skip: true; reason: string; index: number }> = [];
          for (let i = 0; i < zones.length; i++) {
            const z = zones[i];
            const t = trimInfrastructureFromBbox(state.city, z.bbox);
            if (!t) {
              trimNotes.push(`[${i}] ${formatBbox(z.bbox)} has no grass interior after stripping infrastructure — skipped`);
              trimmed.push({ skip: true, reason: 'all infrastructure', index: i });
              continue;
            }
            if (t.x1 !== z.bbox.x1 || t.y1 !== z.bbox.y1 || t.x2 !== z.bbox.x2 || t.y2 !== z.bbox.y2) {
              trimNotes.push(`[${i}] ${formatBbox(z.bbox)} → ${formatBbox(t)} (trimmed roads/sidewalks)`);
            }
            trimmed.push({ original: z.bbox, bbox: t, instructions: z.instructions });
          }

          // Adapter: Zone emits ZoneEvent, Mayor forwards as MayorStreamEvent.
          const zoneAdapter = (e: ZoneEvent) => {
            if (e.kind === 'tool_applied') {
              onEvent({
                kind: 'tool_applied',
                tool_use_id: e.tool_use_id,
                name: e.name,
                input: e.input,
                result: e.result,
                source: 'zone',
              });
            } else if (e.kind === 'zone_message') {
              onEvent({ kind: 'zone_message', text: e.text });
            }
          };

          // Spawn only the zones that have a non-empty interior after trimming.
          // Skipped zones report back to the Mayor in the summary so they can
          // adjust the partition next turn.
          const spawnIndices: number[] = [];
          const spawnPromises: Promise<import('./zone').ZoneBuildResult>[] = [];
          for (let i = 0; i < trimmed.length; i++) {
            const t = trimmed[i];
            if ('skip' in t) continue;
            spawnIndices.push(i);
            spawnPromises.push(
              runZoneBuild(
                t.bbox,
                t.instructions,
                state.city,
                cachedEnvId as string,
                i,
                zoneAdapter,
              ),
            );
          }
          const zoneResults = await Promise.allSettled(spawnPromises);

          // Aggregate summary for the Mayor.
          const lines: string[] = [];
          if (trimNotes.length > 0) {
            lines.push(`bbox adjustments:\n${trimNotes.join('\n')}`);
          }
          let totalBuildings = 0;
          for (let k = 0; k < zoneResults.length; k++) {
            const res = zoneResults[k];
            const i = spawnIndices[k];
            if (res.status === 'fulfilled') {
              lines.push(res.value.summary);
              totalBuildings += Object.values(res.value.counts).reduce((a, b) => a + b, 0);
              // Track the Mayor's ORIGINAL bbox (pre-trim) so future delegate_zones
              // calls can't overlap territory the Mayor has already claimed,
              // even if the actual Zone interior was smaller.
              state.completedZoneBboxes.push(zones[i].bbox);
            } else {
              const msg = res.reason instanceof Error ? res.reason.message : String(res.reason);
              lines.push(`zone ${i} FAILED: ${msg}`);
            }
          }
          // Mention skipped zones in the summary too.
          for (let i = 0; i < trimmed.length; i++) {
            const t = trimmed[i];
            if ('skip' in t) {
              lines.push(`zone ${i} skipped — no buildable interior`);
            }
          }
          const spawned = spawnPromises.length;
          const text =
            `${spawned}/${zones.length} zones spawned. Total placements: ${totalBuildings}.\n\n` +
            lines.join('\n');
          await sendResult(text, false);
          await sendCapNudgeIfHit();
          continue;
        }

        // ---- SINGLETON path (place_property / place_tile_rect / finish) ----
        const call = parseToolCall(event.name, event.input);
        const result: ToolResult = call
          ? applyToolCall(state.city, call)
          : {
              ok: false,
              error: `unknown tool '${event.name}'. Valid: place_property, place_properties, place_tile_rect, place_tile_rects, place_nature, place_natures, delegate_zones, finish`,
            };

        onEvent({
          kind: 'tool_applied',
          tool_use_id: event.id,
          name: event.name,
          input: event.input,
          result,
        });

        await sendResult(result.ok ? 'ok' : result.error, !result.ok);

        // finish tool → exit the loop on our side too.
        if (result.ok && 'done' in result && result.done === true) {
          onEvent({ kind: 'done', reason: 'finish tool called' });
          return;
        }

        await sendCapNudgeIfHit();
        continue;
      }

      if (event.type === 'session.status_terminated') {
        onEvent({ kind: 'done', reason: 'session terminated' });
        return;
      }

      if (event.type === 'session.status_idle') {
        // requires_action: transient (waiting on us for a custom tool result).
        if (event.stop_reason.type === 'requires_action') continue;
        // retries_exhausted: hard terminal.
        if (event.stop_reason.type === 'retries_exhausted') {
          onEvent({ kind: 'done', reason: 'retries_exhausted' });
          return;
        }
        // end_turn: Mayor paused. If the pause was user-initiated (interrupt),
        // keep the loop alive — the user may send a redirect that resumes the
        // session. Otherwise (natural end_turn without calling finish), exit.
        if (state.interrupted) continue;
        onEvent({ kind: 'done', reason: 'stop_reason: end_turn' });
        return;
      }
    }
  } finally {
    state.running = false;
  }
}
