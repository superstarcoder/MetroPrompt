# MetroPrompt — Agentic City Builder

## Project Overview
A pixel-art agentic city builder for a hackathon. The user prompts a Mayor agent, which orchestrates Zone and Infrastructure agents to build and govern a living city. After 7 simulated days, citizens provide feedback and the Mayor generates a formal report.

## Hackathon Context
- **Prompt theme:** "Build For What's Next" — interfaces without a name, workflows from a few years out
- **Timeline:** 4 days of hacking (started ~2026-04-22)

## Tech Stack
- **Framework:** Next.js 16 (App Router) — full-stack, API routes for Claude SDK backend
- **Rendering:** Pixi.js v8 (vanilla, dynamically imported inside `useEffect`) — WebGL, nearest-neighbor scaling for crisp pixel art
- **State:** Zustand — lightweight game-like mutable state
- **Streaming:** Server-Sent Events (SSE) — streams agent actions to frontend in real time
- **Agents:** Anthropic SDK multi-agent via tool calls
- **Pixel art:** PixelLab (AI-assisted isometric sprite generation)

## Project Structure
```
MetroPrompt/
  OLD_all_types.tsx      — archived original schema (do not use)
  assets/                — all pixel art sprites
  app/                   — Next.js application
    app/
      page.tsx           — server component entry point (no 'use client')
      layout.tsx
      globals.css
    components/
      CityRendererWrapper.tsx — client component that owns the ssr:false dynamic import
      CityRenderer.tsx        — Pixi.js renderer ('use client', tiles+properties+pan/zoom+grid)
    lib/
      all_types.tsx      — simulation data schema, source of truth (all exports)
      renderConfig.ts    — per-sprite render offsets and scale (visual tuning only)
    public/assets/       — sprites served to browser
```

## SSR / Client Component Structure
- `page.tsx` — plain server component, imports `CityRendererWrapper`
- `CityRendererWrapper.tsx` — `'use client'`, owns `dynamic(() => import('./CityRenderer'), { ssr: false })`
- `CityRenderer.tsx` — `'use client'`, all Pixi.js logic lives here
- This three-layer pattern is required: `ssr: false` is not allowed in server components, so the dynamic import must live in a client component wrapper

## Agent Architecture
- **Mayor agent** — high-level city goals, population targets, happiness metrics, reacts to simulation feedback
- **Zone agents** — place `Property` objects (residential, commercial, civic)
- **Infrastructure agents** — lay `Tile` objects (roads, sidewalks, crosswalks)
- Agents communicate exclusively via **tool calls** (e.g. `place_property(name, x, y)`, `place_tile(name, x, y)`, `spawn_citizen(home_property_id)`)

## Build Stages
1. **Data schema** ✅ — `app/lib/all_types.tsx`
2. **Pixel art + rendering system** ✅ — Pixi.js isometric renderer with pan/zoom, grid overlay toggle
3. **Mayor + Zone + Infrastructure agents + orchestration** — headless; outputs final `City` state
4. **Connect backend to frontend** — SSE streaming so the city is built live on screen
5. **7-day citizen simulation + feedback loop** — needs decay, pathfinding, citizens generate feedback → Mayor report

## Rendering System (Stage 2 — complete)

### Isometric coordinate mapping
```ts
gridToScreen(gx, gy) = {
  x: (gx - gy) * (TILE_W / 2),   // TILE_W = 64
  y: (gx + gy) * (TILE_H / 2),   // TILE_H = 32
}
```

### Unified depth-sorted render pass (painter's algorithm)
Tiles and properties are merged into a single list and sorted by isometric depth before rendering. This ensures decorative tiles (trees, flowers) correctly appear in front of buildings when their grid position warrants it.

- **Tile depth:** `gx + gy`
- **Property depth:** `px + py` (back/top corner) — using the back corner guarantees all tiles with higher `gx+gy` are drawn after the property
- **Tiles under property footprints are skipped** — before building the render list, an `occupiedCells` set is built from all property footprints. Tiles in occupied cells are not added to the render list, eliminating depth-sorting conflicts between ground tiles and buildings.
- Do NOT go back to separate tile/property rendering passes — it breaks isometric occlusion.

### Tile rendering
- `anchor.set(0.5, 0)` — top vertex of diamond pinned to grid position
- Scale: `(TILE_W / texture.width) * cfg.scale`
- Offsets per tile type stored in `lib/renderConfig.ts` (`TILE_RENDER`)
- Variant tiles (tree, flower_patch) carry a specific `image` field on the `Cell` object; the render key is derived via `renderKey(cell.image)` rather than `cell.name`

### Property rendering
- `anchor.set(0.5, 0)` — top vertex of footprint diamond pinned to grid position
- Width: `prop.width * TILE_W * cfg.scale`
- Y adjusted by `-(prop.width - 1) * TILE_H` to correct for building height above footprint
- Render key derived from image path via `renderKey(prop.image)` — strips path and size suffix: `/assets/apartment_v1_3_3.png` → `apartment_v1`
- **Placement convention:** `(gx, gy)` = top corner of diamond footprint. A 3×3 property at (0,0) occupies cells (0,0)–(2,2).

