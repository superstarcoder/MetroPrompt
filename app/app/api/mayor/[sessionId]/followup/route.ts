import { setFollowupGoal, getSession } from '@/lib/agent/mayor';

// POST /api/mayor/[sessionId]/followup — queue a follow-up goal on an
// existing (idle, post-finish) session. The frontend then opens a fresh
// EventSource on /stream which picks up the queued goal and re-runs the loop.
// Body: { goal: string }
export async function POST(
  req: Request,
  ctx: { params: Promise<{ sessionId: string }> },
): Promise<Response> {
  const { sessionId } = await ctx.params;
  if (!getSession(sessionId)) {
    return Response.json({ error: `unknown sessionId: ${sessionId}` }, { status: 404 });
  }

  let body: { goal?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const goal = typeof body.goal === 'string' ? body.goal.trim() : '';
  if (!goal) {
    return Response.json({ error: 'missing or empty "goal" field' }, { status: 400 });
  }

  try {
    await setFollowupGoal(sessionId, goal);
    return Response.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[api/mayor followup]', msg);
    return Response.json({ error: msg }, { status: 500 });
  }
}
