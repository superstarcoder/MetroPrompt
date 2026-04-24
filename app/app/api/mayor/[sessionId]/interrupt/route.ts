import { sendInterrupt, getSession } from '@/lib/agent/mayor';

// POST /api/mayor/[sessionId]/interrupt — halt the Mayor mid-stride.
// Session goes idle; browser can follow up with a redirect message or let it end.
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ sessionId: string }> },
): Promise<Response> {
  const { sessionId } = await ctx.params;
  if (!getSession(sessionId)) {
    return Response.json({ error: `unknown sessionId: ${sessionId}` }, { status: 404 });
  }
  try {
    await sendInterrupt(sessionId);
    return Response.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[api/mayor interrupt]', msg);
    return Response.json({ error: msg }, { status: 500 });
  }
}
