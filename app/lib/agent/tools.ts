import {
  PROPERTY_DEFAULTS,
  TILE_META,
  TREE_IMAGES,
  FLOWER_PATCH_IMAGES,
  BUSH_IMAGES,
  placeProperty,
  placeTileRect,
  placeNature,
  getPropertyAt,
  getTileAt,
} from '../all_types';
import type { City, NatureName, PropertyName, TileName } from '../all_types';

const NATURE_NAMES: NatureName[] = ['tree', 'flower_patch', 'bush'];

function defaultNatureImage(name: NatureName): string {
  if (name === 'tree') return TREE_IMAGES[0];
  if (name === 'flower_patch') return FLOWER_PATCH_IMAGES[0];
  return BUSH_IMAGES[0];
}

// ============================================================
// TOOL CALL SHAPES
// ============================================================
// Mirrors Anthropic tool_use block shape: { name, input }.
// LLM never sees the City object — it sees an observation string and
// emits these, which we dispatch into city-mutating handlers.

export type ToolCall =
  | { name: 'place_property'; input: { property: PropertyName; x: number; y: number } }
  | { name: 'place_tile_rect'; input: { tile: TileName; x1: number; y1: number; x2: number; y2: number } }
  | { name: 'place_nature'; input: { nature: NatureName; x: number; y: number } }
  | { name: 'finish'; input: { reason: string } };

export type ToolResult =
  | { ok: true; done?: boolean }
  | { ok: false; error: string };

// ============================================================
// HANDLERS
// ============================================================

