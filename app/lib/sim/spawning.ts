import {
  CITIZEN_IMAGE_FRONT,
  spawnPerson,
} from '@/lib/all_types';
import type { City, Person, Position, Property } from '@/lib/all_types';
import { assignCompanyNames } from './companies';

// Pick a starting cell within a property's footprint, distributed by index
// so multiple residents of the same building don't stack on a single tile.
// Walks the footprint in row-major order; wraps if there are more residents
// than cells (shouldn't happen — apartment is 3x3=9 cells for 3 residents).
function residentStartCell(home: Property, residentIndex: number): Position {
  const w = home.width;
  const h = home.height;
  const total = w * h;
  const idx = residentIndex % total;
  return {
    x: home.position.x + (idx % w),
    y: home.position.y + Math.floor(idx / w),
  };
}

// 1 citizen per house, 3 per apartment. All adults for now (children added later).
// Citizens start `inside_property: home` at distinct cells within the footprint
// (just for visual separation pre-movement).
//
// Every adult is an engineer; their `job` field stores which company
// (= which office) they work at. Companies are picked uniformly at random
// from the offices that exist in the city at sim-start time.
export function spawnInitialCitizens(city: City): Person[] {
  const companies = assignCompanyNames(city);

  const spawned: Person[] = [];
  for (const property of city.all_properties) {
    let count = 0;
    if (property.name === 'house') count = 1;
    else if (property.name === 'apartment') count = 3;
    else continue;

    for (let i = 0; i < count; i++) {
      const job = companies.length > 0
        ? companies[Math.floor(Math.random() * companies.length)]
        : null;
      const person = spawnPerson('adult', property, [CITIZEN_IMAGE_FRONT], job);
      person.current_location = residentStartCell(property, i);
      // Start "outside" so the first runTick walks them out — otherwise the
      // entry/fulfillment logic would treat them as already inside their home.
      person.inside_property = null;
      city.all_citizens.push(person);
      spawned.push(person);
    }
  }
  return spawned;
}
