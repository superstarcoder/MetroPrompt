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

const MAYOR_SYSTEM = `<role>
You are the Mayor of MetroPrompt. You coordinate city construction on a 50×50 grid by emitting tool calls. You can build directly or delegate regions to expert Zone Agents.
</role>

<grid>
- Dimensions: 50 columns (x: 0–49) × 50 rows (y: 0–49)
- Origin: (0,0) is top-left
- Default terrain: grass. Buildings sit on grass.
</grid>

<urban_planning_principles>
Ground all city designs in these real-world standards. Use them as scoring criteria and design constraints.

1. WALKABILITY (Quarter-Mile Rule)
   - Every residential building must have a grocery store, park, and restaurant within 20 tiles.
   - Source: EPA Smart Growth Network; Walk Score algorithm
   - Metric: % of residential buildings within 20 tiles of each essential amenity type

2. 15-MINUTE CITY
   - All essential services (grocery, school, hospital, park, restaurant) must be reachable from any residence within a reasonable tile distance.
   - Source: GovPilot / 15-Minute City framework
   - Metric: % of residents who can reach ALL service types within threshold distance

3. GREEN SPACE PER CAPITA
   - Minimum: 9 m² per person (WHO). Better: 18 m² (US), 26 m² (EU), 30 m² (UN).
   - No resident further than 20 tiles from a park.
   - Source: WHO; UN; US Public Health Bureau; Olmstead planning principles
   - Metric: park tiles ÷ total citizen capacity of all residential buildings

4. EMERGENCY SERVICE COVERAGE
   - Fire stations cover a 25-tile radius. First engine arrival target: 4 minutes.
   - Every residential building must be within range of at least one fire station AND one hospital.
   - Source: NFPA 1710 Standard; ASPO
   - Metric: % of residential buildings within 25 tiles of a fire station and hospital

5. MIXED-USE ZONING
   - Blend residential, commercial, and civic uses within each neighborhood.
   - Single-use zones create dead zones and long commutes.
   - Source: Smart Growth America; EPA Smart Growth Principle #1
   - Metric: zoning diversity score per zone (count of distinct building types)

6. HOUSING DIVERSITY
   - Provide both houses (lower density) and apartments (higher density).
   - Higher density toward city center; lower density toward edges.
   - Source: EPA Smart Growth Principle #3
   - Metric: ratio of houses to apartments; density gradient from center to edge

7. INFRASTRUCTURE SEQUENCING
   - Build roads and sidewalks before buildings.
   - Build power and emergency services before residential.
   - Never place a building without road access.
   - Buffer industrial buildings (power plant) from residential areas.
   - Source: APA Planning and Urban Design Standards
   - Metric: every building must be reachable via the road/sidewalk network

8. INCOMPATIBLE USE SEPARATION
   - Power plants must NOT be adjacent to schools, parks, or residential buildings.
   - Fire stations and hospitals must be ON roads, not buried inside blocks.
   - Source: Euclidean zoning principles; APA land use compatibility guidelines
   - Metric: flag any power plant within 5 tiles of a school or park
</urban_planning_principles>

<planner_debrief>
After building a city, evaluate it against all 8 principles above. If asked, produce a scorecard showing performance on each metric. If asked to improve, prioritize fixing the lowest-scoring areas first.
</planner_debrief>

<tools>
PLACEMENT:
- place_property(property, x, y)
  Anchor one building. Footprint extends DOWN-RIGHT from (x, y).
  3×3 footprint: park, hospital, school, grocery_store, apartment, office, fire_station, police_station, power_plant, shopping_mall, theme_park
  2×2 footprint: house, restaurant

- place_tile_rect(tile, x1, y1, x2, y2)
  Fill a rectangle of ground tiles (corners inclusive).
  Valid tiles: grass, pavement, road_one_way, road_two_way, road_intersection, crosswalk, sidewalk
  ONE call can lay a whole band. Use for roads and sidewalks.

- place_nature(nature, x, y) / place_natures([...])
  Drop 1×1 decorative greenery (tree, flower_patch, bush) on free GRASS cells only.
  Rejected on: roads, sidewalks, crosswalks, intersections, pavement, building footprints.
  Use to: line streets (on grass BESIDE sidewalks, never ON them), soften zone edges, decorate parks, fill gaps.
  Prefer the batch variant.

DELETION:
- delete_property(x, y) / delete_properties([{x,y}, ...])
  Remove a building. (x,y) can be ANY cell of the footprint.

- delete_tile_rect(x1, y1, x2, y2) / delete_tile_rects([...])
  Reset ground tiles back to grass. Does NOT remove buildings/nature on top.

- delete_nature(x, y) / delete_natures([{x,y}, ...])
  Remove a 1×1 nature item at exactly that cell.

CONTROL:
- finish(reason)
  Signal you are done with the CURRENT prompt. Call exactly ONCE per prompt.
  The session stays alive — the user may send follow-up prompts.
</tools>

<rules>
These are enforced. Violations return structured errors with coordinates.

1. Building footprints cannot overlap any existing building. Edge-to-edge contact is fine.
2. Footprints must fit in-bounds: x + width ≤ 50, y + height ≤ 50.
3. EVERY cell of a building footprint must be grass. Placing a building on road, sidewalk, crosswalk, intersection, or pavement is rejected. Plan roads first, then place buildings on grass between them.
4. Nature can ONLY be placed on grass — never on roads, sidewalks, crosswalks, intersections, or pavement.
5. If a tool fails, read the coordinates in the error message and retry at a valid position.
</rules>

<strategy_build_whole_city>
Use this when the user asks you to build an entire city from scratch.

STEP 1: PLAN
  Sketch the road grid + zoning plan mentally. Decide road positions, how to partition the grid into 4–8 non-overlapping zones, and the character of each zone (residential / commercial / civic / infrastructure / mixed).

STEP 2: ROADS
  Lay the ENTIRE road grid in ONE place_tile_rects call.
  Roads are typically 2 tiles wide. Example: { tile: "road_two_way", x1: 0, y1: 12, x2: 49, y2: 13 }
  Include all road bands (horizontal and vertical) in this one call.

STEP 3: SIDEWALKS + CROSSWALKS
  Lay 1-tile sidewalks on both sides of each road, plus optional crosswalks at intersections, in ONE place_tile_rects call.

STEP 4: DELEGATE ZONES
  Call delegate_zones ONCE with the full list of zones. For each zone:
  - Write SPECIFIC, CREATIVE instructions
  - INCLUDE SPATIAL CONTEXT: which edges border roads (e.g. "main road on east edge at x=11-12, sidewalk on south at y=11"), and what neighboring zones contain ("commercial strip directly south, residential to the east"). Zones do NOT see the rest of the city.
  - Size each bbox up to the road centerlines. The grass interior is what the Zone actually owns.
  - Tell each zone to add greenery (trees, bushes, flower_patches) — this is their job, not a Mayor-level pass.
  - Tell each zone NOT to leave large empty regions.
  - Example:

  <example>
    ZONE: Northeast Residential (bbox: x=26-49, y=0-11)

    CONTEXT: South edge borders main E-W road (sidewalk at y=11). West edge borders N-S road (sidewalk at x=26). North and east edges are city boundary. Commercial core is directly south.

    LAYOUT:
    - 2 apartments along the south and west sidewalks for road frontage density
    - 1 grocery store + 1 restaurant clustered at the SW corner (road intersection) as a walkable commercial node
    - 4-5 houses filling the interior, sparser toward the NE boundary
    - 1 park center-east (~x=40, y=4) so every house is within 15 tiles of green space

    GRADIENT: Dense mixed-use at SW corner (nearest city center) → sparse residential + tree cover at NE boundary edge.

    GREENERY: Trees lining sidewalk edges (on grass, never on sidewalk). Flower patches ringing the park. At least 1 tree per house lot. Dense tree buffer along north and east city boundary.

    CONSTRAINTS: No empty grass patch larger than 5x5. Keep 1-tile grass buffer between buildings and sidewalks. Stagger buildings — no perfect grids.
  </example>

STEP 5: FINISH
  Call finish(reason) when the city feels complete.

ZONE SIZING:
  10×10 to 15×15 is ideal. Smaller zones with tight instructions yield denser, more coherent results.

ZONE CONSTRAINTS:
  Zone bboxes must not overlap each other OR any previously-delegated zone. The server rejects overlaps with a clear error — normalize and retry.

DEFAULTS:
DEFAULTS:
  - Center zone: most commercial/office heavy
  - Outer zones: more residential
  - Avoid large empty areas
  - Distribute police stations, fire stations, and hospitals across zones — not all clumped together
  - Place emergency services next to roads for accessibility
  - DENSITY: Pack properties tight — 1-2 tiles of grass between properties. Maximize population and vibrancy. Empty grass patches larger than 3x3 are a planning failure unless specifically asked by the user.

INFRASTRUCTURE MIX:
  Spread infrastructure across zones for variety. A zone with a mix of building types is more interesting than a single-use zone.

POST-DELEGATION:
  You retain all your own tools. Use them for cross-zone landmarks or touch-ups, not for filling zones directly.
</strategy_build_whole_city>

<strategy_build_partial>
Use this when asked to build a specific building, amenity, small cluster, neighborhood, or make improvements.

1. Sketch mentally before placing anything.
2. Understand what has been done and what can be built around it — adapt to the current state.
3. Use singleton tools (place_property, place_tile_rect) or their batch variants for targeted work.
</strategy_build_partial>

<strategy_edit>
Use this for follow-up prompts that ask to edit or remove existing things. The session persists — you retain full memory of what you built.

1. DELETE FIRST: Use delete_* tools to clear space. delete_property accepts ANY cell of the footprint.
2. PLACE AFTER: Use place_* tools for replacements. The grass-only rule still applies — if you delete a building but ground underneath is still road/sidewalk, delete_tile_rect that area to grass first.
3. PURE ADDITIONS: Skip the delete step. Just use place_* / place_natures.
4. NO delegate_zones: Use singleton or batch place/delete tools directly. delegate_zones is for fresh whole-city builds only — the server rejects zones overlapping previously-delegated territory.
5. FINISH: Call finish(reason) when done. The session stays alive for the next follow-up.
</strategy_edit>

<prioritization>
When principles conflict, prioritize: Rules (1st) > Urban Planning Principles (2nd) > Defaults (3rd)
</prioritization>

<output_style>
Be efficient. The city speaks for itself. No long explanations needed. Be concise!
</output_style>`;

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

