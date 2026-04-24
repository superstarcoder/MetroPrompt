# MetroPrompt — Agentic City Builder

## Project Overview
A pixel-art agentic city builder for a hackathon. The user prompts a Mayor agent (Claude Managed Agents) which lays out a 50×50 city via tool calls, streaming the build live to the browser. Future stages: citizens simulate for 7 days, then the Mayor generates a report. Multi-agent split (Mayor → Zone + Infrastructure sub-agents) is a Stage 5 polish item.

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
    .env.local           — ANTHROPIC_API_KEY, MAYOR_AGENT_ID, MAYOR_ENV_ID (do not commit)
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
        tools.ts         — ToolCall union, TOOL_SCHEMAS, applyToolCall dispatcher
        observation.ts   — buildObservation (dormant; kept for future prompt-pumped variants)
        mayor.ts         — MAYOR_MODEL const, ensureMayor, createMayorSession, runMayorLoop, sendInterrupt, sendRedirect
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
Single **Mayor agent** running on Claude Managed Agents. Zone / Infrastructure sub-agents (multi-agent split) are deferred to Stage 5 polish — see `app/lib/agent/mayor.ts`'s `MAYOR_SYSTEM` prompt for current capabilities.

- **Design insight:** LLMs can't reliably emit clean 50×50 ASCII grids, but they read them well. So ASCII is LLM *input* (via `cityToAscii`), tool calls are LLM *output*. All tool calls are validated at the call site — `placeProperty` / `placeTileRect` throw on overlap + OOB with structured coordinates, which the Mayor reads and retries.
- **Custom-tool pattern:** our tools (`place_property`, `place_tile_rect`, `finish`) are declared on the agent (no container execution). Mayor emits `agent.custom_tool_use` → our server runs `applyToolCall` → sends `user.custom_tool_result`. See §Mayor Agent below.
- **Model:** `claude-sonnet-4-6` for dev iteration. Flip `MAYOR_MODEL` in `mayor.ts` to `claude-opus-4-7` for demo day — one-line change.

## Build Stages
1. **Data schema** ✅ — `app/lib/all_types.tsx`
2. **Pixel art + rendering system** ✅ — Pixi.js isometric renderer with pan/zoom, grid overlay toggle
3. **Mayor agent via Managed Agents** ✅ — see §Mayor Agent
4. **Connect backend to frontend** ✅ — SSE live build, Build button + Pause + Redirect UI in `CityRenderer.tsx`
5. **Polish** — prompt tuning, multi-agent split (Mayor → Zone / Infra), `pdf`/`docx` skill for final report, `web_search` preamble, `code_execution` for sim stats, memory stores for cross-playthrough learning
6. **7-day citizen simulation + feedback loop** — needs decay, pathfinding, citizens generate feedback → Mayor report

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

## Mayor Agent (`app/lib/agent/`)

### File layout
- **`tools.ts`** — `ToolCall` discriminated union (`place_property` | `place_tile_rect` | `finish`), per-tool input shapes matching our schema, `applyToolCall(city, call) → ToolResult` dispatcher that wraps the throwing placement helpers into `{ ok: true }` / `{ ok: false, error }`, and `TOOL_SCHEMAS` — the JSON Schema list passed directly to `agents.create({ tools })`.
- **`mayor.ts`** — Managed Agents plumbing:
  - `MAYOR_MODEL` constant (top of file) — flip to `claude-opus-4-7` for demo day.
  - `ensureMayor()` — create-or-reuse pattern for the agent + environment. Reads `MAYOR_AGENT_ID` / `MAYOR_ENV_ID` from env; if missing, creates them and logs the IDs to add to `.env.local`. Avoids the #1 MA anti-pattern (new agent per request).
  - `createMayorSession(goal)` — `sessions.create()` with agent + env, stashes `{ city: initCity(50), pendingGoal, interrupted: false }` in a module-level `sessions` Map.
  - `runMayorLoop(sessionId, onEvent)` — stream-first ordering: opens `events.stream()`, then sends the pending goal. For each `agent.custom_tool_use` event: parse → apply via `applyToolCall` → `events.send({user.custom_tool_result, is_error})` back. Emits `tool_applied` synthetic events for the frontend. Terminates on `session.status_terminated`, on `stop_reason: retries_exhausted`, or on `end_turn` when `!state.interrupted`. Turn cap = `MAX_CUSTOM_TOOL_USES = 70`; at the cap we send `user.interrupt` + a nudge asking the Mayor to call `finish`.
  - `sendInterrupt(sessionId)` — sets `state.interrupted = true`, fires `user.interrupt`. The loop sees the resulting `end_turn` idle and stays alive.
  - `sendRedirect(sessionId, text)` — clears `state.interrupted`, fires `user.message`. The loop's pending `stream.next()` unblocks with a `session.status_running` event and the Mayor resumes.
