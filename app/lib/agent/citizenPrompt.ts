// Shared citizen persona logic. Used by BOTH the text chat route
// (/api/citizen-chat) and the Voice Agent session (/api/voice-agent/token),
// so the two can't drift into different characters for the same citizen.

export type CitizenContext = {
  name: string;
  age_group: 'adult' | 'child';
  gender: 'male' | 'female';  // selects the TTS voice pool
  job: string | null;          // company name (offices) or null
  home_type: string;           // "house" | "apartment"
  needs: { hunger: number; boredom: number; tiredness: number };
  // Status snapshot at chat time.
  status: 'walking' | 'inside' | 'idle';
  current_destination?: string; // formatted label, e.g. "Hooli (Office)"
  current_property?: string;    // formatted label when status === 'inside'
  // Completed trips (arrived_tick set). distance_tiles is the path length.
  trips: Array<{ destination: string; distance: number }>;
};

const LONG_WALK_THRESHOLD = 50; // tiles — anything beyond this "feels long"
const MAX_RECENT_TRIPS = 6;     // how many recent trips to surface in the prompt

function jobDescription(job: string | null): string {
  return job ? `Engineer at ${job}` : 'currently unemployed';
}

function summarizeTrips(trips: CitizenContext['trips']): string {
  if (trips.length === 0) {
    return "You haven't been anywhere yet — the simulation just started.";
  }
  const total = trips.length;
  const longWalks = trips.filter(t => t.distance > LONG_WALK_THRESHOLD).length;
  const recent = trips.slice(-MAX_RECENT_TRIPS);
  const recentLines = recent.map(t => {
    const tag = t.distance > LONG_WALK_THRESHOLD ? ' (long walk!)' : '';
    return `- ${t.destination} — ${t.distance} tiles${tag}`;
  }).join('\n');
  const pct = Math.round((longWalks / total) * 100);
  return [
    `Recent trips (last ${recent.length} of ${total}):`,
    recentLines,
    '',
    `Stats: ${total} trips total, ${longWalks} over ${LONG_WALK_THRESHOLD} tiles (${pct}% long walks).`,
  ].join('\n');
}

function statusLine(c: CitizenContext): string {
  if (c.status === 'inside' && c.current_property) {
    return `Right now: inside ${c.current_property}.`;
  }
  if (c.status === 'walking' && c.current_destination) {
    return `Right now: walking to ${c.current_destination}.`;
  }
  return 'Right now: between destinations.';
}

export function buildCitizenSystemPrompt(c: CitizenContext): string {
  return [
    `You are ${c.name}, a resident of a small city. You're roleplaying — respond AS them, in first person, casually. You're a regular person, not an AI assistant.`,
    '',
    'Profile:',
    `- Job: ${jobDescription(c.job)}`,
    `- Home: ${c.home_type}`,
    '',
    `Current needs (1 = fine, 10 = urgent):`,
    `- Hunger: ${c.needs.hunger.toFixed(1)}/10`,
    `- Boredom: ${c.needs.boredom.toFixed(1)}/10`,
    `- Tiredness: ${c.needs.tiredness.toFixed(1)}/10`,
    '',
    statusLine(c),
    '',
    summarizeTrips(c.trips),
    '',
    'Rules for your reply:',
    '- VERY SHORT: 1-2 sentences max. Be terse.',
    '- Stay in character. Talk naturally, like a person texting a friend.',
    '- If a need is high (>7) or many of your trips have been long walks, let that color your tone naturally — don\'t force it.',
    "- Don't list stats at the user. Just answer.",
    '- If asked broadly how you like the city (or anything similar — "how\'s life", "your thoughts on the place", etc.), name at least ONE thing you like. Feel free to also include any improvements (eg: more bike lanes, more walkable distances, more restaurants/cafes, etc.) Fit both into your 1-2 sentences.',
  ].join('\n');
}

