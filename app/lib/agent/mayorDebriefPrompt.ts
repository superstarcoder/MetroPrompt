// The MAYOR_DEBRIEF agent.
//
// Distinct from the build-phase Mayor in `mayor.ts`, which lays roads and
// delegates zones. This one has NO tools and never touches the city: it reads
// the finished simulation and talks the city planner through what happened.
// Keeping them in separate modules keeps the prompts from drifting into each
// other.

// MODEL NOTE — read before changing.
//
// The request was "latest Opus, thinking off". Deepgram's Voice Agent `think`
// provider does not offer any Opus model. Querying
// GET https://agent.deepgram.com/v1/agent/settings/think/models returns exactly
// four Anthropic options: claude-haiku-4-5, claude-sonnet-4-5, claude-sonnet-4-6
// and claude-sonnet-5. So this is the most capable model actually reachable
// through the Voice Agent socket.
//
// Getting Opus here would mean bypassing Deepgram's think provider entirely —
// either via `think.endpoint` (a custom LLM URL that Deepgram's servers must be
// able to reach, so not localhost) or by dropping to raw Listen + Speak sockets
// and running our own loop, which would forfeit Deepgram's turn detection and
// barge-in.
export const MAYOR_DEBRIEF_MODEL = 'claude-sonnet-5';

// Extended thinking is opt-in on the Messages API and Deepgram never requests
// it, so the debrief runs without it. There is no knob to set — its absence is
// the setting. Tools are likewise off by construction: no `functions` key is
// ever sent in the Settings payload.

// A warm, measured voice — the Mayor should sound like someone who has read
// the file and wants to work the problem, not a newsreader.
export const MAYOR_DEBRIEF_VOICE = 'aura-2-apollo-en';

export type DebriefCitizen = {
  name: string;
  job: string | null;
  home: string;
  needs: { hunger: number; boredom: number; tiredness: number };
  trips: number;
  tiles: number;
  longWalks: number;
  topPlace: string | null;
  unmet: Array<{ need: string; reason: string; times: number }>;
};

export type DebriefFire = {
  label: string;
  seconds: number;
};

export type MayorDebriefContext = {
  cityName: string | null;
  day: number;
  ticks: number;
  directory: {
    businesses: Array<{ name: string; kind: string; blurb: string }>;
    amenities: Array<{ label: string; count: number }>;
  };
  citizens: DebriefCitizen[];
  fires: DebriefFire[];
};

const pct = (n: number, of: number): number => (of === 0 ? 0 : Math.round((n / of) * 100));

function overview(c: MayorDebriefContext): string {
  const pop = c.citizens.length;
  const trips = c.citizens.reduce((s, x) => s + x.trips, 0);
  const tiles = c.citizens.reduce((s, x) => s + x.tiles, 0);
  const longWalks = c.citizens.reduce((s, x) => s + x.longWalks, 0);
  const stuck = c.citizens.filter(x => x.unmet.length > 0).length;

  const hungry = c.citizens.filter(x => x.needs.hunger >= 7).length;
  const bored = c.citizens.filter(x => x.needs.boredom >= 7).length;
  const tired = c.citizens.filter(x => x.needs.tiredness >= 7).length;

  return [
    'RUN SUMMARY',
    `- Population ${pop}; ran ${c.ticks} ticks, ended on day ${c.day}.`,
    `- ${trips} completed trips, ${tiles} tiles walked, average ${trips ? Math.round(tiles / trips) : 0} tiles per trip.`,
    `- ${longWalks} trips (${pct(longWalks, trips)}%) were over 50 tiles — long enough that people notice.`,
    `- Ended the run with high needs (7+): ${hungry} hungry, ${bored} bored, ${tired} tired.`,
    `- ${stuck} of ${pop} citizens hit something they wanted and could not act on.`,
  ].join('\n');
}

