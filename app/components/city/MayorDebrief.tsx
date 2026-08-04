'use client';

import Image from 'next/image';
import type { City } from '@/lib/all_types';
import type { FireRecord } from './useSimulation';
import { useMayorDebriefVoice } from './useMayorDebriefVoice';
import type { VoiceStatus } from './useVoiceAgent';

// Mayor debrief panel — the right half of the end-of-run report.
//
// Talks to the MAYOR_DEBRIEF agent (lib/agent/mayorDebriefPrompt.ts), which is
// a separate agent from the build-phase Mayor: no tools, and its whole context
// is the finished simulation report.

// Both mayor PNGs are exactly 16:9 (1672x941 and 1920x1080), so the portrait
// frame is aspect-video and swapping rest -> mouth_open while speaking does not
// reflow the panel.
const MAYOR_REST = '/assets/mayor_rest.png';
const MAYOR_TALKING = '/assets/mayor_mouth_open.png';

const STATUS_LABEL: Record<VoiceStatus, string> = {
  idle: 'Not connected',
  connecting: 'Connecting…',
  listening: 'Listening…',
  thinking: 'Thinking…',
  speaking: 'Speaking',
  error: 'Error',
};

const STATUS_COLOR: Record<VoiceStatus, string> = {
  idle: 'text-white/40',
  connecting: 'text-amber-300',
  listening: 'text-emerald-300',
  thinking: 'text-amber-300',
  speaking: 'text-fuchsia-300',
  error: 'text-red-400',
};

type Props = {
  city: City;
  fireLog: FireRecord[];
  cityName: string | null;
  day: number;
  ticks: number;
};

export function MayorDebrief({ city, fireLog, cityName, day, ticks }: Props) {
  const voice = useMayorDebriefVoice({ city, fireLog, cityName, day, ticks });
  const { status, muted, spokenText } = voice;

  const live = status !== 'idle' && status !== 'error';
  const statusLabel = muted && live ? 'Muted' : STATUS_LABEL[status];
  const statusColor = muted && live ? 'text-white/40' : STATUS_COLOR[status];

  return (
    <div className="flex-1 min-w-0 border-l-2 border-white/20 flex flex-col overflow-y-auto">
      <div className="px-5 py-3 border-b border-white/10 flex items-baseline justify-between gap-3">
        <span className="text-fuchsia-300 uppercase tracking-widest text-[11px]">Mayor debrief</span>
        <span className={`text-[10px] ${statusColor}`}>{statusLabel}</span>
      </div>

      <div className="px-5 py-4 flex flex-col gap-3">
        {/* Portrait — full width of this half. */}
        {/* Talking animation.
            The two PNGs are a properly registered pair: normalised to the same
            width they align at scale 1.000 / dx 0 / dy 0, and only 0.08% of
            pixels differ (centred exactly on the mouth). To preserve that, both
            are sized by WIDTH against rest's own ratio — object-contain in a
            16:9 box would scale them fractionally differently, since their
            aspect ratios differ by 0.06% (1.7768 vs 1.7778).
            Both stay mounted so the browser never fetches mid-sentence. */}
        <div
          className="relative w-full bg-[#0b1220] border-2 border-white/80 overflow-hidden"
          style={{ aspectRatio: '1672 / 941', boxShadow: '3px 3px 0 0 rgba(0,0,0,0.85)' }}
        >
          <Image
            src={MAYOR_REST}
            alt="The Mayor"
            width={1672}
            height={941}
            unoptimized
            priority
            className="absolute top-0 left-0 w-full h-auto"
          />
          <Image
            src={MAYOR_TALKING}
            alt=""
            aria-hidden
            width={1920}
            height={1080}
            unoptimized
            priority
            className="absolute top-0 left-0 w-full h-auto"
            style={{ opacity: voice.mouthOpen ? 1 : 0 }}
          />
        </div>

        {/* Live transcription — same idea as the citizen speech bubble:
            small, and only as tall as it needs to be. */}
        <div
          className="bg-[#0b1220] border-2 border-white/40 px-3 py-2 min-h-[52px] flex items-center"
          style={{ boxShadow: '3px 3px 0 0 rgba(0,0,0,0.85)' }}
        >
          {spokenText ? (
            <p className="text-[11px] leading-snug text-white/90">
              {spokenText}
              {status === 'speaking' && (
                <span className="inline-block w-[2px] h-[11px] ml-[2px] align-[-1px] bg-white animate-pulse" />
              )}
            </p>
          ) : (
            <p className="text-[11px] text-white/25 italic">
              {live ? 'Listening…' : 'Start the debrief to talk with the Mayor.'}
            </p>
          )}
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={live ? voice.stop : voice.start}
            disabled={status === 'connecting'}
            className={[
              'px-3 py-1.5 text-[10px] uppercase tracking-wider border-2 border-white/90 text-white transition-colors',
              live ? 'bg-red-600 hover:bg-red-500' : 'bg-emerald-600 hover:bg-emerald-500',
            ].join(' ')}
            style={{ boxShadow: '3px 3px 0 0 rgba(0,0,0,0.85)' }}
          >
            {live ? '■ Stop talking' : '● Start talking'}
          </button>

          {/* Mute only exists mid-call — there's no mic to gate otherwise. */}
          {live && (
            <button
              type="button"
              onClick={voice.toggleMute}
              aria-pressed={muted}
              title={muted ? 'Unmute your mic' : 'Mute your mic'}
              className={[
                'px-3 py-1.5 text-[10px] uppercase tracking-wider border-2 transition-colors',
                muted
                  ? 'bg-amber-600 hover:bg-amber-500 text-white border-white/90'
                  : 'bg-white/10 hover:bg-white/20 text-white/80 border-white/40',
              ].join(' ')}
              style={{ boxShadow: '3px 3px 0 0 rgba(0,0,0,0.85)' }}
            >
              {muted ? '🔇 Muted' : '🎤 Mute'}
            </button>
          )}

          {/* Mic-live dot, matching VoiceChatBar's cue. */}
          {live && (
            <span className="ml-auto flex items-center gap-1 text-[9px] text-white/40">
              <span
                className={[
                  'w-1.5 h-1.5 rounded-full',
                  muted ? 'bg-white/30' : 'bg-red-500 animate-pulse',
                ].join(' ')}
              />
              MIC
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
