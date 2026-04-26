'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { City, Person, Position, Property } from '@/lib/all_types';
import { spawnInitialCitizens } from '@/lib/sim/spawning';
import { SIMULATION, STAY_DURATION_TICKS, WALK_CELLS_PER_TICK, applyJitter } from '@/lib/sim/constants';
import { buildWalkabilityGrid } from '@/lib/sim/pathfinding';
import { assignDestination, isAtEntryTile } from '@/lib/sim/decisions';
import {
  buildDrivabilityGrid,
  findNearestFireStation,
  shouldYieldForCitizens,
} from '@/lib/sim/firetruck';
import { truckDirection } from './imageHelpers';
import type { TruckDirection } from './imageHelpers';

export type SimState = 'idle' | 'running' | 'paused' | 'done';

// ============================================================
// FIRE TRUCK
// Single active truck at a time. Sub-tick movement (rAF-driven, ~one cell
// every TRUCK_MS_PER_TILE) so it visibly races. Phases:
//   driving_to_fire → at_fire (dwell) → driving_back → null (despawn)
// Yields one cell before any crosswalk/intersection if a citizen is on it
// or one cell away walking onto it.
// ============================================================

const TRUCK_MS_PER_TILE = 380;        // ~2.6 cells/sec — visibly urgent but readable
const TRUCK_AT_FIRE_DWELL_MS = 1500;  // visible "fire suppressed" beat

export type FireTruckPhase = 'driving_to_fire' | 'at_fire' | 'driving_back';

export type FireTruck = {
  station: Property;
  target: Property;
  outboundPath: Position[];
  returnPath: Position[];
  phase: FireTruckPhase;
  pathIndex: number;
  segmentStart: number;        // ms — when the current cell→next-cell lerp began
  visualPosition: Position;    // sub-tile lerped position for rendering
  direction: TruckDirection;   // last meaningful heading; sticky while yielding/dwelling
  yielding: boolean;
  dispatchedAt: number;        // wall-clock ms — for response time
  arrivedAtFireAt?: number;    // wall-clock ms — set on arrival at scene
};

export type ResponseTimeReport = {
  elapsedMs: number;
  targetName: string;
};

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
  // Active fire truck — lifted to the parent so useCityScene (which runs
  // first) can read it. We mutate it here.
  activeFireTruckRef: RefObject<FireTruck | null>;
};

