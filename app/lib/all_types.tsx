import {
  HUNGER_RATE_DISTRIBUTION,
  BOREDOM_RATE_DISTRIBUTION,
  TIREDNESS_RATE_DISTRIBUTION,
  weightedNormal,
} from "@/lib/sim/constants";

// ============================================================
// POSITION
// ============================================================

export type Position = {
  x: number; // 0–499
  y: number; // 0–499
};

// ============================================================
// TILE TYPES (ground layer only — stored as chars in City.tile_grid)
// ============================================================

export type TileName =
  | "pavement"
  | "road_one_way"
  | "road_two_way"
  | "road_intersection"
  | "crosswalk"
  | "sidewalk"
  | "grass";

export const TILE_META: Record<TileName, {
  can_walk_through: boolean;
  can_drive_through: boolean;
  image: string;
}> = {
  pavement:          { can_walk_through: true,  can_drive_through: false, image: "/assets/pavement_1_1.png" },
  road_one_way:      { can_walk_through: false, can_drive_through: true,  image: "/assets/road_1_1.png" },
  road_two_way:      { can_walk_through: false, can_drive_through: true,  image: "/assets/road_1_1.png" },
  road_intersection: { can_walk_through: false, can_drive_through: true,  image: "/assets/intersection_1_1.png" },
  crosswalk:         { can_walk_through: true,  can_drive_through: true,  image: "/assets/crosswalk_1_1.png" },
  sidewalk:          { can_walk_through: true,  can_drive_through: false, image: "/assets/sidewalk_1_1.png" },
  grass:             { can_walk_through: true,  can_drive_through: false, image: "/assets/grass_1_1.png" },
};

// ============================================================
// PROPERTY TYPES (buildings — live in City.all_properties)
// ============================================================

export type PropertyName =
  | "park"
  | "hospital"
  | "school"
  | "grocery_store"
  | "house"
  | "apartment"
  | "office"
  | "restaurant"
  | "fire_station"
  | "police_station"
  | "power_plant"
  | "shopping_mall"
  | "theme_park";

export type Property = {
  name: PropertyName;
  position: Position;
  width: number;
  height: number;
  is_enterable: boolean;
  current_occupants: string[];
  capacity: number;
  boredom_decrease: number;   // 0–10
  hunger_decrease: number;    // 0–10
  tiredness_decrease: number; // 0–10
  image: string;
  // Offices get a unique company name assigned at sim start; other property
  // types leave this undefined.
  company_name?: string;
};

export const HOUSE_IMAGES = [
  "/assets/home_v1_2_2.png",
  "/assets/home_v2_2_2.png",
  "/assets/home_v3_2_2.png",
  "/assets/home_v4_2_2.png",
];

export const APARTMENT_IMAGES = [
  "/assets/apartment_v1_3_3.png",
  "/assets/apartment_v2_3_3.png",
  "/assets/apartment_v3_3_3.png",
  "/assets/apartment_v4_3_3.png",
  "/assets/apartment_v5_3_3.png",
  "/assets/apartment_v6_3_3.png",
  "/assets/apartment_v7_3_3.png",
];

export const OFFICE_IMAGES = [
  "/assets/office_v1_3_3.png",
  "/assets/office_v2_3_3.png",
  "/assets/office_v3_3_3.png",
];

export const RESTAURANT_IMAGES = [
  "/assets/restaurant_v1_2_2.png",
  "/assets/restaurant_v2_2_2.png",
  "/assets/restaurant_v3_2_2.png",
];

export const TREE_IMAGES = [
  "/assets/tree_v1_1_1.png",
  "/assets/tree_v2_1_1.png",
  "/assets/tree_v3_1_1.png",
  "/assets/tree_v4_1_1.png",
];

export const FLOWER_PATCH_IMAGES = [
  "/assets/flower_patch_v1_1_1.png",
];

export const BUSH_IMAGES = [
  "/assets/bush_v1_1_1.png",
];

// ============================================================
// CITIZEN SPRITES
// `man_front` is the idle / selected pose. Each walking direction is a 6-frame
// PNG sequence (split from the original GIFs so Pixi can use them natively as
// AnimatedSprite frames or via a global frame-index lookup).
// ============================================================

