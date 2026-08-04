# MetroPrompt -- Agentic City Builder

Pixel-art city builder, originally for a hackathon ("Build For What's Next"). User prompts a **Mayor agent** which lays roads and partitions the grid, then delegates regions in parallel to **Zone sub-agents**. Build streams live via SSE. A citizen simulation then runs on the finished city -- citizens have needs, pathfind to properties, and can be interviewed about their experience.

**Timeline:** 4-day hackathon (started ~2026-04-22); ongoing development since. Current work: Deepgram voice integration (see Build Stages).

## Tech Stack

| Layer | Tech |
|---|---|
| Framework | Next.js 16 (App Router) -- see `app/AGENTS.md` for breaking changes |
| Rendering | Pixi.js v8 (vanilla, dynamic import, nearest-neighbor scaling) |
| Agents | **Mayor: direct Messages API loop** (own the loop; see Agent Runtimes). Zones: Claude Managed Agents with custom tools |
| Streaming | SSE: Next.js route handler -> browser EventSource (managed runtime adds an upstream Anthropic session stream) |
| Chat rendering | `react-markdown` + `remark-gfm`, styles in `globals.css` under `.chat-md` |
| Voice | Deepgram **Voice Agent API** (Flux STT + Claude Haiku 4.5 + Aura-2 TTS over one WebSocket) |
| Pixel art | PixelLab (AI-assisted isometric sprites) |

## Project Structure

