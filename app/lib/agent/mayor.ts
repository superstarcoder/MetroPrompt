import Anthropic from '@anthropic-ai/sdk';
import type { BetaManagedAgentsStreamSessionEvents } from '@anthropic-ai/sdk/resources/beta/sessions/events';
import { applyToolCall, TOOL_SCHEMAS } from './tools';
import type { ToolCall, ToolResult } from './tools';
import { initCity } from '../all_types';
import type { City } from '../all_types';

// ============================================================
// MODEL SWAP — one line to flip for demo day.
// ============================================================
// Sonnet 4.6 for iteration (fast, cheap). Flip to 'claude-opus-4-7' for demo.
export const MAYOR_MODEL = 'claude-sonnet-4-6';

const AGENT_NAME = 'MetroPrompt Mayor';
const ENV_NAME_PREFIX = 'metroprompt-env';
const MAX_CUSTOM_TOOL_USES = 70;

const MAYOR_SYSTEM = `You are the Mayor of MetroPrompt, an AI city builder.

Given a goal, build a functional city on a 50×50 grid by emitting tool calls. Aim for a balanced mix of residential (house, apartment), commercial (restaurant, grocery_store, shopping_mall, theme_park, office), civic (school, hospital, park), and infrastructure (fire_station, police_station, power_plant) buildings connected by a road network.

GRID
- 50 columns (x: 0-49) × 50 rows (y: 0-49). Origin (0,0) is top-left.
- Default terrain is grass; buildings sit on grass.

TOOLS
- place_property(property, x, y): anchor one building. Footprint extends DOWN-RIGHT from (x, y).
  * 3×3 footprint: park, hospital, school, grocery_store, apartment, office, fire_station, police_station, power_plant, shopping_mall, theme_park
  * 2×2 footprint: house, restaurant
- place_tile_rect(tile, x1, y1, x2, y2): fill a rectangle of ground tiles (corners inclusive). Tile names: grass, pavement, road_one_way, road_two_way, road_intersection, crosswalk, sidewalk. A single cell is x1=x2, y1=y2. Use this for roads and sidewalks — ONE call lays a whole band.
- finish(reason): signal the city is complete. Call exactly ONCE when you're satisfied.

RULES (enforced — violations return structured errors with coordinates)
1. Building footprints cannot overlap any existing building. Edge-to-edge contact is fine.
2. Footprints must fit in-bounds: x+w ≤ 50, y+h ≤ 50.
3. If a tool fails, read the coordinates in the error message and retry at a valid position.

STRATEGY
1. Sketch block layout mentally before placing anything.
2. Lay the road grid with place_tile_rect (use 'road_two_way'). Roads are typically 2 tiles wide — a horizontal road across the whole grid is ONE call: place_tile_rect("road_two_way", 0, 12, 49, 13).
3. Lay 1-tile sidewalks on both sides of each road.
4. Place buildings inside the resulting blocks.
5. Batch tool calls per turn — emit several in a single response, don't wait for results.
6. Aim for roughly 15-25 buildings total plus the road/sidewalk network.
7. Call finish(reason) when you're satisfied with the city.

Be efficient. The city speaks for itself — no long explanations needed.`;

// ============================================================
// SINGLETON CLIENT
// ============================================================

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) _client = new Anthropic();
  return _client;
}

// ============================================================
// AGENT + ENVIRONMENT BOOTSTRAP (create once, reuse forever)
// ============================================================

// Populated either from env vars (.env.local) or on first create.
// Module-level so subsequent requests in the same process reuse.
let cachedAgentId: string | undefined = process.env.MAYOR_AGENT_ID;
let cachedEnvId: string | undefined = process.env.MAYOR_ENV_ID;

export async function ensureMayor(): Promise<{ agentId: string; envId: string }> {
  if (cachedAgentId && cachedEnvId) {
    return { agentId: cachedAgentId, envId: cachedEnvId };
  }
  const c = client();

  if (!cachedEnvId) {
    // Name must be unique per workspace — append timestamp to avoid 409 on replay.
    const env = await c.beta.environments.create({
      name: `${ENV_NAME_PREFIX}-${Date.now()}`,
      config: { type: 'cloud', networking: { type: 'unrestricted' } },
    });
    cachedEnvId = env.id;
    console.log(`[mayor] created environment ${cachedEnvId}`);
  }

  if (!cachedAgentId) {
    const agent = await c.beta.agents.create({
      name: AGENT_NAME,
      model: MAYOR_MODEL,
      system: MAYOR_SYSTEM,
      tools: TOOL_SCHEMAS.map(s => ({ type: 'custom' as const, ...s })),
    });
    cachedAgentId = agent.id;
    console.log(`[mayor] created agent ${cachedAgentId}`);
  }

  console.log(
    `\n[mayor] ============================================================\n` +
    `[mayor] Add these to .env.local so the next boot reuses them:\n` +
    `[mayor]   MAYOR_AGENT_ID=${cachedAgentId}\n` +
    `[mayor]   MAYOR_ENV_ID=${cachedEnvId}\n` +
    `[mayor] ============================================================\n`
  );

  return { agentId: cachedAgentId, envId: cachedEnvId };
}

// ============================================================
// PER-SESSION STATE (single-process demo)
// ============================================================
// sessionId → { city, pendingGoal, status }
// pendingGoal is set at createMayorSession and consumed by runMayorLoop
// after the stream is open (stream-first ordering).

type SessionState = {
  city: City;
  pendingGoal?: string;
  running: boolean;
  // Set true when the user sends an interrupt; cleared when they send a redirect
  // message. Used by the end_turn gate in runMayorLoop so the loop stays alive
  // across a pause, waiting for the redirect that resumes it.
  interrupted: boolean;
};
const sessions = new Map<string, SessionState>();