export const CITIZEN_IMAGE_FRONT = "/assets/characters/man_front.png";

export const CITIZEN_FRAME_COUNT = 6;
const framesFor = (dir: string): string[] =>
  Array.from({ length: CITIZEN_FRAME_COUNT }, (_, i) =>
    `/assets/characters/man_walking_${dir}_frame_${i + 1}.png`);

export const CITIZEN_FRAMES_NE = framesFor("north_east");
export const CITIZEN_FRAMES_NW = framesFor("north_west");
export const CITIZEN_FRAMES_SE = framesFor("south_east");
export const CITIZEN_FRAMES_SW = framesFor("south_west");

export const CITIZEN_IMAGES = [
  CITIZEN_IMAGE_FRONT,
  ...CITIZEN_FRAMES_NE,
  ...CITIZEN_FRAMES_NW,
  ...CITIZEN_FRAMES_SE,
  ...CITIZEN_FRAMES_SW,
];

export const PROPERTY_DEFAULTS: Record<PropertyName, Omit<Property, "position" | "current_occupants">> = {
  park: {
    name: "park",
    width: 3,
    height: 3,
    is_enterable: true,
    capacity: 50,
    boredom_decrease: 8,
    hunger_decrease: 0,
    tiredness_decrease: 3,
    image: "/assets/park_3_3.png",
  },
  hospital: {
    name: "hospital",
    width: 3,
    height: 3,
    is_enterable: true,
    capacity: 20,
    boredom_decrease: 0,
    hunger_decrease: 0,
    tiredness_decrease: 5,
    image: "/assets/hospital_3_3.png",
  },
  school: {
    name: "school",
    width: 3,
    height: 3,
    is_enterable: true,
    capacity: 80,
    boredom_decrease: 3,
    hunger_decrease: 0,
    tiredness_decrease: 0,
    image: "/assets/school_3_3.png",
  },
  grocery_store: {
    name: "grocery_store",
    width: 3,
    height: 3,
    is_enterable: true,
    capacity: 30,
    boredom_decrease: 2,
    hunger_decrease: 8,
    tiredness_decrease: 0,
    image: "/assets/grocery_store_3_3.png",
  },
  house: {
    name: "house",
    width: 2,
    height: 2,
    is_enterable: true,
    capacity: 4,
    boredom_decrease: 2,
    hunger_decrease: 5,
    tiredness_decrease: 10,
    image: HOUSE_IMAGES[0],
  },
  apartment: {
    name: "apartment",
    width: 3,
    height: 3,
    is_enterable: true,
    capacity: 10,
    boredom_decrease: 2,
    hunger_decrease: 5,
    tiredness_decrease: 10,
    image: APARTMENT_IMAGES[0],
  },
  office: {
    name: "office",
    width: 3,
    height: 3,
    is_enterable: true,
    capacity: 30,
    boredom_decrease: 3,
    hunger_decrease: 0,
    tiredness_decrease: 0,
    image: OFFICE_IMAGES[0],
  },
  restaurant: {
    name: "restaurant",
    width: 2,
    height: 2,
    is_enterable: true,
    capacity: 30,
    boredom_decrease: 5,
    hunger_decrease: 10,
    tiredness_decrease: 0,
    image: RESTAURANT_IMAGES[0],
  },
  fire_station: {
    name: "fire_station",
    width: 3,
    height: 3,
    is_enterable: false,
    capacity: 10,
    boredom_decrease: 0,
    hunger_decrease: 0,
    tiredness_decrease: 0,
    image: "/assets/fire_station_3_3.png",
  },
  police_station: {
    name: "police_station",
    width: 3,
    height: 3,
    is_enterable: false,
    capacity: 10,
    boredom_decrease: 0,
    hunger_decrease: 0,
    tiredness_decrease: 0,
    image: "/assets/police_station_3_3.png",
  },
  power_plant: {
    name: "power_plant",
    width: 3,
    height: 3,
    is_enterable: false,
    capacity: 5,
    boredom_decrease: 0,
    hunger_decrease: 0,
    tiredness_decrease: 0,
    image: "/assets/powerplant_3_3.png",
  },
  shopping_mall: {
    name: "shopping_mall",
    width: 3,
    height: 3,
    is_enterable: true,
    capacity: 40,
    boredom_decrease: 6,
    hunger_decrease: 6,
    tiredness_decrease: 0,
    image: "/assets/shopping_mall_3_3.png",
  },
  theme_park: {
    name: "theme_park",
    width: 3,
    height: 3,
    is_enterable: true,
    capacity: 60,
    boredom_decrease: 10,
    hunger_decrease: 2,
    tiredness_decrease: 0,
    image: "/assets/theme_park_3_3.png",
  },
};

