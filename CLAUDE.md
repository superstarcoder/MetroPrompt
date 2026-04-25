# MetroPrompt — Agentic City Builder

## Project Overview
A pixel-art agentic city builder for a hackathon. The user prompts a **Mayor agent** (Claude Managed Agents) which lays the road network and partitions the grid, then delegates each region in parallel to **Zone sub-agents** that fill it in with specialized attention. The build streams live to the browser via SSE. Future stages: citizens simulate for 7 days, then the Mayor generates a report.

## Hackathon Context
- **Prompt theme:** "Build For What's Next" — interfaces without a name, workflows from a few years out
- **Timeline:** 4 days of hacking (started ~2026-04-22)

## Tech Stack
- **Framework:** Next.js 16 (App Router) — full-stack, API routes for Claude SDK backend. **Breaking changes vs training data** — see `app/AGENTS.md`; consult `node_modules/next/dist/docs/` before writing Next.js code.
- **Rendering:** Pixi.js v8 (vanilla, dynamically imported inside `useEffect`) — WebGL, nearest-neighbor scaling for crisp pixel art
- **Agents:** **Claude Managed Agents** (Anthropic's hosted agent loop). Our placement helpers are exposed as **custom tools** — the Mayor fires `agent.custom_tool_use` events, our backend applies them to the `City` and responds with `user.custom_tool_result`. See `app/lib/agent/mayor.ts`.
- **Streaming:** Two-layer SSE — Anthropic's session event stream → our Next.js route handler (runs the custom-tool loop) → browser EventSource. See `app/app/api/mayor/[sessionId]/stream/route.ts`.
- **Pixel art:** PixelLab (AI-assisted isometric sprite generation)

## Project Structure
```
MetroPrompt/
  OLD_all_types.tsx      — archived original schema (do not use)
  assets/                — all pixel art sprites
  app/                   — Next.js application
    AGENTS.md            — Next.js 16 warning (breaking changes)
    .env.local           — ANTHROPIC_API_KEY, MAYOR_AGENT_ID, MAYOR_ENV_ID, ZONE_AGENT_ID (do not commit)
    app/
      page.tsx           — server component entry point
      layout.tsx
      globals.css
      api/
        mayor/
          route.ts                             — POST: create Mayor session
          [sessionId]/
            stream/route.ts                    — GET: SSE proxy + custom-tool loop
            interrupt/route.ts                 — POST: halt session (user.interrupt)
            message/route.ts                   — POST: send redirect (user.message)
    components/
      CityRendererWrapper.tsx — 'use client', owns the ssr:false dynamic import
      CityRenderer.tsx        — 'use client', Pixi.js renderer + Mayor control UI + SSE consumer
    lib/
      all_types.tsx      — simulation data schema, source of truth
      renderConfig.ts    — per-sprite render offsets and scale (visual tuning only)
      agent/
        tools.ts         — ToolCall union, TOOL_SCHEMAS (Mayor) + ZONE_TOOL_SCHEMAS (Zone, no delegate_zones), applyToolCall
        observation.ts   — buildObservation (dormant; kept for future prompt-pumped variants)
        mayor.ts         — MAYOR_MODEL const, MAYOR_SYSTEM, ensureMayor, createMayorSession, runMayorLoop, sendInterrupt, sendRedirect; delegate_zones handler (intersection check + parallel Zone fan-out)
        zone.ts          — ZONE_MODEL const, ZONE_SYSTEM, ensureZone, runZoneBuild (bbox-enforced custom-tool loop, returns summary)
    scripts/
      test_step1.ts      — npx tsx smoke test for the tool dispatcher + observation builder
    public/assets/       — sprites served to browser
```

## SSR / Client Component Structure
- `page.tsx` — plain server component, imports `CityRendererWrapper`
- `CityRendererWrapper.tsx` — `'use client'`, owns `dynamic(() => import('./CityRenderer'), { ssr: false })`
- `CityRenderer.tsx` — `'use client'`, all Pixi.js logic lives here
- This three-layer pattern is required: `ssr: false` is not allowed in server components, so the dynamic import must live in a client component wrapper

## Agent Architecture
Two-tier multi-agent on Claude Managed Agents: **Mayor** (coordinator) + **Zone** sub-agents (specialists), both on `claude-sonnet-4-6`.

- **Design insight:** LLMs can't reliably emit clean 50×50 ASCII grids, but they're great at structured tool calls. ASCII is dev-only input/output; agents talk to the world via tool calls validated at the call site — `placeProperty` / `placeTileRect` throw on overlap + OOB with structured coordinates that the Mayor (or Zone) reads and retries.
- **Custom-tool pattern:** all our tools are declared on the agent configs (no container execution). Agent emits `agent.custom_tool_use` → our server runs `applyToolCall` (with bbox enforcement for Zones) → sends `user.custom_tool_result`. See §Mayor Agent below.
- **Mayor's job (whole-city builds):** lay road + sidewalk grid → partition the grid into 4–8 non-overlapping zones → call `delegate_zones` ONCE with bbox + free-text instructions per zone → optionally place a few signature buildings directly → `finish`. The Mayor does NOT fill in zones itself; that's the Zone agents' job.
- **Mayor's job (small edits / partial builds):** place buildings directly with the placement tools, no delegation. Configurable in `MAYOR_SYSTEM`.
- **Zone's job:** receive bbox + Mayor's instructions, place buildings inside the bbox, call `finish` when done. Hard bbox enforcement on every tool call (rejects placements outside the assigned region with structured errors so the Zone self-corrects). Zones run in parallel via `Promise.allSettled` — bboxes don't intersect (validated server-side), so concurrent mutation of the shared `City` is safe.
- **Model swap:** `MAYOR_MODEL` in `mayor.ts` and `ZONE_MODEL` in `zone.ts` are top-of-file constants. Flip both to `claude-opus-4-7` for demo day — two-line change.

## Build Stages
1. **Data schema** ✅ — `app/lib/all_types.tsx`
2. **Pixel art + rendering system** ✅ — Pixi.js isometric renderer with pan/zoom, grid overlay toggle
3. **Mayor agent via Managed Agents** ✅ — see §Mayor Agent
4. **Connect backend to frontend** ✅ — SSE live build, Build button + Pause + Redirect UI in `CityRenderer.tsx`
5. **Batch tools** ✅ — `place_properties` / `place_tile_rects` array variants. One Mayor turn lays the entire road grid; one Mayor turn delegates all zones.
6. **Multi-agent split (Mayor + parallel Zone agents)** ✅ — `delegate_zones` Mayor tool + `app/lib/agent/zone.ts`. Hard bbox enforcement, intersection-checked, runs zones via `Promise.allSettled`.
7. **Remaining polish (deferred)** — `pdf`/`docx` skill for the post-sim report, `web_search` preamble, `code_execution` for sim stats, memory stores for cross-playthrough learning, stream reconnect (MA Pattern 1), per-zone interrupt UI.
8. **7-day citizen simulation + feedback loop** — needs decay, pathfinding, citizens generate feedback → Mayor report

## Rendering System (Stage 2 — complete)

### Isometric coordinate mapping
```ts
gridToScreen(gx, gy) = {
  x: (gx - gy) * (TILE_W / 2),   // TILE_W = 64
  y: (gx + gy) * (TILE_H / 2),   // TILE_H = 32
}
```

### Two-pass render (current approach)
1. **Pass 1 — tiles.** Iterate `city.tile_grid`, decode char via `CODE_TO_TILE`, look up image via `TILE_META[name].image`, draw. Every cell has a ground tile (default grass); buildings sit on top in pass 2 without modifying the tile grid.
2. **Pass 2 — nature + properties.** Merge `city.all_nature` and `city.all_properties` into a combined drawables list, sort by `position.x + position.y` (painter's-algorithm depth), then draw in order. Nature is 1×1 at its position; properties anchor at their top corner and draw with width `prop.width * TILE_W * cfg.scale`.

Because properties anchor at their back corner and the painter's sort uses that anchor, occlusion works for the current test layouts. If future layouts get denser (taller buildings, overlapping footprints), revisit the sort key — may need `max(x+y) - property-depth` or similar.

### Tile rendering
- `anchor.set(0.5, 0)` — top vertex of diamond pinned to grid position
- Scale: `(TILE_W / texture.width) * cfg.scale`
- Offsets per tile type stored in `lib/renderConfig.ts` (`TILE_RENDER`) — keys match `TileName` exactly (`grass`, `road_one_way`, `road_two_way`, `road_intersection`, `crosswalk`, `sidewalk`, `pavement`)
- Texture path resolved via `TILE_META[CODE_TO_TILE[char]].image` — single source of truth in `all_types.tsx`

### Nature rendering
- `Nature` items (`tree`, `flower_patch`, `bush`) are randomly spawned inside `init()` on grass cells that aren't occupied by a property (~4% tree, ~4% flower_patch, ~2% bush).
- Rendered like tiles: `anchor.set(0.5, 0)`, same scale formula, offsets pulled from `TILE_RENDER` (same record as tiles) keyed by `renderKey(nat.image)` — e.g. `tree_v3`, `flower_patch_v1`, `bush_v1`.

### Property rendering
- `anchor.set(0.5, 0)` — top vertex of footprint diamond pinned to grid position
- Width: `prop.width * TILE_W * cfg.scale`; y scale matches x (`sprite.scale.y = sprite.scale.x`)
- Y adjusted by `-(prop.width - 1) * TILE_H` to correct for building height above footprint
- Render key derived from image path via `renderKey(prop.image)` — strips path and size suffix: `/assets/apartment_v1_3_3.png` → `apartment_v1`
- **Placement convention:** `(gx, gy)` = top corner of diamond footprint. A 3×3 property at (0,0) occupies cells (0,0)–(2,2).

### Texture loading
- Tile textures keyed by image path — `tileTex['/assets/grass_1_1.png']`, collected from `Object.values(TILE_META).map(m => m.image)`
- Property textures keyed by image path — `propTex['/assets/apartment_v1_3_3.png']`, collected from `city.all_properties`
- Nature textures keyed by image path — `natureTex['/assets/tree_v3_1_1.png']`, collected from `city.all_nature`
- All unique paths collected upfront and loaded in parallel via `Assets.load`

### Scene lifecycle (`CityRenderer.tsx`)
- `GRID_SIZE = 50` (50×50 demo grid; real `City` schema uses 500×500).
- **Empty on mount** — `cityRef.current = initCity(50)` (all grass, no buildings). The scene fills in live as the Mayor streams tool events.
- **Textures preloaded upfront** — every possible tile + property variant (`ALL_TILE_IMAGES`, `ALL_PROP_IMAGES` at module top), so `tool_applied` events render immediately without load gaps.
- **Re-render scheduling** — each `tool_applied` event mutates `cityRef.current` via `placeProperty` / `placeTileRect`, then calls `scheduleRender()` which coalesces to a single `requestAnimationFrame` (so a batch of 10 tool calls per Mayor turn = one repaint, not ten).
- **Two-layer world container** — `world > spritesLayer + gridLines`. Repaints clear `spritesLayer.removeChildren()` only; `gridLines` survives.
- **Client-side variant roulette** — when the Mayor emits `place_property(apartment, …)` the browser picks a random image from `APARTMENT_IMAGES` for visual variety. The server's parallel copy uses `PROPERTY_DEFAULTS[name].image`. They diverge only on cosmetic variant — not on structure.

### Pixi.js v8 notes
- Must be dynamically imported inside `useEffect`: `const { Application, ... } = await import('pixi.js')`
- `TextureStyle.defaultOptions.scaleMode = 'nearest'` — set before loading any textures for crisp pixel art
- `await app.init({...})` — async init required in v8
- `app.canvas` (not `app.view`) for the canvas element

### renderConfig.ts
Separates visual tuning from game logic. Contains per-sprite `{ offsetX, offsetY, scale }` for all tile, nature, and property render keys. Edit this file to adjust sprite alignment without touching the schema or renderer logic.

Keys use the sprite variant name (same as what `renderKey()` derives from the image path):
- Tile keys: `grass`, `road_one_way`, `road_two_way`, `road_intersection`, `crosswalk`, `sidewalk`, `pavement` — match `TileName` exactly
- Nature keys: `tree_v1`–`tree_v4`, `flower_patch_v1`, `bush_v1`
- Property keys: `park`, `hospital`, `school`, `grocery_store`, `fire_station`, `police_station`, `powerplant`, `restaurant`, `shopping_mall`, `theme_park`, `apartment_v1`, `apartment_v2`, `office_v1`–`office_v3`, `home_v1`, `home_v2` (note: `home_`, not `house_` — matches image filenames; the `powerplant` key also differs from the `power_plant` property name)

## Data Schema (`app/lib/all_types.tsx`)
All types and constants are exported. Import via `@/lib/all_types`.

### Tiles (`TileName`)
`pavement`, `road_one_way`, `road_two_way`, `road_intersection`, `crosswalk`, `sidewalk`, `grass`

Tiles have no per-instance state — they live in `city.tile_grid: TileCode[][]` as single-char codes. `TILE_META[name]` provides the per-name `{ can_walk_through, can_drive_through, image }` used by rendering and (eventually) pathfinding. There is no `Tile` object type anymore.

### Nature (`NatureName`) — separate from tiles
`tree`, `flower_patch`, `bush`. `Nature = { name, position, image }` — no walkability flags (enforced by rendering / pathfinding).

Variant image arrays:
- `TREE_IMAGES` — `tree_v1_1_1.png` – `tree_v4_1_1.png`
- `FLOWER_PATCH_IMAGES` — `flower_patch_v1_1_1.png`
- `BUSH_IMAGES` — `bush_v1_1_1.png`

### Properties (`PropertyName`) and stats
`Property = { name, position, width, height, is_enterable, current_occupants, capacity, boredom_decrease, hunger_decrease, tiredness_decrease, image }`.

| Property | Size | Cap | Enterable | Boredom↓ | Hunger↓ | Tiredness↓ |
|---|---|---|---|---|---|---|
| `park` | 3×3 | 50 | ✅ | 8 | 0 | 3 |
| `hospital` | 3×3 | 20 | ✅ | 0 | 0 | 5 |
| `school` | 3×3 | 80 | ✅ | 3 | 0 | 0 |
| `grocery_store` | 3×3 | 30 | ✅ | 2 | 8 | 0 |
| `house` | 2×2 | 4 | ✅ | 2 | 5 | 10 |
| `apartment` | 3×3 | 10 | ✅ | 2 | 5 | 10 |
| `office` | 3×3 | 30 | ✅ | 3 | 0 | 0 |
| `restaurant` | 2×2 | 30 | ✅ | 5 | 10 | 0 |
| `fire_station` | 3×3 | 10 | ❌ | 0 | 0 | 0 |
| `police_station` | 3×3 | 10 | ❌ | 0 | 0 | 0 |
| `power_plant` | 3×3 | 5 | ❌ | 0 | 0 | 0 |
| `shopping_mall` | 3×3 | 40 | ✅ | 6 | 6 | 0 |
| `theme_park` | 3×3 | 60 | ✅ | 10 | 2 | 0 |

Variant image arrays:
- `HOUSE_IMAGES` — `home_v1_1_1.png`, `home_v2_2_2.png`
- `APARTMENT_IMAGES` — `apartment_v1_3_3.png`, `apartment_v2_3_3.png`
- `OFFICE_IMAGES` — `office_v1_3_3.png`, `office_v2_3_3.png`, `office_v3_3_3.png`

### Important: no Math.random() at module level
`PROPERTY_DEFAULTS` uses index `[0]` for variant buildings. Random variant selection happens inside `useEffect` / on tool-event handlers (e.g. `pickPropertyImage` in `CityRenderer.tsx`), never at module evaluation time — doing so causes React hydration mismatches.

### People (`Person`)
`name`, `age_group` (`adult`/`child`), `job` (see `Job` union, `null` for children), `home: Property`, `current_location: Position`, `current_path: Position[]`, `inside_property: Property | null`, needs `hunger`/`boredom`/`tiredness` (1–10) with per-person decay rates `hunger_rate` (1.5–4.5), `boredom_rate`/`tiredness_rate` (1.0–4.0), plus `image`.

Helpers:
- `JOB_OPTIONS` — all non-null jobs (`teacher`, `doctor`, `firefighter`, `police_officer`, `chef`, `grocer`, `engineer`, `unemployed`)
- `randomBetween(min, max)`
- `spawnPerson(age_group, home, availableImages)` — assigns random job (null for children), randomized needs/rates, picks image from supplied list. Depends on an external `generateRandomName()` (declared, not yet implemented).

### Grid and City — three-list design
`City` is a flat tile grid plus parallel lists for buildings, nature, and citizens. The tile grid stores only ground chars; buildings and nature live in their own lists keyed by anchor position. This keeps storage compact, matches the renderer's natural iteration, and makes a single char grid the source of truth for the LLM-facing ASCII view.

```ts
City = {
  tile_grid: TileCode[][];    // ground layer; every cell defaults to '.' (grass)
  all_properties: Property[]; // buildings (anchor + variant + occupants)
  all_nature: Nature[];       // trees / flowers / bushes
  all_citizens: Person[];
  day: number;                // 1–7
}
```

Helpers (all in `all_types.tsx`):
- `initCity(size = 500)` — all-grass grid, empty lists. `size` is parameterized so the renderer uses 50×50.
- `placeTile(city, x, y, name: TileName)` — sets `tile_grid[y][x] = TILE_CODES[name]`. No validation (fast).
- `placeTileRect(city, x1, y1, x2, y2, name: TileName)` — fills a rectangle (corners inclusive, normalized). **Throws** on OOB with grid dims in the message. This is the Mayor's primary ground-paint brush.
- `placeProperty(city, property)` — **throws** on OOB or footprint overlap with an existing property, with both building names + coordinates in the error. Pushes to `all_properties` on success. Does **not** touch `tile_grid`; buildings sit on grass by convention.
- `placeNature(city, nature)` — pushes to `all_nature`. No validation.
- `getTileAt(city, position): TileName` — decodes via `CODE_TO_TILE`.
- `getPropertyAt(city, position): Property | undefined` — O(n) scan over `all_properties` for a footprint covering `position`.

### TileCode — single-char codes
`TILE_CODES`, `NATURE_CODES`, `PROPERTY_CODES` are the forward maps (name → char). `CODE_TO_TILE`, `CODE_TO_NATURE`, `CODE_TO_PROPERTY` are their inverses. Uppercase = buildings, lowercase = nature, symbols = ground tiles. `H` = hospital (universal map convention); house is `D`.

| Ground | Nature | Buildings |
|---|---|---|
| `.` grass | `t` tree | `D` house · `A` apartment · `O` office · `R` restaurant |
| `,` pavement | `f` flower_patch | `P` park · `S` school · `G` grocery_store · `H` hospital |
| `-` road_one_way | `b` bush | `F` fire_station · `C` police_station · `E` power_plant |
| `=` road_two_way | | `M` shopping_mall · `Z` theme_park |
| `+` road_intersection | | |
| `x` crosswalk | | |
| `_` sidewalk | | |

### LLM-facing view: `cityToAscii(city)` and `asciiToCity(ascii, opts?)`
- **`cityToAscii(city) → { grid, legend }`** — `grid` overlays nature and properties onto a copy of `tile_grid` (properties stamp their char across their whole footprint so the LLM sees size/shape), joined with newlines. `legend` is the static `ASCII_LEGEND` string. At 50×50 the grid is ~2.5k chars (fits easily); at 500×500 it's 250k and needs a viewport or block-level summary.
- **`asciiToCity(ascii, opts?) → City`** — inverse parser, used as a dev/test utility (not wired into the agent pipeline). Strict: throws with `(x, y)` on ragged rows, malformed multi-cell property footprints, overlaps, or unknown chars. `opts.variantStrategy` is `'default'` (deterministic, SSR-safe) or `'random'` (client-only) for picking variant images.

## Mayor + Zone Agents (`app/lib/agent/`)

### Tool set
The Mayor has 6 tools; Zones have 5 (no `delegate_zones` — recursion banned).

| Tool | Mayor | Zone | Notes |
|---|---|---|---|
| `place_property(property, x, y)` | ✅ | ✅ | One building. Throws on overlap + OOB (Zone also checks bbox). |
| `place_properties(properties[])` | ✅ | ✅ | Many buildings, one call. Per-item validation, partial-success result. |
| `place_tile_rect(tile, x1, y1, x2, y2)` | ✅ | ✅ | One ground-tile rectangle. |
| `place_tile_rects(rects[])` | ✅ | ✅ | Many rects, one call. Mayor lays the entire road grid in one of these. |
| `delegate_zones(zones[])` | ✅ | ❌ | Mayor-only. `zones: [{bbox, instructions}, ...]`. Validates bboxes server-side then fans out to parallel Zone sessions via `Promise.allSettled`. |
| `finish(reason)` | ✅ | ✅ | Ends the agent's loop. Mayor's `finish` ends the build; Zone's `finish` ends just that Zone session. |

### `tools.ts`
- `ToolCall` discriminated union for the singletons (`place_property` | `place_tile_rect` | `finish`). Batch tools and `delegate_zones` are handled inline in `mayor.ts` / `zone.ts` rather than expanding the union.
- `applyToolCall(city, call) → ToolResult` — wraps the throwing placement helpers into `{ ok: true }` / `{ ok: false, error }`. Used by both Mayor and Zone loops.
- `TOOL_SCHEMAS` — full JSON-schema list passed to the Mayor's `agents.create({ tools })`. Includes `delegate_zones`.
- `ZONE_TOOL_SCHEMAS` — `TOOL_SCHEMAS` minus `delegate_zones`. Passed to the Zone's `agents.create({ tools })`. Same identity as `TOOL_SCHEMAS` after filtering — easy to keep in sync.

### `mayor.ts`
- `MAYOR_MODEL` constant (top of file) — flip to `claude-opus-4-7` for demo day.
- `MAYOR_SYSTEM` prompt — distinct strategy branches for "build whole city" (lay infra → partition → `delegate_zones` → optional landmarks → `finish`) vs "edit / partial" (place directly, no delegation). Includes guidance on encoding spatial context (road borders, neighbor character) into each zone's `instructions` string since Zones don't see the rest of the city.
- `ensureMayor()` — create-or-reuse pattern for the Mayor agent + the shared environment. Reads `MAYOR_AGENT_ID` / `MAYOR_ENV_ID` from env; if missing, creates them and logs the IDs to paste into `.env.local`.
- `createMayorSession(goal)` — `sessions.create()`, stashes `{ city: initCity(50), pendingGoal, interrupted: false, completedZoneBboxes: [] }` in a module-level `sessions` Map.
- `runMayorLoop(sessionId, onEvent)` — stream-first: opens `events.stream()`, sends the kickoff `user.message` after. For each `agent.custom_tool_use`:
  - Singletons → `applyToolCall`, send tool_result.
  - `place_properties` / `place_tile_rects` → unroll into per-item synthetic `tool_applied` events for the frontend, send a single composite `tool_result` text back to MA.
  - `delegate_zones` → normalize bboxes, validate (in-grid + intra-batch no-intersect + no-intersect with `state.completedZoneBboxes`), fan out to `runZoneBuild()` via `Promise.allSettled`, aggregate summaries, append successful bboxes to `completedZoneBboxes`. Validation failures return a structured error so the Mayor retries without spawning anything.
  - `finish` → terminate loop.
  - Turn cap = `MAX_CUSTOM_TOOL_USES = 70`. Counts at the tool-call level, so a `place_properties` with 30 items or a `delegate_zones` with 6 zones each = 1 against the cap.
- `sendInterrupt(sessionId)` / `sendRedirect(sessionId, text)` — same UI pause/redirect mechanics as before. Note: only the Mayor's session is interruptible; Zones run to their own `finish`.
- `MayorStreamEvent` is a discriminated union: `anthropic_event` | `tool_applied` (with optional `source: 'mayor' | 'zone'` tag) | `zone_message` | `done`.

### `zone.ts`
- `ZONE_MODEL` constant (same Sonnet 4.6 by default).
- `ZONE_SYSTEM` prompt — terse: "you own this bbox, here are your instructions, place buildings, call finish." Explicitly tells the Zone it does NOT see the rest of the city — trust the Mayor's instructions for adjacency context. Hard bbox rule documented inline so the model knows what'll be rejected.
- `ensureZone()` — create-or-reuse the Zone agent. Reads `ZONE_AGENT_ID` from env; if missing, logs the new ID for `.env.local`. Reuses `MAYOR_ENV_ID` (env passed in by the Mayor's handler — no separate environment).
- `runZoneBuild(bbox, instructions, city, envId, zoneIndex, onEvent) → ZoneBuildResult`:
  - `sessions.create()` with the Zone agent.
  - Kickoff message: just bbox + Mayor's instructions + "place buildings, prefer batch, call finish when done." No full-city ASCII (intentionally — see "Why no ASCII for Zones" below).
  - Custom-tool loop with bbox validation on every singleton + batch tool call (per-item for batches). Out-of-bbox calls return `(x,y) is outside your zone bbox (x1,y1)-(x2,y2)` so the Zone self-corrects.
  - Tracks placement counts by type for the summary ("ok: 14 buildings — 8 house, 2 apartment, 1 park, 3 restaurant").
  - Forwards `tool_applied` and `zone_message` events upstream via `onEvent` so the browser renders Zone placements live through the same SSE pipe.
- `Bbox = { x1, y1, x2, y2 }` exported type. Bboxes are normalized (min/max corners) by the Mayor before being passed to `runZoneBuild`, so Zone code can assume `x1 ≤ x2, y1 ≤ y2`.

### Why no ASCII for Zones
Initial design passed `cityToAscii(city)` in the Zone kickoff so the agent could see roads + neighbors. Removed because: (a) it added ~2.5K chars per zone session, mostly never referenced; (b) the Zone's whole point is *focused attention on its bbox*, and dumping the full city dilutes that; (c) the Mayor already sees the full map and can encode any needed spatial context (road borders, neighbor character) directly into each zone's `instructions` string. Cleaner mental model, smaller prompt, better outputs in practice.

### API routes (`app/app/api/mayor/`)
- **`POST /api/mayor`** — body `{ goal: string }` → `{ sessionId }`. Calls `createMayorSession(goal)`.
- **`GET /api/mayor/[sessionId]/stream`** — SSE. Opens a `ReadableStream`, runs `runMayorLoop` server-side, forwards each `MayorStreamEvent` as `event: mayor\ndata: <json>\n\n`. Browser narrows by `payload.kind`: `anthropic_event` | `tool_applied` (mayor or zone) | `zone_message` | `done`.
- **`POST /api/mayor/[sessionId]/interrupt`** — wraps `sendInterrupt` (Mayor only — Zones not interruptible).
- **`POST /api/mayor/[sessionId]/message`** — body `{ text: string }`. Wraps `sendRedirect`.

All four routes return `{ error: "..." }` with 404/400/500 on unknown sessionId / missing fields / server error.

### Frontend integration (`components/CityRenderer.tsx`)
- Mayor control panel (top-left): goal textarea, Build button, status chip (`idle` / `running` / `paused` / `done`), Pause button (while running), Redirect textarea + "Resume with nudge" button (while paused), Mayor's-thoughts scroll panel showing recent `agent.message` texts.
- Build flow: clears local `cityRef`, POSTs `/api/mayor`, opens `new EventSource(.../stream)`, listens for `event: mayor`. On each `tool_applied` with `result.ok === true` (regardless of `source`) calls `placeProperty` / `placeTileRect` against the local city and `scheduleRender()`. Zone events are mechanically identical to Mayor events on the wire — the `source` tag is purely informational.
- During multi-zone builds, several quadrants fill in concurrently rather than corner-to-corner — clear visual signal that parallel Zone agents are working.

### Environment variables (`app/.env.local`)
- `ANTHROPIC_API_KEY` — required.
- `MAYOR_AGENT_ID`, `MAYOR_ENV_ID`, `ZONE_AGENT_ID` — persist after first boot. Missing IDs trigger fresh `agents.create()` / `environments.create()` calls; the new IDs are logged to the dev console for the user to paste into `.env.local`. **Drop the relevant ID(s) and restart whenever the agent's tool list or system prompt changes** (the agent config on Anthropic's side is immutable per version; we don't currently call `agents.update`).

### Known limitations (deferred polish)
- **Reconnect mid-stream not supported.** Server-side loop guards against double-attach with a `running` flag. Browser drop mid-build → loop completes server-side but a new page can't re-attach. Fix: MA client Pattern 1 (`events.list()` + dedupe on reconnect).
- **Zone sessions not interruptible from UI.** Pause button halts the Mayor; Zones already-spawned run to their own `finish`. Zone-level interrupt would need its own UI surface.
- **Single-user demo assumption.** Module-level `sessions` Map is per-process. Two browser tabs can coexist with different sessions but not multi-tenant.
- **Agent config drift.** Changing `MAYOR_SYSTEM`, `ZONE_SYSTEM`, or any tool schema requires deleting the corresponding `*_AGENT_ID` from `.env.local` and restarting. Faster long-term: call `client.beta.agents.update()` on boot.

## Key Design Notes
- Citizens have needs that decay over time; buildings satisfy those needs — the city either *works* or *fails*, not just gets built
- `fire_station` / `police_station` / `power_plant` are not enterable and have no need-decrease stats (risk/utility infrastructure)
- `current_path: Position[]` supports pathfinding — citizens visibly walk to buildings
- `day: 1–7` implies a weekly simulation cycle
- Pathfinding (A* or similar) on the 500×500 grid is a non-trivial Stage 5 concern — plan for it early