### Texture loading
- Tile textures keyed by image path (not tile name) — `tileTex['/assets/grass_1_1.png']`
- Property textures keyed by image path — `propTex['/assets/apartment_v1_3_3.png']`
- All unique paths collected upfront and loaded in parallel

### Road layout (test grid)
- Roads are **2 tiles wide** — two parallel 1×1 road tiles per road
- Road columns: x = 12–13, 26–27, 40–41
- Road rows: y = 12–13, 26–27, 40–41
- Sidewalks flank each road on both sides (1 tile wide)

### Pixi.js v8 notes
- Must be dynamically imported inside `useEffect`: `const { Application, ... } = await import('pixi.js')`
- `TextureStyle.defaultOptions.scaleMode = 'nearest'` — set before loading any textures for crisp pixel art
- `await app.init({...})` — async init required in v8
- `app.canvas` (not `app.view`) for the canvas element

### renderConfig.ts
Separates visual tuning from game logic. Contains per-sprite `{ offsetX, offsetY, scale }` for all tile and property types. Edit this file to adjust sprite alignment without touching the schema or renderer logic.

Keys use the sprite variant name (same as what `renderKey()` derives from the image path):
- `apartment_v1`, `apartment_v2`
- `office_v1`, `office_v2`, `office_v3`
- `home_v1`, `home_v2` (note: `home_`, not `house_` — matches image filenames)
- `tree_v1`, `tree_v2`, `tree_v3`, `tree_v4`
- `flower_patch_v1`

## Data Schema (`app/lib/all_types.tsx`)
All types and constants are exported. Import via `@/lib/all_types`.

### Tiles (`TileName`)
`pavement`, `road_one_way`, `road_two_way`, `road_intersection`, `crosswalk`, `sidewalk`, `grass`, `flower_patch`, `bush`, `tree`

- `flower_patch` — walkable, 1 variant: `flower_patch_v1_1_1.png`
- `tree` — not walkable, 4 variants: `tree_v1_1_1.png` – `tree_v4_1_1.png` (exported as `TREE_IMAGES`)
- `bush` — not walkable, no sprite asset yet

### Properties (`PropertyName`) and sizes
| Property | Size | Notes |
|---|---|---|
| `park` | 3×3 | boredom↓8, tiredness↓3 |
| `hospital` | 3×3 | tiredness↓5 |
| `school` | 3×3 | boredom↓3 |
| `grocery_store` | 3×3 | hunger↓8 |
| `fire_station` | 3×3 | no need stats (risk mitigation) |
| `police_station` | 3×3 | no need stats (risk mitigation) |
| `power_plant` | 3×3 | no need stats |
| `apartment` | 3×3 | cap 10, 2 variants (`APARTMENT_IMAGES`) |
| `office` | 3×3 | cap 30, boredom↓3, 3 variants (`OFFICE_IMAGES`) |
| `restaurant` | 2×2 | hunger↓10, boredom↓5 |
| `house` | 2×2 | cap 4, 2 variants (`HOUSE_IMAGES`) |

### Variant image arrays
- `HOUSE_IMAGES` — `home_v1_1_1.png`, `home_v2_2_2.png`
- `APARTMENT_IMAGES` — `apartment_v1_3_3.png`, `apartment_v2_3_3.png`
- `OFFICE_IMAGES` — `office_v1_3_3.png`, `office_v2_3_3.png`, `office_v3_3_3.png`
- `TREE_IMAGES` — `tree_v1_1_1.png` – `tree_v4_1_1.png`

### Important: no Math.random() at module level
`PROPERTY_DEFAULTS` and `TILE_DEFAULTS` use index `[0]` for variant properties. Random variant selection happens at construction time (in helpers like `apt()`, `office()`, `randomTreeImage()`), never at module evaluation time — doing so causes React hydration mismatches.

### People
`name`, `age_group` (adult/child), `job`, `home`, `current_location`, `current_path`, `inside_property`, needs (`hunger`/`boredom`/`tiredness`) with individual decay rates

### City
`city_grid: GridCell[][]`, `all_citizens`, `all_properties`, `day` (1–7)

## CityRenderer construction helpers
Defined at module level in `CityRenderer.tsx`, used to build `testProps: Property[]`:
- `bldg(name, x, y)` — any non-variant property
- `apt(v, x, y)` — apartment with explicit variant (1 or 2)
- `house(x, y)` — house_v2 (2×2)
- `office(v, x, y)` — office with explicit variant (1, 2, or 3)

## Key Design Notes
- Citizens have needs that decay over time; buildings satisfy those needs — the city either *works* or *fails*, not just gets built
- `fire_station` / `police_station` are risk-mitigation infrastructure (no need-decrease stats), not need-satisfiers
- `current_path: Position[]` supports pathfinding — citizens visibly walk to buildings
- `day: 1–7` implies a weekly simulation cycle
- Pathfinding (A* or similar) on the 500×500 grid is a non-trivial Stage 5 concern — plan for it early
