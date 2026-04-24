import { sendRedirect, getSession } from '@/lib/agent/mayor';

// POST /api/mayor/[sessionId]/message — send a user message (redirect/nudge).
// Typical use: after interrupt, the user types "actually focus on parks" and we send it.
// Body: { text: string }
export async function POST(
  req: Request,
  ctx: { params: Promise<{ sessionId: string }> },
): Promise<Response> {
  const { sessionId } = await ctx.params;
  if (!getSession(sessionId)) {
    return Response.json({ error: `unknown sessionId: ${sessionId}` }, { status: 404 });
  }

  let body: { text?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) {
    return Response.json({ error: 'missing or empty "text" field' }, { status: 400 });
  }

  try {
    await sendRedirect(sessionId, text);
    return Response.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[api/mayor message]', msg);
    return Response.json({ error: msg }, { status: 500 });
  }
}
