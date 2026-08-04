'use client';

import type { City, Person } from '@/lib/all_types';
import { citizenGender } from '@/lib/all_types';
import { businessBlurb } from '@/lib/sim/companies';
import type { FireRecord } from './useSimulation';
import { MayorDebrief } from './MayorDebrief';
import { PROPERTY_LABELS, formatPropertyLabel, formatTripDestination } from './propertyLabels';

// End-of-run report. Everything the sim knows about every citizen, with no
// model calls — this is the raw record the Mayor debrief will later summarize.
//
// Split vertically: the citizen roster owns the LEFT half, the right half is
// reserved for the Mayor interview (Stage 3). Each side scrolls on its own,
// so adding the interview later won't reflow or shrink the roster.

const LONG_WALK_TILES = 50; // matches LONG_WALK_THRESHOLD in citizenPrompt.ts

type Props = {
  city: City;
  day: number;
  tick: number;
  fireLog: FireRecord[];
  /** Saved-city name, or whatever the user typed in the save box. Null if unnamed. */
  cityName: string | null;
  onClose: () => void;
};

const fmtSeconds = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;

// Response times are wall-clock and depend on how far the nearest station is,
// so these thresholds are about relative feel, not a real-world standard.
function responseTone(ms: number): string {
  if (ms <= 8000) return 'text-emerald-300';
  if (ms <= 20000) return 'text-amber-300';
  return 'text-rose-300';
}

