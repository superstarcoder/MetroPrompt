// ============================================================
// POSITION
// ============================================================

export type Position = {
  x: number; // 0–499
  y: number; // 0–499
};

// ============================================================
// TILE TYPES
// ============================================================

export type TileName =
  | "pavement"
  | "road_one_way"
  | "road_two_way"
  | "road_intersection"
  | "crosswalk"
  | "sidewalk"
  | "grass";

export type Tile = {
  name: TileName;
  can_walk_through: boolean;
  can_drive_through: boolean;
  position: Position;
  width: number;
  height: number;
  image: string;
};

export const TILE_DEFAULTS: Record<TileName, Omit<Tile, "position">> = {
  pavement: {
    name: "pavement",
    can_walk_through: true,
    can_drive_through: false,
    width: 1,
    height: 1,
    image: "/assets/pavement_1_1.png",
  },
  road_one_way: {
    name: "road_one_way",
    can_walk_through: false,
    can_drive_through: true,
    width: 1,
    height: 1,
    image: "/assets/road_1_1.png",
  },
  road_two_way: {
    name: "road_two_way",
    can_walk_through: false,
    can_drive_through: true,
    width: 1,
    height: 1,
    image: "/assets/road_1_1.png",
  },
  road_intersection: {
    name: "road_intersection",
    can_walk_through: false,
    can_drive_through: true,
    width: 1,
    height: 1,
    image: "/assets/intersection_1_1.png",
  },
  crosswalk: {
    name: "crosswalk",
    can_walk_through: true,
    can_drive_through: true,
    width: 1,
    height: 1,
    image: "/assets/crosswalk_1_1.png",
  },
  sidewalk: {
    name: "sidewalk",
    can_walk_through: true,
    can_drive_through: false,
    width: 1,
    height: 1,
    image: "/assets/sidewalk_1_1.png",
  },
  grass: {
    name: "grass",
    can_walk_through: true,
    can_drive_through: false,
    width: 1,
    height: 1,
    image: "/assets/grass_1_1.png",
  },
};

// ============================================================
// PROPERTY TYPES
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
  | "power_plant";

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
  "/assets/home_v1_1_1.png",
  "/assets/home_v2_2_2.png",
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
// NATURE TYPES
// ============================================================

export type NatureName = "tree" | "flower_patch" | "bush";

export type Nature = {
  name: NatureName;
  position: Position;
  image: string;
};

export const APARTMENT_IMAGES = [
  "/assets/apartment_v1_3_3.png",
  "/assets/apartment_v2_3_3.png",
];

export const OFFICE_IMAGES = [
  "/assets/office_v1_3_3.png",
  "/assets/office_v2_3_3.png",
  "/assets/office_v3_3_3.png",
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
};

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
// GRID CELL TYPE
// ============================================================

export type GridCell =
  | { kind: "tile"; data: Tile }
  | { kind: "property"; data: Property }
  | null;

// ============================================================
// CITY TYPE
// ============================================================

export type City = {
  city_grid: GridCell[][];
  all_citizens: Person[];
  all_properties: Property[];
  day: number; // 1–7
};

// ============================================================
// CITY INITIALIZATION
// ============================================================

export const initCity = (): City => ({
  city_grid: Array.from({ length: 500 }, (_, y) =>
    Array.from({ length: 500 }, (_, x) => ({
      kind: "tile",
      data: {
        ...TILE_DEFAULTS.grass,
        position: { x, y },
      },
    }))
  ),
  all_citizens: [],
  all_properties: [],
  day: 1,
});

// ============================================================
// GRID HELPERS
// ============================================================

export const placeTile = (city: City, tile: Tile): void => {
  city.city_grid[tile.position.y][tile.position.x] = {
    kind: "tile",
    data: tile,
  };
};

export const placeProperty = (city: City, property: Property): void => {
  for (let dy = 0; dy < property.height; dy++) {
    for (let dx = 0; dx < property.width; dx++) {
      city.city_grid[property.position.y + dy][property.position.x + dx] = {
        kind: "property",
        data: property,
      };
    }
  }
  city.all_properties.push(property);
};

export const getCellAt = (city: City, position: Position): GridCell => {
  return city.city_grid[position.y][position.x];
};
