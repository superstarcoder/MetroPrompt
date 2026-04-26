import type { City, Person, Property } from '@/lib/all_types';
import { DECISION_WEIGHTS } from './constants';
import { planPathToProperty } from './pathfinding';

type Need = 'hunger' | 'boredom' | 'tiredness';

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
// citizen in place: sets `current_path` AND `current_destination`. Tries
// multiple candidates if the first pick is unreachable or yields a zero-length
// walk (citizen already at the entry tile of the picked target — common when
// they just arrived).
export function assignDestination(
  citizen: Person,
  city: City,
  walkability: boolean[][],
  maxAttempts = 8,
): void {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const target = pickDestination(citizen, city);
    if (!target) return;

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
    return;
  }
  // Couldn't find a movable destination this tick — retry next tick.
}
