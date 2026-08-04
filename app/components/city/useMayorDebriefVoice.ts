'use client';

import { useCallback } from 'react';
import type { City } from '@/lib/all_types';
import { buildDebriefContext } from './debriefContext';
import type { FireRecord } from './useSimulation';
import { useVoiceAgent } from './useVoiceAgent';
import type { VoiceAgentConfig, VoiceSession } from './useVoiceAgent';

// Live voice debrief with the MAYOR_DEBRIEF agent. Transport is shared with the
// citizen interview (useVoiceAgent); the only difference is which config the
// server hands back — a different prompt, model, voice, and greeting.

export type MayorDebriefVoice = VoiceSession;

type Args = {
  city: City;
  fireLog: FireRecord[];
  cityName: string | null;
  day: number;
  ticks: number;
};

export function useMayorDebriefVoice({ city, fireLog, cityName, day, ticks }: Args): MayorDebriefVoice {
  const fetchConfig = useCallback(async (): Promise<VoiceAgentConfig> => {
    // Built at connect time so the Mayor always sees the run as it finally
    // stood, not as it looked when this component first mounted.
    const report = buildDebriefContext(city, fireLog, cityName, day, ticks);
    const res = await fetch('/api/voice-agent/mayor-debrief-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ report }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? `token request failed (${res.status})`);
    }
    return res.json();
  }, [city, fireLog, cityName, day, ticks]);

  return useVoiceAgent({
    enabled: true,
    // One subject for the whole screen, so nothing mid-session should hang up.
    // Closing the report unmounts the hook, which tears down regardless.
    resetKey: 'mayor-debrief',
    fetchConfig,
  });
}
