# MetroPrompt -- Agentic City Builder

Pixel-art city builder for a hackathon ("Build For What's Next"). User prompts a **Mayor agent** (Claude Managed Agents) which lays roads and partitions the grid, then delegates regions in parallel to **Zone sub-agents**. Build streams live via SSE. Future: 7-day citizen simulation + Mayor report.

**Timeline:** 4-day hackathon (started ~2026-04-22)

## Tech Stack

| Layer | Tech |
|---|---|
| Framework | Next.js 16 (App Router) -- see `app/AGENTS.md` for breaking changes |
| Rendering | Pixi.js v8 (vanilla, dynamic import, nearest-neighbor scaling) |
| Agents | Claude Managed Agents with custom tools (`agent.custom_tool_use` / `user.custom_tool_result`) |
| Streaming | Two-layer SSE: Anthropic session stream -> Next.js route handler -> browser EventSource |
| Chat rendering | `react-markdown` + `remark-gfm`, styles in `globals.css` under `.chat-md` |
| Pixel art | PixelLab (AI-assisted isometric sprites) |

## Project Structure

```
MetroPrompt/
  assets/               -- pixel art sprites
  app/                  -- Next.js application
    .env.local          -- ANTHROPIC_API_KEY, MAYOR_AGENT_ID, MAYOR_ENV_ID, ZONE_AGENT_ID
    app/
      page.tsx          -- server component entry
      layout.tsx / globals.css
      api/mayor/
        route.ts                        -- POST: create session
        [sessionId]/
          stream/route.ts               -- GET: SSE proxy + custom-tool loop
          interrupt/route.ts            -- POST: halt session
          message/route.ts              -- POST: redirect (user.message)
          followup/route.ts             -- POST: queue follow-up goal
    components/
      CityRendererWrapper.tsx           -- 'use client', dynamic import w/ ssr:false
      CityRenderer.tsx                  -- 'use client', composes hooks + UI
      city/
        constants.ts                    -- TILE_W/H, GRID_SIZE, gridToScreen
        imageHelpers.ts                 -- renderKey, variant pickers, preload arrays
        paletteData.ts                  -- sidebar palette data
        hitTesting.ts                   -- screenToGrid, entityAt, isPlacementValid
        streamTypes.ts                  -- MayorEvent, FeedItem, Status, ToolItem
        feedHelpers.ts                  -- tool style + formatting for chat feed
        useCityScene.ts                 -- Pixi app/world/layers, painter loop, pan/zoom, pointer events
        useCityEditor.ts               -- edit-mode: select/drag/delete entities, palette drag-to-place
        useMayorSession.ts             -- SSE stream, tool_applied -> city mutations, build/followup/pause/redirect
        ChatPanel.tsx                   -- draggable/minimizable chat panel w/ feed + composer
        Palette.tsx                     -- building/nature thumbnail sidebar
    lib/
      all_types.tsx                     -- data schema (source of truth)
      cityStore.ts                      -- localStorage persistence
      renderConfig.ts                   -- per-sprite render offsets/scale
      agent/
        tools.ts                        -- tool schemas, handlers, applyToolCall, grass-only validation
        mayor.ts                        -- Mayor agent: system prompt, session mgmt, runMayorLoop, delegate_zones
        zone.ts                         -- Zone agent: system prompt, runZoneBuild (bbox-enforced)
```

## SSR Pattern

`page.tsx` (server) -> `CityRendererWrapper` ('use client', `dynamic(..., { ssr: false })`) -> `CityRenderer` ('use client', Pixi logic). Three layers required because `ssr: false` can't be used in server components.

## Frontend Architecture

`CityRenderer.tsx` (~250 lines) is a shell composing three hooks + two UI components:

**`useCityScene`** -- Pixi app/world/layers, texture preload, painter loop (`scheduleRender`), pan/zoom, pointer events, floating delete-button positioning. No knowledge of agent stream or chat.

**`useCityEditor`** -- Edit-mode refs + actions: select, hover highlight, drag-to-move, palette drag-to-place, delete. Called **first** to create refs; scene called second to receive them; `bindScene()` threads scene outputs back via mutable ref.

**`useMayorSession`** -- SSE event handling, status/feed state, city mutations on `tool_applied`, four user actions (build/followup/pause/redirect). Closes EventSource on `kind: 'done'` to prevent auto-reconnect zombie loops.

