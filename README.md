# MetroPrompt

An agentic, pixel-art city builder. The user describes a city in natural language; a **Mayor** agent plans the road grid, partitions the map, and delegates each region to a **Zone** sub-agent. Zones build in parallel, the city streams to the browser live over SSE, and Pixi.js renders it as isometric pixel art.

Built for the *Build For What's Next* hackathon over five days. Stack: Next.js 16 (App Router) · Pixi.js v8 · Anthropic Claude Managed Agents · TypeScript.

---

## High-level data flow

```
 Browser                Next.js route                Anthropic Managed Agents
 ───────                ─────────────                ────────────────────────
 prompt ─POST /api/mayor──▶ createMayorSession ─────▶ beta.sessions.create
                                                     (Mayor agent)

 EventSource ─GET /stream──▶ runMayorLoop
                              │
                              ├── stream:  beta.sessions.events.stream(sessionId)
                              │     ◀── agent.message / agent.custom_tool_use / status
                              │
                              ├── apply tool to City object (server-side state)
                              ├── send user.custom_tool_result back to MA
                              │
                              ├── on delegate_zones:
                              │     fan out → runZoneBuild × N (Promise.allSettled)
                              │       Zone session ↔ same SDK pattern
                              │       events forwarded through the Mayor's channel
                              │
                              └── SSE frame ─▶ browser EventSource
                                  { kind: "tool_applied", name, input, result }
                                  → useMayorSession mutates City
                                  → useCityScene repaints via requestAnimationFrame
```

Two streams are layered: Anthropic's Managed Agents stream feeds the Next.js route handler; the route handler emits its own SSE frames to the browser. The browser only ever speaks to our route, never directly to Anthropic.

---

## Agent architecture

Two-tier hierarchy. Each tier is a separate Claude Managed Agent with its own system prompt and tool schema.

### Mayor (`app/lib/agent/mayor.ts`)

- **Model:** `claude-opus-4-7`. Partition and delegation strategy benefits from deeper reasoning.
- **Tools (14):** `place_property` / `place_properties`, `place_tile_rect` / `place_tile_rects`, `place_nature` / `place_natures`, the six matching `delete_*` variants, `delegate_zones`, `finish`.
- **Strategy (encoded in system prompt):**
  1. Lay the *entire* road grid in **one** `place_tile_rects` call.
  2. Lay sidewalks/crosswalks in one more call.
  3. Call `delegate_zones` exactly once with 4–8 non-overlapping bboxes + per-zone briefs.
  4. Optionally place cross-zone landmarks.
  5. Call `finish`.
- For *small edits* (single building, neighborhood tweak) the Mayor skips delegation entirely and uses placement/deletion tools directly. The system prompt branches on `<strategy_build_whole_city>` vs. `<strategy_build_partial>` vs. `<strategy_edit>`.
- The Mayor is anchored on real-world urban-planning principles (walkability / quarter-mile rule, 15-minute city, NFPA emergency-coverage radii, mixed-use zoning) so prompts like "evaluate this city" produce a concrete scorecard.

### Zone (`app/lib/agent/zone.ts`)

- **Model:** `claude-haiku-4-5`. Opus was burning 20k+ output tokens deliberating on a 10×10 fill and occasionally hitting internal limits mid-tool-call, stranding the session in `requires_action`. Haiku is faster, cheaper, doesn't over-think a constrained task, and quality is plenty.
- **Tools (7):** placement + nature variants + `finish`. **No** deletion, **no** `delegate_zones`.
- **Sees only its bbox + the Mayor's brief.** Doesn't see the rest of the city. The Mayor's instructions must include spatial context ("road on south edge", "commercial strip directly south").
- Hard bbox enforcement on every tool call: out-of-bbox placements return a structured error and the agent retries.

### Why structured tool calls, not ASCII output

LLMs cannot reliably emit a clean 50×50 ASCII grid (drift, off-by-ones, missing rows). Structured tool calls (`place_property(park, 12, 8)`) work great: they're validated server-side and either succeed or come back with coordinates the agent can correct against.

---

## Tool calling

### Lifecycle

Tools are declared on the agent config at creation time (`beta.agents.create({ tools })`). The agent emits an `agent.custom_tool_use` event; the server runs the handler against the in-memory `City` and replies with `user.custom_tool_result`.

```
agent.custom_tool_use { id, name, input }
   ↓
applyToolCall(city, { name, input })  →  ToolResult { ok: true } | { ok: false, error }
   ↓
beta.sessions.events.send({ user.custom_tool_result, custom_tool_use_id: id, is_error })
```

