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
// MODEL
// ============================================================
// Opus 5. Previously Sonnet 4.6 + MAYOR_THINKING='off' (~83s for a 50x50).
//
// ⚠️ THINKING MUST STAY ON ('adaptive') ON THIS MODEL.
// Opus-5-generation models have a documented failure mode with thinking
// disabled: a tool call is written into the VISIBLE TEXT instead of emitted as
// a tool_use block. The turn succeeds, the call silently never runs, no error
// is raised, and the stray text poisons later turns. A build loop that is
// nothing but tool calls is the worst possible place for it — the Mayor would
// appear to work and build nothing. Cost/latency is controlled with
// MAYOR_EFFORT instead; on Opus 5, 'low' is unusually strong.
//
// Also note for any future model swap: `temperature` / `top_p` / `top_k` are
// rejected outright on this generation (400). This loop has never sent them —
// keep it that way.
export const MAYOR_MODEL = 'claude-opus-5';

// Thinking depth, and now the PRIMARY cost/latency lever — since thinking can't
// be switched off on Opus 5 (see MAYOR_MODEL), this is what replaces it.
// 'low' on Opus 5 is documented as unusually strong, so it's the starting point
// rather than a compromise; raise it if build quality regresses.
// Opus 5 accepts the full ladder: low | medium | high | xhigh | max.
// NOTE: effort must live on the AGENT — an `effort` inside a per-session model
// override is silently ignored. And if you change MAYOR_MODEL, always send
// effort alongside it: on a model-id change an omitted effort resets to the new
// model's default.
// NOTE: Zone agents run Haiku 4.5, which rejects `effort` — don't mirror this there.
export const MAYOR_EFFORT: 'low' | 'medium' | 'high' | 'xhigh' | 'max' = 'low';

// Which system prompt the Mayor runs on. Both are defined below; flip this one
// line to A/B them. v1 = original long-form (~2,860 tok), v2 = condensed
// (~1,180 tok, plans "mentally" and suppresses pre-tool-call prose).
// Reported in the [bench] header so every run is self-labeling.
export const MAYOR_PROMPT_VERSION: 'v1' | 'v2' = 'v1';

// Which agent runtime drives the build.
//   'managed' — Claude Managed Agents: Anthropic runs the loop, we answer
//               custom_tool_use over a session stream. (original)
//   'direct'  — we own the loop over plain Messages API streaming.
// Both emit identical MayorStreamEvents, so the frontend is unchanged.
export const MAYOR_RUNTIME: 'managed' | 'direct' = 'direct';

// Thinking mode — only honoured by the 'direct' runtime.
//
// ⚠️ 'off' IS NOT SAFE ON OPUS 5 — it silently turns tool calls into plain text
// (see MAYOR_MODEL). It stays in the union only because flipping MAYOR_MODEL
// back to a Sonnet-4.6-generation model makes it viable again; it is not a knob
// to reach for while this model is set. Tune MAYOR_EFFORT instead.
export const MAYOR_THINKING: 'adaptive' | 'off' = 'adaptive';

// Output ceiling per turn for the direct loop. Generous because thinking tokens
// count against it — the v1/high baseline spent 7.7k on turn one alone.
const MAYOR_MAX_TOKENS = 32000;

const AGENT_NAME = 'MetroPrompt Mayor';
const ENV_NAME_PREFIX = 'metroprompt-env';
const MAX_CUSTOM_TOOL_USES = 70;

