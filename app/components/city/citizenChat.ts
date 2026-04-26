import type { Person } from '@/lib/all_types';
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
  job: string | null;
  home_type: string;
  needs: { hunger: number; boredom: number; tiredness: number };
  status: 'walking' | 'inside' | 'idle';
  current_destination?: string;
  current_property?: string;
  trips: Array<{ destination: string; distance: number }>;
};

// Build the chat payload from a Person object. Only completed trips are sent
// (arrived_tick set) — abandoned trips don't reflect real walking experience.
export function buildCitizenContext(c: Person): CitizenChatContext {
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
    job: c.job,
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
  history: ChatTurn[],
  question: string,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch('/api/citizen-chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: buildMessages(history, question),
      citizen: buildCitizenContext(citizen),
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