The **LLM never sees the `City` object directly.** It emits tool calls, gets back `"ok"` or a structured error string with coordinates, and corrects.

### Validation, all server-side

Defined in `app/lib/agent/tools.ts` and `all_types.ts`:

- **Grass-only rule.** Every cell of a building footprint must be `grass`. Nature must be on grass. Roads, sidewalks, crosswalks, pavement → rejected with the offending coordinate.
- **Bounds.** `x + width ≤ 50`, `y + height ≤ 50`.
- **No overlap.** Any cell already occupied by a building → rejected.
- **Zone bbox enforcement.** Zone tool calls additionally check that the entire footprint fits inside the assigned bbox.
- Error messages are coordinate-rich (`"footprint cell (14,22) is 'sidewalk', buildings can only sit on grass"`) so the agent can retry without re-planning.

### Batch tools

Mayor and Zone both prefer batch variants (`place_properties`, `place_tile_rects`, `place_natures`, plus the matching deletion batches). The server expands a batch into per-item `applyToolCall`s and emits a *synthetic per-item `tool_applied`* event so the browser renders progressively, then returns one aggregated tool result to the agent:

```
ok: all 17 placed
                  -- or --
partial: 14/17 placed
failed:
  [3] place_property(office, 22, 5): footprint cell (22,5) is 'road_two_way', buildings can only sit on grass
  [9] place_property(park, 40, 41): footprint extends out of bounds (x=42 > 49)
  ...
```

This is the single most useful affordance: the agent gets one round-trip per batch instead of N, but still sees per-item diagnostics for the failures.

### `delegate_zones`: fan-out

The most complex tool call. Server-side it:

1. **Normalizes** every bbox (tolerate the LLM swapping x1/x2).
2. **Validates all-or-nothing**: in-bounds, non-self-intersecting, non-overlapping with any prior delegation in this session. Any failure → reject the entire call with structured errors so the Mayor retries cleanly. Partial spawns would be more confusing than one clear error.
3. **Auto-trims** each bbox inward past any roads/sidewalks the Mayor laid (`trimInfrastructureFromBbox`). A zone's *requested* bbox is allowed to extend up to road centerlines for clarity in the brief; the *actual* interior the zone owns is the grass core. Bboxes whose interior fully disappears under trimming are *skipped* and reported back to the Mayor in the result summary.
4. **Spawns** one `runZoneBuild` per surviving zone, all wrapped in `Promise.allSettled` so a single Zone failure doesn't take down its siblings.
5. **Forwards** every Zone tool call and message back through the Mayor's SSE channel tagged with `source: "zone"`, so the browser renders Zone progress live and labels it correctly.
6. **Aggregates** a summary the Mayor sees as a single tool result, including per-zone counts and any trim/skip notes.

The Mayor's *original* (pre-trim) bboxes are stored on `state.completedZoneBboxes` so subsequent `delegate_zones` calls (e.g. on a follow-up prompt) can't re-claim territory the Mayor has already partitioned.

---

## Error handling and session robustness

Managed Agents sessions can get permanently stuck in `requires_action` if a `custom_tool_use` is received and never answered. Several layers prevent that:

### Tool-use ledger

Inside `runMayorLoop`:

```ts
const pending = new Set<string>();
// on agent.custom_tool_use:  pending.add(event.id)
// on send result:             pending.delete(id)
// finally { drain pending with is_error: true }
```

If a handler throws between receiving the tool_use and replying, the `finally` block drains every unanswered id with a generic error result. The session can never sit waiting for a reply that will never come.

### Per-session call cap

`MAX_CUSTOM_TOOL_USES = 70`. When the cap is hit, the server sends a `user.interrupt` followed by a `user.message` instructing the agent to call `finish`. Stops runaway loops without killing the session.

### Stream-first ordering

The stream is opened *before* the kickoff `user.message` is sent. Otherwise early `agent.custom_tool_use` events emitted before the consumer attaches would be lost.

### `end_turn` gate

If Managed Agents reports `session.status_idle` with `stop_reason.end_turn` and the user has *not* interrupted, the loop exits. If the user *has* interrupted, the loop keeps running, waiting for the redirect message that will resume the agent. This is what makes "pause, type a correction, resume" work.

### EventSource auto-reconnect guard