// v2 — condensed. Roughly a third the length of v1, same principles and rules,
// with the per-tool prose collapsed (the agent also receives TOOL_SCHEMAS as
// real JSON schemas, so the <tools> block is a summary, not the contract).
const MAYOR_SYSTEM_V2 = `<role>
You are the Mayor of MetroPrompt, building a city on a 50×50 grid via tool calls. You build through Zone sub-agents, and also hold every placement tool yourself.
</role>

<delegation_rule>
Overrides any later text that sounds like delegation is optional.
FIRST build of a session (empty grid, nothing delegated yet): you MUST make
exactly one delegate_zones call — not optional, not skippable because building it
yourself looks faster. Whole-city goal: 4-8 zones. Narrow goal: still delegate,
1-3 zones over just that area. Lay roads + sidewalks yourself first.
FOLLOW-UPS: delegation is optional and usually wrong — place directly, since
delegate_zones rejects overlap with already-delegated territory.
</delegation_rule>

<grid>
50×50, origin (0,0) top-left. Default terrain: grass.
</grid>

<principles>
Score/design against these. Priority when in conflict: Rules > Principles > Defaults.
1. Walkability: grocery, park, restaurant within 20 tiles of every residence.
2. 15-min city: all service types (grocery, school, hospital, park, restaurant) reachable within reasonable distance.
3. Green space: parks scaled to population; no resident >20 tiles from a park.
4. Emergency coverage: every residence within 25 tiles of a fire station AND hospital; both on roads, not buried mid-block.
5. Mixed use: blend residential/commercial/civic per neighborhood; avoid single-use zones.
6. Housing diversity: mix houses (low density) and apartments (high density); density increases toward center.
7. Sequencing: roads/sidewalks before buildings; power/emergency before residential; every building must have road access; buffer power plant from residential.
8. Separation: power plant never within 5 tiles of school/park/residential.
</principles>

<tools>
place_property(property, x, y) / place_properties([...]) — anchor top-left, footprint down-right. 3×3: park, hospital, school, grocery_store, apartment, office, fire_station, police_station, power_plant, shopping_mall, theme_park. 2×2: house, restaurant. Prefer batch for 2+.

place_tile_rect(tile, x1, y1, x2, y2) / place_tile_rects([...]) — fill rectangle, corners inclusive. Tiles: grass, pavement, road_one_way, road_two_way, road_intersection, crosswalk, sidewalk. Prefer batch for roads/sidewalks — lay full grid in one call.

place_nature(nature, x, y) / place_natures([...]) — 1×1 tree/flower_patch/bush, grass only.

delete_property(x, y) / delete_properties([...]) — any footprint cell works.
delete_tile_rect(x1, y1, x2, y2) / delete_tile_rects([...]) — resets to grass, doesn't touch buildings/nature.
delete_nature(x, y) / delete_natures([...])

delegate_zones(zones: [{bbox: {x1, y1, x2, y2}, instructions}]) — hand regions to Zone sub-agents that run in parallel, each placing only inside its own bbox. Whole-city builds only, after roads + sidewalks are down; call once with all zones. Bboxes must fit in-grid (0-49 per axis), must not intersect each other, and must not intersect zones delegated earlier in this session.

finish(reason) — call exactly once per prompt to end your turn. Session persists for follow-ups.
</tools>

<rules>
1. Building footprints: no overlap with existing buildings; must fit in-bounds; every cell must be grass (not road/sidewalk/crosswalk/intersection/pavement).
2. Nature: grass only.
3. On tool error, read the coordinates and retry at a valid position.
</rules>

<strategy_whole_city>
1. PLAN: road grid + 4-8 zones, mentally, briefly. Don't narrate this in chat — go straight to tool calls.
2. ROADS: one place_tile_rects call, all bands (typically 2 tiles wide).
3. SIDEWALKS: one place_tile_rects call, both sides of each road + crosswalks at intersections. Any tile crossing a road must be crosswalk, never sidewalk — crosswalk is the only walkable AND drivable tile, so a sidewalk over a road severs the network and blocks fire trucks.
4. DELEGATE (MANDATORY on a first build — never place zone interiors yourself): one delegate_zones call, 4-8 zones sized 10-15 tiles. Per zone, give ONE short paragraph (2-4 sentences) covering: bbox edges that border roads, what's adjacent, building mix, and "add greenery, no empty patch >3x3." Skip elaborate multi-section templates — a tight paragraph outperforms a long one.
5. Call finish().

Defaults: center = commercial/office-heavy, outer = residential; distribute emergency services across zones, on roads; density gradient center→edge; pack tight (1-2 tile gaps); no empty area >3x3 unless requested.
</strategy_whole_city>

<strategy_partial>
For a specific building/cluster/neighborhood on a FOLLOW-UP: sketch briefly, adapt to existing state, use singleton/batch place tools directly. No delegate_zones. (If the grid is still empty this is a first build — delegation_rule applies instead: delegate 1-3 zones over the requested area.)
</strategy_partial>

<strategy_edit>
For follow-ups editing/removing existing work: delete_* first (any footprint cell works for delete_property), then place_* after (delete_tile_rect first if ground isn't grass). Pure additions skip delete. No delegate_zones — it rejects overlap with prior zones. Call finish() when done.
</strategy_edit>

<output_style>
Be concise. No pre-tool-call plan essays, no emoji-heavy headers. A one-line description before acting is enough; let the tool calls and a brief closing summary do the talking.
</output_style>`;