function FireLog({ fires }: { fires: FireRecord[] }) {
  if (fires.length === 0) return null;

  const times = fires.map(f => f.elapsedMs);
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const worst = Math.max(...times);
  const best = Math.min(...times);

  return (
    <div
      className="bg-[#0b1220] border-2 border-rose-400/50 px-3 py-2.5 mb-3 font-mono text-[11px]"
      style={{ boxShadow: '3px 3px 0 0 rgba(0,0,0,0.85)' }}
    >
      <div className="flex justify-between items-baseline gap-2 pb-1.5 mb-2 border-b border-white/15">
        <span className="text-rose-300 uppercase tracking-wider">🔥 Fire response</span>
        <span className="text-white/35 text-[9px] uppercase tracking-wider">
          {fires.length} {fires.length === 1 ? 'call' : 'calls'}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-1 mb-2 text-center">
        {[
          { k: 'average', v: fmtSeconds(avg), tone: responseTone(avg) },
          { k: 'fastest', v: fmtSeconds(best), tone: 'text-white/70' },
          { k: 'slowest', v: fmtSeconds(worst), tone: responseTone(worst) },
        ].map(s => (
          <div key={s.k} className="bg-white/5 py-1">
            <div className={`tabular-nums text-[13px] ${s.tone}`}>{s.v}</div>
            <div className="text-[8px] uppercase tracking-wider text-white/35">{s.k}</div>
          </div>
        ))}
      </div>

      {/* Every call, newest first. */}
      <div className="space-y-0.5 max-h-40 overflow-y-auto pr-1">
        {[...fires].reverse().map((f, i) => (
          <div key={i} className="flex justify-between gap-2 items-baseline">
            <span className="truncate text-white/80">{f.label}</span>
            <span className="shrink-0 flex items-baseline gap-2">
              <span className="text-white/25 text-[9px] tabular-nums">
                ({f.position.x},{f.position.y}) · t{f.tick}
              </span>
              <span className={`tabular-nums ${responseTone(f.elapsedMs)}`}>
                {fmtSeconds(f.elapsedMs)}
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const NEED_COLORS: Record<string, string> = {
  Hunger: '#f59e0b',
  Boredom: '#a78bfa',
  Tiredness: '#60a5fa',
};

function NeedBar({ label, value, rate }: { label: string; value: number; rate: number }) {
  const pct = Math.min(100, Math.max(0, (value / 10) * 100));
  // 7+ is the threshold at which an unmet want gets recorded, so flag it here
  // too — it explains why a citizen has complaints.
  const urgent = value >= 7;
  return (
    <div className="flex items-center gap-2">
      <span className="w-[52px] text-white/55 text-[9px] uppercase tracking-wider">{label}</span>
      <div className="flex-1 h-1.5 bg-white/10 relative">
        <div className="absolute inset-y-0 left-0" style={{ width: `${pct}%`, background: NEED_COLORS[label] }} />
      </div>
      <span className={`w-7 text-right tabular-nums text-[10px] ${urgent ? 'text-amber-300' : 'text-white/70'}`}>
        {value.toFixed(1)}
      </span>
      <span className="w-11 text-right tabular-nums text-[9px] text-white/30">+{rate.toFixed(2)}</span>
    </div>
  );
}

function statusOf(c: Person): { text: string; tone: string } {
  if (c.inside_property) {
    return { text: `Inside ${formatPropertyLabel(c.inside_property)}`, tone: 'text-emerald-300' };
  }
  if (c.current_path.length > 0 && c.current_destination) {
    return { text: `Walking to ${formatPropertyLabel(c.current_destination)}`, tone: 'text-sky-300' };
  }
  return { text: 'Between destinations', tone: 'text-white/40' };
}

const UNMET_LABEL: Record<string, string> = {
  no_option: 'nowhere in the city could help',
  unreachable: 'no walkable route to anywhere that could help',
};

function CitizenCard({ citizen, city }: { citizen: Person; city: City }) {
  const c = citizen;
  const status = statusOf(c);

  const employer = c.job
    ? city.all_properties.find(p => p.name === 'office' && p.company_name === c.job)
    : undefined;
  const employerBlurb = employer ? businessBlurb(employer) : null;

  const done = c.trips.filter(t => t.arrived_tick !== undefined);
  const tiles = done.reduce((sum, t) => sum + t.distance_tiles, 0);
  const longWalks = done.filter(t => t.distance_tiles > LONG_WALK_TILES).length;
  const longest = done.reduce((m, t) => Math.max(m, t.distance_tiles), 0);
  const unmet = c.unmet_wants ?? [];

  // Most-visited destinations, so the card shows a habit rather than a log dump.
  const visits = new Map<string, number>();
  for (const t of done) {
    const key = formatTripDestination(t);
    visits.set(key, (visits.get(key) ?? 0) + 1);
  }
  const topPlaces = [...visits].sort((a, b) => b[1] - a[1]).slice(0, 4);
  const recent = [...done].slice(-4).reverse();

  return (
    <div
      className="bg-[#0b1220] border-2 border-white/80 px-3 py-2.5 font-mono text-[11px] leading-tight"
      style={{ boxShadow: '3px 3px 0 0 rgba(0,0,0,0.85)' }}
    >
      {/* Identity */}
      <div className="flex justify-between items-baseline gap-2 pb-1.5 mb-2 border-b border-white/15">
        <span className="text-fuchsia-300 uppercase tracking-wider truncate">{c.name}</span>
        <span className="text-white/35 text-[9px] uppercase tracking-wider shrink-0">
          {citizenGender(c)} · {c.age_group}
        </span>
      </div>

      <div className="space-y-0.5 mb-2">
        <div className="flex justify-between gap-2">
          <span className="text-white/45">Job</span>
          <span className="truncate text-right">{c.job ? `Engineer @ ${c.job}` : 'Unemployed'}</span>
        </div>
        {employerBlurb && (
          <div className="text-white/35 italic text-[9.5px] leading-snug text-right">{employerBlurb}</div>
        )}
        <div className="flex justify-between gap-2">
          <span className="text-white/45">Home</span>
          <span className="truncate">{PROPERTY_LABELS[c.home.name] ?? c.home.name}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-white/45">Status</span>
          <span className={`truncate text-right ${status.tone}`}>{status.text}</span>
        </div>
      </div>

      {/* Needs at the moment the run ended */}
      <div className="space-y-1 mb-2.5">
        <NeedBar label="Hunger" value={c.hunger} rate={c.hunger_rate} />
        <NeedBar label="Boredom" value={c.boredom} rate={c.boredom_rate} />
        <NeedBar label="Tiredness" value={c.tiredness} rate={c.tiredness_rate} />
      </div>

      {/* Activity totals */}
      <div className="grid grid-cols-4 gap-1 mb-2 text-center">
        {[
          { k: 'trips', v: done.length },
          { k: 'tiles', v: tiles },
          { k: 'longest', v: longest },
          { k: 'long walks', v: longWalks },
        ].map(s => (
          <div key={s.k} className="bg-white/5 py-1">
            <div className="tabular-nums text-white">{s.v}</div>
            <div className="text-[8px] uppercase tracking-wider text-white/35">{s.k}</div>
          </div>
        ))}
      </div>

      {/* Where they actually spent their time */}
      {topPlaces.length > 0 && (
        <div className="mb-2">
          <div className="text-[8px] uppercase tracking-wider text-white/35 mb-0.5">Most visited</div>
          <div className="space-y-0.5">
            {topPlaces.map(([place, n]) => (
              <div key={place} className="flex justify-between gap-2">
                <span className="truncate text-white/80">{place}</span>
                <span className="tabular-nums text-white/40 shrink-0">×{n}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {recent.length > 0 && (
        <div className="mb-2">
          <div className="text-[8px] uppercase tracking-wider text-white/35 mb-0.5">Recent trips</div>
          <div className="space-y-0.5">
            {recent.map((t, i) => (
              <div key={i} className="flex justify-between gap-2">
                <span className="truncate text-white/70">{formatTripDestination(t)}</span>
                <span
                  className={`tabular-nums shrink-0 ${
                    t.distance_tiles > LONG_WALK_TILES ? 'text-amber-300' : 'text-white/35'
                  }`}
                >
                  {t.distance_tiles}t
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* The signal that doesn't exist anywhere else: wants they couldn't act on */}
      {unmet.length > 0 ? (
        <div className="border-t border-white/15 pt-1.5">
          <div className="text-[8px] uppercase tracking-wider text-rose-300/70 mb-0.5">Unmet wants</div>
          <div className="space-y-0.5">
            {unmet.map((u, i) => (
              <div key={i} className="text-rose-200/80 text-[10px] leading-snug">
                Was <span className="text-rose-300">{u.need}</span> — {UNMET_LABEL[u.reason] ?? u.reason}
                <span className="text-white/30"> (×{u.count})</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="border-t border-white/15 pt-1.5 text-[10px] text-emerald-300/50">
          No unmet wants — the city met every need.
        </div>
      )}
    </div>
  );
}

export function SimulationReport({ city, day, tick, fireLog, cityName, onClose }: Props) {
  const citizens = city.all_citizens;

  // City-wide totals. Same numbers the Mayor briefing will eventually use.
  const allDone = citizens.flatMap(c => c.trips.filter(t => t.arrived_tick !== undefined));
  const totalTiles = allDone.reduce((s, t) => s + t.distance_tiles, 0);
  const unmetCitizens = citizens.filter(c => (c.unmet_wants ?? []).length > 0);
  const unmetTotal = citizens.reduce(
    (s, c) => s + (c.unmet_wants ?? []).reduce((n, u) => n + u.count, 0),
    0,
  );

  const avgResponseMs = fireLog.length > 0
    ? fireLog.reduce((s, f) => s + f.elapsedMs, 0) / fireLog.length
    : null;

  const summary: Array<{ k: string; v: string | number; alert?: boolean }> = [
    { k: 'citizens', v: citizens.length },
    { k: 'trips', v: allDone.length },
    { k: 'tiles walked', v: totalTiles },
    { k: 'ticks', v: tick },
    { k: 'citizens stuck', v: unmetCitizens.length, alert: unmetCitizens.length > 0 },
    // Dash rather than 0.0s when there were no fires — an average of nothing
    // isn't zero, and showing "0.0s" would read as a perfect score.
    { k: 'avg fire response', v: avgResponseMs === null ? '—' : fmtSeconds(avgResponseMs) },
  ];

  return (
    <div
      data-mayor-ui
      className="absolute inset-0 z-40 flex flex-col bg-[#050a14]/97 font-mono text-white"
      onPointerDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
    >
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between gap-4 px-5 py-3 border-b-2 border-white/20">
        <div className="flex items-baseline gap-3 min-w-0">
          <span className="text-fuchsia-300 uppercase tracking-widest text-[13px]">Simulation Report</span>
          <span className="text-white/50 text-[10px] uppercase tracking-wider shrink-0">Day {day}</span>
          <span className="text-white/35 text-[10px] truncate">
            {unmetTotal > 0
              ? `${unmetCitizens.length} of ${citizens.length} citizens hit a want the city couldn't serve`
              : 'every citizen got where they needed to go'}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 px-3 py-1.5 text-[10px] uppercase tracking-wider bg-[#0b1220] border-2 border-white/90 hover:bg-[#1a2540] transition-colors"
          style={{ boxShadow: '3px 3px 0 0 rgba(0,0,0,0.85)' }}
        >
          ✕ back to city
        </button>
      </div>

      {/* City totals */}
      <div className="shrink-0 grid grid-cols-3 md:grid-cols-6 gap-2 px-5 py-3 border-b border-white/10">
        {summary.map(s => (
          <div key={s.k} className="bg-white/5 border border-white/10 py-1.5 text-center">
            <div className={`tabular-nums text-[15px] ${s.alert ? 'text-rose-300' : 'text-white'}`}>{s.v}</div>
            <div className="text-[8px] uppercase tracking-wider text-white/35">{s.k}</div>
          </div>
        ))}
      </div>

      {/* Vertical split: roster on the left, Mayor debrief on the right.
          Each side scrolls on its own so a long roster never pushes the
          interview off-screen. */}
      <div className="flex-1 min-h-0 flex">
        {/* LEFT HALF — citizen roster, two per row. */}
        <div className="w-1/2 shrink-0 overflow-y-auto px-5 py-4">
          {/* Fire log sits above the roster and scrolls with it. */}
          <FireLog fires={fireLog} />
          {citizens.length === 0 ? (
            <div className="text-white/40 italic text-[12px]">
              No citizens in this run — build some houses and start the simulation.
            </div>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
              {citizens.map((c, i) => (
                <CitizenCard key={`${c.name}-${i}`} citizen={c} city={city} />
              ))}
            </div>
          )}
        </div>

        {/* RIGHT HALF — Mayor debrief. */}
        <MayorDebrief
          city={city}
          fireLog={fireLog}
          cityName={cityName}
          day={day}
          ticks={tick}
        />
      </div>
    </div>
  );
}
