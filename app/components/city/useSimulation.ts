'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { City, Person } from '@/lib/all_types';
import { spawnInitialCitizens } from '@/lib/sim/spawning';
import { SIMULATION, STAY_DURATION_TICKS, WALK_CELLS_PER_TICK, applyJitter } from '@/lib/sim/constants';
import { buildWalkabilityGrid } from '@/lib/sim/pathfinding';
import { assignDestination, isAtEntryTile } from '@/lib/sim/decisions';

export type SimState = 'idle' | 'running' | 'paused' | 'done';

type Args = {
  cityRef: RefObject<City>;
  scheduleRender: () => void;
  // Selection state lives in the parent so both useCityScene (clicks +
  // freeze rendering) and useSimulation (skip movement) can read/write it.
  selectedCitizenRef: RefObject<Person | null>;
  setSelectedCitizen: (p: Person | null) => void;
  // Wall-clock timestamp of the last sim tick. Owned by the parent and
  // updated here at the end of each tick so the renderer can lerp.
  tickStartedAtRef: RefObject<number>;
};

// Steps 4–5: tick loop, need decay, decision-making + movement.
// Step 6 will add property-entry mechanics (stay duration, need fulfillment).
export function useSimulation({
  cityRef,
  scheduleRender,
  selectedCitizenRef,
  setSelectedCitizen,
  tickStartedAtRef,
}: Args) {
  const [simState, setSimState] = useState<SimState>('idle');
  const [tick, setTick] = useState(0);
  const [citizensVersion, setCitizensVersion] = useState(0);

  const tickRef = useRef(0);
  // Walkability cache. Built once at sim start (city is static during sim).
  const walkabilityRef = useRef<boolean[][] | null>(null);

  const runTick = useCallback(() => {
    const city = cityRef.current;
    const walkability = walkabilityRef.current;
    const sel = selectedCitizenRef.current;

    for (const c of city.all_citizens) {
      // 1. Decay every tick, regardless of selection / movement / location.
      c.hunger    = Math.min(10, Math.max(1, c.hunger    + applyJitter(c.hunger_rate)));
      c.boredom   = Math.min(10, Math.max(1, c.boredom   + applyJitter(c.boredom_rate)));
      c.tiredness = Math.min(10, Math.max(1, c.tiredness + applyJitter(c.tiredness_rate)));

      // 2. Selected citizen freezes — no movement, no entry/exit transitions.
      if (c === sel) {
        c.prev_location = { ...c.current_location };
        continue;
      }

      c.prev_location = { ...c.current_location };

      // 3. Inside a property: apply fulfillment, count down, exit when done.
      if (c.inside_property) {
        const p = c.inside_property;
        c.hunger    = Math.min(10, Math.max(1, c.hunger    - p.hunger_decrease));
        c.boredom   = Math.min(10, Math.max(1, c.boredom   - p.boredom_decrease));
        c.tiredness = Math.min(10, Math.max(1, c.tiredness - p.tiredness_decrease));
        const remaining = (c.stay_ticks_remaining ?? STAY_DURATION_TICKS) - 1;
        if (remaining <= 0) {
          // Leave: detach from this property and pick a new destination so
          // the next tick can immediately start walking.
          const occIdx = p.current_occupants.indexOf(c.name);
          if (occIdx >= 0) p.current_occupants.splice(occIdx, 1);
          c.inside_property = null;
          c.current_destination = undefined;
          c.stay_ticks_remaining = undefined;
          if (walkability) assignDestination(c, city, walkability, tickRef.current);
        } else {
          c.stay_ticks_remaining = remaining;
        }
        continue;
      }

      // 4. Walking: advance up to WALK_CELLS_PER_TICK cells along the path.
      // The visual lerp covers the full tick interval regardless, so this
      // scales walking speed proportionally.
      if (c.current_path.length > 0) {
        for (let i = 0; i < WALK_CELLS_PER_TICK && c.current_path.length > 0; i++) {
          c.current_location = c.current_path.shift()!;
        }
        // Arrived at end of path — try to enter the destination, or re-roll.
        if (c.current_path.length === 0) {
          const target = c.current_destination;
          if (target && isAtEntryTile(c.current_location, target)) {
            if (target.current_occupants.length < target.capacity) {
              target.current_occupants.push(c.name);
              c.inside_property = target;
              c.stay_ticks_remaining = STAY_DURATION_TICKS;
              // Stamp arrival on the most recent (in-progress) trip.
              const lastTrip = c.trips[c.trips.length - 1];
              if (lastTrip && lastTrip.arrived_tick === undefined) {
                lastTrip.arrived_tick = tickRef.current;
              }
            } else {
              // Full — try a different destination next tick.
              c.current_destination = undefined;
              if (walkability) assignDestination(c, city, walkability, tickRef.current);
            }
          } else {
            // Path ended without proper arrival (shouldn't normally happen).
            c.current_destination = undefined;
            if (walkability) assignDestination(c, city, walkability, tickRef.current);
          }
        }
        continue;
      }

      // 5. Idle: no path, not inside. Pick a destination.
      if (walkability) assignDestination(c, city, walkability, tickRef.current);
    }

    tickStartedAtRef.current = Date.now();
    tickRef.current += 1;
    setTick(tickRef.current);
    if (tickRef.current >= SIMULATION.total_ticks) {
      setSimState('done');
    }
    scheduleRender();
  }, [cityRef, scheduleRender, selectedCitizenRef, tickStartedAtRef]);

  useEffect(() => {
    if (simState !== 'running') return;
    const id = setInterval(runTick, SIMULATION.tick_interval_ms);
    return () => clearInterval(id);
  }, [simState, runTick]);

  const startSim = useCallback(() => {
    cityRef.current.all_citizens.length = 0;
    spawnInitialCitizens(cityRef.current);
    walkabilityRef.current = buildWalkabilityGrid(cityRef.current);
    tickRef.current = 0;
    for (const c of cityRef.current.all_citizens) {
      c.prev_location = { ...c.current_location };
      assignDestination(c, cityRef.current, walkabilityRef.current, tickRef.current);
    }
    setSelectedCitizen(null);
    setCitizensVersion(v => v + 1);
    tickStartedAtRef.current = Date.now();
    setTick(0);
    setSimState('running');
    scheduleRender();
  }, [cityRef, scheduleRender, setSelectedCitizen, tickStartedAtRef]);

  const stopSim = useCallback(() => {
    cityRef.current.all_citizens.length = 0;
    walkabilityRef.current = null;
    setSelectedCitizen(null);
    setCitizensVersion(v => v + 1);
    tickRef.current = 0;
    tickStartedAtRef.current = 0;
    setTick(0);
    setSimState('idle');
    scheduleRender();
  }, [cityRef, scheduleRender, setSelectedCitizen, tickStartedAtRef]);

  const pauseSim = useCallback(() => {
    setSimState(s => (s === 'running' ? 'paused' : s));
  }, []);

  const resumeSim = useCallback(() => {
    setSimState(s => {
      if (s !== 'paused') return s;
      tickStartedAtRef.current = Date.now();
      return 'running';
    });
  }, [tickStartedAtRef]);

  const day  = Math.min(SIMULATION.total_days, Math.floor(tick / SIMULATION.ticks_per_day) + 1);
  const hour = (tick % SIMULATION.ticks_per_day) + 1;

  return {
    simState,
    tick,
    day,
    hour,
    citizensVersion,
    startSim,
    stopSim,
    pauseSim,
    resumeSim,
  };
}