// Voice variant of the same persona. Spoken replies need slightly different
// rules than typed ones: no markdown, no lists, and contractions so TTS
// doesn't sound stilted.
export function buildCitizenVoicePrompt(c: CitizenContext): string {
  return [
    buildCitizenSystemPrompt(c),
    '',
    'You are being interviewed OUT LOUD — your reply is read by a speech synthesizer:',
    '- Never use markdown, bullet points, numbers, or emoji. Plain spoken sentences only.',
    '- Use contractions and natural filler the way people actually talk.',
    '- Say numbers as words ("about forty tiles", not "40").',
    '- Keep it to one or two sentences. Long answers are painful to listen to.',
    '- If interrupted, stop and answer the new question. Do not restart the old answer.',
  ].join('\n');
}

export function isCitizenContext(v: unknown): v is CitizenContext {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.name === 'string' &&
    (o.age_group === 'adult' || o.age_group === 'child') &&
    (o.gender === 'male' || o.gender === 'female') &&
    (o.job === null || typeof o.job === 'string') &&
    typeof o.home_type === 'string' &&
    typeof o.needs === 'object' && o.needs !== null &&
    Array.isArray(o.trips)
  );
}

// ============================================================
// VOICE SELECTION
// ============================================================
// Two properties matter here:
//
//   1. A citizen must sound the SAME every time you talk to them, or they stop
//      reading as a character. So the voice is a deterministic hash of the
//      name, never a random pick — no per-citizen voice field to persist.
//   2. The voice must match the citizen's gender, which is stored on the
//      Person at spawn (and which also drives their name, and later their
//      sprite). The hash therefore selects WITHIN a gender pool.
//
// Deepgram names Aura-2 voices after mythological figures and follows that
// convention for voice gender, which is how these pools are split. Every ID
// below was checked against the voice list shipped in @deepgram/sdk.

const FEMALE_VOICES = [
  'aura-2-thalia-en', 'aura-2-andromeda-en', 'aura-2-asteria-en', 'aura-2-hera-en',
  'aura-2-cora-en', 'aura-2-juno-en', 'aura-2-ophelia-en', 'aura-2-selene-en',
  'aura-2-athena-en', 'aura-2-aurora-en', 'aura-2-helena-en', 'aura-2-minerva-en',
] as const;

const MALE_VOICES = [
  'aura-2-arcas-en', 'aura-2-apollo-en', 'aura-2-orion-en', 'aura-2-draco-en',
  'aura-2-hermes-en', 'aura-2-mars-en', 'aura-2-odysseus-en', 'aura-2-atlas-en',
  'aura-2-jupiter-en', 'aura-2-neptune-en', 'aura-2-orpheus-en', 'aura-2-zeus-en',
] as const;

export function pickCitizenVoice(name: string, gender: 'male' | 'female'): string {
  // FNV-1a — small, stable, and no dependency. Any stable hash works; what
  // matters is that the same name always maps to the same voice.
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const pool = gender === 'female' ? FEMALE_VOICES : MALE_VOICES;
  return pool[h % pool.length];
}

// ============================================================
// KEYTERMS
// ============================================================
// Nova/Flux mangles domain vocabulary it has no reason to expect. Seeding the
// citizen's own name plus the places they've actually been fixes the words a
// user is most likely to say back at them.

const PLACE_TERMS = [
  'grocery store', 'restaurant', 'apartment', 'theme park', 'shopping mall',
  'fire station', 'police station', 'power plant', 'hospital', 'school', 'park',
];

export function citizenKeyterms(c: CitizenContext): string[] {
  const terms = new Set<string>(PLACE_TERMS);
  // Full name and each part — users say "Ezra" as often as "Ezra Nguyen".
  terms.add(c.name);
  for (const part of c.name.split(/\s+/)) if (part.length > 2) terms.add(part);
  if (c.job) terms.add(c.job);
  for (const t of c.trips) {
    // Trip labels look like "Hooli (Office)" — the bare name is the useful term.
    const bare = t.destination.replace(/\s*\(.*\)\s*$/, '').trim();
    if (bare) terms.add(bare);
  }
  return Array.from(terms).slice(0, 50);
}