function handlePlaceProperty(
  city: City,
  args: { property: PropertyName; x: number; y: number },
): ToolResult {
  const def = PROPERTY_DEFAULTS[args.property];
  if (!def) {
    return {
      ok: false,
      error: `place_property: unknown property '${args.property}'. Valid: ${Object.keys(PROPERTY_DEFAULTS).join(', ')}`,
    };
  }
  // Reject if any cell in the footprint is not grass — buildings can't sit on
  // roads, sidewalks, crosswalks, intersections, or pavement.
  const h = city.tile_grid.length;
  const w = city.tile_grid[0]?.length ?? 0;
  for (let dy = 0; dy < def.height; dy++) {
    for (let dx = 0; dx < def.width; dx++) {
      const x = args.x + dx;
      const y = args.y + dy;
      if (x < 0 || y < 0 || x >= w || y >= h) continue; // OOB handled by placeProperty
      const tile = getTileAt(city, { x, y });
      if (tile !== 'grass') {
        return {
          ok: false,
          error: `place_property: '${args.property}' footprint cell (${x},${y}) is '${tile}', buildings can only sit on grass`,
        };
      }
    }
  }
  try {
    placeProperty(city, {
      ...def,
      position: { x: args.x, y: args.y },
      current_occupants: [],
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function handlePlaceTileRect(
  city: City,
  args: { tile: TileName; x1: number; y1: number; x2: number; y2: number },
): ToolResult {
  if (!TILE_META[args.tile]) {
    return {
      ok: false,
      error: `place_tile_rect: unknown tile '${args.tile}'. Valid: ${Object.keys(TILE_META).join(', ')}`,
    };
  }
  try {
    placeTileRect(city, args.x1, args.y1, args.x2, args.y2, args.tile);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function handlePlaceNature(
  city: City,
  args: { nature: NatureName; x: number; y: number },
): ToolResult {
  if (!NATURE_NAMES.includes(args.nature)) {
    return {
      ok: false,
      error: `place_nature: unknown nature '${args.nature}'. Valid: ${NATURE_NAMES.join(', ')}`,
    };
  }
  const h = city.tile_grid.length;
  const w = city.tile_grid[0]?.length ?? 0;
  if (args.x < 0 || args.y < 0 || args.x >= w || args.y >= h) {
    return {
      ok: false,
      error: `place_nature: (${args.x},${args.y}) is out of bounds (grid ${w}x${h})`,
    };
  }
  const blocking = getPropertyAt(city, { x: args.x, y: args.y });
  if (blocking) {
    return {
      ok: false,
      error: `place_nature: (${args.x},${args.y}) is occupied by '${blocking.name}' at (${blocking.position.x},${blocking.position.y})`,
    };
  }
  const tile = getTileAt(city, { x: args.x, y: args.y });
  if (tile !== 'grass') {
    return {
      ok: false,
      error: `place_nature: ${args.nature} can only grow on grass; (${args.x},${args.y}) is '${tile}'`,
    };
  }
  placeNature(city, {
    name: args.nature,
    position: { x: args.x, y: args.y },
    image: defaultNatureImage(args.nature),
  });
  return { ok: true };
}

function handleFinish(_city: City, _args: { reason: string }): ToolResult {
  return { ok: true, done: true };
}

// ============================================================
// DISPATCHER
// ============================================================

export function applyToolCall(city: City, call: ToolCall): ToolResult {
  switch (call.name) {
    case 'place_property':  return handlePlaceProperty(city, call.input);
    case 'place_tile_rect': return handlePlaceTileRect(city, call.input);
    case 'place_nature':    return handlePlaceNature(city, call.input);
    case 'finish':          return handleFinish(city, call.input);
  }
}

// Convenience: apply a batch, collect per-call results. Does NOT short-circuit
// on error — the Mayor should see every failure in the next observation.
export function applyBatch(
  city: City,
  calls: ToolCall[],
): Array<{ call: ToolCall; result: ToolResult }> {
  return calls.map(call => ({ call, result: applyToolCall(city, call) }));
}

// ============================================================
// TOOL SCHEMAS (Anthropic SDK shape)
// ============================================================

type ToolSchema = {
  name:
    | 'place_property'
    | 'place_properties'
    | 'place_tile_rect'
    | 'place_tile_rects'
    | 'place_nature'
    | 'place_natures'
    | 'delegate_zones'
    | 'finish';
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
  };
};

export const TOOL_SCHEMAS: ToolSchema[] = [
  {
    name: 'place_property',
    description:
      'Place a SINGLE building anchored at (x, y). For two or more buildings in the same turn, prefer place_properties (the batch variant) — fewer turns, less overhead. ' +
      'Footprint extends down-right from the anchor. ' +
      '3x3 buildings: park, hospital, school, grocery_store, apartment, office, fire_station, police_station, power_plant, shopping_mall, theme_park. ' +
      '2x2 buildings: house, restaurant. ' +
      'Footprints must fit in-bounds, must not overlap any existing building, and EVERY cell of the footprint must be grass (not road, sidewalk, crosswalk, intersection, or pavement).',
    input_schema: {
      type: 'object',
      properties: {
        property: { type: 'string', enum: Object.keys(PROPERTY_DEFAULTS) },
        x: { type: 'integer', minimum: 0 },
        y: { type: 'integer', minimum: 0 },
      },
      required: ['property', 'x', 'y'],
    },
  },
  {
    name: 'place_properties',
    description:
      'Place MANY buildings in one tool call. PREFERRED when placing more than one building — collapses N place_property calls into one, saving turns. ' +
      'Each item is validated independently against the current city state; partial success is reported back as text — successful items are placed, failed items are listed by index with their error so you can retry just those. Same rules as place_property: in-bounds, no overlap with existing buildings, footprint must be entirely on grass.',
    input_schema: {
      type: 'object',
      properties: {
        properties: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              property: { type: 'string', enum: Object.keys(PROPERTY_DEFAULTS) },
              x: { type: 'integer', minimum: 0 },
              y: { type: 'integer', minimum: 0 },
            },
            required: ['property', 'x', 'y'],
          },
        },
      },
      required: ['properties'],
    },
  },
  {
    name: 'place_tile_rect',
    description:
      'Fill a SINGLE axis-aligned rectangle of ground tiles (corners inclusive). For multiple rectangles in the same turn, prefer place_tile_rects. ' +
      'Use for roads, sidewalks, pavement, crosswalks. Later calls overwrite earlier ones. ' +
      'A single cell is x1=x2, y1=y2.',
    input_schema: {
      type: 'object',
      properties: {
        tile: { type: 'string', enum: Object.keys(TILE_META) },
        x1: { type: 'integer', minimum: 0 },
        y1: { type: 'integer', minimum: 0 },
        x2: { type: 'integer', minimum: 0 },
        y2: { type: 'integer', minimum: 0 },
      },
      required: ['tile', 'x1', 'y1', 'x2', 'y2'],
    },
  },
  {
    name: 'place_tile_rects',
    description:
      'Fill MANY tile rectangles in one tool call. PREFERRED when laying a road grid or any multi-band tile pattern — collapses N place_tile_rect calls into one. ' +
      'Each rect is validated independently; partial success is reported by index. Rects in the array are applied left-to-right, so later rects can overwrite earlier ones.',
    input_schema: {
      type: 'object',
      properties: {
        rects: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              tile: { type: 'string', enum: Object.keys(TILE_META) },
              x1: { type: 'integer', minimum: 0 },
              y1: { type: 'integer', minimum: 0 },
              x2: { type: 'integer', minimum: 0 },
              y2: { type: 'integer', minimum: 0 },
            },
            required: ['tile', 'x1', 'y1', 'x2', 'y2'],
          },
        },
      },
      required: ['rects'],
    },
  },
  {
    name: 'place_nature',
    description:
      'Place a SINGLE 1x1 nature decoration (tree, flower_patch, or bush) at (x, y). For two or more in the same turn, prefer place_natures. ' +
      'Nature is purely decorative — it sits on top of the ground tile but cannot be placed where a building footprint already exists. ' +
      'ALL nature (tree / flower_patch / bush) can only be placed on grass tiles — placing on a road, sidewalk, crosswalk, intersection, or pavement is rejected. ' +
      'Use it to soften zones, line streets with trees, fill awkward gaps, and add greenery around parks/houses.',
    input_schema: {
      type: 'object',
      properties: {
        nature: { type: 'string', enum: NATURE_NAMES },
        x: { type: 'integer', minimum: 0 },
        y: { type: 'integer', minimum: 0 },
      },
      required: ['nature', 'x', 'y'],
    },
  },
  {
    name: 'place_natures',
    description:
      'Place MANY nature decorations (trees / flower_patches / bushes) in one tool call. PREFERRED when scattering greenery — collapses N place_nature calls into one. ' +
      'Each item is validated independently against the current city; partial success is reported back as text. ' +
      'Cells covered by an existing building are rejected per-item. ALL nature (tree / flower_patch / bush) must sit on grass — placing on roads, sidewalks, crosswalks, intersections, or pavement will fail. Restrict to grass cells.',
    input_schema: {
      type: 'object',
      properties: {
        natures: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              nature: { type: 'string', enum: NATURE_NAMES },
              x: { type: 'integer', minimum: 0 },
              y: { type: 'integer', minimum: 0 },
            },
            required: ['nature', 'x', 'y'],
          },
        },
      },
      required: ['natures'],
    },
  },
  {
    name: 'delegate_zones',
    description:
      'Hand off multiple regions of the grid to Zone sub-agents that each fill in one bbox. ' +
      'Use this for WHOLE-CITY builds after you have laid the road + sidewalk grid: partition the grid into 4-8 non-overlapping zones ' +
      'along the road grid, and call delegate_zones once with the full list. Each zone runs in parallel with its own tool budget, ' +
      'sees the current map, and places buildings only inside its bbox. Give each zone a distinct character via the instructions ' +
      '("dense residential + a small park", "civic center with hospital and school", etc.). ' +
      'Validation: bboxes must fit in-grid (0-49 on each axis), must not intersect each other, and must not intersect zones from prior delegate_zones calls in this session. ' +
      'For small edits or partial builds, skip this tool and place directly with place_property / place_properties.',
    input_schema: {
      type: 'object',
      properties: {
        zones: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              bbox: {
                type: 'object',
                properties: {
                  x1: { type: 'integer', minimum: 0 },
                  y1: { type: 'integer', minimum: 0 },
                  x2: { type: 'integer', minimum: 0 },
                  y2: { type: 'integer', minimum: 0 },
                },
                required: ['x1', 'y1', 'x2', 'y2'],
              },
              instructions: {
                type: 'string',
                minLength: 1,
              },
            },
            required: ['bbox', 'instructions'],
          },
        },
      },
      required: ['zones'],
    },
  },
  {
    name: 'finish',
    description: 'Signal the city is complete. Include a one-sentence rationale.',
    input_schema: {
      type: 'object',
      properties: { reason: { type: 'string' } },
      required: ['reason'],
    },
  },
];

// Zone agents get placement tools + finish only. Delegate_zones is Mayor-only
// (no recursive sub-delegation — keeps the system bounded).
export const ZONE_TOOL_SCHEMAS: ToolSchema[] = TOOL_SCHEMAS.filter(
  s => s.name !== 'delegate_zones',
);
