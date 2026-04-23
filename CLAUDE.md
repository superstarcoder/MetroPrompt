# MetroPrompt — Agentic City Builder

## Project Overview
A pixel-art agentic city builder for a hackathon. The user prompts a Mayor agent, which orchestrates Zone and Infrastructure agents to build and govern a living city. After 7 simulated days, citizens provide feedback and the Mayor generates a formal report.

## Hackathon Context
- **Prompt theme:** "Build For What's Next" — interfaces without a name, workflows from a few years out
- **Timeline:** 4 days of hacking (started ~2026-04-22)

## Tech Stack
- **Framework:** Next.js (App Router) — full-stack, API routes for Claude SDK backend
- **Rendering:** Pixi.js (vanilla, inside `useEffect`) — WebGL, pixel-art nearest-neighbor scaling, handles many moving citizens
- **State:** Zustand — lightweight game-like mutable state, readable by Pixi render loop
- **Streaming:** Server-Sent Events (SSE) — streams agent actions to frontend in real time
- **Agents:** Anthropic SDK multi-agent via tool calls
- **Pixel art:** PixelLab (AI-assisted generation)

## Agent Architecture
- **Mayor agent** — high-level city goals, population targets, happiness metrics, reacts to simulation feedback
- **Zone agents** — place `Property` objects (residential, commercial, civic)
- **Infrastructure agents** — lay `Tile` objects (roads, sidewalks, crosswalks)
- Agents communicate exclusively via **tool calls** (e.g. `place_property(name, x, y)`, `place_tile(name, x, y)`, `spawn_citizen(home_property_id)`)

## Build Stages
1. **Data schema** ✅ — `all_types.tsx`
2. **Pixel art + rendering system** — sprites for all tiles/properties/people, Pixi.js grid renderer
3. **Mayor + Zone + Infrastructure agents + orchestration** — headless; outputs final `City` state
4. **Connect backend to frontend** — SSE streaming so the city is built live on screen
5. **7-day citizen simulation + feedback loop** — needs decay, pathfinding, citizens generate feedback → Mayor report

## Data Schema Summary (`all_types.tsx`)
- **Grid:** 500×500, initialized to grass tiles
- **Tiles:** `pavement`, `road_one_way`, `road_two_way`, `road_intersection`, `crosswalk`, `sidewalk`, `grass`
- **Properties:** `park`, `hospital`, `school`, `grocery_store`, `house`, `apartment`, `restaurant`, `fire_station`, `police_station`, `power_plant` — each has `capacity`, `boredom_decrease`, `hunger_decrease`, `tiredness_decrease`
- **People:** `name`, `age_group` (adult/child), `job`, `home`, `current_location`, `current_path`, `inside_property`, needs (`hunger`/`boredom`/`tiredness`) with individual decay rates
- **City:** `city_grid: GridCell[][]`, `all_citizens`, `all_properties`, `day` (1–7)

## Key Design Notes
- Citizens have needs that decay over time; buildings satisfy those needs — the city either *works* or *fails*, not just gets built
- `fire_station` / `police_station` are risk-mitigation infrastructure (no need-decrease stats), not need-satisfiers
- `current_path: Position[]` supports pathfinding — citizens visibly walk to buildings
- `day: 1–7` implies a weekly simulation cycle
- Pathfinding (A* or similar) on the 500×500 grid is a non-trivial Stage 5 concern — plan for it early