Browsers auto-reconnect EventSource on close. After `finish` the session has no pending goal; if the browser reopens `/stream`, `runMayorLoop` immediately emits `kind: 'done'` and returns instead of holding the stream open. Without this guard, a zombie loop would keep `running = true` and block legitimate follow-ups.

### Re-entrant sessions

Sessions persist in a module-level `Map<sessionId, SessionState>` after `finish`. Follow-ups go:

```
POST /api/mayor/[sessionId]/followup  → setFollowupGoal(goal)
browser opens new EventSource /stream → runMayorLoop consumes pendingGoal
```

Same Managed Agents session: the agent has full conversation history of the previous build. `completedZoneBboxes` persists across follow-ups, blocking re-delegation of already-built territory.

### Interrupt + redirect

`POST /interrupt` sets `state.interrupted = true` and forwards `user.interrupt` to MA. The end_turn gate then keeps the loop alive. `POST /message` (redirect) clears the flag and sends a `user.message`, resuming the agent with new guidance.

---

## SSE pipeline

Route: `app/api/mayor/[sessionId]/stream/route.ts`. A `ReadableStream<Uint8Array>` is returned with `Content-Type: text/event-stream`. Every event from `runMayorLoop` is encoded as a single SSE frame:

```
event: mayor
data: {"kind":"tool_applied","name":"place_property","input":{...},"result":{"ok":true}}

```

Three event kinds the browser handles:

- `anthropic_event`: raw passthrough (used for `agent.message`, status events, etc.).
- `tool_applied`: synthetic, post-handler. Contains the `ToolResult` so the browser can render without reparsing the raw `custom_tool_use`. Optional `source: "zone"` tag for color-coding.
- `done`: terminal. Browser closes the EventSource on receipt to prevent auto-reconnect.

`X-Accel-Buffering: no` and `Cache-Control: no-cache, no-transform` are set so reverse proxies don't buffer chunks.

---

## Frontend architecture

`CityRenderer.tsx` is a ~250-line shell composing three hooks plus two UI components, split out of a god-component refactor. SSR is impossible (Pixi needs `window`), so:

```
page.tsx (server)
  → CityRendererWrapper ('use client', dynamic(..., { ssr: false }))
    → CityRenderer ('use client')
        ├── useCityEditor       creates edit-mode refs + actions
        ├── useCityScene        Pixi app, layers, painter loop, pan/zoom
        ├── useMayorSession     SSE consumer, mutations, send actions
        ├── <ChatPanel/>        draggable, markdown feed, composer
        └── <Palette/>          drag-to-place sidebar
```

Three layers of the wrapper are required because `dynamic(..., { ssr: false })` can only be called inside a *client* component.

### `useCityScene`

Owns everything Pixi: `Application`, world container, three rendering layers (`spritesLayer`, `gridLines`, `highlightLayer`), texture preload, the painter loop, pan/zoom, pointer events, and floating delete-button positioning. Knows nothing about the agent stream or the chat UI.

### `useCityEditor`

Edit-mode actions for `/cities/[id]`: select, hover highlight, drag-to-move, palette drag-to-place, delete. Called *first*, so its refs are available to hand to the scene hook. Scene outputs are threaded back via a mutable `bindScene()` ref so the two hooks can be wired bidirectionally without circular dependencies.

### `useMayorSession`

Owns the EventSource. On every `tool_applied` it mutates `cityRef.current` in-place and calls `scheduleRender()` from the scene hook. Closes the EventSource on `done` to prevent the auto-reconnect zombie loop. Exposes four user actions: `build`, `followup`, `pause`, `redirect`.

### Adding a fourth hook

A future 7-day citizen simulation will plug in as `useSimulation({ cityRef, scheduleRender })`: same shape, no other refactor needed.

---

## Rendering

### Isometric mapping

```
gridToScreen(gx, gy) = {
  x: (gx - gy) * TILE_W / 2,
  y: (gx + gy) * TILE_H / 2,
}
// TILE_W = 64, TILE_H = 32
```

### Two-pass painter

