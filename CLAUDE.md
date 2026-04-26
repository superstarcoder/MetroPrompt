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
- **Markdown rendering:** `react-markdown` + `remark-gfm` in the chat panel for agent text. Styles live in `app/app/globals.css` under `.chat-md`.
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
            followup/route.ts                  — POST: queue a follow-up goal on a finished session
    components/
      CityRendererWrapper.tsx — 'use client', owns the ssr:false dynamic import
      CityRenderer.tsx        — 'use client', thin shell that composes 3 hooks + 2 UI components
      city/                   — focused modules + hooks for the renderer (see "Frontend Architecture")
        constants.ts          — TILE_W, TILE_H, GRID_SIZE, gridToScreen
        imageHelpers.ts       — renderKey, variant pickers, preload arrays
        paletteData.ts        — PROPERTY_PALETTE / NATURE_PALETTE (sidebar data)
        hitTesting.ts         — SelectedEntity, EntityDragState, screenToGrid, entityAt, isPlacementValid
        streamTypes.ts        — MayorEvent, FeedItem, Status, ToolItem (frontend mirror of mayor stream)
        feedHelpers.ts        — toolStyle, formatToolInput (chat-feed presentation)
        useCityScene.ts       — Pixi app/world/layers, painter loop, pan/zoom, hover/click/drag plumbing
        useCityEditor.ts      — edit-mode refs + palette drag-to-place + delete-selected
        useMayorSession.ts    — SSE stream, tool_applied → city mutations, build/followup/pause/redirect
        ChatPanel.tsx         — draggable + minimizable panel: header, feed, 4-state composer dock
        Palette.tsx           — building/nature thumbnail sidebar
    lib/
      all_types.tsx      — simulation data schema, source of truth (incl. deletePropertyAt / deleteNatureAt helpers)
      cityStore.ts       — localStorage persistence for saved cities
      renderConfig.ts    — per-sprite render offsets and scale (visual tuning only)
      agent/
        tools.ts         — ToolCall union, TOOL_SCHEMAS (Mayor) + ZONE_TOOL_SCHEMAS (Zone, no delegate_zones, no delete_*), applyToolCall, grass-only validation for buildings + nature
        observation.ts   — buildObservation (dormant; kept for future prompt-pumped variants)
        mayor.ts         — MAYOR_MODEL const, MAYOR_SYSTEM, ensureMayor, createMayorSession, runMayorLoop, sendInterrupt, sendRedirect, setFollowupGoal; delegate_zones handler (intersection check + auto-trim of road/sidewalk borders + parallel Zone fan-out); delete_* batch handlers; tool-use ledger drain
        zone.ts          — ZONE_MODEL const (Haiku 4.5), ZONE_SYSTEM, ensureZone, runZoneBuild (bbox-enforced custom-tool loop with tool-use ledger drain, returns summary)
    scripts/
      test_step1.ts      — npx tsx smoke test for the tool dispatcher + observation builder
    public/assets/       — sprites served to browser
