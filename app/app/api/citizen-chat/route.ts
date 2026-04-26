import Anthropic from '@anthropic-ai/sdk';

// POST /api/citizen-chat — one-shot citizen chat (no agent, no conversation
// history). Takes a citizen profile snapshot + a single user question and
// returns a 1-2 sentence in-character reply via the plain Messages API.
//
// Each call is independent: every chat round sends a fresh system prompt
// built from the citizen's current state. No prompt caching — the system
// prompt is per-citizen and short, and citizen state evolves between turns.

type CitizenContext = {
  name: string;
  age_group: 'adult' | 'child';
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

type ApiMessage = { role: 'user' | 'assistant'; content: string };
type ChatBody = { messages?: unknown; citizen?: unknown };

const CHAT_MODEL = 'claude-haiku-4-5';
const MAX_TOKENS = 120;
const LONG_WALK_THRESHOLD = 50; // tiles — anything beyond this "feels long"
const MAX_RECENT_TRIPS = 6;     // how many recent trips to surface in the prompt
const MAX_MESSAGES = 30;        // hard cap on chat history (15 turns)
const MAX_CONTENT_LENGTH = 1000; // per-message char cap

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) _client = new Anthropic();
  return _client;
}

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

function buildSystemPrompt(c: CitizenContext): string {
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

function isCitizenContext(v: unknown): v is CitizenContext {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.name === 'string' &&
    (o.age_group === 'adult' || o.age_group === 'child') &&
    (o.job === null || typeof o.job === 'string') &&
    typeof o.home_type === 'string' &&
    typeof o.needs === 'object' && o.needs !== null &&
    Array.isArray(o.trips)
  );
}

// Validates and normalizes the chat history. Must be a non-empty array of
// alternating user/assistant messages, starting with user and ending with
// user (so the model has something to respond to). Returns null on invalid.
function validateMessages(v: unknown): ApiMessage[] | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > MAX_MESSAGES) return null;
  const out: ApiMessage[] = [];
  for (let i = 0; i < v.length; i++) {
    const m = v[i];
    if (!m || typeof m !== 'object') return null;
    const role = (m as Record<string, unknown>).role;
    const content = (m as Record<string, unknown>).content;
    if (role !== 'user' && role !== 'assistant') return null;
    if (typeof content !== 'string') return null;
    const trimmed = content.trim();
    if (!trimmed || trimmed.length > MAX_CONTENT_LENGTH) return null;
    // Alternate strictly. Start with user, end with user.
    const expected = i % 2 === 0 ? 'user' : 'assistant';
    if (role !== expected) return null;
    out.push({ role, content: trimmed });
  }
  if (out[out.length - 1].role !== 'user') return null;
  return out;
}

export async function POST(req: Request): Promise<Response> {
  let body: ChatBody;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const messages = validateMessages(body.messages);
  if (!messages) {
    return Response.json({
      error: 'invalid "messages" field — expected non-empty alternating user/assistant array ending with a user message',
    }, { status: 400 });
  }
  if (!isCitizenContext(body.citizen)) {
    return Response.json({ error: 'invalid or missing "citizen" field' }, { status: 400 });
  }

  try {
    const response = await client().messages.create({
      model: CHAT_MODEL,
      max_tokens: MAX_TOKENS,
      system: buildSystemPrompt(body.citizen),
      messages,
    });

    // Pull the first text block. Haiku in non-thinking mode returns a single
    // text block; defensive in case future models add other block types.
    const textBlock = response.content.find(b => b.type === 'text');
    const reply = textBlock && textBlock.type === 'text' ? textBlock.text.trim() : '';
    if (!reply) {
      return Response.json({ error: 'empty reply from model' }, { status: 502 });
    }
    return Response.json({ reply });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[api/citizen-chat]', msg);
    return Response.json({ error: msg }, { status: 500 });
  }
}
