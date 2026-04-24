import { runMayorLoop, getSession } from '@/lib/agent/mayor';
import type { MayorStreamEvent } from '@/lib/agent/mayor';

// Next.js: never cache, always run at request time.
export const dynamic = 'force-dynamic';

// GET /api/mayor/[sessionId]/stream — SSE endpoint.
// Opens Anthropic's session event stream, runs the custom-tool loop server-side,
// and forwards each event to the browser as an SSE frame.
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ sessionId: string }> },
): Promise<Response> {
  const { sessionId } = await ctx.params;
  if (!getSession(sessionId)) {
    return Response.json({ error: `unknown sessionId: ${sessionId}` }, { status: 404 });
  }

  const encoder = new TextEncoder();

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: MayorStreamEvent) => {
        // SSE frame: `event: <type>\ndata: <json>\n\n`.
        // We always use the type `mayor` for our wrapped payload; browser parses
        // the JSON body to discriminate kind/anthropic_event/tool_applied/done.
        const frame =
          `event: mayor\n` +
          `data: ${JSON.stringify(event)}\n\n`;
        try {
          controller.enqueue(encoder.encode(frame));
        } catch {
          // Controller closed mid-write (client disconnected). Ignore.
        }
      };

      try {
        await runMayorLoop(sessionId, send);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[api/mayor stream]', msg);
        send({ kind: 'done', reason: `error: ${msg}` });
      } finally {
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
  });

  return new Response(body, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