// ============================================================
// NATURE TYPES (trees / flowers / bushes — live in City.all_nature)
// ============================================================

export type NatureName = "tree" | "flower_patch" | "bush";

export type Nature = {
  name: NatureName;
  position: Position;
  image: string;
};

// ============================================================
// TILE CODES (single-char codes — LLM-facing + grid storage)
// ============================================================

export const TILE_CODES = {
  grass: ".",
  pavement: ",",
  road_one_way: "-",
  road_two_way: "=",
  road_intersection: "+",
  crosswalk: "x",
  sidewalk: "_",
} as const satisfies Record<TileName, string>;

export const NATURE_CODES = {
  tree: "t",
  flower_patch: "f",
  bush: "b",
} as const satisfies Record<NatureName, string>;

export const PROPERTY_CODES = {
  house: "D",
  apartment: "A",
  office: "O",
  restaurant: "R",
  park: "P",
  school: "S",
  grocery_store: "G",
  hospital: "H",
  fire_station: "F",
  police_station: "C",
  power_plant: "E",
  shopping_mall: "M",
  theme_park: "Z",
} as const satisfies Record<PropertyName, string>;

export type TileCode =
  | typeof TILE_CODES[keyof typeof TILE_CODES]
  | typeof NATURE_CODES[keyof typeof NATURE_CODES]
  | typeof PROPERTY_CODES[keyof typeof PROPERTY_CODES];

export const CODE_TO_TILE: Record<string, TileName> = Object.fromEntries(
  Object.entries(TILE_CODES).map(([name, code]) => [code, name as TileName])
);
export const CODE_TO_NATURE: Record<string, NatureName> = Object.fromEntries(
  Object.entries(NATURE_CODES).map(([name, code]) => [code, name as NatureName])
);
export const CODE_TO_PROPERTY: Record<string, PropertyName> = Object.fromEntries(
  Object.entries(PROPERTY_CODES).map(([name, code]) => [code, name as PropertyName])
);

// ============================================================
// PEOPLE TYPES
// ============================================================

export type AgeGroup = "adult" | "child";

// Every adult is an engineer; the value of `Person.job` is the company name
// (matching one of the offices' `company_name`). Children get `null`.
// Display convention: "Engineer @ {job}".
export type Job = string | null;

// A trip the citizen took (or attempted) during the simulation. Used by the
// chat endpoint to give Claude grounded context about each citizen's actual
// experience of the city: where they went, how far, how long.
//
// Trips with `arrived_tick === undefined` are in-progress OR were abandoned
// (citizen rerouted before reaching the destination, e.g. capacity full).
// Walkability heuristics filter to `arrived_tick !== undefined`.
export type Trip = {
  destination_name: PropertyName;
  destination_company?: string; // for offices
  start_tick: number;
  // Number of grid cells the citizen needs to walk from where they decided to
  // the destination's entry tile. Equals trip duration in ticks since
  // citizens advance one cell per tick.
  distance_tiles: number;
  arrived_tick?: number;
};

