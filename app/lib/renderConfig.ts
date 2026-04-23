type RenderOffset = { offsetX: number; offsetY: number; scale: number };

export const TILE_RENDER: Record<string, RenderOffset> = {
  grass:        { offsetX: 0, offsetY: -15, scale: 0.99 },
  road:         { offsetX: 0, offsetY: -15, scale: 1.0 },
  road_one_way: { offsetX: 0, offsetY: -30, scale: 1.0 },
  road_two_way: { offsetX: 0, offsetY: -30, scale: 1.0 },
  intersection: { offsetX: 0, offsetY: -15, scale: 1.0 },
  crosswalk:    { offsetX: 0, offsetY: -15, scale: 1.0 },
  sidewalk:     { offsetX: 2, offsetY: -19, scale: 1.2 },
  pavement:     { offsetX: 0, offsetY: -19, scale: 1.2 },
};

export const PROP_RENDER: Record<string, RenderOffset> = {
  park:          { offsetX: 0, offsetY: 17, scale: 0.97 },
  hospital:      { offsetX: 0, offsetY: -28, scale: 1.06 },
  school:        { offsetX: 0, offsetY: 0, scale: 1.0 },
  grocery_store: { offsetX: -1, offsetY: 9, scale: 0.9 }, // Manually adjusted, do not change without testing
  fire_station:  { offsetX: -1, offsetY: -10, scale: 0.97 },
  police_station:{ offsetX: 0, offsetY: -7, scale: 1 },
  power_plant:   { offsetX: 0, offsetY: -24, scale: 1 },
  apartment:     { offsetX: 0, offsetY: -31, scale: 1.1 },
  restaurant:    { offsetX: 0, offsetY: 10, scale: 1.0 }, // Manually adjusted, do not change without testing
  house_v1:      { offsetX: -1, offsetY: -48, scale: 2 },
  house_v2:      { offsetX: 5, offsetY: -25, scale: 1.1 }, // Manually adjusted, do not change without testing
};
