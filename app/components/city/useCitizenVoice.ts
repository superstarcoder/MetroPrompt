'use client';

import { useCallback } from 'react';
import type { RefObject } from 'react';
import type { City, Person } from '@/lib/all_types';
import { buildCitizenContext } from './citizenChat';
import { useVoiceAgent } from './useVoiceAgent';
import type { VoiceAgentConfig, VoiceSession } from './useVoiceAgent';

// Live voice interview with a citizen. All transport lives in useVoiceAgent —
// this only supplies the citizen-specific config (persona prompt, voice, LLM)
// by way of /api/voice-agent/token.

export { VISUALIZER_BARS } from './useVoiceAgent';
export type { VoiceStatus, VoiceTurn } from './useVoiceAgent';
export type CitizenVoice = VoiceSession;

export function useCitizenVoice(citizen: Person | null, cityRef: RefObject<City>): CitizenVoice {
  const fetchConfig = useCallback(async (): Promise<VoiceAgentConfig> => {
    if (!citizen) throw new Error('no citizen selected');
    const res = await fetch('/api/voice-agent/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ citizen: buildCitizenContext(citizen, cityRef.current) }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? `token request failed (${res.status})`);
    }
    return res.json();
  }, [citizen, cityRef]);

  return useVoiceAgent({
    enabled: citizen !== null,
    // Switching citizens must hang up: the live session is voiced as, and
    // grounded in, the citizen you were looking at a moment ago.
    resetKey: citizen?.name ?? '',
    fetchConfig,
  });
}