**`ChatPanel`** -- Draggable/minimizable card with status badge, markdown message feed, color-coded tool cards, 4-state composer (idle/running/paused/done).

**`Palette`** -- Building/nature thumbnail sidebar. One prop: `onPalettePointerDown`.

**`CityRenderer` owns:** canvas mount ref, `cityRef`, `showGrid` toggle, save-city UI, chat panel window position, JSX assembly.

**Future:** Simulation plugs in as a fourth hook (`useSimulation({ cityRef, scheduleRender })`).

## Agent Architecture

Two-tier: **Mayor** (coordinator, `claude-sonnet-4-6`) + **Zone** sub-agents (specialists, `claude-haiku-4-5`). Zone uses Haiku because its task is constrained -- Sonnet burned 20k+ tokens deliberating on simple zone fills.

### Core Design Principles

- LLMs can't reliably emit clean 50x50 ASCII grids, but structured tool calls work great. Agents talk via validated tool calls (`placeProperty`/`placeTileRect` throw on overlap/OOB).
- All tools are declared on agent configs (no container execution). Agent emits `agent.custom_tool_use` -> server runs `applyToolCall` -> sends `user.custom_tool_result`.
- **Grass-only rule:** building footprints must be all-grass; nature only on grass. Enforced in `tools.ts`.
- **Tool-use ledger:** every tool_use ID tracked in `pending: Set<string>`; `finally` block drains unanswered IDs with error results so sessions never get stuck in `requires_action`.

### Mayor's Job

- **Full build:** lay road grid -> partition into 4-8 zones -> `delegate_zones` ONCE -> optional landmarks -> `finish`
- **Small edits:** place/delete directly, no delegation
- **Follow-ups:** session stays alive post-finish; `setFollowupGoal` queues new goals on same session with full conversation history

### Zone's Job

Receive bbox + instructions, place buildings + nature inside bbox, call `finish`. Hard bbox enforcement on every tool call. Zones run in parallel via `Promise.allSettled` (non-overlapping bboxes = safe concurrent mutation).

**Auto-trim:** before fan-out, Zone bboxes are greedily trimmed inward past road/sidewalk edges so Zones can never overwrite the Mayor's infrastructure.

### Tool Set

Mayor has 14 tools; Zones have 7 (no `delegate_zones`, no `delete_*`).

**Placement:** `place_property`, `place_properties`, `place_tile_rect`, `place_tile_rects`, `place_nature`, `place_natures`
**Deletion (Mayor-only):** `delete_property`, `delete_properties`, `delete_tile_rect`, `delete_tile_rects`, `delete_nature`, `delete_natures`
**Control:** `delegate_zones` (Mayor-only), `finish` (both)

### Re-entrant Sessions

Sessions persist in a module-level Map after `finish`. Follow-up flow: `POST /followup` -> queues goal -> browser opens fresh EventSource on `/stream` -> `runMayorLoop` consumes queued goal. `completedZoneBboxes` preserved across follow-ups to prevent re-delegation.

### Environment Variables

`ANTHROPIC_API_KEY`, `MAYOR_AGENT_ID`, `MAYOR_ENV_ID`, `ZONE_AGENT_ID`. Missing IDs trigger fresh `agents.create()` calls. **Drop ID(s) and restart when agent tools/system prompt/model changes** (agent config is immutable per version).

## Data Schema (`app/lib/all_types.tsx`)

### City Structure (three-list design)

```ts
City = {
  tile_grid: TileCode[][];   // ground layer, default '.' (grass)
  all_properties: Property[];
  all_nature: Nature[];
  all_citizens: Person[];
  day: number;               // 1-7
}
```

### Tiles (`TileName`)

`grass`, `pavement`, `road_one_way`, `road_two_way`, `road_intersection`, `crosswalk`, `sidewalk`. Stored as single chars in `tile_grid`.

### Nature (`NatureName`)

`tree`, `flower_patch`, `bush`. `Nature = { name, position, image }`. 1x1 items.

### Properties (`PropertyName`)

