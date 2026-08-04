import { citizenGender, type City, type Person } from '@/lib/all_types';
import { businessBlurb } from '@/lib/sim/companies';
import { formatPropertyLabel, formatTripDestination, PROPERTY_LABELS } from './propertyLabels';

// One completed exchange in the chat with a citizen.
export type ChatTurn = { question: string; reply: string };

// Continuous chat state for the currently-selected citizen. Reset whenever
// selection changes. The bubble derives what to show from these three fields:
//   pending → thinking dots
//   error → error message
//   history.length > 0 → most recent reply
//   else → no bubble
export type ChatState = {
  history: ChatTurn[];
  pending: boolean;
  error: string | null;
};

export const initialChatState: ChatState = { history: [], pending: false, error: null };

// Snapshot of a citizen's state to send to /api/citizen-chat.
export type CitizenChatContext = {
  name: string;
  age_group: 'adult' | 'child';
  gender: 'male' | 'female';
  job: string | null;
  job_blurb: string | null;
  home_type: string;
  directory: {
    businesses: Array<{ name: string; kind: string; blurb: string }>;
    amenities: Array<{ label: string; count: number }>;
  };
  needs: { hunger: number; boredom: number; tiredness: number };
  status: 'walking' | 'inside' | 'idle';
  current_destination?: string;
  current_property?: string;
  trips: Array<{ destination: string; distance: number }>;
};

// Everything the citizen knows about their own city: named businesses with
// what they do, plus counts of the unnamed amenity types. Built from the city
// that was ACTUALLY constructed — so citizens can't recommend a restaurant
// that was never placed, and a missing hospital reads to them as missing.
function buildDirectory(city: City): CitizenChatContext['directory'] {
  const businesses: CitizenChatContext['directory']['businesses'] = [];
  const counts = new Map<string, number>();

  for (const p of city.all_properties) {
    const label = PROPERTY_LABELS[p.name] ?? p.name;
    const blurb = businessBlurb(p);
    if (p.company_name && blurb) {
      businesses.push({ name: p.company_name, kind: label, blurb });
    } else if (p.name !== 'house' && p.name !== 'apartment') {
      // Homes are noise here — every citizen has one and nobody discusses
      // the housing stock by count.
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }

  return {
    businesses,
    amenities: [...counts].map(([label, count]) => ({ label, count })),
  };
}

// What the citizen's employer actually does. `Person.job` stores the company
// name, so find the matching office and read its profile.
function employerBlurb(c: Person, city: City): string | null {
  if (!c.job) return null;
  const office = city.all_properties.find(
    p => p.name === 'office' && p.company_name === c.job,
  );
  return office ? businessBlurb(office) : null;
}

// Build the chat payload from a Person object. Only completed trips are sent
// (arrived_tick set) — abandoned trips don't reflect real walking experience.
export function buildCitizenContext(c: Person, city: City): CitizenChatContext {
  let status: 'walking' | 'inside' | 'idle' = 'idle';
  let current_destination: string | undefined;
  let current_property: string | undefined;

  if (c.inside_property) {
    status = 'inside';
    current_property = formatPropertyLabel(c.inside_property);
  } else if (c.current_path.length > 0) {
    status = 'walking';
    if (c.current_destination) current_destination = formatPropertyLabel(c.current_destination);
  }

  const trips = c.trips
    .filter(t => t.arrived_tick !== undefined)
    .map(t => ({
      destination: formatTripDestination(t),
      distance: t.distance_tiles,
    }));

  return {
    name: c.name,
    age_group: c.age_group,
    // Resolved rather than read straight off the Person: citizens saved before
    // `gender` existed don't carry one, and citizenGender() hashes the name so
    // those keep the same voice across reloads instead of re-rolling.
    gender: citizenGender(c),
    job: c.job,
    job_blurb: employerBlurb(c, city),
    directory: buildDirectory(city),
    home_type: PROPERTY_LABELS[c.home.name] ?? c.home.name,
    needs: {
      hunger: c.hunger,
      boredom: c.boredom,
      tiredness: c.tiredness,
    },
    status,
    current_destination,
    current_property,
    trips,
  };
}

// API message shape — alternating user/assistant.
type ApiMessage = { role: 'user' | 'assistant'; content: string };

function buildMessages(history: ChatTurn[], pendingQuestion: string): ApiMessage[] {
  const msgs: ApiMessage[] = [];
  for (const turn of history) {
    msgs.push({ role: 'user', content: turn.question });
    msgs.push({ role: 'assistant', content: turn.reply });
  }
  msgs.push({ role: 'user', content: pendingQuestion });
  return msgs;
}

// Send a question to the chat endpoint, threading the prior `history` so
// Claude sees the full conversation. Returns the reply text, or throws.
export async function sendCitizenChat(
  citizen: Person,
  city: City,
  history: ChatTurn[],
  question: string,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch('/api/citizen-chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: buildMessages(history, question),
      citizen: buildCitizenContext(citizen, city),
    }),
    signal,
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.error ?? `chat request failed (${res.status})`);
  }
  const data = await res.json();
  if (typeof data.reply !== 'string' || !data.reply) {
    throw new Error('empty reply from server');
  }
  return data.reply;
}