export function getSession(sessionId: string): SessionState | undefined {
  return sessions.get(sessionId);
}

export async function createMayorSession(goal: string): Promise<string> {
  const { agentId, envId } = await ensureMayor();
  const session = await client().beta.sessions.create({
    agent: agentId,
    environment_id: envId,
    title: `mayor-${new Date().toISOString()}`,
  });
  sessions.set(session.id, {
    city: initCity(50),
    pendingGoal: goal,
    running: false,
    interrupted: false,
  });
  return session.id;
}

// ============================================================
// USER-SENT EVENTS (interrupt / redirect from the UI)
// ============================================================

export async function sendInterrupt(sessionId: string): Promise<void> {
  const s = sessions.get(sessionId);
  if (s) s.interrupted = true;
  await client().beta.sessions.events.send(sessionId, {
    events: [{ type: 'user.interrupt' }],
  });
}

export async function sendRedirect(sessionId: string, text: string): Promise<void> {
  const s = sessions.get(sessionId);
  if (s) s.interrupted = false;
  await client().beta.sessions.events.send(sessionId, {
    events: [
      {
        type: 'user.message',
        content: [{ type: 'text', text }],
      },
    ],
  });
}

// ============================================================
// EVENT LOOP (stream forward + custom-tool handling)
// ============================================================

export type MayorStreamEvent =
  // Raw event passed through from Anthropic's stream (we forward these to the browser).
  | { kind: 'anthropic_event'; event: BetaManagedAgentsStreamSessionEvents }
  // Our synthetic event after applying a custom tool — useful for the browser to render
  // the ToolResult without reparsing the raw agent.custom_tool_use.
  | {
      kind: 'tool_applied';
      tool_use_id: string;
      name: string;
      input: Record<string, unknown>;
      result: ToolResult;
    }
  // Loop terminated.
  | { kind: 'done'; reason: string };

function parseToolCall(
  name: string,
  input: Record<string, unknown>,
): ToolCall | null {
  // The Mayor's allowed tool names match our dispatcher exactly.
  if (name === 'place_property' || name === 'place_tile_rect' || name === 'finish') {
    return { name, input: input as never } as ToolCall;
  }
  return null;
}

export async function runMayorLoop(
  sessionId: string,
  onEvent: (e: MayorStreamEvent) => void,
): Promise<void> {
  const state = sessions.get(sessionId);
  if (!state) throw new Error(`[mayor] unknown sessionId: ${sessionId}`);
  if (state.running) throw new Error(`[mayor] loop already running for ${sessionId}`);
  state.running = true;

  const c = client();
  // STREAM-FIRST: open the stream before sending the kickoff, so we don't miss early events.
  const stream = await c.beta.sessions.events.stream(sessionId);

  if (state.pendingGoal) {
    const goal = state.pendingGoal;
    state.pendingGoal = undefined;
    await c.beta.sessions.events.send(sessionId, {
      events: [{ type: 'user.message', content: [{ type: 'text', text: goal }] }],
    });
  }

  let customToolUseCount = 0;

  try {
    for await (const event of stream) {
      onEvent({ kind: 'anthropic_event', event });

      if (event.type === 'agent.custom_tool_use') {
        customToolUseCount++;
        const call = parseToolCall(event.name, event.input);
        const result: ToolResult = call
          ? applyToolCall(state.city, call)
          : {
              ok: false,
              error: `unknown tool '${event.name}'. Valid: place_property, place_tile_rect, finish`,
            };

        onEvent({
          kind: 'tool_applied',
          tool_use_id: event.id,
          name: event.name,
          input: event.input,
          result,
        });

        await c.beta.sessions.events.send(sessionId, {
          events: [
            {
              type: 'user.custom_tool_result',
              custom_tool_use_id: event.id,
              content: [
                {
                  type: 'text',
                  text: result.ok ? 'ok' : result.error,
                },
              ],
              is_error: !result.ok,
            },
          ],
        });

        // finish tool → exit the loop on our side too.
        if (result.ok && 'done' in result && result.done === true) {
          onEvent({ kind: 'done', reason: 'finish tool called' });
          return;
        }

        // Turn cap: send an interrupt + nudge if the agent is runaway.
        if (customToolUseCount >= MAX_CUSTOM_TOOL_USES) {
          await c.beta.sessions.events.send(sessionId, {
            events: [
              { type: 'user.interrupt' },
              {
                type: 'user.message',
                content: [
                  {
                    type: 'text',
                    text: `You've reached the turn cap (${MAX_CUSTOM_TOOL_USES} tool calls). Call finish with a brief reason to conclude.`,
                  },
                ],
              },
            ],
          });
        }
        continue;
      }

      if (event.type === 'session.status_terminated') {
        onEvent({ kind: 'done', reason: 'session terminated' });
        return;
      }

      if (event.type === 'session.status_idle') {
        // requires_action: transient (waiting on us for a custom tool result).
        if (event.stop_reason.type === 'requires_action') continue;
        // retries_exhausted: hard terminal.
        if (event.stop_reason.type === 'retries_exhausted') {
          onEvent({ kind: 'done', reason: 'retries_exhausted' });
          return;
        }
        // end_turn: Mayor paused. If the pause was user-initiated (interrupt),
        // keep the loop alive — the user may send a redirect that resumes the
        // session. Otherwise (natural end_turn without calling finish), exit.
        if (state.interrupted) continue;
        onEvent({ kind: 'done', reason: 'stop_reason: end_turn' });
        return;
      }
    }
  } finally {
    state.running = false;
  }
}