| Property | Size | Cap | Enterable | Key Stats |
|---|---|---|---|---|
| `park` | 3x3 | 50 | yes | boredom-8, tiredness-3 |
| `hospital` | 3x3 | 20 | yes | tiredness-5 |
| `school` | 3x3 | 80 | yes | boredom-3 |
| `grocery_store` | 3x3 | 30 | yes | hunger-8, boredom-2 |
| `house` | 2x2 | 4 | yes | tiredness-10, hunger-5 |
| `apartment` | 3x3 | 10 | yes | tiredness-10, hunger-5 |
| `office` | 3x3 | 30 | yes | boredom-3 |
| `restaurant` | 2x2 | 30 | yes | hunger-10, boredom-5 |
| `fire_station` | 3x3 | 10 | no | infrastructure |
| `police_station` | 3x3 | 10 | no | infrastructure |
| `power_plant` | 3x3 | 5 | no | infrastructure |
| `shopping_mall` | 3x3 | 40 | yes | boredom-6, hunger-6 |
| `theme_park` | 3x3 | 60 | yes | boredom-10 |

### TileCode Map

| Ground | Nature | Buildings |
|---|---|---|
| `.` grass, `,` pavement | `t` tree | `D` house, `A` apartment, `O` office, `R` restaurant |
| `-` road_one_way, `=` road_two_way | `f` flower_patch | `P` park, `S` school, `G` grocery, `H` hospital |
| `+` intersection, `x` crosswalk, `_` sidewalk | `b` bush | `F` fire_station, `C` police, `E` power_plant, `M` mall, `Z` theme_park |

### People (`Person`)

`name`, `age_group` (adult/child), `job`, `home`, `current_location`, `current_path`, `inside_property`, needs (`hunger`/`boredom`/`tiredness` 1-10) with per-person decay rates.

### Key Helpers

`initCity(size)`, `placeTile`, `placeTileRect` (throws OOB), `placeProperty` (throws overlap/OOB), `placeNature`, `deletePropertyAt` (any cell of footprint), `deleteNatureAt`, `cityToAscii`/`asciiToCity`.

**No `Math.random()` at module level** -- variant selection happens in `useEffect`/event handlers to avoid hydration mismatches.

## Rendering System

### Isometric Mapping

`gridToScreen(gx, gy) = { x: (gx-gy) * TILE_W/2, y: (gx+gy) * TILE_H/2 }` (TILE_W=64, TILE_H=32)

### Two-Pass Render

1. **Tiles** -- iterate `tile_grid`, draw ground sprites
2. **Nature + Properties** -- merge, sort by `x+y` (painter's algorithm), draw in order. Properties anchor at top corner with width-based scaling.

### Key Rendering Details

- All sprites: `anchor.set(0.5, 0)`, nearest-neighbor scaling
- Textures preloaded in parallel via `Assets.load` at init
- `renderConfig.ts` holds per-sprite `{ offsetX, offsetY, scale }` -- edit for alignment without touching schema/renderer
- Client-side variant roulette: browser picks random variant from image arrays for visual variety
- GRID_SIZE = 50 (demo), schema supports 500x500
- Three-layer world: `spritesLayer` + `gridLines` + `highlightLayer`
- Repaints coalesced to single `requestAnimationFrame`

### Pixi.js v8 Notes

- Dynamic import inside `useEffect`: `const { Application, ... } = await import('pixi.js')`
- `TextureStyle.defaultOptions.scaleMode = 'nearest'` before loading textures
- `await app.init({...})` (async init required)
- `app.canvas` not `app.view`

## Edit Mode

When `editable={true}` (used by `/cities/[id]`):
- **Click** selects entity, shows floating delete button at south vertex
- **Drag entity** moves it (invalid drops snap back)
- **Drag from palette** spawns new entity (invalid drops discard)
- `onCityChange` fires after mutations for localStorage persistence

## Build Stages

1-12: **Complete** -- schema, rendering, Mayor agent, SSE streaming, batch tools, multi-agent (Mayor+Zones), nature placement, chat UI, edit tools + follow-ups, robustness (tool ledger, Haiku swap), saved cities + edit mode, frontend refactor (god-component -> hooks)

13. **Next:** 7-day citizen simulation (decay, pathfinding, feedback -> Mayor report)
14. **Deferred:** report generation, stream reconnect, per-zone interrupt, cross-playthrough memory

## Known Limitations

- No stream reconnect mid-build (server loop completes, can't re-attach)
- Zone sessions not interruptible from UI
- Single-user demo (module-level session Map, per-process)
- Agent config changes require deleting `*_AGENT_ID` and restarting
- No SDK knob to disable extended thinking on Managed Agents (model swap is the workaround)
- Filename casing: data files lowercase, components PascalCase (cross-platform safety)