export type Person = {
  name: string;
  age_group: AgeGroup;
  job: Job;
  home: Property;
  current_location: Position;
  // Where the citizen was at the start of the current sim tick. Used by the
  // renderer to lerp screen position smoothly between cells while still
  // advancing the logical grid position one cell per tick.
  prev_location?: Position;
  // While selected by the user, the citizen freezes at the fractional
  // (mid-lerp) position they were at when clicked, instead of snapping to
  // current_location. Set in the Pixi click handler, cleared on deselect.
  // Logical state (current_location, current_path) is unaffected.
  visual_position?: Position;
  current_path: Position[];
  inside_property: Property | null;
  // Where the citizen is currently heading (set by assignDestination, cleared
  // on entry / leave). Used to detect arrival at an entry tile.
  current_destination?: Property;
  // Ticks remaining in the citizen's current property visit. Set on entry,
  // counted down each tick while inside, triggers leave when ≤ 0.
  stay_ticks_remaining?: number;
  hunger: number;           // 1–10
  boredom: number;          // 1–10
  tiredness: number;        // 1–10
  hunger_rate: number;      // ~0.09–0.28 per tick (per hour); see HUNGER_RATE_DISTRIBUTION
  boredom_rate: number;     // ~0.06–0.25 per tick (per hour); see BOREDOM_RATE_DISTRIBUTION
  tiredness_rate: number;   // ~0.06–0.25 per tick (per hour); see TIREDNESS_RATE_DISTRIBUTION
  image: string;
  // Append-only trip log used by the chat endpoint. Pushed on assignDestination
  // success; arrived_tick stamped on entry. Initialized to [] at spawn.
  trips: Trip[];
};

export const randomBetween = (min: number, max: number): number =>
  Math.random() * (max - min) + min;

const FIRST_NAMES = [
  "Alex", "Sam", "Jordan", "Casey", "Riley", "Morgan", "Taylor", "Jamie",
  "Dana", "Pat", "Robin", "Drew", "Quinn", "Avery", "Reese", "Sage",
  "Maya", "Owen", "Iris", "Leo", "Nora", "Kai", "Ezra", "Luna",
  "Hugo", "Vera", "Theo", "Elena", "Felix", "Naomi", "Kira", "Otto",
];

const LAST_NAMES = [
  "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis",
  "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson", "Thomas",
  "Patel", "Nguyen", "Kim", "Chen", "Singh", "Khan", "Cohen", "Reyes",
];

const generateRandomName = (): string =>
  `${FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)]} ${LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)]}`;

export const spawnPerson = (
  age_group: AgeGroup,
  home: Property,
  availableImages: string[],
  job: Job = null,
): Person => ({
  name: generateRandomName(),
  age_group,
  job,
  home,
  current_location: home.position,
  current_path: [],
  inside_property: home,
  hunger: randomBetween(1.0, 4.0),
  boredom: randomBetween(1.0, 4.0),
  tiredness: randomBetween(1.0, 4.0),
  hunger_rate: weightedNormal(HUNGER_RATE_DISTRIBUTION),
  boredom_rate: weightedNormal(BOREDOM_RATE_DISTRIBUTION),
  tiredness_rate: weightedNormal(TIREDNESS_RATE_DISTRIBUTION),
  image: availableImages[Math.floor(Math.random() * availableImages.length)],
  trips: [],
});

// ============================================================
// CITY TYPE
// ============================================================

export type City = {
  tile_grid: TileCode[][];       // ground layer; every cell defaults to grass
  all_properties: Property[];    // buildings (anchor + variant + occupants)
  all_nature: Nature[];          // trees / flowers / bushes
  all_citizens: Person[];
  day: number;                   // 1–7
};

// ============================================================
// CITY INITIALIZATION
// ============================================================

export const initCity = (size: number = 500): City => ({
  tile_grid: Array.from({ length: size }, () =>
    Array.from({ length: size }, (): TileCode => TILE_CODES.grass)
  ),
  all_properties: [],
  all_nature: [],
  all_citizens: [],
  day: 1,
});

// ============================================================
// GRID HELPERS
// ============================================================

export const placeTile = (city: City, x: number, y: number, name: TileName): void => {
  city.tile_grid[y][x] = TILE_CODES[name];
};

export const placeTileRect = (
  city: City,
  x1: number, y1: number,
  x2: number, y2: number,
  name: TileName,
): void => {
  const xLo = Math.min(x1, x2), xHi = Math.max(x1, x2);
  const yLo = Math.min(y1, y2), yHi = Math.max(y1, y2);
  const gridH = city.tile_grid.length;
  const gridW = city.tile_grid[0]?.length ?? 0;
  if (xLo < 0 || yLo < 0 || xHi >= gridW || yHi >= gridH) {
    throw new Error(
      `placeTileRect: '${name}' rect (${xLo},${yLo})-(${xHi},${yHi}) extends out of bounds (grid ${gridW}x${gridH})`
    );
  }
  for (let y = yLo; y <= yHi; y++) {
    for (let x = xLo; x <= xHi; x++) {
      city.tile_grid[y][x] = TILE_CODES[name];
    }
  }
};