// The aggregate that matters most: what people wanted and couldn't get.
function unmetSummary(c: MayorDebriefContext): string {
  const byKey = new Map<string, { need: string; reason: string; citizens: number; times: number }>();
  for (const p of c.citizens) {
    for (const u of p.unmet) {
      const key = `${u.need}|${u.reason}`;
      const row = byKey.get(key) ?? { need: u.need, reason: u.reason, citizens: 0, times: 0 };
      row.citizens += 1;
      row.times += u.times;
      byKey.set(key, row);
    }
  }
  if (byKey.size === 0) return 'UNMET WANTS\n- None. Every citizen could act on every need.';

  const explain: Record<string, string> = {
    no_option: 'nothing in the city serves that need',
    unreachable: 'it exists but there is no walkable route',
  };
  const rows = [...byKey.values()]
    .sort((a, b) => b.citizens - a.citizens)
    .map(r => `- ${r.citizens} citizens were ${r.need} and stuck: ${explain[r.reason] ?? r.reason} (${r.times} times total)`);
  return ['UNMET WANTS', ...rows].join('\n');
}

function fireSummary(c: MayorDebriefContext): string {
  if (c.fires.length === 0) return 'FIRE RESPONSE\n- No fires this run.';
  const times = c.fires.map(f => f.seconds);
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const worst = Math.max(...times);
  const lines = c.fires.map(f => `- ${f.label}: ${f.seconds.toFixed(1)}s`);
  return [
    'FIRE RESPONSE',
    `- ${c.fires.length} calls, average ${avg.toFixed(1)}s, slowest ${worst.toFixed(1)}s.`,
    ...lines,
  ].join('\n');
}

function cityLayout(c: MayorDebriefContext): string {
  const lines = ['WHAT IS BUILT'];
  for (const b of c.directory.businesses) lines.push(`- ${b.name} (${b.kind}): ${b.blurb}`);
  if (c.directory.amenities.length > 0) {
    lines.push(
      `- Also: ${c.directory.amenities
        .map(a => (a.count > 1 ? `${a.count} ${a.label}s` : `1 ${a.label}`))
        .join(', ')}.`,
    );
  }
  if (c.directory.businesses.length === 0 && c.directory.amenities.length === 0) {
    lines.push('- Essentially nothing was built.');
  }
  return lines.join('\n');
}

// One line per citizen. Dense on purpose — the Mayor should be able to name a
// specific resident, and that is only possible if every resident is present.
function roster(c: MayorDebriefContext): string {
  if (c.citizens.length === 0) return 'RESIDENTS\n- Nobody lives here yet.';
  const lines = c.citizens.map(p => {
    const bits = [
      `${p.name} (${p.job ? `works at ${p.job}` : 'unemployed'}, ${p.home})`,
      `${p.trips} trips / ${p.tiles} tiles / ${p.longWalks} long`,
      `hunger ${p.needs.hunger.toFixed(0)}, boredom ${p.needs.boredom.toFixed(0)}, tired ${p.needs.tiredness.toFixed(0)}`,
    ];
    if (p.topPlace) bits.push(`most at ${p.topPlace}`);
    for (const u of p.unmet) bits.push(`STUCK: ${u.need} x${u.times}`);
    return `- ${bits.join('; ')}`;
  });
  return ['RESIDENTS', ...lines].join('\n');
}

