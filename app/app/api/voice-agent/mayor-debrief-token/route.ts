import { DeepgramClient } from '@deepgram/sdk';
import {
  MAYOR_DEBRIEF_MODEL,
  MAYOR_DEBRIEF_VOICE,
  buildMayorDebriefPrompt,
  isMayorDebriefContext,
  mayorDebriefGreeting,
  mayorDebriefKeyterms,
} from '@/lib/agent/mayorDebriefPrompt';

// POST /api/voice-agent/mayor-debrief-token
//
// Same shape and same reasoning as /api/voice-agent/token (see that file for
// why the browser connects to Deepgram directly and why the API key never
// leaves the server) — but for the MAYOR_DEBRIEF agent, which gets the whole
// simulation report as context instead of a single citizen's persona.
//
// Kept as its own route rather than a `mode` flag on the citizen route: the
// two have different payloads, different models, and different prompts, and
// merging them would mean one handler validating two unrelated bodies.

export const dynamic = 'force-dynamic';

const TOKEN_TTL_SECONDS = 60;

let _dg: DeepgramClient | null = null;
function deepgram(): DeepgramClient {
  if (!_dg) {
    const apiKey = process.env.DEEPGRAM_API_KEY;
    if (!apiKey) throw new Error('DEEPGRAM_API_KEY is not set');
    _dg = new DeepgramClient({ apiKey });
  }
  return _dg;
}

export async function POST(req: Request): Promise<Response> {
  let body: { report?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  if (!isMayorDebriefContext(body.report)) {
    return Response.json({ error: 'missing or malformed "report" field' }, { status: 400 });
  }
  const report = body.report;

  try {
    const grant = await deepgram().auth.v1.tokens.grant({ ttl_seconds: TOKEN_TTL_SECONDS });

    const prompt = buildMayorDebriefPrompt(report);
    console.log(
      `[mayor_debrief] session: model=${MAYOR_DEBRIEF_MODEL} city=${report.cityName ?? '(unnamed)'} ` +
      `citizens=${report.citizens.length} fires=${report.fires.length} prompt=${prompt.length} chars`,
    );

    return Response.json({
      token: grant.access_token,
      expiresIn: grant.expires_in,
      model: MAYOR_DEBRIEF_MODEL,
      prompt,
      voice: MAYOR_DEBRIEF_VOICE,
      keyterms: mayorDebriefKeyterms(report),
      greeting: mayorDebriefGreeting(report),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[api/voice-agent/mayor-debrief-token]', msg);

    // The most common setup failure by a wide margin: a valid but scope-
    // restricted key. It passes inference calls, so it looks fine everywhere
    // else, and only /v1/auth/grant rejects it.
    if (msg.includes('403') || /FORBIDDEN|Insufficient permissions/i.test(msg)) {
      return Response.json(
        {
          error:
            'Deepgram rejected the token request (403). DEEPGRAM_API_KEY is valid but ' +
            'lacks permission to mint temporary tokens — create a key with the Member ' +
            '(or Owner) role in the Deepgram console and use that instead.',
        },
        { status: 403 },
      );
    }
    if (msg.includes('DEEPGRAM_API_KEY is not set')) {
      return Response.json(
        { error: 'DEEPGRAM_API_KEY is not set in .env.local — add it and restart the dev server.' },
        { status: 500 },
      );
    }
    return Response.json({ error: msg }, { status: 500 });
  }
}
