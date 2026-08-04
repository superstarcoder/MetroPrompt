'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// Deepgram Voice Agent session — the shared transport used by BOTH the citizen
// interview and the Mayor debrief. Deepgram owns the whole speech loop (STT,
// LLM, TTS, turn detection, barge-in); we only move audio in and out and mirror
// the state it reports.
//
// Everything agent-specific (which prompt, which voice, which LLM, which
// greeting) arrives from `fetchConfig`, so the hard-won protocol details below
// live in exactly one place.
//
// Audio contract, fixed by the Settings message:
//   mic   → linear16, 16 kHz, mono  (downsampled by the input AudioContext)
//   agent → linear16, 24 kHz, mono  (raw binary frames on the socket)

const AGENT_URL = 'wss://agent.deepgram.com/v1/agent/converse';
const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;
const MIC_BUFFER_SIZE = 4096;
const KEEPALIVE_MS = 8000;
export const VISUALIZER_BARS = 24;

// Ceiling on how fast the transcript may reveal, in characters per second.
// Deepgram delivers TTS faster than real time, so at the very start of an
// utterance only a fraction of a second of audio is buffered and the
// duration-based estimate below is briefly far too short — without this cap
// that would dump half the sentence out in one frame. Aura-2 speaks at roughly
// 15 ch/s; 24 leaves headroom for fast lines without letting text outrun voice.
const MAX_REVEAL_CHARS_PER_SEC = 24;

// Mouth-flap thresholds for the talking animation.
//
// Self-calibrating on purpose: Aura-2 output level varies by voice and by line,
// so any fixed threshold either never opens the mouth or never closes it.
// Instead we track a decaying peak and open on anything above a fraction of it,
// with an absolute floor so silence keeps the mouth shut.
const MOUTH_PEAK_DECAY = 0.97;      // per frame — peak halves in ~0.4s at 60fps
const MOUTH_OPEN_FRACTION = 0.4;    // of the recent peak
const MOUTH_SILENCE_FLOOR = 0.02;   // below this it is not speech

export type VoiceStatus =
  | 'idle'         // not connected
  | 'connecting'   // fetching token / opening socket / awaiting mic permission
  | 'listening'    // connected, mic live, agent silent
  | 'thinking'     // agent is generating
  | 'speaking'     // agent audio is playing
  | 'error';

export type VoiceTurn = { role: 'user' | 'assistant'; content: string };

// Everything the server must supply to open a session.
export type VoiceAgentConfig = {
  token: string;      // short-TTL Deepgram JWT
  prompt: string;     // system prompt for the think provider
  voice: string;      // Aura-2 voice id
  keyterms: string[]; // STT keyterm prompting
  greeting: string;   // spoken before the user says anything
  model: string;      // Deepgram-supported Anthropic model id
};

export type VoiceSession = {
  status: VoiceStatus;
  error: string | null;
  /** Normalised 0..1 output levels, one per bar. All zero when silent. */
  levels: number[];
  /** Full conversation transcript, newest last. */
  transcript: VoiceTurn[];
  /** Mic gated off: the agent cannot hear you, and cannot be barged in on. */
  muted: boolean;
  /**
   * True on the loud part of a syllable while the agent speaks — drives a
   * talking animation. Derived from the same AnalyserNode as `levels`, so it
   * tracks the actual voice rather than a timer.
   */
  mouthOpen: boolean;
  /**
   * What the agent is saying right now, revealed in step with the audio.
   * Holds the last complete utterance once they stop speaking.
   */
  spokenText: string;
  start: () => void;
  stop: () => void;
  toggleMute: () => void;
};

// Deepgram sends JSON control frames and binary audio frames over one socket.
type AgentMessage = { type?: string; role?: string; content?: string; description?: string };

type Options = {
  /** False disables `start` entirely (e.g. no citizen selected). */
  enabled: boolean;
  /** Changing this hangs up — used to drop the session when the subject changes. */
  resetKey: string;
  /** Fetches a fresh token + agent config. Called once per `start`. */
  fetchConfig: () => Promise<VoiceAgentConfig>;
};

