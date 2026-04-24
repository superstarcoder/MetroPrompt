# MetroPrompt — Agentic City Builder

## Project Overview
A pixel-art agentic city builder for a hackathon. The user prompts a Mayor agent, which orchestrates Zone and Infrastructure agents to build and govern a living city. After 7 simulated days, citizens provide feedback and the Mayor generates a formal report.

## Hackathon Context
- **Prompt theme:** "Build For What's Next" — interfaces without a name, workflows from a few years out
- **Timeline:** 4 days of hacking (started ~2026-04-22)

## Tech Stack
- **Framework:** Next.js 16 (App Router) — full-stack, API routes for Claude SDK backend. **Breaking changes vs training data** — see `app/AGENTS.md`; consult `node_modules/next/dist/docs/` before writing Next.js code.
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
    AGENTS.md            — Next.js 16 warning (breaking changes)
    app/
      page.tsx           — server component entry point (no 'use client')
      layout.tsx
      globals.css
    components/
      CityRendererWrapper.tsx — client component that owns the ssr:false dynamic import
      CityRenderer.tsx        — Pixi.js renderer ('use client', tiles + nature + properties + pan/zoom + grid)
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
- **Infrastructure agents** — lay ground tiles (roads, sidewalks, crosswalks) via `place_tile(name, x, y)`
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

### Test scene layout (`CityRenderer.tsx`)
- `GRID_SIZE = 50` (50×50 demo grid; real `City` schema uses 500×500)
- 4×4 block layout separated by 2-tile roads + 1-tile sidewalks
- Road columns: x = 12–13, 26–27, 40–41
- Road rows: y = 12–13, 26–27, 40–41
- Sidewalk columns/rows: 11, 14, 25, 28, 39, 42
- `testProps` hand-places a mix of residential/commercial/civic buildings across the 16 blocks

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
`PROPERTY_DEFAULTS` uses index `[0]` for variant buildings. Random variant selection happens at construction time (in helpers like `apt()`, `office()`, and the nature-spawn loop inside `init()`), never at module evaluation time — doing so causes React hydration mismatches.

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
- `initCity(size = 500)` — all-grass grid, empty lists. `size` is parameterized so the renderer's test scene can use 50×50.
- `placeTile(city, x, y, name: TileName)` — sets `tile_grid[y][x] = TILE_CODES[name]`.
- `placeProperty(city, property)` — pushes to `all_properties`. Does **not** touch `tile_grid`; buildings sit on grass by convention.
- `placeNature(city, nature)` — pushes to `all_nature`. Does not touch `tile_grid`.
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

### LLM-facing view: `cityToAscii(city)`
Returns `{ grid: string; legend: string }`. `grid` overlays nature and properties onto a copy of `tile_grid` (properties stamp their char across their whole footprint so the LLM sees size/shape), joined with newlines. `legend` is the static `ASCII_LEGEND` string listing every code. Caller is responsible for deciding how to ship this to the agent (raw grid at 50×50 is ~2.5k chars and fits easily; at 500×500 it's 250k and needs a viewport or block-level summary instead).

## CityRenderer construction helpers
Defined at module level in `CityRenderer.tsx`, used to build `testProps: Property[]`:
- `bldg(name, x, y)` — any non-variant property (or variant using its default image)
- `apt(v, x, y)` — apartment with explicit variant (1 or 2)
- `house(x, y)` — house using `HOUSE_IMAGES[1]` (`home_v2`, 2×2)
- `office(v, x, y)` — office with explicit variant (1, 2, or 3)

## Key Design Notes
- Citizens have needs that decay over time; buildings satisfy those needs — the city either *works* or *fails*, not just gets built
- `fire_station` / `police_station` / `power_plant` are not enterable and have no need-decrease stats (risk/utility infrastructure)
- `current_path: Position[]` supports pathfinding — citizens visibly walk to buildings
- `day: 1–7` implies a weekly simulation cycle
- Pathfinding (A* or similar) on the 500×500 grid is a non-trivial Stage 5 concern — plan for it early