export const placeProperty = (city: City, property: Property): void => {
  const gridH = city.tile_grid.length;
  const gridW = city.tile_grid[0]?.length ?? 0;
  const { x: px, y: py } = property.position;
  const { width: pw, height: ph, name } = property;

  if (px < 0 || py < 0 || px + pw > gridW || py + ph > gridH) {
    throw new Error(
      `placeProperty: '${name}' at (${px},${py}) ${pw}x${ph} extends out of bounds (grid ${gridW}x${gridH})`
    );
  }

  for (const p of city.all_properties) {
    const overlaps =
      px < p.position.x + p.width &&
      px + pw > p.position.x &&
      py < p.position.y + p.height &&
      py + ph > p.position.y;
    if (overlaps) {
      throw new Error(
        `placeProperty: '${name}' at (${px},${py}) ${pw}x${ph} overlaps existing '${p.name}' at (${p.position.x},${p.position.y}) ${p.width}x${p.height}`
      );
    }
  }

  city.all_properties.push(property);
};

export const placeNature = (city: City, nature: Nature): void => {
  city.all_nature.push(nature);
};

// Remove the property whose footprint covers `position` (any cell, not just anchor).
// Returns the removed property, or undefined if none matched.
export const deletePropertyAt = (city: City, position: Position): Property | undefined => {
  const idx = city.all_properties.findIndex(p =>
    position.x >= p.position.x && position.x < p.position.x + p.width &&
    position.y >= p.position.y && position.y < p.position.y + p.height
  );
  if (idx === -1) return undefined;
  const [removed] = city.all_properties.splice(idx, 1);
  return removed;
};

// Remove the nature item at exactly `position` (1x1). Returns it if found.
export const deleteNatureAt = (city: City, position: Position): Nature | undefined => {
  const idx = city.all_nature.findIndex(n =>
    n.position.x === position.x && n.position.y === position.y
  );
  if (idx === -1) return undefined;
  const [removed] = city.all_nature.splice(idx, 1);
  return removed;
};

export const getTileAt = (city: City, position: Position): TileName => {
  return CODE_TO_TILE[city.tile_grid[position.y][position.x]];
};

export const getPropertyAt = (city: City, position: Position): Property | undefined => {
  return city.all_properties.find(p =>
    position.x >= p.position.x && position.x < p.position.x + p.width &&
    position.y >= p.position.y && position.y < p.position.y + p.height
  );
};

// ============================================================
// LLM VIEW — single char per cell, readable ASCII map
// ============================================================

export const ASCII_LEGEND = `Legend:
  Ground:      . grass   , pavement   - road_one_way   = road_two_way   + intersection   x crosswalk   _ sidewalk
  Nature:      t tree    f flower_patch   b bush
  Buildings (uppercase):
    D house (2x2)          A apartment (3x3)      O office (3x3)
    R restaurant (2x2)     P park (3x3)           S school (3x3)
    G grocery_store (3x3)  H hospital (3x3)       F fire_station (3x3)
    C police_station (3x3) E power_plant (3x3)    M shopping_mall (3x3)
    Z theme_park (3x3)`;

export function cityToAscii(city: City): { grid: string; legend: string } {
  const rows: string[][] = city.tile_grid.map(r => [...r]);
  for (const n of city.all_nature) {
    if (rows[n.position.y] && rows[n.position.y][n.position.x] !== undefined) {
      rows[n.position.y][n.position.x] = NATURE_CODES[n.name];
    }
  }
  for (const p of city.all_properties) {
    for (let dy = 0; dy < p.height; dy++) {
      for (let dx = 0; dx < p.width; dx++) {
        const y = p.position.y + dy;
        const x = p.position.x + dx;
        if (rows[y] && rows[y][x] !== undefined) {
          rows[y][x] = PROPERTY_CODES[p.name];
        }
      }
    }
  }
  return {
    grid: rows.map(r => r.join("")).join("\n"),
    legend: ASCII_LEGEND,
  };
}