export function buildMayorDebriefPrompt(c: MayorDebriefContext): string {
  const cityName = c.cityName?.trim() || null;

  return [
    `You are the Mayor of ${cityName ?? 'this city'}. You are speaking with the city planner who designed and built it — the person who laid every road and placed every building.`,
    cityName
      ? `Always call the city by name: ${cityName}.`
      : 'The city has not been named yet, so just call it "the city".',
    '',
    'This is a debrief. The simulation has finished and you have read the whole report. Your job is to help the planner understand what worked, what did not, and what to do next.',
    '',
    'TONE',
    // Without a hard cap this reliably produces 100-word, three-paragraph
    // answers — fine on a page, about forty seconds of audio out loud.
    '- Hard limit: 60 words. Two or three sentences. This is a conversation, not a briefing document.',
    '- If there is more to say, give the headline and offer to go deeper. Do not cover three topics in one turn.',
    '- Warm and respectful, lightly formal — a professional who likes working with them.',
    '- Open by thanking them for the work they put into building this city. Mean it.',
    '- Ask what they want to dig into rather than reciting the whole report at once.',
    '- Never read numbers off like a spreadsheet. Use them to make a point.',
    '',
    'HOW TO BE USEFUL',
    '- Ground every claim in the data below. Name real residents and real places.',
    '- Lead with the pattern, then the evidence. "People are walking too far to eat — nine residents, and the average trip is over sixty tiles."',
    '- Always pair a problem with a concrete, buildable fix: where to put the thing, not just what is missing.',
    '- Be specific and imaginative with suggestions. A grocery store in the northeast gap. A second fire station to halve response time. Restaurants clustered near the offices so lunch is not a hike.',
    '- If something went well, say so plainly. Do not manufacture problems.',
    '',
    'ISSUES THAT COMMONLY SHOW UP — check the data before raising any of them:',
    '- Amenities missing entirely, so a need can never be met.',
    '- Amenities that exist but sit too far from housing, producing long walks.',
    '- Everything clustered in one corner, leaving a dead quarter of the map.',
    '- Fire stations too far out, so response times run long.',
    '- Housing and workplaces separated with nothing in between.',
    '- Buildings cut off from the road and sidewalk network entirely.',
    '',
    'HARD RULES',
    '- Only discuss what is in the report. Never invent a resident, business, or statistic.',
    '- If the planner asks something the data does not cover, say so and offer what you do know.',
    '- You have no ability to build anything. You advise; they build.',
    '',
    '=== SIMULATION REPORT ===',
    '',
    overview(c),
    '',
    unmetSummary(c),
    '',
    fireSummary(c),
    '',
    cityLayout(c),
    '',
    roster(c),
    '',
    '=== END REPORT ===',
    '',
    'Spoken out loud by a speech synthesizer: no markdown, lists, or emoji. Numbers as words ("about sixty tiles", not "60"). Keep every turn under 60 words — long answers are painful to listen to. If interrupted, answer the new question and do not restart.',
  ].join('\n');
}

export function mayorDebriefGreeting(c: MayorDebriefContext): string {
  const name = c.cityName?.trim();
  return name
    ? `Thanks for coming in — and thank you for the work you put into ${name}. I've been through the reports. Where would you like to start?`
    : `Thanks for coming in — and thank you for all the work you put into building this place. I've been through the reports. Where would you like to start?`;
}

// Seed the STT with the proper nouns the planner is most likely to say back.
export function mayorDebriefKeyterms(c: MayorDebriefContext): string[] {
  const terms = new Set<string>([
    'city planner', 'fire station', 'response time', 'grocery store', 'restaurant',
    'apartment', 'sidewalk', 'crosswalk', 'theme park', 'shopping mall', 'power plant',
    'police station', 'hospital', 'walkability', 'zoning',
  ]);
  if (c.cityName?.trim()) terms.add(c.cityName.trim());
  for (const b of c.directory.businesses) terms.add(b.name);
  // Residents by first name — the planner will refer to them that way.
  for (const p of c.citizens) {
    const first = p.name.split(/\s+/)[0];
    if (first.length > 2) terms.add(first);
  }
  return [...terms].slice(0, 50);
}

export function isMayorDebriefContext(v: unknown): v is MayorDebriefContext {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    (o.cityName === null || typeof o.cityName === 'string') &&
    typeof o.day === 'number' &&
    typeof o.ticks === 'number' &&
    Array.isArray(o.citizens) &&
    Array.isArray(o.fires) &&
    typeof o.directory === 'object' && o.directory !== null
  );
}
