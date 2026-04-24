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
};

export const HOUSE_IMAGES = [
  "/assets/home_v1_2_2.png",
  "/assets/home_v2_2_2.png",
];

export const APARTMENT_IMAGES = [
  "/assets/apartment_v1_3_3.png",
  "/assets/apartment_v2_3_3.png",
];

export const OFFICE_IMAGES = [
  "/assets/office_v1_3_3.png",
  "/assets/office_v2_3_3.png",
  "/assets/office_v3_3_3.png",
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
    image: "/assets/restaurant_2_2.png",
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

export type Job =
  | "teacher"
  | "doctor"
  | "firefighter"
  | "police_officer"
  | "chef"
  | "grocer"
  | "engineer"
  | "unemployed"
  | null; // null for children

export type Person = {
  name: string;
  age_group: AgeGroup;
  job: Job;
  home: Property;
  current_location: Position;
  current_path: Position[];
  inside_property: Property | null;
  hunger: number;           // 1–10
  boredom: number;          // 1–10
  tiredness: number;        // 1–10
  hunger_rate: number;      // 1.5–4.5 per day
  boredom_rate: number;     // 1.0–4.0 per day
  tiredness_rate: number;   // 1.0–4.0 per day
  image: string;
};

export const JOB_OPTIONS: Exclude<Job, null>[] = [
  "teacher",
  "doctor",
  "firefighter",
  "police_officer",
  "chef",
  "grocer",
  "engineer",
  "unemployed",
];

export const randomBetween = (min: number, max: number): number =>
  Math.random() * (max - min) + min;

declare function generateRandomName(): string;

export const spawnPerson = (
  age_group: AgeGroup,
  home: Property,
  availableImages: string[]
): Person => ({
  name: generateRandomName(),
  age_group,
  job: age_group === "adult"
    ? JOB_OPTIONS[Math.floor(Math.random() * JOB_OPTIONS.length)]
    : null,
  home,
  current_location: home.position,
  current_path: [],
  inside_property: home,
  hunger: randomBetween(1.0, 4.0),
  boredom: randomBetween(1.0, 4.0),
  tiredness: randomBetween(1.0, 4.0),
  hunger_rate: randomBetween(1.5, 4.5),
  boredom_rate: randomBetween(1.0, 4.0),
  tiredness_rate: randomBetween(1.0, 4.0),
  image: availableImages[Math.floor(Math.random() * availableImages.length)],
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