// ============================================================
// LLM VIEW (inverse) — parse ASCII grid back into a City
// ============================================================

export type AsciiToCityOptions = {
  // How to pick images for nature/property variants (ASCII loses variant info).
  // 'default' → always use PROPERTY_DEFAULTS[name].image and *_IMAGES[0] for nature (deterministic, SSR-safe)
  // 'random'  → pick a random variant (client-only; do NOT call at module load)
  variantStrategy?: "default" | "random";
};

function pickNatureImage(name: NatureName, strategy: "default" | "random"): string {
  const arr =
    name === "tree" ? TREE_IMAGES :
    name === "flower_patch" ? FLOWER_PATCH_IMAGES :
    BUSH_IMAGES;
  return strategy === "random" ? arr[Math.floor(Math.random() * arr.length)] : arr[0];
}

function pickPropertyImage(name: PropertyName, strategy: "default" | "random"): string {
  if (strategy !== "random") return PROPERTY_DEFAULTS[name].image;
  const arr =
    name === "house" ? HOUSE_IMAGES :
    name === "apartment" ? APARTMENT_IMAGES :
    name === "office" ? OFFICE_IMAGES :
    name === "restaurant" ? RESTAURANT_IMAGES :
    null;
  return arr ? arr[Math.floor(Math.random() * arr.length)] : PROPERTY_DEFAULTS[name].image;
}

export function asciiToCity(ascii: string, opts?: AsciiToCityOptions): City {
  const strategy = opts?.variantStrategy ?? "default";

  const raw = ascii.split("\n");
  const rows = raw.length > 0 && raw[raw.length - 1] === "" ? raw.slice(0, -1) : raw;
  if (rows.length === 0) throw new Error("asciiToCity: empty input");
  const width = rows[0].length;
  for (let y = 0; y < rows.length; y++) {
    if (rows[y].length !== width) {
      throw new Error(`asciiToCity: ragged row at y=${y} (len ${rows[y].length} vs expected ${width})`);
    }
  }
  const height = rows.length;

  const city = initCity(Math.max(width, height));
  const visited: boolean[][] = Array.from({ length: height }, () => new Array(width).fill(false));

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (visited[y][x]) continue;
      const ch = rows[y][x];

      if (ch in CODE_TO_TILE) {
        placeTile(city, x, y, CODE_TO_TILE[ch]);
        visited[y][x] = true;
      } else if (ch in CODE_TO_NATURE) {
        const name = CODE_TO_NATURE[ch];
        placeNature(city, { name, position: { x, y }, image: pickNatureImage(name, strategy) });
        visited[y][x] = true;
      } else if (ch in CODE_TO_PROPERTY) {
        const name = CODE_TO_PROPERTY[ch];
        const { width: pw, height: ph } = PROPERTY_DEFAULTS[name];
        for (let dy = 0; dy < ph; dy++) {
          for (let dx = 0; dx < pw; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (yy >= height || xx >= width) {
              throw new Error(`asciiToCity: '${ch}' at (${x},${y}) expects ${pw}x${ph} footprint but extends past grid at (${xx},${yy})`);
            }
            if (rows[yy][xx] !== ch) {
              throw new Error(`asciiToCity: '${ch}' at (${x},${y}) expects ${pw}x${ph} footprint of '${ch}' but (${xx},${yy}) is '${rows[yy][xx]}'`);
            }
            if (visited[yy][xx]) {
              throw new Error(`asciiToCity: '${ch}' at (${x},${y}) overlaps previously-consumed cell (${xx},${yy})`);
            }
          }
        }
        placeProperty(city, {
          ...PROPERTY_DEFAULTS[name],
          image: pickPropertyImage(name, strategy),
          position: { x, y },
          current_occupants: [],
        });
        for (let dy = 0; dy < ph; dy++) {
          for (let dx = 0; dx < pw; dx++) {
            visited[y + dy][x + dx] = true;
          }
        }
      } else {
        throw new Error(`asciiToCity: unknown char '${ch}' at (${x},${y})`);
      }
    }
  }

  return city;
}
