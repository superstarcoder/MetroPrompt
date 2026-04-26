// SSE event shapes (mirror MayorStreamEvent in lib/agent/mayor.ts) and the feed
// item types the chat panel renders.

export type ToolAppliedEvent = {
  kind: 'tool_applied';
  tool_use_id: string;
  name: string;
  input: Record<string, unknown>;
  result: { ok: true } | { ok: false; error: string };
  source?: 'mayor' | 'zone';
};
export type AnthropicEvent = {
  kind: 'anthropic_event';
  // discriminated by event.type — narrow at use site
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  event: any;
};
export type DoneEvent = { kind: 'done'; reason: string };
export type ZoneMessageEvent = { kind: 'zone_message'; text: string };
export type MayorEvent = ToolAppliedEvent | AnthropicEvent | DoneEvent | ZoneMessageEvent;

export type AgentSource = 'mayor' | 'zone';

export type ToolItem = {
  toolUseId: string;
  name: string;
  input: Record<string, unknown>;
  ok: boolean;
  error?: string;
};

export type FeedItem =
  | { kind: 'message'; id: number; author: AgentSource; text: string }
  | {
      kind: 'tool_batch';
      id: number;
      batchId: string;
      name: string;
      source: AgentSource;
      items: ToolItem[];
    };

export type Status = 'idle' | 'running' | 'paused' | 'done';
