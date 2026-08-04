import type { City, NeedName, Person, Property, UnmetWant } from '@/lib/all_types';
import { DECISION_WEIGHTS } from './constants';
import { planPathToProperty } from './pathfinding';

type Need = NeedName;

function highestNeed(c: Person): Need {
  if (c.hunger >= c.boredom && c.hunger >= c.tiredness) return 'hunger';
  if (c.boredom >= c.tiredness) return 'boredom';
  return 'tiredness';
}

function decreaseFor(p: Property, need: Need): number {
  return need === 'hunger'   ? p.hunger_decrease   :
         need === 'boredom'  ? p.boredom_decrease  :
                               p.tiredness_decrease;
}

// Citizens can enter:
//   - Their own home
//   - Any other enterable, non-residential building
// Other people's homes are off-limits (no random house-hopping).
function isValidDestination(citizen: Person, property: Property): boolean {
  if (!property.is_enterable) return false;
  if (property.name === 'house' || property.name === 'apartment') {
    return property === citizen.home;
  }
  return true;
}

const manhattan = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

// Pick the property whose `*_decrease` for the citizen's highest need is
// largest, breaking ties by Manhattan distance to the citizen.
function pickOptimalDestination(citizen: Person, city: City): Property | null {
  const need = highestNeed(citizen);
  const candidates = city.all_properties.filter(
    p => isValidDestination(citizen, p) && decreaseFor(p, need) > 0,
  );
  if (candidates.length === 0) return null;

  const maxDecrease = candidates.reduce((m, p) => Math.max(m, decreaseFor(p, need)), 0);
  const top = candidates.filter(p => decreaseFor(p, need) === maxDecrease);
  top.sort((a, b) => manhattan(a.position, citizen.current_location) - manhattan(b.position, citizen.current_location));
  return top[0];
}

function pickRandomDestination(citizen: Person, city: City): Property | null {
  const candidates = city.all_properties.filter(p => isValidDestination(citizen, p));
  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

// 70/30 split per DECISION_WEIGHTS. Returns null if no valid destinations.
export function pickDestination(citizen: Person, city: City): Property | null {
  return Math.random() < DECISION_WEIGHTS.optimal_chance
    ? pickOptimalDestination(citizen, city)
    : pickRandomDestination(citizen, city);
}

// A want only counts as unmet once it's actually pressing. Below this the
// citizen has a mild preference, not a complaint worth reporting to a mayor.
const UNMET_NEED_THRESHOLD = 7;

// Needs a PUBLIC amenity is expected to answer. Tiredness is excluded on
// purpose: home gives tiredness_decrease 10, more than any hospital, so
// sleeping at home is the correct answer rather than a gap in the city. Left
// in, it would fire in every city without a hospital and swamp the signal.
const PUBLIC_NEEDS: readonly Need[] = ['hunger', 'boredom'];

// Does anything OTHER than the citizen's own home address this need?
//
// Home is excluded deliberately. It serves all three needs (hunger 5,
// boredom 2, tiredness 10), so counting it would make this always true and
// the check dead code. The question worth asking a city planner is not "can
// this person eat at all" but "does the city offer anywhere to eat".
function cityCanServeNeed(citizen: Person, city: City, need: Need): boolean {
  return city.all_properties.some(
    p => p !== citizen.home && isValidDestination(citizen, p) && decreaseFor(p, need) > 0,
  );
}

// Records an unmet want ONCE per (need, reason), bumping a counter on repeats.
// Idle citizens re-decide every tick, so appending a row per failure would
// produce thousands of duplicates and drown out the actual signal.
function recordUnmetWant(citizen: Person, need: Need, reason: UnmetWant['reason'], tick: number): void {
  const wants = (citizen.unmet_wants ??= []);
  const existing = wants.find(w => w.need === need && w.reason === reason);
  if (existing) {
    existing.count += 1;
    existing.last_tick = tick;
    return;
  }
  wants.push({ need, reason, first_tick: tick, last_tick: tick, count: 1 });
}

// True iff `pos` is 4-adjacent to any cell of the property's footprint.
// This is the entry-tile predicate used by runTick to detect arrival.
export function isAtEntryTile(pos: { x: number; y: number }, p: Property): boolean {
  for (let dy = 0; dy < p.height; dy++) {
    for (let dx = 0; dx < p.width; dx++) {
      const px = p.position.x + dx;
      const py = p.position.y + dy;
      if (Math.abs(pos.x - px) + Math.abs(pos.y - py) === 1) return true;
    }
  }
  return false;
}

// Picks a destination and computes the citizen's path to it. Mutates the
// citizen in place: sets `current_path`, `current_destination`, and pushes a
// new entry to `trips`. Tries multiple candidates if the first pick is
// unreachable or yields a zero-length walk (citizen already at the entry tile
// of the picked target — common when they just arrived).
//
// `currentTick` stamps the trip's `start_tick`. The corresponding
// `arrived_tick` is set by useSimulation when the citizen enters the property.
export function assignDestination(
  citizen: Person,
  city: City,
  walkability: boolean[][],
  currentTick: number,
  maxAttempts = 8,
): void {
  // Checked before the attempt loop so it reflects the CITY, not which way the
  // 70/30 optimal-vs-random roll happened to land this tick.
  const need = highestNeed(citizen);
  if (
    citizen[need] >= UNMET_NEED_THRESHOLD &&
    PUBLIC_NEEDS.includes(need) &&
    !cityCanServeNeed(citizen, city, need)
  ) {
    recordUnmetWant(citizen, need, 'no_option', currentTick);
    // Deliberately not returning: the citizen still goes somewhere (usually
    // home). The want is logged either way — settling isn't the same as
    // being satisfied.
  }

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const target = pickDestination(citizen, city);
    if (!target) {
      // Nowhere valid to go at all — not even home.
      recordUnmetWant(citizen, need, 'no_option', currentTick);
      return;
    }

    const path = planPathToProperty(
      citizen.current_location,
      citizen.home,
      target,
      walkability,
    );
    if (!path || path.length === 0) continue;

    const firstSameAsCurrent =
      path[0].x === citizen.current_location.x &&
      path[0].y === citizen.current_location.y;
    // If the citizen is already at the picked target's entry, the path is
    // a single cell (from === to). Skip and try a different target.
    if (firstSameAsCurrent && path.length === 1) continue;

    citizen.current_path = firstSameAsCurrent ? path.slice(1) : path;
    citizen.current_destination = target;
    citizen.trips.push({
      destination_name: target.name,
      destination_company: target.company_name,
      start_tick: currentTick,
      distance_tiles: citizen.current_path.length,
    });
    return;
  }
  // Every attempt found a destination but none was walkable. Buildings exist;
  // the road network is what failed. Retry next tick — but log it once.
  recordUnmetWant(citizen, need, 'unreachable', currentTick);
}
