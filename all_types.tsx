// ============================================================
// POSITION
// ============================================================

type Position = {
	x: number; // 0–499
	y: number; // 0–499
  };
  
  // ============================================================
  // TILE TYPES
  // ============================================================
  
  type TileName =
	| "pavement"
	| "road_one_way"
	| "road_two_way"
	| "road_intersection"
	| "crosswalk"
	| "sidewalk"
	| "grass";
  
  type Tile = {
	name: TileName;
	can_walk_through: boolean;
	can_drive_through: boolean;
	position: Position;
	width: number;
	height: number;
	image: string;
  };
  
  const TILE_DEFAULTS: Record<TileName, Omit<Tile, "position">> = {
	pavement: {
	  name: "pavement",
	  can_walk_through: true,
	  can_drive_through: false,
	  width: 1,
	  height: 1,
	  image: "/sprites/tiles/pavement.png",
	},
	road_one_way: {
	  name: "road_one_way",
	  can_walk_through: false,
	  can_drive_through: true,
	  width: 1,
	  height: 1,
	  image: "/sprites/tiles/road_one_way.png",
	},
	road_two_way: {
	  name: "road_two_way",
	  can_walk_through: false,
	  can_drive_through: true,
	  width: 2,
	  height: 2,
	  image: "/sprites/tiles/road_two_way.png",
	},
	road_intersection: {
	  name: "road_intersection",
	  can_walk_through: false,
	  can_drive_through: true,
	  width: 1,
	  height: 1,
	  image: "/sprites/tiles/road_intersection.png",
	},
	crosswalk: {
	  name: "crosswalk",
	  can_walk_through: true,
	  can_drive_through: true,
	  width: 1,
	  height: 1,
	  image: "/sprites/tiles/crosswalk.png",
	},
	sidewalk: {
	  name: "sidewalk",
	  can_walk_through: true,
	  can_drive_through: false,
	  width: 1,
	  height: 1,
	  image: "/sprites/tiles/sidewalk.png",
	},
	grass: {
	  name: "grass",
	  can_walk_through: true,
	  can_drive_through: false,
	  width: 1,
	  height: 1,
	  image: "/sprites/tiles/grass.png",
	},
  };
  
  // ============================================================
  // PROPERTY TYPES
  // ============================================================
  
  type PropertyName =
	| "park"
	| "hospital"
	| "school"
	| "grocery_store"
	| "house"
	| "apartment"
	| "restaurant"
	| "fire_station"
	| "police_station"
	| "power_plant";
  
  type Property = {
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
  
  const PROPERTY_DEFAULTS: Record<PropertyName, Omit<Property, "position" | "current_occupants">> = {
	park: {
	  name: "park",
	  width: 4,
	  height: 4,
	  is_enterable: true,
	  capacity: 50,
	  boredom_decrease: 8,
	  hunger_decrease: 0,
	  tiredness_decrease: 3,
	  image: "/sprites/properties/park.png",
	},
	hospital: {
	  name: "hospital",
	  width: 4,
	  height: 4,
	  is_enterable: true,
	  capacity: 20,
	  boredom_decrease: 0,
	  hunger_decrease: 0,
	  tiredness_decrease: 5,
	  image: "/sprites/properties/hospital.png",
	},
	school: {
	  name: "school",
	  width: 4,
	  height: 4,
	  is_enterable: true,
	  capacity: 80,
	  boredom_decrease: 3,
	  hunger_decrease: 0,
	  tiredness_decrease: 0,
	  image: "/sprites/properties/school.png",
	},
	grocery_store: {
	  name: "grocery_store",
	  width: 4,
	  height: 4,
	  is_enterable: true,
	  capacity: 30,
	  boredom_decrease: 2,
	  hunger_decrease: 8,
	  tiredness_decrease: 0,
	  image: "/sprites/properties/grocery_store.png",
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
	  image: "/sprites/properties/house.png",
	},
	apartment: {
	  name: "apartment",
	  width: 4,
	  height: 4,
	  is_enterable: true,
	  capacity: 10,
	  boredom_decrease: 2,
	  hunger_decrease: 5,
	  tiredness_decrease: 10,
	  image: "/sprites/properties/apartment.png",
	},
	restaurant: {
	  name: "restaurant",
	  width: 4,
	  height: 4,
	  is_enterable: true,
	  capacity: 30,
	  boredom_decrease: 5,
	  hunger_decrease: 10,
	  tiredness_decrease: 0,
	  image: "/sprites/properties/restaurant.png",
	},
	fire_station: {
	  name: "fire_station",
	  width: 4,
	  height: 4,
	  is_enterable: false,
	  capacity: 10,
	  boredom_decrease: 0,
	  hunger_decrease: 0,
	  tiredness_decrease: 0,
	  image: "/sprites/properties/fire_station.png",
	},
	police_station: {
	  name: "police_station",
	  width: 4,
	  height: 4,
	  is_enterable: false,
	  capacity: 10,
	  boredom_decrease: 0,
	  hunger_decrease: 0,
	  tiredness_decrease: 0,
	  image: "/sprites/properties/police_station.png",
	},
	power_plant: {
	  name: "power_plant",
	  width: 4,
	  height: 4,
	  is_enterable: false,
	  capacity: 5,
	  boredom_decrease: 0,
	  hunger_decrease: 0,
	  tiredness_decrease: 0,
	  image: "/sprites/properties/power_plant.png",
	},
  };
  
  // ============================================================
  // PEOPLE TYPES
  // ============================================================
  
  type AgeGroup = "adult" | "child";
  
  type Job =
	| "teacher"
	| "doctor"
	| "firefighter"
	| "police_officer"
	| "chef"
	| "grocer"
	| "engineer"
	| "unemployed"
	| null; // null for children
  
  type Person = {
	name: string;
	age_group: AgeGroup;
	job: Job;
	home: Property;
	current_location: Position;
	current_path: Position[];
	inside_property: Property | null;
	hunger: number;       // 1–10
	boredom: number;      // 1–10
	tiredness: number;    // 1–10
	hunger_rate: number;      // 1.5–4.5 per day
	boredom_rate: number;     // 1.0–4.0 per day
	tiredness_rate: number;   // 1.0–4.0 per day
	image: string;
  };
  
  const JOB_OPTIONS: Exclude<Job, null>[] = [
	"teacher",
	"doctor",
	"firefighter",
	"police_officer",
	"chef",
	"grocer",
	"engineer",
	"unemployed",
  ];
  
  const randomBetween = (min: number, max: number): number =>
	Math.random() * (max - min) + min;
  
  const spawnPerson = (
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
  
  type GridCell =
	| { kind: "tile"; data: Tile }
	| { kind: "property"; data: Property }
	| null;
  
  // ============================================================
  // CITY TYPE
  // ============================================================
  
  type City = {
	city_grid: GridCell[][];
	all_citizens: Person[];
	all_properties: Property[];
	day: number; // 1–7
  };
  
  // ============================================================
  // CITY INITIALIZATION
  // ============================================================
  
  const initCity = (): City => ({
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
  
  const placeTile = (city: City, tile: Tile): void => {
	city.city_grid[tile.position.y][tile.position.x] = {
	  kind: "tile",
	  data: tile,
	};
  };
  
  const placeProperty = (city: City, property: Property): void => {
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
  
  const getCellAt = (city: City, position: Position): GridCell => {
	return city.city_grid[position.y][position.x];
  };