```
MetroPrompt/
  assets/               -- pixel art sprites
  app/                  -- Next.js application
    .env.local          -- ANTHROPIC_API_KEY, DEEPGRAM_API_KEY (+ MAYOR_AGENT_ID / MAYOR_ENV_ID / ZONE_AGENT_ID,
                        --  only used by the managed runtime; direct needs just the key)
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
      api/citizen-chat/route.ts         -- POST: interview a citizen (grounded in their trip log)
      api/voice-agent/token/route.ts    -- POST: mint Deepgram JWT + persona/voice/keyterms
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
        useSimulation.ts                -- sim tick driver: needs decay, movement, firetruck response
        citizenChat.ts                  -- builds CitizenChatContext from a Person, calls /api/citizen-chat
        useCitizenVoice.ts              -- Deepgram Voice Agent socket, mic capture, playback, visualizer
        VoiceChatBar.tsx                -- voice chat button + status + output visualizer row
        propertyLabels.ts               -- display names for properties / trip destinations
        ChatPanel.tsx                   -- draggable/minimizable chat panel w/ feed + composer
        Palette.tsx                     -- building/nature thumbnail sidebar
        CitizenSpeechBubble.tsx         -- citizen chat bubble (pending / reply / error)
        CitizenStatsPopup.tsx           -- selected-citizen needs + status panel
        PropertyInfoPopup.tsx           -- property details on click
        ResponseTimePopup.tsx           -- firetruck response-time readout
    lib/
      all_types.tsx                     -- data schema (source of truth)
      cityStore.ts                      -- localStorage persistence
      renderConfig.ts                   -- per-sprite render offsets/scale
      agent/
        citizenPrompt.ts                -- shared citizen persona (text + voice), voice picker, keyterms
        tools.ts                        -- tool schemas, handlers, applyToolCall, grass-only validation
        mayor.ts                        -- Mayor: prompts (v1/v2), config toggles, dispatchMayorTool,
                                        --  runMayorLoop (managed) + runMayorLoopDirect, runMayorBuild
        zone.ts                         -- Zone agent: system prompt, runZoneBuild (bbox-enforced)
        observation.ts                  -- city -> text observation for agents
      sim/
        constants.ts                    -- tick rates, need decay distributions, thresholds
        spawning.ts                     -- populate a finished city with citizens
        decisions.ts                    -- need-driven destination choice (pickDestination/assignDestination)
        pathfinding.ts                  -- road/sidewalk-aware routing
        companies.ts                    -- office employers
        firetruck.ts                    -- emergency dispatch + response-time tracking
    scripts/
      bench-mayor.mjs                   -- headless build benchmark (POST /api/mayor + SSE, prints timings)
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

### Agent Runtimes (`MAYOR_RUNTIME` in `mayor.ts`)

The Mayor can run on either of two interchangeable runtimes. Both emit identical `MayorStreamEvent`s, so **the frontend is unaffected by the choice**. `runMayorBuild()` dispatches; flipping the constant is the only change needed.

| | `'managed'` | `'direct'` (current) |
|---|---|---|
| Loop | Anthropic runs it; we answer `agent.custom_tool_use` | We own it over `messages.stream()` |
| Setup per build | `agents.create` / `environments.create` / `sessions.create` | none -- local UUID; config rides on each request |
| Transcript | server-side session | `state.messages` in our own Map |
| Thinking | **forced on, no knob** | per-request (`MAYOR_THINKING`) |
| Effort | on the agent config | per-request `output_config.effort` |
| Prompt caching | automatic | explicit `cache_control` (system + rolling history breakpoint) |

**Zones always run on Managed Agents**, regardless of `MAYOR_RUNTIME`. In direct mode an environment is created lazily on first `delegate_zones`.

`dispatchMayorTool()` holds *all* tool handling (batches, `delegate_zones`, singletons) and both runtimes call it, so the two paths provably execute the same logic.

### Tuning knobs (all in `mayor.ts`, all logged in the `[bench]` header)

| Constant | Current | Notes |
|---|---|---|
| `MAYOR_MODEL` | `claude-sonnet-4-6` | Chosen, not a placeholder. See the warning at the constant before changing it. |
| `MAYOR_RUNTIME` | `'direct'` | `'managed'` is a one-line revert. |
| `MAYOR_THINKING` | `'off'` | Direct runtime only. **The single biggest latency lever.** |
| `MAYOR_EFFORT` | `'medium'` | `low`/`medium`/`high`/`max` on Sonnet 4.6. Haiku 4.5 rejects `effort` -- don't set it on Zones. |
| `MAYOR_PROMPT_VERSION` | `'v1'` | v1 long-form (~2,860 tok) / v2 condensed (~1,180 tok). Both live; flip to A/B. |

### Performance (50x50 build, fixed benchmark prompt)

| runtime | thinking | first tool call | total output | total wall |
|---|---|---|---|---|
| managed | forced on, effort `high` | 105s | ~13.7k | 248s |
| managed | forced on, effort `medium` | 49.9s | 13.2k | 222.8s |
| direct | `adaptive` | 134s | 14.3k | 227.7s |
| **direct** | **`off`** | **7.3s** | **3.0k** | **82.9s** |

Owning the loop bought nothing by itself -- platform overhead measured at ~5% of wall time, and `direct + adaptive` matched managed. **The entire win came from disabling thinking**, which Managed Agents cannot express. Thinking was ~86% of output tokens on the old config. Quality (zone tiling, walkability, coverage) held at `thinking: off`.

Measure with `node scripts/bench-mayor.mjs` (needs `npm run dev` running), or read the `[bench]` lines the server prints on any UI build. Keep the goal string identical across runs or the numbers stop comparing.

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

Sessions persist in a module-level Map after `finish`. Follow-up flow: `POST /followup` -> queues goal -> browser opens fresh EventSource on `/stream` -> the loop consumes the queued goal. `completedZoneBboxes` preserved across follow-ups to prevent re-delegation.

Direct runtime: conversation history lives in `state.messages` and follow-ups append to it. `sendInterrupt` sets a flag checked at each turn boundary (the only safe stop point -- interrupting mid-turn would orphan a `tool_use` block); `sendRedirect` appends to the transcript if the loop is live, otherwise queues as `pendingGoal`.

### Environment Variables

`ANTHROPIC_API_KEY` is the only one the direct runtime needs. `MAYOR_AGENT_ID` / `MAYOR_ENV_ID` / `ZONE_AGENT_ID` apply to Managed Agents; missing IDs trigger fresh `agents.create()` / `environments.create()` calls.

`DEEPGRAM_API_KEY` is needed for voice. It must hold the **Member or Owner** role -- a restricted key passes inference calls (so it looks fine everywhere else) but gets 403 on `/v1/auth/grant`, which is the only endpoint the token route uses.

**You no longer drop the agent ID when the prompt or tools change.** `ensureMayor()` reconciles a pinned agent once per boot: it retrieves the current version and pushes the config from code as a new version. Updates are versioned and no-op when nothing changed, so this neither spams versions nor requires a restart. Pin `MAYOR_AGENT_ID` -- an unpinned ID means a brand-new agent object on every boot.

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

`name`, `age_group` (adult/child), `gender?` (male/female), `job`, `home`, `current_location`, `current_path`, `inside_property`, needs (`hunger`/`boredom`/`tiredness` 1-10) with per-person decay rates.

**Gender** is rolled 50/50 at spawn and drives the first-name pool, the TTS voice pool, and (planned) the sprite set, so all three agree. It is *stored*, not inferred from the name -- which is what lets the unisex first names (Alex, Sam, Taylor, ...) stay usable by either gender while the voice stays stable per citizen. The field is optional because cities saved before it existed have citizens without it; **always read it through `citizenGender(person)`**, which falls back to a name hash so old saves don't re-roll their voice on every load.

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

13. **Complete** -- citizen simulation: needs decay, road-aware pathfinding, companies/jobs, firetruck emergency response, per-citizen trip log, click-to-interview citizens (`/api/citizen-chat`)
14. **Complete** -- agent loop performance: direct Messages API runtime, thinking/effort/prompt toggles, shared tool dispatch, benchmark harness (3x faster builds, 78% fewer tokens)

### Deepgram voice branch (in progress)

15. **Stage 1 -- Complete:** make the agent loop fast enough for real-time voice (above).
16. **Stage 2 -- Complete:** Deepgram **Voice Agent API** integration on citizen interviews. Full mic -> Flux STT -> Claude Haiku -> Aura-2 TTS -> speaker path with barge-in, plus a live output visualizer. See Voice Architecture below.
17. **Stage 3:** live formal interview with the Mayor about citizen feedback and future plans. **Prerequisite (not voice work):** log *failed* wants -- `pickDestination` returns null when nothing is reachable and nothing is recorded, so "I got hungry and there was nowhere to go" is currently invisible. Then aggregate citizen feedback for the Mayor.
18. **Stage 4:** talk to the Mayor live while it builds -- narration of tool calls, mute/unmute, barge-in wired to the interrupt path.

**Deferred:** report generation, stream reconnect, per-zone interrupt, cross-playthrough memory, moving Zones onto the direct runtime (~47% of remaining build wall time).

## Voice Architecture (Deepgram Voice Agent)

Deepgram owns the entire speech loop -- STT, LLM, TTS, turn detection, and barge-in
-- over one WebSocket. We only move audio in and out and mirror the state it reports.

```
app/api/voice-agent/token/route.ts  -- mints a ~60s JWT + builds the persona payload
lib/agent/citizenPrompt.ts          -- ONE persona source shared by voice + text chat
components/city/useCitizenVoice.ts  -- browser socket, mic capture, playback, visualizer
components/city/VoiceChatBar.tsx    -- button + status + 24-bar output visualizer
```

**The browser connects to Deepgram directly**, not through us: proxying a bidirectional
audio stream through a route handler would add a hop to every 20ms frame in both
directions. The `DEEPGRAM_API_KEY` still never leaves the server -- what ships to the
client is a short-TTL JWT, useless once it expires.

### Hard-won details (changing any of these silently breaks the session)

| Detail | Why |
|---|---|
| **Native `WebSocket`, not the SDK's socket** | Its `ReconnectingWebSocket` passes auth via `options.headers` on `new WebSocket(url, protocols, options)`. Node's `ws` honours that 3rd argument; **browsers silently discard it**, so auth never leaves the page and the promise never settles -- the UI just hangs on "Connecting...". The SDK is fine server-side for minting tokens. |
| Auth rides the **subprotocol**: `['bearer', <jwt>]` | Verified against the live endpoint. `?access_token=` returns 401. API keys use `['token', <key>]`. |
| Settings keys are **snake_case** (`sample_rate`) | camelCase is ignored and silently falls back to defaults. No `any` cast on the payload, on purpose, so the compiler keeps them honest. |
| Flux STT needs `version: 'v2'` on the listen provider | Omitting it fails the model lookup. |
| Handlers wired **before** the socket opens | Greeting audio can arrive within ms of `SettingsApplied`; a late listener misses the citizen's first words. |
| Unexpected close -> error, never silent | Close code is the only useful diagnostic the browser gives (1006 pre-open = auth; close right after Settings = payload). |
| `AnalyserNode` sits **on** the playback path | Visualizer reads from it, so bars move only when the citizen actually speaks. |
| Voice = FNV-1a hash of the name, **within the citizen's gender pool** | A citizen must sound the same every time or they stop reading as a character. A hash gives that with no per-citizen voice field to persist. Pools live in `citizenPrompt.ts`; all IDs verified against the voice list in `@deepgram/sdk`. |
| Barge-in flushes scheduled `AudioBufferSourceNode`s | Deepgram detects the interruption server-side, but already-buffered audio keeps playing over the user unless we stop it. |
| Muting gates the mic **send**, not the track | No frames reach Deepgram, so it never detects a user turn -- mute disables barge-in by construction rather than by a second rule that could drift. Toggling needs no re-permission, and `KeepAlive` holds the socket through the silence. |
| Transcript reveal is paced to the **audio clock** | `ConversationText` is one complete statement -- there are no token deltas to stream. `useCitizenVoice` instead meters characters out against `outCtx.currentTime`, bounded by `MAX_REVEAL_CHARS_PER_SEC`, so words surface as they're spoken. Snaps to full on `AgentAudioDone`; freezes mid-sentence on barge-in, because that's what the citizen actually got to say. |

## Known Limitations

- No stream reconnect mid-build (server loop completes, can't re-attach)
- Zone sessions not interruptible from UI; Zones still run on Managed Agents
- Single-user demo (module-level session Map, per-process)
- Direct runtime interrupts land at turn boundaries, not mid-turn
- Filename casing: data files lowercase, components PascalCase (cross-platform safety)

**Resolved** (don't reintroduce these workarounds):
- ~~No SDK knob to disable extended thinking~~ -- the direct runtime sets `thinking` per request. This was the single largest source of build latency.
- ~~Agent config changes require deleting `*_AGENT_ID` and restarting~~ -- `ensureMayor()` reconciles via `agents.update()`.
- ~~Tailwind padding/margin utilities silently do nothing~~ -- `globals.css` had a hand-written `* { margin: 0; padding: 0 }` reset. Tailwind v4 puts utilities in `@layer utilities`, and **unlayered CSS outranks any layered rule regardless of specificity**, so that one line zeroed out every `p-*` and `m-*` class app-wide. Preflight already applies the same reset inside `@layer base`. Don't add a bare `*` reset after `@import "tailwindcss"`.
