import { DeepgramClient } from '@deepgram/sdk';
import {
  buildCitizenVoicePrompt,
  citizenKeyterms,
  isCitizenContext,
  pickCitizenVoice,
} from '@/lib/agent/citizenPrompt';

// POST /api/voice-agent/token — mint a short-lived Deepgram token and return
// everything the browser needs to open a Voice Agent session as this citizen.
//
// Why the browser connects directly to Deepgram rather than through us: the
// session is a bidirectional audio stream, and proxying it through a Next.js
// route handler would add a hop to every 20ms frame in both directions — the
// one thing a real-time voice UX cannot afford.
//
// Why that's still safe: the DEEPGRAM_API_KEY never leaves the server. What
// ships to the browser is a JWT scoped to usage::write with a ~60s TTL — long
// enough to open the socket, useless if it leaks afterwards.
//
// The persona is built HERE rather than client-side so voice and text chat
// share one source of truth (lib/agent/citizenPrompt.ts).

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
  let body: { citizen?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  if (!isCitizenContext(body.citizen)) {
    return Response.json({ error: 'missing or malformed "citizen" field' }, { status: 400 });
  }
  const citizen = body.citizen;

  try {
    const grant = await deepgram().auth.v1.tokens.grant({
      ttl_seconds: TOKEN_TTL_SECONDS,
    });

    return Response.json({
      token: grant.access_token,
      expiresIn: grant.expires_in,
      // Citizens are short, fast exchanges — Haiku keeps latency low.
      model: 'claude-haiku-4-5',
      prompt: buildCitizenVoicePrompt(citizen),
      voice: pickCitizenVoice(citizen.name, citizen.gender),
      keyterms: citizenKeyterms(citizen),
      greeting: `Hey — I'm ${citizen.name.split(/\s+/)[0]}. What do you want to know?`,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[api/voice-agent/token]', msg);

    // The most common setup failure by a wide margin: a valid but scope-
    // restricted key. It passes inference calls, so it looks fine everywhere
    // else, and only /v1/auth/grant rejects it. Say so instead of forwarding
    // a bare "Insufficient permissions".
    if (msg.includes('403') || /FORBIDDEN|Insufficient permissions/i.test(msg)) {
      return Response.json(
        {
          error:
            'Deepgram rejected the token request (403). DEEPGRAM_API_KEY is valid but ' +
            'lacks permission to mint temporary tokens — restricted keys can run ' +
            'inference but cannot call /v1/auth/grant. Create a key with the Member ' +
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
