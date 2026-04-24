import { createMayorSession } from '@/lib/agent/mayor';

// POST /api/mayor — create a fresh session around a goal. Returns {sessionId}.
// The stream + tool loop starts when the client opens GET /api/mayor/[sessionId]/stream.
export async function POST(req: Request): Promise<Response> {
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
    const sessionId = await createMayorSession(goal);
    return Response.json({ sessionId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[api/mayor POST]', msg);
    return Response.json({ error: msg }, { status: 500 });
  }
}