```

## SSR / Client Component Structure
- `page.tsx` — plain server component, imports `CityRendererWrapper`
- `CityRendererWrapper.tsx` — `'use client'`, owns `dynamic(() => import('./CityRenderer'), { ssr: false })`
- `CityRenderer.tsx` — `'use client'`, all Pixi.js logic lives here
- This three-layer pattern is required: `ssr: false` is not allowed in server components, so the dynamic import must live in a client component wrapper

## Frontend Architecture
`CityRenderer.tsx` is a ~250-line shell. Almost all behavior lives in three hooks + two UI components under `app/components/city/`. The seams are designed so simulation (citizens, decay, pathfinding) can plug in as a fourth sibling hook without surgery.

### `useCityScene.ts` — the Pixi.js scene
Owns: app/world/layers, texture preload, painter loop (`scheduleRender`), pan/zoom, hover/click/drag pointer plumbing, the floating delete-button anchor (positioned each frame by an `app.ticker` callback). Knows nothing about the agent stream or the chat panel.

- **Args:** `{ mountRef, cityRef, deleteBtnRef, showGrid, editor refs (passed in), setSelectedEntity }`
- **Returns:** `{ scheduleRender, worldRef }`
- The painter loop reads `cityRef.current` plus the live editor refs (`hoveredEntityRef`, `selectedEntityRef`, `entityDragRef`) to apply hover/select highlights and the green/red drag tint. Coalesces repaints to one `requestAnimationFrame`.

### `useCityEditor.ts` — edit-mode state + actions
Owns: `selectedEntity` React state + the live refs (`selectedEntityRef`, `hoveredEntityRef`, `entityDragRef`, `editableRef`, `onCityChangeRef`), `setSelectedEntity`, `onPalettePointerDown` (drag a thumbnail from the sidebar onto the grid), `onDeleteSelected` (the floating ✕ button).

- **Args:** `{ cityRef, editable, onCityChange }`
- **Returns:** the editor refs (so they can be threaded into `useCityScene`), `selectedEntity` state, `setSelectedEntity`, `onPalettePointerDown`, `onDeleteSelected`, plus `bindScene({ scheduleRender, worldRef })`.

**The hook-order cycle.** `useCityScene` needs the editor refs as inputs (they're read by Pixi event handlers). The editor's callbacks (`onPalettePointerDown`, `onDeleteSelected`) need `scheduleRender` + `worldRef` from the scene. To break this: editor is called **first** (creates refs), scene is called next (receives the refs), and a `useEffect(() => editor.bindScene({ scheduleRender, worldRef }), ...)` threads scene outputs back into the editor through a mutable ref. Editor callbacks read scene values lazily through `sceneRef.current`. If a click ever fires before scene init finishes, the callback returns silently.

### `useMayorSession.ts` — the agent stream
Owns: `status` / `sessionId` / `feed` / `originalGoal` state, the `goal` / `followupText` / `redirectText` composer inputs, the `pushMessage` / `pushToolApplied` feed updaters, the `tool_applied` → city-mutation handler, and the four user actions (`onBuild`, `onFollowup`, `onPause`, `onRedirect`). Mutates `cityRef` in place and calls `scheduleRender` after each mutation.

- **Args:** `{ cityRef, scheduleRender, onBuildReset? }` — `onBuildReset` is fired at the start of `onBuild` so the parent can clear save-related state.
- The handler dispatches by `payload.kind`: `tool_applied` (mutates city + schedules render), `anthropic_event` (status transitions + `agent.message` → mayor feed entry), `zone_message` → zone feed entry, `done` (close EventSource and stop the browser's auto-reconnect from spawning a zombie loop server-side).

### `ChatPanel.tsx` and `Palette.tsx` — UI
- **`ChatPanel`** — draggable + minimizable card with the header (status badge + minimize button), the feed (`message` / `tool_batch` items rendered with markdown / color-coded glyphs respectively), and the four-state composer dock (`idle` / `running` / `paused` / `done`). Gets its content via props; doesn't own any session state.
- **`Palette`** — building / nature thumbnail sidebar. One prop: `onPalettePointerDown(e, item)`.

### What `CityRenderer.tsx` still owns
- The `mountRef` for the Pixi canvas
- `cityRef` (initialized from the `initialCity` prop in readOnly mode, or empty grass otherwise)
- `showGrid` state + the grid-toggle button JSX
- Save-city UI state (`saveName`, `saveState`) + `onSaveCity` callback (snapshots `cityRef.current` to `localStorage` via `lib/cityStore.ts`)
- Chat-panel window-position state + the panel's drag-to-move-window logic
- The JSX assembly: mount div, delete button, `<Palette>`, readOnly header, `<ChatPanel>`, grid toggle

### Adding simulation later
Citizens / 7-day decay / pathfinding will become a fourth hook (`useSimulation({ cityRef, scheduleRender })`) called next to the existing three. If citizens need per-frame ticking (smoother walking) instead of event-driven repaints, expose either the Pixi `app` or a dedicated citizen layer from `useCityScene`. The `City` schema already has `all_citizens` and `Person.current_path` fields ready.

## Agent Architecture
Two-tier multi-agent on Claude Managed Agents: **Mayor** (coordinator, `claude-sonnet-4-6`) + **Zone** sub-agents (specialists, `claude-haiku-4-5`). Zone is on Haiku because its task ("place buildings in this bbox per the Mayor's brief") is constrained and low-ambiguity — Sonnet's extended thinking was burning 20k+ output tokens deliberating on simple zone fills, occasionally hitting internal limits mid-tool-call and stranding the session in `requires_action`. Haiku is faster, cheaper, and produces equivalent or better results on this kind of bounded task. Mayor stays on Sonnet because partition + delegation strategy benefits from the deeper reasoning.

- **Design insight:** LLMs can't reliably emit clean 50×50 ASCII grids, but they're great at structured tool calls. ASCII is dev-only input/output; agents talk to the world via tool calls validated at the call site — `placeProperty` / `placeTileRect` throw on overlap + OOB with structured coordinates that the Mayor (or Zone) reads and retries.
- **Custom-tool pattern:** all our tools are declared on the agent configs (no container execution). Agent emits `agent.custom_tool_use` → our server runs `applyToolCall` (with bbox enforcement for Zones) → sends `user.custom_tool_result`.
- **Mayor's job (whole-city builds):** lay road + sidewalk grid → partition the grid into 4–8 non-overlapping zones → call `delegate_zones` ONCE with bbox + free-text instructions per zone → optionally place a few signature buildings or scatter cross-zone landmarks/nature directly → `finish`. The Mayor does NOT fill in zones itself; that's the Zone agents' job.
- **Mayor's job (small edits / partial builds):** place buildings, tiles, or nature directly with the placement tools, no delegation. Configurable in `MAYOR_SYSTEM`.
- **Zone's job:** receive bbox + Mayor's instructions, place buildings + nature inside the bbox, call `finish` when done. Hard bbox enforcement on every tool call (rejects placements outside the assigned region with structured errors so the Zone self-corrects). Zones run in parallel via `Promise.allSettled` — bboxes don't intersect (validated server-side), so concurrent mutation of the shared `City` is safe.
- **Auto-trim of Zone bboxes:** before fan-out, the Mayor's requested bbox for each zone is greedily trimmed inward as long as any edge row/column contains a road/sidewalk/crosswalk/intersection/pavement tile. The Zone receives the trimmed (grass-interior) bbox, so it can never overwrite the Mayor's road network. The Mayor's *original* bbox is what's stored in `completedZoneBboxes` for future-overlap checks (matches the Mayor's mental model of "I claimed this rectangle"). Any trims are reported back to the Mayor in the `delegate_zones` result text under `bbox adjustments:`. See `trimInfrastructureFromBbox` in `mayor.ts`.
- **Grass-only placement rule:** every cell of a building footprint must be grass; nature (tree/flower_patch/bush) can only sit on grass. The handlers in `tools.ts` enforce this with structured errors before mutating the city. Combined with auto-trim, this means Zones effectively own a pure-grass interior and never collide with infrastructure.
- **Re-entrant Mayor sessions (follow-up edits).** The Mayor session is NOT closed after `finish` — it stays alive in the `sessions` Map with `running = false`. The user can send a follow-up prompt that re-uses the same session: `POST /api/mayor/[sessionId]/followup` calls `setFollowupGoal(sessionId, goal)` which sets `pendingGoal`, then the browser opens a fresh EventSource on `/stream`. `runMayorLoop` consumes the queued goal, sends it as a new `user.message`, and runs the loop body again until the next `finish`. The Mayor retains full conversation history, and `completedZoneBboxes` is preserved across follow-ups so the Mayor can't re-delegate a region it already filled — surgical edits go through `place_*` / `delete_*` instead.
- **Edit tools (`delete_*`) are Mayor-only.** Zones build into a fresh interior; surgical removals are the Mayor's job during follow-up prompts. `delete_property(x,y)` accepts ANY cell of the footprint (no need to remember the anchor). `delete_tile_rect` resets a rectangle to grass. `delete_nature` removes a 1×1 nature item. All have batch variants (`delete_properties`, `delete_tile_rects`, `delete_natures`).
- **Tool-use ledger** (mayor.ts + zone.ts). Every received `agent.custom_tool_use` ID is added to a `pending: Set<string>`; every `sendResult` removes its entry and is idempotent. On loop exit (clean `finish`, error, break), a `finally` block drains anything still in `pending` by sending a generic `is_error: true` `"internal error: tool handler did not return a result"` response. This guarantees every tool call the agent made gets *some* answer — sessions can never end up stuck in `requires_action` waiting for a reply that a thrown handler never sent. Stranded IDs are logged via `console.warn`.
- **Model swap:** `MAYOR_MODEL` in `mayor.ts` and `ZONE_MODEL` in `zone.ts` are top-of-file constants. Flip both to `claude-opus-4-7` for demo day — two-line change.

## Build Stages (history)
1. **Data schema** ✅ — `app/lib/all_types.tsx`
2. **Pixel art + rendering system** ✅ — Pixi.js isometric renderer with pan/zoom, grid overlay toggle
3. **Mayor agent via Managed Agents** ✅
4. **Connect backend to frontend** ✅ — SSE live build, Build button + Pause + Redirect UI
5. **Batch tools** ✅ — `place_properties` / `place_tile_rects` / `place_natures` array variants
6. **Multi-agent split (Mayor + parallel Zone agents)** ✅ — `delegate_zones` Mayor tool + `app/lib/agent/zone.ts`
7. **Nature placement tools** ✅ — `place_nature` / `place_natures` for both Mayor and Zone agents
8. **Chat UI overhaul** ✅ — unified draggable, minimizable pixel-themed chat panel with markdown messages and color-coded tool-call cards
9. **Edit tools + follow-up reprompt flow** ✅ — `delete_*` (Mayor-only) + re-entrant session via `setFollowupGoal`
10. **Robustness — tool-use ledger + Zone model swap** ✅ — `pending: Set<string>` finally-drain in both loops; Zone agent moved to `claude-haiku-4-5`
11. **Saved cities + edit mode** ✅ — `lib/cityStore.ts` (localStorage), `/cities` index + `/cities/[id]` viewer with hover/click/drag editing of properties + nature, palette sidebar, floating ✕ button on selected entity
12. **Frontend refactor** ✅ — `CityRenderer.tsx` split from a ~1600-line god-component into a 252-line shell + three focused hooks (`useCityScene`, `useCityEditor`, `useMayorSession`) and two UI components (`ChatPanel`, `Palette`). Sets up the seam for simulation as a sibling hook.
13. **7-day citizen simulation + feedback loop** — needs decay, pathfinding, citizens generate feedback → Mayor report. Plugs into the renderer as a fourth hook (`useSimulation`).
14. **Remaining polish (deferred)** — `pdf`/`docx` skill for the post-sim report, `web_search` preamble, `code_execution` for sim stats, memory stores for cross-playthrough learning, stream reconnect (MA Pattern 1), per-zone interrupt UI

## Rendering System

### Isometric coordinate mapping
```ts
// constants.ts
gridToScreen(gx, gy) = {
  x: (gx - gy) * (TILE_W / 2),   // TILE_W = 64
  y: (gx + gy) * (TILE_H / 2),   // TILE_H = 32
}
```

### Two-pass render (in `useCityScene`'s painter loop)
1. **Pass 1 — tiles.** Iterate `city.tile_grid`, decode char via `CODE_TO_TILE`, look up image via `TILE_META[name].image`, draw. Every cell has a ground tile (default grass); buildings sit on top in pass 2 without modifying the tile grid.
2. **Pass 2 — nature + properties.** Merge `city.all_nature` and `city.all_properties` into a combined drawables list, sort by `position.x + position.y` (painter's-algorithm depth), then draw in order. Nature is 1×1 at its position; properties anchor at their top corner and draw with width `prop.width * TILE_W * cfg.scale`.

Because properties anchor at their back corner and the painter's sort uses that anchor, occlusion works for the current test layouts. If future layouts get denser, revisit the sort key.

### Tile rendering
- `anchor.set(0.5, 0)` — top vertex of diamond pinned to grid position
- Scale: `(TILE_W / texture.width) * cfg.scale`
- Offsets per tile type stored in `lib/renderConfig.ts` (`TILE_RENDER`) — keys match `TileName` exactly
- Texture path resolved via `TILE_META[CODE_TO_TILE[char]].image` — single source of truth in `all_types.tsx`

### Nature rendering
- `Nature` items (`tree`, `flower_patch`, `bush`) are placed by the Mayor or Zone agents via `place_nature` / `place_natures`. The scene starts with no nature; greenery streams in alongside buildings during the build.
- Rendered like tiles: `anchor.set(0.5, 0)`, same scale formula, offsets pulled from `TILE_RENDER` keyed by `renderKey(nat.image)` — e.g. `tree_v3`, `flower_patch_v1`, `bush_v1`.
- Server stores the default variant; the browser picks a random variant via `pickNatureImage` for visual variety.

### Property rendering
- `anchor.set(0.5, 0)` — top vertex of footprint diamond pinned to grid position
- Width: `prop.width * TILE_W * cfg.scale`; y scale matches x
- Y adjusted by `-(prop.width - 1) * TILE_H` to correct for building height above footprint
- Render key derived from image path via `renderKey(prop.image)` — strips path and size suffix: `/assets/apartment_v1_3_3.png` → `apartment_v1`
- **Placement convention:** `(gx, gy)` = top corner of diamond footprint. A 3×3 property at (0,0) occupies cells (0,0)–(2,2).

### Texture loading
- Every unique image path under `ALL_TILE_IMAGES` / `ALL_PROP_IMAGES` / `ALL_NATURE_IMAGES` (collected at module top in `imageHelpers.ts`) is preloaded in parallel via `Assets.load` inside `useCityScene`'s init, so `tool_applied` events render immediately without load gaps.
- Textures keyed by image path: `tileTex['/assets/grass_1_1.png']`, `propTex['/assets/apartment_v1_3_3.png']`, etc.

### Scene lifecycle (in `useCityScene`)
- `GRID_SIZE = 50` (50×50 demo grid; real `City` schema uses 500×500).
- **Empty on mount** — `cityRef.current = initCity(50)` (all grass, no buildings). The scene fills in live as the Mayor streams tool events, OR is seeded from `initialCity` when the renderer is mounted by `/cities/[id]` in readOnly mode.
- **Re-render scheduling** — each `tool_applied` event mutates `cityRef.current` (in `useMayorSession`'s handler), then calls `scheduleRender()` which coalesces to a single `requestAnimationFrame` (so a batch of 10 tool calls per Mayor turn = one repaint, not ten).
- **Three-layer world container** — `world > spritesLayer + gridLines + highlightLayer`. Repaints clear `spritesLayer.removeChildren()` and `highlightLayer.removeChildren()`; `gridLines` survives. The highlight layer holds tinted sprite copies (yellow for selected, soft white for hovered) that overlay everything else with `blendMode: 'screen'`.
- **Client-side variant roulette** — when the Mayor emits `place_property(apartment, …)` the browser picks a random image from `APARTMENT_IMAGES` for visual variety. The server's parallel copy uses `PROPERTY_DEFAULTS[name].image`. They diverge only on cosmetic variant — not on structure.

### Pixi.js v8 notes
- Must be dynamically imported inside `useEffect`: `const { Application, ... } = await import('pixi.js')` — done inside `useCityScene`'s init.
- `TextureStyle.defaultOptions.scaleMode = 'nearest'` — set before loading any textures for crisp pixel art
- `await app.init({...})` — async init required in v8
- `app.canvas` (not `app.view`) for the canvas element

### renderConfig.ts
Separates visual tuning from game logic. Contains per-sprite `{ offsetX, offsetY, scale }` for all tile, nature, and property render keys. Edit this file to adjust sprite alignment without touching the schema or renderer logic.

Keys use the sprite variant name (same as what `renderKey()` derives from the image path):
- Tile keys: `grass`, `road_one_way`, `road_two_way`, `road_intersection`, `crosswalk`, `sidewalk`, `pavement` — match `TileName` exactly
- Nature keys: `tree_v1`–`tree_v4`, `flower_patch_v1`, `bush_v1`
- Property keys: `park`, `hospital`, `school`, `grocery_store`, `fire_station`, `police_station`, `powerplant`, `restaurant`, `shopping_mall`, `theme_park`, `apartment_v1`, `apartment_v2`, `office_v1`–`office_v3`, `home_v1`, `home_v2` (note: `home_`, not `house_` — matches image filenames; the `powerplant` key also differs from the `power_plant` property name)

## Edit Mode (saved-city viewer)
When `CityRenderer` is mounted with `editable={true}` (used by `/cities/[id]`), `useCityEditor` enables hover/click/drag editing. The painter loop reads its live refs to highlight the selected (yellow tint) and hovered (soft white) entity, and to render the in-flight drag with green/red tint based on `isPlacementValid`.

- **Click an entity** → selects it. The floating ✕ delete button appears anchored to its south vertex (positioned every Pixi tick by `repositionDeleteBtn`).
- **Drag an existing entity** → moves it. Validity = in-bounds + no overlap with other entities (does NOT enforce grass-only — users can drop on roads). Invalid drop snaps back to the original position.
- **Drag from the palette sidebar** → spawns a new entity at the cursor cell. Invalid drop discards the entity entirely. The first cursor position is over the palette itself, so the placement starts invalid; releasing without moving onto the canvas is a clean cancel.
- **`onCityChange`** fires after every successful mutation (delete, drag-drop). The `/cities/[id]` page uses this to persist back to localStorage.

## Data Schema (`app/lib/all_types.tsx`)
All types and constants are exported. Import via `@/lib/all_types`.

### Tiles (`TileName`)
`pavement`, `road_one_way`, `road_two_way`, `road_intersection`, `crosswalk`, `sidewalk`, `grass`

Tiles have no per-instance state — they live in `city.tile_grid: TileCode[][]` as single-char codes. `TILE_META[name]` provides the per-name `{ can_walk_through, can_drive_through, image }` used by rendering and (eventually) pathfinding.

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
- `RESTAURANT_IMAGES` — restaurant variants

### Important: no Math.random() at module level
`PROPERTY_DEFAULTS` uses index `[0]` for variant buildings. Random variant selection happens inside `useEffect` / on tool-event handlers (`pickPropertyImage` / `pickNatureImage` in `imageHelpers.ts`), never at module evaluation time — doing so causes React hydration mismatches.

### People (`Person`)
`name`, `age_group` (`adult`/`child`), `job` (see `Job` union, `null` for children), `home: Property`, `current_location: Position`, `current_path: Position[]`, `inside_property: Property | null`, needs `hunger`/`boredom`/`tiredness` (1–10) with per-person decay rates `hunger_rate` (1.5–4.5), `boredom_rate`/`tiredness_rate` (1.0–4.0), plus `image`.

Helpers:
- `JOB_OPTIONS` — all non-null jobs (`teacher`, `doctor`, `firefighter`, `police_officer`, `chef`, `grocer`, `engineer`, `unemployed`)
- `randomBetween(min, max)`
- `spawnPerson(age_group, home, availableImages)` — assigns random job (null for children), randomized needs/rates, picks image from supplied list. Depends on an external `generateRandomName()` (declared, not yet implemented).

### Grid and City — three-list design
`City` is a flat tile grid plus parallel lists for buildings, nature, and citizens. The tile grid stores only ground chars; buildings and nature live in their own lists keyed by anchor position.

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
- `placeTileRect(city, x1, y1, x2, y2, name: TileName)` — fills a rectangle (corners inclusive, normalized). **Throws** on OOB.
- `placeProperty(city, property)` — **throws** on OOB or footprint overlap with an existing property. Pushes to `all_properties` on success.
- `placeNature(city, nature)` — pushes to `all_nature`. Validation lives in `tools.ts → handlePlaceNature`.
- `getTileAt(city, position): TileName` — decodes via `CODE_TO_TILE`.
- `getPropertyAt(city, position): Property | undefined` — O(n) scan over `all_properties` for a footprint covering `position`.
- `deletePropertyAt(city, position): Property | undefined` — finds the property whose footprint covers `position` (any cell, not just anchor) and splices it from `all_properties`. Used by `handleDeleteProperty` and the frontend's edit-mode delete + drag-discard paths.
- `deleteNatureAt(city, position): Nature | undefined` — splices the 1×1 nature item at exactly `position` from `all_nature`. Used by `handleDeleteNature` and the frontend.

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
- **`cityToAscii(city) → { grid, legend }`** — `grid` overlays nature and properties onto a copy of `tile_grid` (properties stamp their char across their whole footprint so the LLM sees size/shape), joined with newlines. `legend` is the static `ASCII_LEGEND` string. At 50×50 the grid is ~2.5k chars; at 500×500 it's 250k and needs a viewport.
- **`asciiToCity(ascii, opts?) → City`** — inverse parser, used as a dev/test utility (not wired into the agent pipeline). Strict: throws with `(x, y)` on ragged rows, malformed multi-cell property footprints, overlaps, or unknown chars. `opts.variantStrategy` is `'default'` (deterministic, SSR-safe) or `'random'` (client-only).

## Mayor + Zone Agents (`app/lib/agent/`)

### Tool set
The Mayor has 14 tools; Zones have 7 (no `delegate_zones` — recursion banned; no `delete_*` — Zones build into a fresh interior, edits are the Mayor's job).

| Tool | Mayor | Zone | Notes |
|---|---|---|---|
| `place_property(property, x, y)` | ✅ | ✅ | One building. Rejects on overlap, OOB, or any non-grass cell in the footprint (Zone also checks bbox). |
| `place_properties(properties[])` | ✅ | ✅ | Many buildings, one call. Per-item validation, partial-success result. |
| `place_tile_rect(tile, x1, y1, x2, y2)` | ✅ | ✅ | One ground-tile rectangle. |
| `place_tile_rects(rects[])` | ✅ | ✅ | Many rects, one call. Mayor lays the entire road grid in one of these. |
| `place_nature(nature, x, y)` | ✅ | ✅ | One 1×1 tree/flower_patch/bush. Rejected if not on a grass tile or if a building covers the cell. |
| `place_natures(natures[])` | ✅ | ✅ | Many nature items, one call. Per-item validation, partial-success result. |
| `delete_property(x, y)` | ✅ | ❌ | Removes the building covering `(x, y)`. Accepts ANY cell of the footprint. |
| `delete_properties(positions[])` | ✅ | ❌ | Many delete-by-cell, one call. Per-item validation, partial-success result. |
| `delete_tile_rect(x1, y1, x2, y2)` | ✅ | ❌ | Resets a rectangle to grass. Buildings/nature on top are NOT removed — delete those separately. |
| `delete_tile_rects(rects[])` | ✅ | ❌ | Many tile-clears, one call. |
| `delete_nature(x, y)` | ✅ | ❌ | Removes the 1×1 nature item at exactly `(x, y)`. |
| `delete_natures(positions[])` | ✅ | ❌ | Many nature deletes, one call. |
| `delegate_zones(zones[])` | ✅ | ❌ | Mayor-only. Validates + auto-trims bboxes server-side then fans out to parallel Zone sessions via `Promise.allSettled`. NOT used during follow-up edits. |
| `finish(reason)` | ✅ | ✅ | Ends the agent's loop. Mayor's `finish` ends THIS prompt (session stays alive for follow-ups); Zone's `finish` ends just that Zone session. |

### `tools.ts`
- `ToolCall` discriminated union for the singletons. Batch tools and `delegate_zones` are handled inline in `mayor.ts` / `zone.ts` rather than expanding the union.
- Handlers (`handlePlaceProperty`, `handlePlaceTileRect`, `handlePlaceNature`, `handleDeleteProperty`, `handleDeleteTileRect`, `handleDeleteNature`, `handleFinish`) — wrap the throwing placement helpers into `{ ok: true }` / `{ ok: false, error }`, plus enforce the **grass-only rule**.
- `applyToolCall(city, call) → ToolResult` — central dispatcher.
- `TOOL_SCHEMAS` — full JSON-schema list passed to the Mayor's `agents.create({ tools })`. `ZONE_TOOL_SCHEMAS` — `TOOL_SCHEMAS` filtered through `ZONE_EXCLUDED` (`Set` of `delegate_zones` + all six `delete_*` names).

### `mayor.ts`
- `MAYOR_MODEL` constant — flip to `claude-opus-4-7` for demo day.
- `MAYOR_SYSTEM` prompt — three strategy branches: "build whole city" (lay infra → partition → `delegate_zones` → optional landmarks → `finish`), "specific build / small cluster / improvement" (place directly with singletons or batches, no delegation), and "EDIT / REMOVE existing things" (use `delete_*` first to clear space, then `place_*` to add; `delegate_zones` is forbidden during follow-ups).
- `ensureMayor()` — create-or-reuse pattern for the Mayor agent + the shared environment.
- `createMayorSession(goal)` — `sessions.create()`, stashes `{ city: initCity(50), pendingGoal, running: false, interrupted: false, completedZoneBboxes: [] }` in a module-level `sessions` Map.
- `setFollowupGoal(sessionId, goal)` — queues a follow-up goal on an idle (post-`finish`) session.
- `runMayorLoop(sessionId, onEvent)` — stream-first: opens `events.stream()`, sends the kickoff `user.message` after. **No-op guard at the top:** if `pendingGoal` is undefined, the loop emits a `done` event and returns immediately. Tool-use ID added to `pending: Set<string>` ledger; `sendResult` is idempotent. Singletons → `applyToolCall`. Batches → unroll into per-item synthetic `tool_applied` events for the frontend (each tagged with `${event.id}#${i}` so the UI can group), send a single composite `tool_result`. `delegate_zones` → normalize+validate+auto-trim bboxes, `Promise.allSettled` over `runZoneBuild`, append originals to `completedZoneBboxes`. `finish` → exit. Turn cap = `MAX_CUSTOM_TOOL_USES = 70`.
- **Finally drain.** When the loop exits (clean, error, or break), the `finally` block walks `pending` and sends an error result for any unanswered tool_use_id. Sets `state.running = false`.
- Helpers `INFRA_TILES`, `isInfrastructure`, `trimInfrastructureFromBbox` live at the top of `mayor.ts` — the trim is a greedy four-edge peel that loops until every edge row/column is pure grass (or the bbox collapses).
- `sendInterrupt(sessionId)` / `sendRedirect(sessionId, text)` — UI pause/redirect mechanics.
- `MayorStreamEvent` is a discriminated union: `anthropic_event` | `tool_applied` (with optional `source: 'mayor' | 'zone'` tag) | `zone_message` | `done`.