export function useVoiceAgent({ enabled, resetKey, fetchConfig }: Options): VoiceSession {
  const [status, setStatus] = useState<VoiceStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<VoiceTurn[]>([]);
  const [levels, setLevels] = useState<number[]>(() => new Array(VISUALIZER_BARS).fill(0));
  const [muted, setMuted] = useState(false);
  const [spokenText, setSpokenText] = useState('');
  const [mouthOpen, setMouthOpen] = useState(false);
  const mouthPeakRef = useRef(0);

  // Held in refs so callers can pass an inline closure without invalidating
  // `start` on every render. Synced in an effect rather than during render —
  // both are only read from event handlers, which always run after commit.
  const fetchConfigRef = useRef(fetchConfig);
  const enabledRef = useRef(enabled);
  useEffect(() => {
    fetchConfigRef.current = fetchConfig;
    enabledRef.current = enabled;
  });

  // Everything below is imperative audio/socket plumbing that must survive
  // re-renders and be torn down exactly once.
  const socketRef = useRef<WebSocket | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const inCtxRef = useRef<AudioContext | null>(null);
  const outCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const keepAliveRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const rafRef = useRef(0);
  // Scheduled playback sources, so a barge-in can cancel audio already queued.
  const scheduledRef = useRef<AudioBufferSourceNode[]>([]);
  const nextPlayAtRef = useRef(0);
  const runningRef = useRef(false);
  // Read inside the mic callback, which is created once and never sees state.
  const mutedRef = useRef(false);
  // The utterance being spoken and how much of it has been revealed so far.
  // `startAt` is a timestamp on the OUTPUT AudioContext clock — the same clock
  // playback is scheduled against — so the reveal follows the voice itself
  // rather than wall time, and stays in step even if the socket stutters.
  const utteranceRef = useRef<{ text: string; startAt: number | null; revealed: number } | null>(null);

  const teardown = useCallback(() => {
    runningRef.current = false;

    if (keepAliveRef.current) { clearInterval(keepAliveRef.current); keepAliveRef.current = null; }
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0; }

    for (const src of scheduledRef.current) { try { src.stop(); } catch { /* already stopped */ } }
    scheduledRef.current = [];
    nextPlayAtRef.current = 0;

    if (processorRef.current) { processorRef.current.disconnect(); processorRef.current.onaudioprocess = null; processorRef.current = null; }
    if (micStreamRef.current) { for (const t of micStreamRef.current.getTracks()) t.stop(); micStreamRef.current = null; }
    if (inCtxRef.current) { void inCtxRef.current.close().catch(() => {}); inCtxRef.current = null; }
    if (outCtxRef.current) { void outCtxRef.current.close().catch(() => {}); outCtxRef.current = null; }
    analyserRef.current = null;

    if (socketRef.current) { try { socketRef.current.close(); } catch { /* already closed */ } socketRef.current = null; }

    mutedRef.current = false;
    setMuted(false);
    utteranceRef.current = null;
    setSpokenText('');
    mouthPeakRef.current = 0;
    setMouthOpen(false);
    setLevels(new Array(VISUALIZER_BARS).fill(0));
  }, []);

  // Gate the mic rather than pausing the track: toggling is instant, needs no
  // re-permission, and keeps the audio graph intact. The important consequence
  // is that while muted no frames reach Deepgram at all, so it never detects a
  // user turn — muting therefore disables barge-in by construction, not by a
  // second rule that could drift out of sync with this one.
  const toggleMute = useCallback(() => {
    setMuted(prev => {
      const next = !prev;
      mutedRef.current = next;
      return next;
    });
  }, []);

  const stop = useCallback(() => {
    teardown();
    setStatus('idle');
  }, [teardown]);

  // Drop any agent audio still queued. Deepgram decides the barge-in happened
  // server-side; without this the already-buffered sentence keeps playing over
  // the user, which is the single most obvious way a voice UI feels broken.
  const flushPlayback = useCallback(() => {
    for (const src of scheduledRef.current) { try { src.stop(); } catch { /* already stopped */ } }
    scheduledRef.current = [];
    nextPlayAtRef.current = 0;
  }, []);

  const playChunk = useCallback((pcm: ArrayBuffer) => {
    const ctx = outCtxRef.current;
    const analyser = analyserRef.current;
    if (!ctx || !analyser || ctx.state === 'closed') return;

    // linear16 → float32 in [-1, 1]
    const ints = new Int16Array(pcm);
    if (ints.length === 0) return;
    const buffer = ctx.createBuffer(1, ints.length, OUTPUT_SAMPLE_RATE);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < ints.length; i++) channel[i] = ints[i] / 32768;

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(analyser);

    // Schedule back-to-back so consecutive chunks play gaplessly. A small lead
    // absorbs jitter when the socket delivers late.
    const now = ctx.currentTime;
    const startAt = Math.max(now + 0.02, nextPlayAtRef.current);
    src.start(startAt);
    nextPlayAtRef.current = startAt + buffer.duration;

    // First chunk of a new utterance: this is the instant the voice actually
    // begins, so it's the zero point the transcript reveals from.
    const u = utteranceRef.current;
    if (u && u.startAt === null) u.startAt = startAt;

    scheduledRef.current.push(src);
    src.onended = () => {
      scheduledRef.current = scheduledRef.current.filter(s => s !== src);
    };
  }, []);

  const start = useCallback(async () => {
    if (!enabledRef.current || runningRef.current) return;
    runningRef.current = true;
    mutedRef.current = false;
    setMuted(false);
    utteranceRef.current = null;
    setSpokenText('');
    setError(null);
    setTranscript([]);
    setStatus('connecting');

    try {
      // 1. Server mints a short-lived token and builds the persona.
      const cfg = await fetchConfigRef.current();

      // 2. Mic first — if permission is denied we want to fail before opening
      //    a socket we'd only have to tear down.
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      if (!runningRef.current) { for (const t of micStream.getTracks()) t.stop(); return; }
      micStreamRef.current = micStream;

      // 3. Output audio graph, built BEFORE the socket so the first agent
      //    frame always has somewhere to land: sources → analyser → speakers.
      //    The analyser must sit on the path, not off to the side, since the
      //    visualizer reads from it.
      const outCtx = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });
      const analyser = outCtx.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.7;
      analyser.connect(outCtx.destination);
      outCtxRef.current = outCtx;
      analyserRef.current = analyser;

      // 4. Connect.
      //
      // We use a NATIVE WebSocket rather than the SDK's socket wrapper. Two
      // reasons: browsers ignore the `options.headers` the SDK passes as the
      // third `new WebSocket()` argument (so header auth silently never
      // leaves the page), and its ReconnectingWebSocket layer doesn't survive
      // the Next.js client bundle. A direct socket against the documented
      // protocol is simpler and fully under our control. The SDK is still used
      // server-side to mint the token.
      //
      // Auth rides the SUBPROTOCOL: ['bearer', <jwt>]. Verified against the
      // live endpoint — a query param returns 401.
      const socket = new WebSocket(AGENT_URL, ['bearer', cfg.token]);
      socket.binaryType = 'arraybuffer'; // agent audio arrives as raw frames
      if (!runningRef.current) { socket.close(); return; }
      socketRef.current = socket;

      // Wire every handler BEFORE the socket opens. The greeting audio can
      // arrive within milliseconds of Settings being accepted, and a listener
      // attached later would miss the agent's first words.
      socket.addEventListener('message', (ev: MessageEvent) => {
        // Binary frame = agent audio.
        if (ev.data instanceof ArrayBuffer) { playChunk(ev.data); return; }
        if (ev.data instanceof Blob) { void ev.data.arrayBuffer().then(playChunk); return; }

        let m: AgentMessage;
        try { m = JSON.parse(ev.data as string); } catch { return; }

        switch (m.type) {
          case 'UserStartedSpeaking':
            flushPlayback();
            // The queued audio was just cut off, so stop revealing too. What's
            // already on screen is exactly what the agent got to say before
            // being interrupted — completing the sentence would misreport it.
            utteranceRef.current = null;
            setStatus('listening');
            break;
          case 'AgentThinking':
            setStatus('thinking');
            break;
          case 'AgentStartedSpeaking':
            setStatus('speaking');
            break;
          case 'AgentAudioDone':
            // Playback finished: snap to the full text so a slightly slow
            // reveal can never leave a sentence permanently truncated.
            if (utteranceRef.current) {
              setSpokenText(utteranceRef.current.text);
              utteranceRef.current = null;
            }
            setStatus('listening');
            break;
          case 'ConversationText':
            if (m.role === 'user' || m.role === 'assistant') {
              const role = m.role;
              const content = m.content ?? '';
              if (content) {
                setTranscript(prev => [...prev, { role, content }]);
                if (role === 'assistant') {
                  // Text lands before the audio does. Hold it and let the
                  // reveal pump below meter it out as the voice plays.
                  utteranceRef.current = { text: content, startAt: null, revealed: 0 };
                  setSpokenText('');
                }
              }
            }
            break;
          case 'Error':
            console.error('[voice] agent error', m);
            setError(m.description ?? 'voice agent error');
            setStatus('error');
            break;
        }
      });

      socket.addEventListener('error', () => {
        // The browser deliberately withholds detail here; the close code that
        // follows is the useful signal.
        console.error('[voice] socket error');
      });

      socket.addEventListener('close', (ev: CloseEvent) => {
        console.warn(`[voice] socket closed code=${ev.code} reason="${ev.reason}"`);
        if (!runningRef.current) return;
        teardown();
        // 1000/1005 are normal hang-ups; anything else is worth surfacing.
        if (ev.code !== 1000 && ev.code !== 1005) {
          setError(`connection closed (${ev.code})${ev.reason ? `: ${ev.reason}` : ''}`);
          setStatus('error');
        } else {
          setStatus('idle');
        }
      });

      await new Promise<void>((resolve, reject) => {
        if (socket.readyState === WebSocket.OPEN) return resolve();
        const onOpen = () => { cleanup(); resolve(); };
        const onFail = () => { cleanup(); reject(new Error('voice socket failed to open')); };
        const cleanup = () => {
          socket.removeEventListener('open', onOpen);
          socket.removeEventListener('close', onFail);
        };
        socket.addEventListener('open', onOpen);
        socket.addEventListener('close', onFail);
      });
      if (!runningRef.current) { socket.close(); return; }

      {
        // NB: these keys are snake_case (sample_rate), and the Flux STT model
        // requires version: 'v2' on the listen provider. Both are load-bearing
        // — no cast here on purpose, so the compiler keeps them honest.
        //
        // No `functions` key: neither agent gets tools. Extended thinking is
        // likewise absent — it is opt-in on the Messages API and Deepgram never
        // requests it, so the think provider runs without it.
        socket.send(JSON.stringify({
          type: 'Settings',
          audio: {
            input: { encoding: 'linear16', sample_rate: INPUT_SAMPLE_RATE },
            output: { encoding: 'linear16', sample_rate: OUTPUT_SAMPLE_RATE, container: 'none' },
          },
          agent: {
            listen: {
              provider: {
                type: 'deepgram',
                version: 'v2',
                model: 'flux-general-en',
                keyterms: cfg.keyterms,
              },
            },
            think: {
              provider: { type: 'anthropic', model: cfg.model },
              prompt: cfg.prompt,
            },
            speak: {
              provider: { type: 'deepgram', model: cfg.voice },
            },
            greeting: cfg.greeting,
          },
        }));

        // 5. Mic → linear16 → socket.
        const inCtx = new AudioContext({ sampleRate: INPUT_SAMPLE_RATE });
        inCtxRef.current = inCtx;
        const source = inCtx.createMediaStreamSource(micStream);
        // ScriptProcessorNode is deprecated in favour of AudioWorklet, but it
        // needs no separate module file and is universally supported. Swap it
        // if mic capture ever becomes a bottleneck.
        const processor = inCtx.createScriptProcessor(MIC_BUFFER_SIZE, 1, 1);
        processor.onaudioprocess = (e) => {
          if (!runningRef.current || !socketRef.current) return;
          // Muted: drop the frame before conversion. KeepAlive below is what
          // holds the socket open through a long silence.
          if (mutedRef.current) return;
          const input = e.inputBuffer.getChannelData(0);
          const pcm = new Int16Array(input.length);
          for (let i = 0; i < input.length; i++) {
            const s = Math.max(-1, Math.min(1, input[i]));
            pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
          }
          const ws = socketRef.current;
          if (ws.readyState !== WebSocket.OPEN) return;
          try { ws.send(pcm.buffer); } catch { /* socket closing */ }
        };
        source.connect(processor);
        // Required for onaudioprocess to fire in Chrome; gain 0 so the user
        // never hears their own mic.
        const mute = inCtx.createGain();
        mute.gain.value = 0;
        processor.connect(mute);
        mute.connect(inCtx.destination);
        processorRef.current = processor;

        keepAliveRef.current = setInterval(() => {
          const ws = socketRef.current;
          if (ws?.readyState !== WebSocket.OPEN) return;
          try { ws.send(JSON.stringify({ type: 'KeepAlive' })); } catch { /* closing */ }
        }, KEEPALIVE_MS);

        setStatus('listening');
      }

      // 6. Visualizer + transcript-reveal pump.
      const bins = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        const a = analyserRef.current;
        if (!a || !runningRef.current) return;
        a.getByteFrequencyData(bins);
        const out = new Array(VISUALIZER_BARS);
        const per = Math.max(1, Math.floor(bins.length / VISUALIZER_BARS));
        for (let b = 0; b < VISUALIZER_BARS; b++) {
          let sum = 0;
          for (let i = 0; i < per; i++) sum += bins[b * per + i] ?? 0;
          out[b] = Math.min(1, (sum / per) / 255);
        }
        setLevels(out);

        // Mouth flap, from the same analyser data. setState with the SAME
        // boolean is a no-op in React, so this only re-renders on an actual
        // open/close transition rather than every animation frame.
        const avg = out.reduce((a, b) => a + b, 0) / out.length;
        mouthPeakRef.current = Math.max(avg, mouthPeakRef.current * MOUTH_PEAK_DECAY);
        const open =
          avg > Math.max(MOUTH_SILENCE_FLOOR, mouthPeakRef.current * MOUTH_OPEN_FRACTION);
        setMouthOpen(prev => (prev === open ? prev : open));

        // Transcript reveal, metered against the audio clock.
        //
        // Deepgram sends each assistant turn as one complete ConversationText —
        // there are no token deltas to forward — so instead of streaming text
        // we pace it to the voice, which is what the user actually perceives as
        // "in sync". Two estimates, whichever is lower:
        //   • elapsed / buffered  — real progress through the audio we hold.
        //     Since TTS arrives faster than real time, `buffered` converges on
        //     the true duration within a few hundred ms and this dominates.
        //   • elapsed x MAX_CPS   — a speech-rate ceiling that covers the
        //     opening moments, when `buffered` is still far too short.
        // Reveal is monotonic: text never un-writes itself if an estimate dips.
        const u = utteranceRef.current;
        const octx = outCtxRef.current;
        if (u && octx && u.startAt !== null) {
          const elapsed = octx.currentTime - u.startAt;
          if (elapsed > 0) {
            const buffered = nextPlayAtRef.current - u.startAt;
            const byAudio = buffered > 0 ? (elapsed / buffered) * u.text.length : 0;
            const byRate = elapsed * MAX_REVEAL_CHARS_PER_SEC;
            const target = Math.min(u.text.length, Math.floor(Math.min(byAudio, byRate)));
            if (target > u.revealed) {
              u.revealed = target;
              setSpokenText(u.text.slice(0, target));
            }
          }
        }

        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      teardown();
      setError(
        msg.includes('Permission') || msg.includes('NotAllowed')
          ? 'Microphone permission denied'
          : msg,
      );
      setStatus('error');
    }
  }, [flushPlayback, playChunk, teardown]);

  // Hang up when the subject changes or the component unmounts — otherwise a
  // live session keeps talking as someone you're no longer looking at. The work
  // belongs in the cleanup rather than the effect body: it runs for the
  // OUTGOING subject, which is exactly whose socket and mic we want closed.
  useEffect(() => {
    return () => {
      teardown();
      setStatus('idle');
      setTranscript([]);
      setError(null);
    };
  }, [resetKey, teardown]);

  return {
    status,
    error,
    levels,
    transcript,
    muted,
    mouthOpen,
    spokenText,
    start: () => { void start(); },
    stop,
    toggleMute,
  };
}
