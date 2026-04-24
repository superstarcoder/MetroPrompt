type RenderOffset = { offsetX: number; offsetY: number; scale: number };

export const TILE_RENDER: Record<string, RenderOffset> = {
  grass:             { offsetX: 0, offsetY: -15, scale: 0.99 },
  road_one_way:      { offsetX: 0, offsetY: -15, scale: 1.0 },
  road_two_way:      { offsetX: 0, offsetY: -15, scale: 1.0 },
  road_intersection: { offsetX: 0, offsetY: -15, scale: 1.0 },
  crosswalk:         { offsetX: 0, offsetY: -15, scale: 1.0 },
  sidewalk:          { offsetX: 2, offsetY: -19, scale: 1.2 },
  pavement:          { offsetX: 0, offsetY: -19, scale: 1.2 },
  flower_patch_v1: { offsetX: 0, offsetY: -15, scale: 1.0 },
  bush_v1:         { offsetX: 0, offsetY: -15, scale: 1.0 },
  tree_v1:         { offsetX: 0, offsetY: -32, scale: 1.2 },
  tree_v2:         { offsetX: 0, offsetY: -20, scale: 1.0 },
  tree_v3:         { offsetX: 0, offsetY: -20, scale: 1.0 },
  tree_v4:         { offsetX: 0, offsetY: -23, scale: 1.0 },
};

export const PROP_RENDER: Record<string, RenderOffset> = {
  park:          { offsetX: 0, offsetY: 17, scale: 0.97 },
  hospital:      { offsetX: 0, offsetY: -28, scale: 1.06 },
  school:        { offsetX: 0, offsetY: 0, scale: 1.0 },
  grocery_store: { offsetX: -1, offsetY: 9, scale: 0.9 }, // Manually adjusted, do not change without testing
  fire_station:  { offsetX: -1, offsetY: -10, scale: 0.97 },
  police_station:{ offsetX: 0, offsetY: -7, scale: 1 },
  powerplant:    { offsetX: 0, offsetY: -25, scale: 1 },
  apartment_v1:  { offsetX: 0, offsetY: -79, scale: 1.3 },
  apartment_v2:  { offsetX: 0, offsetY: -45, scale: 1.1 },
  office_v1:     { offsetX: 0, offsetY: -96, scale: 1.37 },
  office_v2:     { offsetX: 0, offsetY: -108, scale: 1.5 },
  office_v3:     { offsetX: 0, offsetY: -105, scale: 1.4 },
  restaurant:    { offsetX: 0, offsetY: -25, scale: 1.0 }, // Manually adjusted, do not change without testing
  home_v1:       { offsetX: -1, offsetY: -15, scale: 1 },
  home_v2:       { offsetX: 5, offsetY: -25, scale: 1.1 }, // Manually adjusted, do not change without testing
  shopping_mall: { offsetX: 0, offsetY: -9, scale: 1 },
  theme_park:    { offsetX: 0, offsetY: -14, scale: 1 },
};