1. **Tiles.** Iterate `tile_grid`, draw ground sprites in row-major order.
2. **Nature + properties.** Merge into one list, sort by `x + y` (painter's algorithm), draw in order. Properties anchor at their top corner with width-based scale.

### Pixi.js v8 specifics

- Dynamic import inside `useEffect`: `const { Application, ... } = await import('pixi.js')`.
- `TextureStyle.defaultOptions.scaleMode = 'nearest'` set *before* loading textures so the AI-generated pixel art stays crisp.
- `await app.init({...})`: async init is required in v8.
- `app.canvas` (not `app.view`).
- All sprites: `anchor.set(0.5, 0)`.
- Textures preloaded in parallel via `Assets.load`.

### Coalesced repaints

Mutations call `scheduleRender()`, which sets a dirty flag and queues a single `requestAnimationFrame`. A burst of 50 `tool_applied` events from a Zone batch produces one repaint, not fifty.

### `renderConfig.ts`

Per-sprite `{ offsetX, offsetY, scale }`. Edits live here so visual alignment doesn't touch the data schema or the renderer.

### Hydration safety

No `Math.random()` at module level. Variant selection (which of N tree sprites to draw) happens inside `useEffect` or event handlers. Otherwise SSR + client picks would mismatch.

---

## Data schema (`app/lib/all_types.tsx`)

```ts
City = {
  tile_grid:     TileCode[][];   // ground layer; default '.' = grass
  all_properties: Property[];    // 2×2 or 3×3 buildings
  all_nature:    Nature[];       // 1×1 trees / flowers / bushes
  all_citizens:  Person[];       // simulation (forthcoming)
  day:           number;         // 1–7
}
```

Three lists rather than a single layered grid: properties have multi-cell footprints and per-instance metadata (capacity, occupants, sprite variant), and citizens move continuously, not on cell boundaries. The flat `tile_grid` stays cheap to scan for validation.

Mutation helpers throw on overlap / OOB so any path that bypasses the agent layer (UI drag-to-place, localStorage rehydration) gets the same invariant guarantees.

---

## Project layout

```
MetroPrompt/
  CLAUDE.md                  -- project conventions (read this first if working on the repo)
  assets/                    -- pixel-art sprites
  app/
    .env.local               -- ANTHROPIC_API_KEY, MAYOR_AGENT_ID, MAYOR_ENV_ID, ZONE_AGENT_ID
    app/
      page.tsx               -- server entry
      api/mayor/
        route.ts                       -- POST: create session
        [sessionId]/stream/route.ts    -- GET:  SSE proxy + custom-tool loop
        [sessionId]/interrupt/route.ts -- POST: pause
        [sessionId]/message/route.ts   -- POST: redirect (user.message)
        [sessionId]/followup/route.ts  -- POST: queue follow-up goal
    components/
      CityRenderer.tsx                 -- shell composing the three hooks
      city/
        useCityScene.ts                -- Pixi app + render loop
        useCityEditor.ts               -- edit mode
        useMayorSession.ts             -- SSE consumer
        ChatPanel.tsx
        Palette.tsx
    lib/
      all_types.tsx                    -- City schema + mutation helpers (source of truth)
      cityStore.ts                     -- localStorage persistence
      renderConfig.ts                  -- per-sprite render offsets/scale
      agent/
        tools.ts                       -- tool schemas, handlers, applyToolCall
        mayor.ts                       -- Mayor agent + runMayorLoop
        zone.ts                        -- Zone agent + runZoneBuild
```

---

## Running locally

```
cd app
npm install
# .env.local:
#   ANTHROPIC_API_KEY=sk-ant-...
#   MAYOR_AGENT_ID=...   (optional, created on first boot)
#   MAYOR_ENV_ID=...     (optional)
#   ZONE_AGENT_ID=...    (optional)
npm run dev
```

On first boot, agents and an environment are auto-created and their IDs are logged. Paste them into `.env.local` so subsequent boots reuse the same agent versions.

**Heads up:** Managed Agents config is immutable per agent version. If you change a tool schema, system prompt, or model on either agent, **delete the corresponding `*_AGENT_ID`** from `.env.local` and restart so a fresh agent is created.

---

## Known limitations

- No mid-build stream reconnect: if the browser disconnects, the server-side loop completes but the user can't reattach to it.
- Zone sessions aren't independently interruptible from the UI (interrupt fires only on the Mayor).
- Single-process demo: sessions live in a module-level Map; horizontal scaling would need an external store.
- No SDK knob to disable extended thinking on Managed Agents; Haiku-on-Zone is the workaround.
- Filename casing matters cross-platform: data files lowercase, components PascalCase.

---

## Status

Stages 1–12 complete: schema, rendering, Mayor, SSE, batch tools, Mayor+Zone fan-out, nature placement, chat UI, edits + follow-ups, robustness (tool ledger, Haiku swap), saved cities + edit mode, frontend hook refactor.

Next up: 7-day citizen simulation (need decay, pathfinding, and a feedback loop that hands the simulation results back to the Mayor for a planning report).