// v1 — original long-form prompt.
const MAYOR_SYSTEM_V1 = `<role>
You are the Mayor of MetroPrompt. You coordinate city construction on a 50×50 grid by emitting tool calls. You build through expert Zone Agents, and you also hold every placement tool yourself.
</role>

<delegation_rule>
This overrides any later text that sounds like delegation is optional.

FIRST build of a session (the grid starts empty, nothing has been delegated yet):
you MUST make exactly one delegate_zones call. This is not optional, and not
something to skip because you could place the buildings yourself. Zone Agents run
in parallel and are the intended way the city gets built.
  - Whole-city goal: 4-8 zones covering the map.
  - Narrowly scoped goal (one neighborhood or amenity): still delegate, just use
    1-3 zones covering only the requested area. Do not invent a whole city.
Roads and sidewalks are still yours to lay first, before delegating.

FOLLOW-UP prompts (anything after that first build): delegation is OPTIONAL and
usually wrong. Use your own placement tools directly — delegate_zones rejects
zones overlapping territory already delegated in this session.
</delegation_rule>

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
  Lay 1-tile sidewalks on both sides of each road, plus crosswalks at intersections, in ONE place_tile_rects call.
  Any tile that CROSSES a road must be crosswalk, never sidewalk. Crosswalk is the only tile that is both walkable and drivable — a sidewalk laid over a road is not drivable, so it severs the road network and fire trucks cannot get through.

STEP 4: DELEGATE ZONES — MANDATORY, NEVER SKIP
  Per delegation_rule, a first build always delegates. Do not place the zone
  interiors yourself, even if that seems faster or simpler.
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
Use this when asked to build a specific building, amenity, small cluster, neighborhood, or make improvements — on a FOLLOW-UP prompt, once a first build already exists.

1. Sketch mentally before placing anything.
2. Understand what has been done and what can be built around it — adapt to the current state.
3. Use singleton tools (place_property, place_tile_rect) or their batch variants for targeted work.

If the grid is still EMPTY, this is the first build, and delegation_rule applies
instead — delegate 1-3 zones covering the requested area rather than placing it
yourself.
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
// Active prompt — selected by MAYOR_PROMPT_VERSION above.
const MAYOR_SYSTEM = MAYOR_PROMPT_VERSION === 'v1' ? MAYOR_SYSTEM_V1 : MAYOR_SYSTEM_V2;

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

// Single source of truth for the agent config, shared by create and update so a
// pinned MAYOR_AGENT_ID can't drift from what's in this file.
function mayorAgentConfig() {
  return {
    name: AGENT_NAME,
    model: { id: MAYOR_MODEL, effort: MAYOR_EFFORT },
    system: MAYOR_SYSTEM,
    tools: TOOL_SCHEMAS.map(s => ({ type: 'custom' as const, ...s })),
  };
}

// Set once per process: whether we've reconciled a pinned agent this boot.
let agentReconciled = false;

export async function ensureMayor(): Promise<{ agentId: string; envId: string }> {
  if (cachedAgentId && cachedEnvId) {
    // Agent came from .env.local, so its stored config is whatever it was when
    // it was created — possibly an older model/effort/prompt. Push the current
    // config once per boot. Updates are versioned and no-op when nothing
    // changed, so this neither spams versions nor requires dropping the ID
    // when the prompt or tools change.
    if (!agentReconciled) {
      agentReconciled = true;
      try {
        // SDK 0.91 requires `version` on update (optimistic concurrency), so
        // read the current version first. Retrieve → update is also the
        // recommended shape: a mismatch 409s instead of clobbering.
        const current = await client().beta.agents.retrieve(cachedAgentId);
        const updated = await client().beta.agents.update(cachedAgentId, {
          version: current.version,
          ...mayorAgentConfig(),
        });
        // Log the SERVER's echoed model config, not our local constant — this
        // is the only thing that proves the effort setting actually landed.
        console.log(
          `[mayor] reconciled agent ${cachedAgentId} v${current.version} → v${updated.version} ` +
          `· live model config: ${JSON.stringify(updated.model)}`
        );
      } catch (e) {
        // Non-fatal: a stale config still builds cities. Surface and continue.
        console.warn(`[mayor] agent reconcile failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
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
    const agent = await c.beta.agents.create(mayorAgentConfig());
    cachedAgentId = agent.id;
    agentReconciled = true; // freshly created from the same config
    console.log(
      `[mayor] created agent ${cachedAgentId} ` +
      `· live model config: ${JSON.stringify(agent.model)}`
    );
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
  // Conversation history for the 'direct' runtime. Managed Agents keeps this
  // server-side; when we own the loop we own the transcript, and follow-ups
  // just append to it. Unused when MAYOR_RUNTIME === 'managed'.
  messages: Anthropic.MessageParam[];
};
const sessions = new Map<string, SessionState>();