- **`observation.ts`** — `buildObservation(city, errors)` composes `cityToAscii` + counts + prior-turn errors into a text block. Dormant: MA surfaces state via events, not prompt-pumped observations. Kept for a future prompt variant or the Zone/Infra sub-agents.

### API routes (`app/app/api/mayor/`)
- **`POST /api/mayor`** — body `{ goal: string }` → `{ sessionId }`. Validates the body, calls `createMayorSession(goal)`.
- **`GET /api/mayor/[sessionId]/stream`** — SSE. Opens a `ReadableStream`, runs `runMayorLoop` server-side, forwards each `MayorStreamEvent` as `event: mayor\ndata: <json>\n\n`. Browser narrows by `payload.kind`: `anthropic_event` | `tool_applied` | `done`.
- **`POST /api/mayor/[sessionId]/interrupt`** — wraps `sendInterrupt`. Returns `{ ok: true }`.
- **`POST /api/mayor/[sessionId]/message`** — body `{ text: string }`. Wraps `sendRedirect`.

All four routes return `{ error: "..." }` with 404/400/500 on unknown sessionId / missing fields / server error.

### Frontend integration (`components/CityRenderer.tsx`)
- Mayor control panel (top-left): goal textarea, Build button, status chip (`idle` / `running` / `paused` / `done`), Pause button (while running), Redirect textarea + "Resume with nudge" button (while paused), Mayor's-thoughts scroll panel showing the last 5 `agent.message` texts.
- Build flow: clears local `cityRef`, POSTs `/api/mayor`, opens `new EventSource(.../stream)`, listens for `event: mayor`, and on each `tool_applied` with `result.ok === true` calls `placeProperty` / `placeTileRect` against the local city, then `scheduleRender()`.
- Status state machine drives UI from `session.status_*` events (see `handleMayorEvent`).

### Environment variables (`app/.env.local`)
- `ANTHROPIC_API_KEY` — required.
- `MAYOR_AGENT_ID`, `MAYOR_ENV_ID` — persist after first boot so subsequent dev-server restarts reuse the same agent/environment instead of creating fresh ones. If missing, `ensureMayor()` creates them and logs the IDs to paste in.

### Known limitations (deferred to Stage 5 polish)
- **Reconnect mid-stream not supported.** The server-side `runMayorLoop` guards against double-attach with a `running` flag. If the browser disconnects mid-build, the server loop continues to completion but a new page can't re-attach (`"loop already running"`). Fix: MA client Pattern 1 — `events.list()` + dedupe on reconnect. Out of scope for hackathon.
- **Single-user demo assumption.** Module-level `sessions` Map is per-process. Two browser tabs can coexist with different sessions but not multi-tenant.
- **No persistence across server restarts.** City state lives in memory; dev-server restart wipes active sessions (but the MA session itself persists on Anthropic's side — could reconnect with Pattern 1 once implemented).

## Key Design Notes
- Citizens have needs that decay over time; buildings satisfy those needs — the city either *works* or *fails*, not just gets built
- `fire_station` / `police_station` / `power_plant` are not enterable and have no need-decrease stats (risk/utility infrastructure)
- `current_path: Position[]` supports pathfinding — citizens visibly walk to buildings
- `day: 1–7` implies a weekly simulation cycle
- Pathfinding (A* or similar) on the 500×500 grid is a non-trivial Stage 5 concern — plan for it early
