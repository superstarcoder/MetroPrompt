import type { City } from '@/lib/all_types';
import { businessBlurb } from '@/lib/sim/companies';
import type { MayorDebriefContext } from '@/lib/agent/mayorDebriefPrompt';
import type { FireRecord } from './useSimulation';
import { PROPERTY_LABELS, formatTripDestination } from './propertyLabels';

// Turns the finished run into the report the MAYOR_DEBRIEF agent reads.
// Built client-side for the same reason the citizen context is: the sim lives
// in the browser, and this is a pure projection of it.

const LONG_WALK_TILES = 50;

export function buildDebriefContext(
  city: City,
  fireLog: FireRecord[],
  cityName: string | null,
  day: number,
  ticks: number,
): MayorDebriefContext {
  const businesses: MayorDebriefContext['directory']['businesses'] = [];
  const counts = new Map<string, number>();

  for (const p of city.all_properties) {
    const label = PROPERTY_LABELS[p.name] ?? p.name;
    const blurb = businessBlurb(p);
    if (p.company_name && blurb) {
      businesses.push({ name: p.company_name, kind: label, blurb });
    } else if (p.name !== 'house' && p.name !== 'apartment') {
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }

  const citizens = city.all_citizens.map(c => {
    const done = c.trips.filter(t => t.arrived_tick !== undefined);
    const visits = new Map<string, number>();
    for (const t of done) {
      const key = formatTripDestination(t);
      visits.set(key, (visits.get(key) ?? 0) + 1);
    }
    const topPlace = [...visits].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    return {
      name: c.name,
      job: c.job,
      home: PROPERTY_LABELS[c.home.name] ?? c.home.name,
      needs: { hunger: c.hunger, boredom: c.boredom, tiredness: c.tiredness },
      trips: done.length,
      tiles: done.reduce((s, t) => s + t.distance_tiles, 0),
      longWalks: done.filter(t => t.distance_tiles > LONG_WALK_TILES).length,
      topPlace,
      unmet: (c.unmet_wants ?? []).map(u => ({
        need: u.need,
        reason: u.reason,
        times: u.count,
      })),
    };
  });

  return {
    cityName,
    day,
    ticks,
    directory: {
      businesses,
      amenities: [...counts].map(([label, count]) => ({ label, count })),
    },
    citizens,
    fires: fireLog.map(f => ({ label: f.label, seconds: f.elapsedMs / 1000 })),
  };
}