// Steps 4–5: tick loop, need decay, decision-making + movement.
// Step 6 will add property-entry mechanics (stay duration, need fulfillment).
export function useSimulation({
  cityRef,
  scheduleRender,
  selectedCitizenRef,
  setSelectedCitizen,
  tickStartedAtRef,
  activeFireTruckRef,
}: Args) {
  const [simState, setSimState] = useState<SimState>('idle');
  const [tick, setTick] = useState(0);
  const [citizensVersion, setCitizensVersion] = useState(0);

  const tickRef = useRef(0);
  // Walkability cache. Built once at sim start (city is static during sim).
  const walkabilityRef = useRef<boolean[][] | null>(null);
  // Drivability cache. Same lifecycle as walkability — rebuilt on sim start.
  const drivabilityRef = useRef<boolean[][] | null>(null);

  // Fire truck — single active truck at a time. Ref is owned by the parent;
  // we mutate it here. fireTruckActive is the React-visible mirror that
  // gates UI (the 🔥 button hides while a truck is en route).
  const [fireTruckActive, setFireTruckActive] = useState(false);
  const [responseReport, setResponseReport] = useState<ResponseTimeReport | null>(null);
  // Mirror simState into a ref so the rAF loop reads the latest value without
  // resubscribing every state change.
  const simStateRef = useRef<SimState>('idle');
  useEffect(() => { simStateRef.current = simState; }, [simState]);
  // rAF handle for the truck movement loop. Only running while a truck exists.
  const truckRafRef = useRef<number | null>(null);

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
        c.tick_path = [];
        continue;
      }

      c.prev_location = { ...c.current_location };
      // Reset per-tick walk record. Populated below in the walking branch.
      c.tick_path = [];

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
          const next = c.current_path.shift()!;
          c.current_location = next;
          c.tick_path!.push(next);
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

  // ============================================================
  // FIRE TRUCK MOVEMENT
  // rAF-driven sub-tick loop, only alive while a truck exists. Stops the
  // truck movement if sim is paused (but keeps it visible at its current
  // cell). Response time is wall-clock — pause time counts toward it.
  // ============================================================

  const stepTruck = useCallback((now: number) => {
    const truck = activeFireTruckRef.current;
    if (!truck) return;

    // Truck freezes with the sim. Wall-clock keeps ticking either way.
    if (simStateRef.current !== 'running') return;

    if (truck.phase === 'at_fire') {
      if (truck.arrivedAtFireAt && now - truck.arrivedAtFireAt >= TRUCK_AT_FIRE_DWELL_MS) {
        // Start return trip. Reverse outbound path so the truck retraces
        // the same road back. (We could re-A* but reversal is cheaper and
        // visually consistent.)
        truck.phase = 'driving_back';
        truck.pathIndex = 0;
        truck.segmentStart = now;
        truck.visualPosition = { ...truck.returnPath[0] };
        if (truck.returnPath.length > 1) {
          const dir = truckDirection(truck.returnPath[0], truck.returnPath[1]);
          if (dir) truck.direction = dir;
        }
      }
      return;
    }

    const path = truck.phase === 'driving_to_fire' ? truck.outboundPath : truck.returnPath;

    // End of path?
    if (truck.pathIndex >= path.length - 1) {
      if (truck.phase === 'driving_to_fire') {
        truck.phase = 'at_fire';
        truck.arrivedAtFireAt = now;
        truck.visualPosition = { ...path[path.length - 1] };
        // Surface the response-time report immediately on arrival.
        setResponseReport({
          elapsedMs: now - truck.dispatchedAt,
          targetName: truck.target.name,
        });
      } else {
        // Returned to station — despawn.
        activeFireTruckRef.current = null;
        setFireTruckActive(false);
      }
      return;
    }

    const current = path[truck.pathIndex];
    const next = path[truck.pathIndex + 1];

    // Yield BEFORE entering crosswalk / intersection cells. Stop one cell
    // back; resume once the cell is clear and no citizen is one tile away
    // walking onto it. Pass the citizens' lerp progress so we use their
    // visual position (not just current_location, which has already jumped
    // ahead of where the sprite actually is on screen).
    const tickStarted = tickStartedAtRef.current;
    const tickElapsed = tickStarted > 0 ? now - tickStarted : 0;
    const citizenProgress = Math.max(0, Math.min(1, tickElapsed / SIMULATION.tick_interval_ms));
    if (shouldYieldForCitizens(next, cityRef.current.all_citizens, cityRef.current, citizenProgress)) {
      truck.yielding = true;
      truck.visualPosition = { ...current };
      truck.segmentStart = now; // freeze segment timer
      return;
    }
    if (truck.yielding) {
      truck.yielding = false;
      truck.segmentStart = now; // restart the segment cleanly
    }

    const elapsed = now - truck.segmentStart;
    const t = elapsed / TRUCK_MS_PER_TILE;

    if (t >= 1) {
      truck.pathIndex += 1;
      truck.segmentStart = now;
      truck.visualPosition = { ...path[truck.pathIndex] };
      if (truck.pathIndex < path.length - 1) {
        const dir = truckDirection(path[truck.pathIndex], path[truck.pathIndex + 1]);
        if (dir) truck.direction = dir;
      }
    } else {
      truck.visualPosition = {
        x: current.x + (next.x - current.x) * t,
        y: current.y + (next.y - current.y) * t,
      };
    }
  }, [cityRef, activeFireTruckRef, tickStartedAtRef]);

  const startTruckLoop = useCallback(() => {
    if (truckRafRef.current != null) return;
    const loop = () => {
      stepTruck(Date.now());
      scheduleRender();
      if (activeFireTruckRef.current) {
        truckRafRef.current = requestAnimationFrame(loop);
      } else {
        truckRafRef.current = null;
      }
    };
    truckRafRef.current = requestAnimationFrame(loop);
  }, [stepTruck, scheduleRender, activeFireTruckRef]);

  const dispatchFireTruck = useCallback((target: Property): { ok: true } | { ok: false; reason: string } => {
    if (activeFireTruckRef.current) return { ok: false, reason: 'A truck is already responding.' };
    if (simStateRef.current !== 'running') return { ok: false, reason: 'Simulation is not running.' };
    const drivability = drivabilityRef.current;
    if (!drivability) return { ok: false, reason: 'No drivability grid (sim not started).' };

    const route = findNearestFireStation(target, cityRef.current, drivability);
    if (!route) return { ok: false, reason: 'No reachable fire station — build one and connect it via roads.' };

    const outbound = route.path;
    if (outbound.length < 2) return { ok: false, reason: 'Truck is already at the scene.' };
    const returnPath = [...outbound].reverse();

    const initialDir = truckDirection(outbound[0], outbound[1]) ?? 'SE';

    const truck: FireTruck = {
      station: route.station,
      target,
      outboundPath: outbound,
      returnPath,
      phase: 'driving_to_fire',
      pathIndex: 0,
      segmentStart: Date.now(),
      visualPosition: { ...outbound[0] },
      direction: initialDir,
      yielding: false,
      dispatchedAt: Date.now(),
    };
    activeFireTruckRef.current = truck;
    setFireTruckActive(true);
    setResponseReport(null);
    startTruckLoop();
    scheduleRender();
    return { ok: true };
  }, [cityRef, scheduleRender, startTruckLoop, activeFireTruckRef]);

  const dismissResponseReport = useCallback(() => {
    setResponseReport(null);
  }, []);

  const startSim = useCallback(() => {
    cityRef.current.all_citizens.length = 0;
    spawnInitialCitizens(cityRef.current);
    walkabilityRef.current = buildWalkabilityGrid(cityRef.current);
    drivabilityRef.current = buildDrivabilityGrid(cityRef.current);
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
    drivabilityRef.current = null;
    activeFireTruckRef.current = null;
    if (truckRafRef.current != null) {
      cancelAnimationFrame(truckRafRef.current);
      truckRafRef.current = null;
    }
    setFireTruckActive(false);
    setResponseReport(null);
    setSelectedCitizen(null);
    setCitizensVersion(v => v + 1);
    tickRef.current = 0;
    tickStartedAtRef.current = 0;
    setTick(0);
    setSimState('idle');
    scheduleRender();
  }, [cityRef, scheduleRender, setSelectedCitizen, tickStartedAtRef, activeFireTruckRef]);

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
    // Fire truck wiring
    fireTruckActive,
    dispatchFireTruck,
    responseReport,
    dismissResponseReport,
  };
}