export function getSession(sessionId: string): SessionState | undefined {
  return sessions.get(sessionId);
}

export async function createMayorSession(goal: string): Promise<string> {
  // DIRECT runtime: there is no server-side agent or session to provision —
  // model, system prompt and tools all ride on each Messages request. Skip
  // ensureMayor() entirely (no agents.create / environments.create /
  // sessions.create round-trips) and mint a local id to key our own state on.
  // Zones still need an env id, so resolve one lazily only if they delegate.
  if (MAYOR_RUNTIME === 'direct') {
    const localId = `local_${crypto.randomUUID()}`;
    sessions.set(localId, {
      city: initCity(50),
      pendingGoal: goal,
      running: false,
      interrupted: false,
      completedZoneBboxes: [],
      messages: [],
    });
    return localId;
  }

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
    messages: [],
  });
  return session.id;
}

// ============================================================
// USER-SENT EVENTS (interrupt / redirect from the UI)
// ============================================================

export async function sendInterrupt(sessionId: string): Promise<void> {
  const s = sessions.get(sessionId);
  if (s) s.interrupted = true;
  // Direct runtime: the flag IS the interrupt. runMayorLoopDirect checks it at
  // each turn boundary, so there's no server-side session to notify.
  if (MAYOR_RUNTIME === 'direct') return;
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
  // Direct runtime: append straight onto our own transcript. If the loop is
  // still spinning it picks this up on the next turn; if it already exited,
  // pendingGoal makes the next /stream open resume from here.
  if (MAYOR_RUNTIME === 'direct') {
    if (!s) throw new Error(`[mayor] unknown sessionId: ${sessionId}`);
    if (s.running) s.messages.push({ role: 'user', content: text });
    else s.pendingGoal = text;
    return;
  }
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

// ============================================================
// SHARED TOOL DISPATCH
// ============================================================
// Both runtimes funnel every Mayor tool call through here. Returns the text
// that goes back to the model as a tool result, rather than posting it itself,
// so the managed loop can wrap it in `user.custom_tool_result` and the direct
// loop can wrap it in a `tool_result` content block.

type DispatchOutcome = { text: string; isError: boolean; done?: boolean };

// Zones still run on Managed Agents, so they need an environment. In direct
// mode we never call ensureMayor(), so resolve one lazily on first delegation.
async function ensureEnvIdForZones(): Promise<string> {
  if (cachedEnvId) return cachedEnvId;
  const env = await client().beta.environments.create({
    name: `${ENV_NAME_PREFIX}-${Date.now()}`,
    config: { type: 'cloud', networking: { type: 'unrestricted' } },
  });
  cachedEnvId = env.id;
  console.log(`[mayor] created environment ${cachedEnvId} (lazy, for zones)`);
  return cachedEnvId;
}

// Generic batch runner — every *_properties / *_rects / *_natures tool is
// "apply the singleton N times, emit a synthetic per-item event, summarise".
function runBatch<T>(
  city: City,
  toolUseId: string,
  items: T[],
  singleton: ToolCall['name'],
  fmt: (item: T) => string,
  verb: 'placed' | 'removed' | 'cleared',
  onEvent: (e: MayorStreamEvent) => void,
): DispatchOutcome {
  let okCount = 0;
  const failures: string[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const result = applyToolCall(city, {
      name: singleton,
      input: item,
    } as ToolCall);
    // Per-item synthetic event so the frontend renders progressively and reuses
    // its existing singleton handler rather than needing a batch shape.
    onEvent({
      kind: 'tool_applied',
      tool_use_id: `${toolUseId}#${i}`,
      name: singleton,
      input: item as unknown as Record<string, unknown>,
      result,
    });
    if (result.ok) okCount++;
    else failures.push(`[${i}] ${fmt(item)}: ${result.error}`);
  }

  return {
    text:
      failures.length === 0
        ? `ok: all ${items.length} ${verb}`
        : `partial: ${okCount}/${items.length} ${verb}\nfailed:\n${failures.join('\n')}`,
    isError: failures.length > 0,
  };
}

async function dispatchMayorTool(
  state: SessionState,
  toolUseId: string,
  name: string,
  input: Record<string, unknown>,
  onEvent: (e: MayorStreamEvent) => void,
): Promise<DispatchOutcome> {
  // ---- BATCH tools ----
  if (name === 'place_properties') {
    return runBatch(
      state.city, toolUseId,
      (input as { properties?: PlacePropertyItem[] }).properties ?? [],
      'place_property', formatProperty, 'placed', onEvent,
    );
  }
  if (name === 'place_tile_rects') {
    return runBatch(
      state.city, toolUseId,
      (input as { rects?: PlaceTileRectItem[] }).rects ?? [],
      'place_tile_rect', formatTileRect, 'placed', onEvent,
    );
  }
  if (name === 'place_natures') {
    return runBatch(
      state.city, toolUseId,
      (input as { natures?: PlaceNatureItem[] }).natures ?? [],
      'place_nature', formatNature, 'placed', onEvent,
    );
  }
  if (name === 'delete_tile_rects') {
    return runBatch(
      state.city, toolUseId,
      (input as { rects?: DeleteTileRectItem[] }).rects ?? [],
      'delete_tile_rect', formatDeleteTileRect, 'cleared', onEvent,
    );
  }
  if (name === 'delete_properties' || name === 'delete_natures') {
    const singleton = name === 'delete_properties' ? 'delete_property' : 'delete_nature';
    const kind = name === 'delete_properties' ? 'property' : 'nature';
    return runBatch(
      state.city, toolUseId,
      (input as { positions?: DeletePositionItem[] }).positions ?? [],
      singleton,
      (item: DeletePositionItem) => formatDeletePos(kind, item),
      'removed', onEvent,
    );
  }

  // ---- DELEGATE_ZONES: fan out to parallel Zone agents ----
  if (name === 'delegate_zones') {
    const rawZones = (input as { zones?: DelegateZonesItem[] }).zones ?? [];
    // Normalize every bbox upfront so downstream checks + Zone loops see
    // consistent corners (tolerates the model swapping x1/x2 etc.).
    const zones: DelegateZonesItem[] = rawZones.map(z => ({
      bbox: normalizeBbox(z.bbox),
      instructions: z.instructions,
    }));

    // Validate before spawning anything. All-or-nothing — partial spawning is
    // more confusing than one clear error.
    const validationErrors: string[] = [];
    for (let i = 0; i < zones.length; i++) {
      const b = zones[i].bbox;
      if (!bboxInGrid(b)) {
        validationErrors.push(`[${i}] bbox ${formatBbox(b)} is outside the 50x50 grid`);
        continue;
      }
      for (let j = 0; j < i; j++) {
        if (bboxesIntersect(b, zones[j].bbox)) {
          validationErrors.push(
            `[${i}] bbox ${formatBbox(b)} intersects [${j}] ${formatBbox(zones[j].bbox)}`,
          );
          break;
        }
      }
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
      return {
        text: `delegate_zones rejected — fix the bboxes and retry:\n${validationErrors.join('\n')}`,
        isError: true,
      };
    }

    // Auto-shrink each bbox so it excludes roads/sidewalks the Mayor laid.
    const trimNotes: string[] = [];
    const trimmed: Array<
      { original: Bbox; bbox: Bbox; instructions: string } | { skip: true; reason: string; index: number }
    > = [];
    for (let i = 0; i < zones.length; i++) {
      const z = zones[i];
      const t = trimInfrastructureFromBbox(state.city, z.bbox);
      if (!t) {
        trimNotes.push(
          `[${i}] ${formatBbox(z.bbox)} has no grass interior after stripping infrastructure — skipped`,
        );
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

    const envId = await ensureEnvIdForZones();
    const spawnIndices: number[] = [];
    const spawnPromises: Promise<import('./zone').ZoneBuildResult>[] = [];
    for (let i = 0; i < trimmed.length; i++) {
      const t = trimmed[i];
      if ('skip' in t) continue;
      spawnIndices.push(i);
      spawnPromises.push(
        runZoneBuild(t.bbox, t.instructions, state.city, envId, i, zoneAdapter),
      );
    }
    const zoneResults = await Promise.allSettled(spawnPromises);

    const lines: string[] = [];
    if (trimNotes.length > 0) lines.push(`bbox adjustments:\n${trimNotes.join('\n')}`);
    let totalBuildings = 0;
    for (let k = 0; k < zoneResults.length; k++) {
      const res = zoneResults[k];
      const i = spawnIndices[k];
      if (res.status === 'fulfilled') {
        lines.push(res.value.summary);
        totalBuildings += Object.values(res.value.counts).reduce((a, b) => a + b, 0);
        // Track the ORIGINAL (pre-trim) bbox so future delegations can't
        // overlap territory already claimed, even if the interior was smaller.
        state.completedZoneBboxes.push(zones[i].bbox);
      } else {
        const msg = res.reason instanceof Error ? res.reason.message : String(res.reason);
        lines.push(`zone ${i} FAILED: ${msg}`);
      }
    }
    for (let i = 0; i < trimmed.length; i++) {
      if ('skip' in trimmed[i]) lines.push(`zone ${i} skipped — no buildable interior`);
    }

    return {
      text:
        `${spawnPromises.length}/${zones.length} zones spawned. Total placements: ${totalBuildings}.\n\n` +
        lines.join('\n'),
      isError: false,
    };
  }

  // ---- SINGLETON path (place_property / place_tile_rect / finish / ...) ----
  const call = parseToolCall(name, input);
  const result: ToolResult = call
    ? applyToolCall(state.city, call)
    : {
        ok: false,
        error: `unknown tool '${name}'. Valid: place_property, place_properties, place_tile_rect, place_tile_rects, place_nature, place_natures, delete_property, delete_properties, delete_tile_rect, delete_tile_rects, delete_nature, delete_natures, delegate_zones, finish`,
      };

  onEvent({ kind: 'tool_applied', tool_use_id: toolUseId, name, input, result });

  return {
    text: result.ok ? 'ok' : result.error,
    isError: !result.ok,
    done: result.ok && 'done' in result && result.done === true,
  };
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

  // ── Build telemetry ────────────────────────────────────────────────────
  // Printed to the server console as [bench] lines so a normal UI run yields
  // the same numbers as scripts/bench-mayor.mjs. Paste these when comparing
  // MAYOR_EFFORT settings. NOTE: `agent.thinking` is a BUFFERED event — it
  // fires when the thinking block ENDS, so its timestamp is the end of
  // thinking, not the start (thinking begins at span.model_request_start).
  const tStart = Date.now();
  const secs = (ms: number) => (ms / 1000).toFixed(1);
  const stamp = () => secs(Date.now() - tStart).padStart(6);
  const turnOut: number[] = [];
  let totalCacheRead = 0;
  let firstThinkingEndMs: number | null = null;
  let firstToolCallMs: number | null = null;
  console.log(
    `[bench] ═══ build start · model=${MAYOR_MODEL} effort=${MAYOR_EFFORT} ` +
    `prompt=${MAYOR_PROMPT_VERSION} (${MAYOR_SYSTEM.length} chars) · ${sessionId}`
  );

  try {
    for await (const event of stream) {
      onEvent({ kind: 'anthropic_event', event });

      if (event.type === 'agent.thinking') {
        if (firstThinkingEndMs === null) firstThinkingEndMs = Date.now() - tStart;
        console.log(`[bench] ${stamp()}s  thinking block ended`);
      } else if (event.type === 'span.model_request_end') {
        const u = event.model_usage;
        const out = u?.output_tokens ?? 0;
        const cacheRead = u?.cache_read_input_tokens ?? 0;
        turnOut.push(out);
        totalCacheRead += cacheRead;
        console.log(
          `[bench] ${stamp()}s  turn ${turnOut.length}: ${out} out · ${cacheRead} cache read`
        );
      }

      if (event.type === 'agent.custom_tool_use') {
        if (firstToolCallMs === null) {
          firstToolCallMs = Date.now() - tStart;
          console.log(`[bench] ${stamp()}s  FIRST TOOL CALL (${event.name})`);
        }
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

        // All tool handling lives in dispatchMayorTool so the direct runtime
        // shares exactly this logic. We just wrap the outcome in the
        // Managed-Agents-shaped result event.
        const out = await dispatchMayorTool(
          state,
          event.id,
          event.name,
          event.input as Record<string, unknown>,
          onEvent,
        );
        await sendResult(out.text, out.isError);

        if (out.done) {
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

    const totalOut = turnOut.reduce((s, n) => s + n, 0);
    const na = (ms: number | null) => (ms === null ? 'n/a' : `${secs(ms)}s`);
    console.log(
      `[bench] ═══ SUMMARY model=${MAYOR_MODEL} effort=${MAYOR_EFFORT} prompt=${MAYOR_PROMPT_VERSION}\n` +
      `[bench]     total wall time          ${secs(Date.now() - tStart)}s\n` +
      `[bench]     first-turn thinking      ${na(firstThinkingEndMs)}\n` +
      `[bench]     time to first tool call  ${na(firstToolCallMs)}\n` +
      `[bench]     first-turn output        ${turnOut[0] ?? 0}\n` +
      `[bench]     total output tokens      ${totalOut}\n` +
      `[bench]     per-turn output          [${turnOut.join(', ')}]\n` +
      `[bench]     model requests           ${turnOut.length}\n` +
      `[bench]     tool calls (mayor)       ${customToolUseCount}\n` +
      `[bench]     cache read (all turns)   ${totalCacheRead}`
    );
  }
}

// ============================================================
// DIRECT RUNTIME — we own the agent loop
// ============================================================
// Same contract as runMayorLoop: consume state.pendingGoal, emit
// MayorStreamEvents, return when the build ends. Differences from Managed
// Agents: no agent/environment/session provisioning, the transcript lives in
// state.messages, and thinking + effort are per-request instead of baked into
// an agent version.

// Synthetic Managed-Agents-shaped events so the existing frontend switch
// (session.status_running / _idle / _terminated / agent.message) works
// unchanged across both runtimes.
function asMaEvent(e: unknown): BetaManagedAgentsStreamSessionEvents {
  return e as BetaManagedAgentsStreamSessionEvents;
}

export async function runMayorLoopDirect(
  sessionId: string,
  onEvent: (e: MayorStreamEvent) => void,
): Promise<void> {
  const state = sessions.get(sessionId);
  if (!state) throw new Error(`[mayor] unknown sessionId: ${sessionId}`);
  if (state.running) throw new Error(`[mayor] loop already running for ${sessionId}`);

  // Same guard as the managed loop: a bare EventSource reconnect after finish
  // has nothing queued and should exit rather than start a fresh turn.
  if (!state.pendingGoal) {
    onEvent({ kind: 'done', reason: 'no pending goal — nothing to do' });
    return;
  }

  state.running = true;
  const goal = state.pendingGoal;
  state.pendingGoal = undefined;
  state.messages.push({ role: 'user', content: goal });

  // ── Build telemetry (mirrors the managed loop so numbers are comparable) ──
  const tStart = Date.now();
  const secs = (ms: number) => (ms / 1000).toFixed(1);
  const stamp = () => secs(Date.now() - tStart).padStart(6);
  const turnOut: number[] = [];
  let totalCacheRead = 0;
  let firstThinkingEndMs: number | null = null;
  let firstToolCallMs: number | null = null;
  let toolCallCount = 0;
  console.log(
    `[bench] ═══ build start · runtime=direct model=${MAYOR_MODEL} effort=${MAYOR_EFFORT} ` +
    `thinking=${MAYOR_THINKING} prompt=${MAYOR_PROMPT_VERSION} (${MAYOR_SYSTEM.length} chars) · ${sessionId}`
  );

  // Messages API tool shape is exactly our stored schema shape.
  const tools = TOOL_SCHEMAS.map(s => ({
    name: s.name,
    description: s.description,
    input_schema: s.input_schema,
  }));

  onEvent({ kind: 'anthropic_event', event: asMaEvent({ type: 'session.status_running' }) });

  try {
    for (;;) {
      // Interrupt is just a flag here — checked at the turn boundary, which is
      // the only safe place to stop without orphaning a tool_use block.
      if (state.interrupted) {
        onEvent({ kind: 'done', reason: 'interrupted' });
        return;
      }

      onEvent({
        kind: 'anthropic_event',
        event: asMaEvent({ type: 'span.model_request_start' }),
      });

      const stream = client().messages.stream({
        model: MAYOR_MODEL,
        max_tokens: MAYOR_MAX_TOKENS,
        // Breakpoint on the system block covers tools + system (render order is
        // tools → system → messages), so the static prefix is cached from turn two.
        system: [
          { type: 'text', text: MAYOR_SYSTEM, cache_control: { type: 'ephemeral' } },
        ],
        tools,
        ...(MAYOR_THINKING === 'adaptive'
          ? { thinking: { type: 'adaptive' as const } }
          : { thinking: { type: 'disabled' as const } }),
        output_config: { effort: MAYOR_EFFORT },
        messages: state.messages,
      });

      const msg = await stream.finalMessage();

      const u = msg.usage;
      turnOut.push(u.output_tokens ?? 0);
      totalCacheRead += u.cache_read_input_tokens ?? 0;

      // Mirror the Managed Agents span/thinking events so the SSE consumers
      // (scripts/bench-mayor.mjs, and anything the UI adds later) see the same
      // stream shape under both runtimes.
      const hasThinking = msg.content.some(b => b.type === 'thinking');
      if (hasThinking) {
        if (firstThinkingEndMs === null) firstThinkingEndMs = Date.now() - tStart;
        onEvent({ kind: 'anthropic_event', event: asMaEvent({ type: 'agent.thinking' }) });
      }
      onEvent({
        kind: 'anthropic_event',
        event: asMaEvent({
          type: 'span.model_request_end',
          model_usage: {
            input_tokens: u.input_tokens ?? 0,
            output_tokens: u.output_tokens ?? 0,
            cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
            cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0,
          },
        }),
      });
      console.log(
        `[bench] ${stamp()}s  turn ${turnOut.length}: ${u.output_tokens ?? 0} out · ` +
        `${u.cache_read_input_tokens ?? 0} cache read · stop=${msg.stop_reason}`
      );

      // Forward assistant prose in the same shape Managed Agents emitted.
      const text = msg.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map(b => b.text)
        .join('');
      if (text) {
        onEvent({
          kind: 'anthropic_event',
          event: asMaEvent({ type: 'agent.message', content: [{ type: 'text', text }] }),
        });
      }

      // Echo content back verbatim — thinking blocks must round-trip unmodified.
      state.messages.push({ role: 'assistant', content: msg.content });

      if (msg.stop_reason !== 'tool_use') {
        onEvent({
          kind: 'anthropic_event',
          event: asMaEvent({ type: 'session.status_idle', stop_reason: { type: 'end_turn' } }),
        });
        onEvent({ kind: 'done', reason: `stop_reason: ${msg.stop_reason}` });
        return;
      }

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      let finished = false;

      for (const block of msg.content) {
        if (block.type !== 'tool_use') continue;
        toolCallCount++;
        if (firstToolCallMs === null) {
          firstToolCallMs = Date.now() - tStart;
          console.log(`[bench] ${stamp()}s  FIRST TOOL CALL (${block.name})`);
        }

        const out = await dispatchMayorTool(
          state,
          block.id,
          block.name,
          (block.input ?? {}) as Record<string, unknown>,
          onEvent,
        );

        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: out.text,
          is_error: out.isError,
        });
        if (out.done) finished = true;
      }

      // Every tool_use needs a matching tool_result in ONE user message —
      // splitting them across messages degrades parallel tool calling.
      if (toolResults.length > 0) {
        // Cache the growing prefix: breakpoint on the last result block so the
        // next turn reads the whole conversation instead of reprocessing it.
        // The API caps at 4 cache_control blocks per request and ours would
        // otherwise accumulate one per turn, so retire the previous breakpoint
        // first — only the newest one (plus the system block) should survive.
        for (const m of state.messages) {
          if (!Array.isArray(m.content)) continue;
          for (const b of m.content) {
            if (b && typeof b === 'object' && 'cache_control' in b) {
              delete (b as { cache_control?: unknown }).cache_control;
            }
          }
        }
        toolResults[toolResults.length - 1].cache_control = { type: 'ephemeral' };
        state.messages.push({ role: 'user', content: toolResults });
      }

      if (finished) {
        onEvent({ kind: 'done', reason: 'finish tool called' });
        return;
      }

      if (toolCallCount >= MAX_CUSTOM_TOOL_USES) {
        state.messages.push({
          role: 'user',
          content:
            `You've reached the turn cap (${MAX_CUSTOM_TOOL_USES} tool calls). ` +
            `Call finish with a brief reason to conclude.`,
        });
      }
    }
  } finally {
    state.running = false;
    const totalOut = turnOut.reduce((s, n) => s + n, 0);
    const na = (ms: number | null) => (ms === null ? 'n/a' : `${secs(ms)}s`);
    console.log(
      `[bench] ═══ SUMMARY runtime=direct model=${MAYOR_MODEL} effort=${MAYOR_EFFORT} ` +
      `thinking=${MAYOR_THINKING} prompt=${MAYOR_PROMPT_VERSION}\n` +
      `[bench]     total wall time          ${secs(Date.now() - tStart)}s\n` +
      `[bench]     first-turn thinking      ${na(firstThinkingEndMs)}\n` +
      `[bench]     time to first tool call  ${na(firstToolCallMs)}\n` +
      `[bench]     first-turn output        ${turnOut[0] ?? 0}\n` +
      `[bench]     total output tokens      ${totalOut}\n` +
      `[bench]     per-turn output          [${turnOut.join(', ')}]\n` +
      `[bench]     model requests           ${turnOut.length}\n` +
      `[bench]     tool calls (mayor)       ${toolCallCount}\n` +
      `[bench]     cache read (all turns)   ${totalCacheRead}`
    );
  }
}

// Entry point used by the SSE route — picks the runtime. Both implementations
// have identical signatures and emit identical events, so flipping
// MAYOR_RUNTIME is the only change needed to A/B them.
export function runMayorBuild(
  sessionId: string,
  onEvent: (e: MayorStreamEvent) => void,
): Promise<void> {
  return MAYOR_RUNTIME === 'direct'
    ? runMayorLoopDirect(sessionId, onEvent)
    : runMayorLoop(sessionId, onEvent);
}
