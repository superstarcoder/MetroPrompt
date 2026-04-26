import type { City } from '@/lib/all_types';

// 30 unique short company names (mostly fictional/iconic). Used as the
// pool from which each office is randomly assigned a name at sim start.
export const COMPANY_NAMES: ReadonlyArray<string> = [
  'Acme',
  'Globex',
  'Initech',
  'Hooli',
  'Pied Piper',
  'Stark',
  'Wayne',
  'Cyberdyne',
  'Tyrell',
  'Umbrella',
  'OCP',
  'Soylent',
  'Wonka',
  'Aperture',
  'Black Mesa',
  'Massive Dynamic',
  'Vandelay',
  'Dunder',
  'Sterling',
  'Compuserve',
  'Gringotts',
  'Buy n Large',
  'Vault-Tec',
  'Strickland',
  'Cyclops',
  'Atlas',
  'Helix',
  'Nimbus',
  'Solstice',
  'Verity',
];

// Assigns a unique company name to every office that doesn't already have one.
// Preserves any names already set (so re-running on a city in progress is
// idempotent). If there are more offices than names available, falls back to
// numbered "Office N" labels.
//
// Returns the full list of company names currently in the city, suitable for
// random job assignment.
export function assignCompanyNames(city: City): string[] {
  const offices = city.all_properties.filter(p => p.name === 'office');

  const taken = new Set<string>();
  for (const o of offices) {
    if (typeof o.company_name === 'string') taken.add(o.company_name);
  }

  // Shuffle the unused names (Fisher-Yates).
  const available = COMPANY_NAMES.filter(n => !taken.has(n));
  for (let i = available.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [available[i], available[j]] = [available[j], available[i]];
  }

  let cursor = 0;
  let fallbackCounter = 1;
  for (const office of offices) {
    if (typeof office.company_name === 'string') continue;
    if (cursor < available.length) {
      office.company_name = available[cursor++];
    } else {
      // Out of unique names — synthesize a deterministic-ish fallback.
      while (taken.has(`Office ${fallbackCounter}`)) fallbackCounter++;
      office.company_name = `Office ${fallbackCounter}`;
      taken.add(office.company_name);
      fallbackCounter++;
    }
  }

  return offices
    .map(o => o.company_name)
    .filter((n): n is string => typeof n === 'string');
}