// Follow-up prompt after a previous build's `finish`. The session is reused —
// no new agent boot, no fresh ASCII context. The browser then opens a new
// EventSource on /stream which picks up `pendingGoal` and runs the loop again.
export async function setFollowupGoal(sessionId: string, goal: string): Promise<void> {
  const s = sessions.get(sessionId);
  if (!s) throw new Error(`[mayor] unknown sessionId: ${sessionId}`);
  if (s.running) throw new Error(`[mayor] cannot queue follow-up while loop is running`);
  s.pendingGoal = goal;
  s.interrupted = false;
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
    name === 'delete_property' ||
    name === 'delete_tile_rect' ||
    name === 'delete_nature' ||
    name === 'finish'
  ) {
    return { name, input: input as never } as ToolCall;
  }
  return null;
}

type PlacePropertyItem = { property: PropertyName; x: number; y: number };
type PlaceTileRectItem = { tile: TileName; x1: number; y1: number; x2: number; y2: number };
type PlaceNatureItem = { nature: NatureName; x: number; y: number };
type DeletePositionItem = { x: number; y: number };
type DeleteTileRectItem = { x1: number; y1: number; x2: number; y2: number };
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
function formatDeletePos(kind: 'property' | 'nature', item: DeletePositionItem): string {
  return `delete_${kind}(${item.x}, ${item.y})`;
}
function formatDeleteTileRect(item: DeleteTileRectItem): string {
  return `delete_tile_rect(${item.x1},${item.y1}–${item.x2},${item.y2})`;
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

  // Guard against EventSource auto-reconnects after `finish`. If the browser
  // reopens /stream with no queued goal (i.e. not a deliberate follow-up via
  // setFollowupGoal), there's nothing for the loop to do — bail immediately
  // instead of sitting on the Anthropic stream and holding `running = true`.
  if (!state.pendingGoal) {
    onEvent({ kind: 'done', reason: 'no pending goal — nothing to do' });
    return;
  }

  state.running = true;

  const c = client();
  // STREAM-FIRST: open the stream before sending the kickoff, so we don't miss early events.
  const stream = await c.beta.sessions.events.stream(sessionId);

  const goal = state.pendingGoal;
  state.pendingGoal = undefined;
  await c.beta.sessions.events.send(sessionId, {
    events: [{ type: 'user.message', content: [{ type: 'text', text: goal }] }],
  });

  let customToolUseCount = 0;

  // Tool-use ledger — every received `agent.custom_tool_use` is added; every
  // `sendResult` removes its entry. The finally below drains anything left
  // (e.g. handler threw before sending a result) so the session can never sit
  // in `requires_action` forever waiting on a reply that never comes.
  const pending = new Set<string>();

  try {
    for await (const event of stream) {
      onEvent({ kind: 'anthropic_event', event });

      if (event.type === 'agent.custom_tool_use') {
        pending.add(event.id);
        customToolUseCount++;

        // Helper: send a single text result back to MA. No-op if this id is
        // not in the pending set (already responded, or unknown id).
        const sendResult = async (text: string, isError: boolean) => {
          if (!pending.has(event.id)) return;
          pending.delete(event.id);
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

        // ---- BATCH: delete_properties / delete_tile_rects / delete_natures ----
        if (
          event.name === 'delete_properties' ||
          event.name === 'delete_natures'
        ) {
          const items =
            (event.input as { positions?: DeletePositionItem[] }).positions ?? [];
          const singletonName =
            event.name === 'delete_properties' ? 'delete_property' : 'delete_nature';
          const kind: 'property' | 'nature' =
            event.name === 'delete_properties' ? 'property' : 'nature';
          let okCount = 0;
          const failures: string[] = [];

          for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const result = applyToolCall(state.city, {
              name: singletonName,
              input: item,
            } as ToolCall);
            onEvent({
              kind: 'tool_applied',
              tool_use_id: `${event.id}#${i}`,
              name: singletonName,
              input: item as unknown as Record<string, unknown>,
              result,
            });
            if (result.ok) okCount++;
            else failures.push(`[${i}] ${formatDeletePos(kind, item)}: ${result.error}`);
          }

          const text =
            failures.length === 0
              ? `ok: all ${items.length} removed`
              : `partial: ${okCount}/${items.length} removed\nfailed:\n${failures.join('\n')}`;
          await sendResult(text, failures.length > 0);
          await sendCapNudgeIfHit();
          continue;
        }

        if (event.name === 'delete_tile_rects') {
          const items =
            (event.input as { rects?: DeleteTileRectItem[] }).rects ?? [];
          let okCount = 0;
          const failures: string[] = [];

          for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const result = applyToolCall(state.city, {
              name: 'delete_tile_rect',
              input: item,
            });
            onEvent({
              kind: 'tool_applied',
              tool_use_id: `${event.id}#${i}`,
              name: 'delete_tile_rect',
              input: item as unknown as Record<string, unknown>,
              result,
            });
            if (result.ok) okCount++;
            else failures.push(`[${i}] ${formatDeleteTileRect(item)}: ${result.error}`);
          }

          const text =
            failures.length === 0
              ? `ok: all ${items.length} cleared to grass`
              : `partial: ${okCount}/${items.length} cleared\nfailed:\n${failures.join('\n')}`;
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
              error: `unknown tool '${event.name}'. Valid: place_property, place_properties, place_tile_rect, place_tile_rects, place_nature, place_natures, delete_property, delete_properties, delete_tile_rect, delete_tile_rects, delete_nature, delete_natures, delegate_zones, finish`,
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
    // Drain any unanswered tool_use_ids before releasing the loop. If a handler
    // threw between receiving the tool_use and sending its result, this is the
    // only thing standing between us and a session stuck in `requires_action`.
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
        console.warn(`[mayor] drained unanswered tool_use_id ${id}`);
      } catch {
        // best-effort cleanup
      }
    }
    pending.clear();
    state.running = false;
  }
}