### `zone.ts`
- `ZONE_MODEL` constant — `claude-haiku-4-5` (the SDK doesn't expose a thinking-disable knob on Managed Agents; swapping models is the practical fix).
- `ZONE_SYSTEM` prompt — terse: "you own this bbox, here are your instructions, place buildings + nature, call finish." Documents the GRASS-ONLY RULE and HARD BBOX RULE inline.
- `ensureZone()` — create-or-reuse the Zone agent. Reads `ZONE_AGENT_ID` from env; reuses `MAYOR_ENV_ID`.
- `runZoneBuild(bbox, instructions, city, envId, zoneIndex, onEvent) → ZoneBuildResult`:
  - `sessions.create()` with the Zone agent. Kickoff message: just (auto-trimmed) bbox + Mayor's instructions + "place buildings, prefer batch, call finish when done." No full-city ASCII (intentionally — see "Why no ASCII for Zones" below).
  - Custom-tool loop with bbox validation on every singleton + batch tool call (per-item for batches). `bboxContainsProperty`, `bboxContainsTileRect`, `bboxContainsPosition`.
  - **Tool-use ledger.** Same pattern as `runMayorLoop`. The `finally` block drains anything still in `pending` (logged as `[zone N] drained unanswered tool_use_id ...`).
  - Tracks placement counts by type for the summary.
  - Forwards `tool_applied` and `zone_message` events upstream via `onEvent`.
- `Bbox = { x1, y1, x2, y2 }` exported type. Bboxes are normalized and infrastructure-trimmed by the Mayor before being passed to `runZoneBuild`.

### Why no ASCII for Zones
Initial design passed `cityToAscii(city)` in the Zone kickoff so the agent could see roads + neighbors. Removed because: (a) it added ~2.5K chars per zone session, mostly never referenced; (b) the Zone's whole point is *focused attention on its bbox*, and dumping the full city dilutes that; (c) the Mayor already sees the full map and can encode any needed spatial context directly into each zone's `instructions` string.

### API routes (`app/app/api/mayor/`)
- **`POST /api/mayor`** — body `{ goal: string }` → `{ sessionId }`. Calls `createMayorSession(goal)`.
- **`GET /api/mayor/[sessionId]/stream`** — SSE. Opens a `ReadableStream`, runs `runMayorLoop` server-side, forwards each `MayorStreamEvent` as `event: mayor\ndata: <json>\n\n`. Used both for the initial build AND for follow-up re-entries (the loop's no-pending-goal guard makes accidental re-entries safe).
- **`POST /api/mayor/[sessionId]/interrupt`** — wraps `sendInterrupt` (Mayor only — Zones not interruptible).
- **`POST /api/mayor/[sessionId]/message`** — body `{ text: string }`. Wraps `sendRedirect` (used while paused mid-build to nudge the Mayor with `user.message`).
- **`POST /api/mayor/[sessionId]/followup`** — body `{ goal: string }`. Wraps `setFollowupGoal`. Use after a `finish` to queue a new goal on the same session; the browser then opens a fresh EventSource on `/stream`. Rejects with 500 if the loop is still running.

### Frontend integration recap
The frontend split (see "Frontend Architecture" above) places SSE event handling in `useMayorSession`. On each `tool_applied` it pushes to the chat feed and, if `result.ok === true`, applies the change to `cityRef.current` (`placeProperty` / `placeTileRect` / `placeNature` for places, `deletePropertyAt` / `deleteNatureAt` / `placeTileRect→grass` for deletes), then calls `scheduleRender()`. `agent.message` events become `mayor` messages; `zone_message` events become `zone` messages. The `source` tag on `tool_applied` is purely for labeling — the handler treats Mayor and Zone events identically.

**EventSource auto-reconnect guard.** When the SSE stream emits `kind: 'done'`, `useMayorSession` closes `esRef.current` and nulls it. Without this, the browser's default EventSource auto-reconnect would re-open `/stream` after the server closed it on `finish`, kicking off a zombie `runMayorLoop` and holding `state.running = true` — which would then make the next `/followup` POST fail with "loop already running". The backend's no-pending-goal early return is the belt-and-suspenders fallback.

During multi-zone builds, several quadrants fill in concurrently rather than corner-to-corner — clear visual signal that parallel Zone agents are working. Pixi pan/zoom handlers ignore events whose target is inside `[data-mayor-ui]`, so the chat panel and grid toggle don't pan the canvas.

### Environment variables (`app/.env.local`)
- `ANTHROPIC_API_KEY` — required.
- `MAYOR_AGENT_ID`, `MAYOR_ENV_ID`, `ZONE_AGENT_ID` — persist after first boot. Missing IDs trigger fresh `agents.create()` / `environments.create()` calls; the new IDs are logged to the dev console for the user to paste into `.env.local`. **Drop the relevant ID(s) and restart whenever the agent's tool list or system prompt changes** (the agent config on Anthropic's side is immutable per version).

### Known limitations (deferred polish)
- **Reconnect mid-stream not supported.** Server-side loop guards against double-attach with a `running` flag. Browser drop mid-build → loop completes server-side but a new page can't re-attach. Fix: MA client Pattern 1 (`events.list()` + dedupe on reconnect).
- **Zone sessions not interruptible from UI.** Pause button halts the Mayor; Zones already-spawned run to their own `finish`.
- **Single-user demo assumption.** Module-level `sessions` Map is per-process. Sessions also live for the lifetime of the dev server process — restarting drops all in-flight session state.
- **Agent config drift.** Changing `MAYOR_SYSTEM`, `ZONE_SYSTEM`, or any tool schema (or model) requires deleting the corresponding `*_AGENT_ID` from `.env.local` and restarting.
- **No SDK knob to disable extended thinking on Managed Agents.** Switching `ZONE_MODEL` to Haiku 4.5 was the practical workaround.

## Key Design Notes
- Citizens have needs that decay over time; buildings satisfy those needs — the city either *works* or *fails*, not just gets built
- `fire_station` / `police_station` / `power_plant` are not enterable and have no need-decrease stats (risk/utility infrastructure)
- `current_path: Position[]` supports pathfinding — citizens visibly walk to buildings
- `day: 1–7` implies a weekly simulation cycle
- Pathfinding (A* or similar) on the 500×500 grid is a non-trivial Stage 13 concern — plan for it early
- Filename casing matters in cross-platform builds: data files use lowercase (`paletteData.ts`) and component files use PascalCase (`Palette.tsx`) to avoid collisions on case-insensitive filesystems (macOS, Windows)
