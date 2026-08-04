#!/usr/bin/env node
// Benchmark one Mayor build against a running dev server.
//
//   npm run dev                       # in another terminal
//   node scripts/bench-mayor.mjs      # uses the default goal
//   node scripts/bench-mayor.mjs "your own goal"
//
// Drives the same path the browser does (POST /api/mayor → GET .../stream) and
// reports where the wall time actually goes. Compare runs across MAYOR_EFFORT
// settings in lib/agent/mayor.ts — keep the goal identical between runs.

const BASE = process.env.BENCH_BASE ?? 'http://localhost:3000';

// Fixed benchmark prompt. Change it and prior numbers stop being comparable.
const DEFAULT_GOAL =
  'Build a small mixed-use city: a central road grid, a park, a hospital, ' +
  'residential blocks, and a few restaurants and shops.';

const goal = process.argv[2] ?? DEFAULT_GOAL;

const t0 = Date.now();
const at = () => ((Date.now() - t0) / 1000).toFixed(1).padStart(6) + 's';

// Milestones we care about, in the order they should occur.
let firstThinkingEnd = null;   // agent.thinking (buffered → thinking FINISHED here)
let firstToolUse = null;       // first agent.custom_tool_use
let modelRequests = [];        // one per span.model_request_end
let toolCalls = 0;
let zoneToolCalls = 0;

console.log(`goal: ${goal}\nbase: ${BASE}\n`);

const res = await fetch(`${BASE}/api/mayor`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ goal }),
});
if (!res.ok) {
  console.error(`POST /api/mayor failed (${res.status}): ${await res.text()}`);
  process.exit(1);
}
const { sessionId } = await res.json();
console.log(`${at()}  session ${sessionId}`);

const stream = await fetch(`${BASE}/api/mayor/${sessionId}/stream`, {
  headers: { Accept: 'text/event-stream' },
});
if (!stream.ok || !stream.body) {
  console.error(`stream failed (${stream.status})`);
  process.exit(1);
}

const reader = stream.body.getReader();
const decoder = new TextDecoder();
let buf = '';
let done = false;

while (!done) {
  const { value, done: closed } = await reader.read();
  if (closed) break;
  buf += decoder.decode(value, { stream: true });

  // SSE frames are separated by a blank line.
  const frames = buf.split('\n\n');
  buf = frames.pop() ?? '';

  for (const frame of frames) {
    const line = frame.split('\n').find(l => l.startsWith('data: '));
    if (!line) continue;

    let ev;
    try {
      ev = JSON.parse(line.slice(6));
    } catch {
      continue;
    }

    if (ev.kind === 'tool_applied') {
      toolCalls++;
      if (ev.source === 'zone') zoneToolCalls++;
      if (firstToolUse === null) firstToolUse = Date.now() - t0;
      continue;
    }

    if (ev.kind === 'done') {
      console.log(`${at()}  done — ${ev.reason}`);
      done = true;
      break;
    }

    if (ev.kind !== 'anthropic_event') continue;
    const a = ev.event;

    switch (a.type) {
      case 'agent.thinking':
        // Buffered event: emitted when the thinking block COMPLETES, so this
        // timestamp is the END of thinking, not the start.
        if (firstThinkingEnd === null) firstThinkingEnd = Date.now() - t0;
        console.log(`${at()}  agent.thinking      (thinking block ended)`);
        break;

      case 'span.model_request_start':
        console.log(`${at()}  model_request_start`);
        break;

      case 'span.model_request_end': {
        const u = a.model_usage ?? {};
        modelRequests.push({
          at: Date.now() - t0,
          out: u.output_tokens ?? 0,
          in: u.input_tokens ?? 0,
          cacheRead: u.cache_read_input_tokens ?? 0,
          cacheWrite: u.cache_creation_input_tokens ?? 0,
        });
        console.log(
          `${at()}  model_request_end   ` +
          `${u.input_tokens ?? 0} in → ${u.output_tokens ?? 0} out · ` +
          `cache ${u.cache_read_input_tokens ?? 0} read / ${u.cache_creation_input_tokens ?? 0} write`
        );
        break;
      }
    }
  }
}

const total = (Date.now() - t0) / 1000;
const totalOut = modelRequests.reduce((s, r) => s + r.out, 0);
const totalCacheRead = modelRequests.reduce((s, r) => s + r.cacheRead, 0);
const first = modelRequests[0];

const fmt = (ms) => ms === null ? '   n/a' : (ms / 1000).toFixed(1) + 's';

console.log(`
────────────────────────────────────────────────
  MAYOR BUILD BENCHMARK
────────────────────────────────────────────────
  total wall time          ${total.toFixed(1)}s
  first turn thinking      ${fmt(firstThinkingEnd)}   ← the effort lever
  time to first tool call  ${fmt(firstToolUse)}
  first turn output tokens ${first ? first.out : 'n/a'}
  total output tokens      ${totalOut}
  model requests           ${modelRequests.length}
  tool calls               ${toolCalls} (${zoneToolCalls} from zones)
  cache read (turns 2+)    ${totalCacheRead}${totalCacheRead === 0 && modelRequests.length > 1 ? '  ⚠ zero across multiple turns — prefix being invalidated' : ''}
────────────────────────────────────────────────`);
