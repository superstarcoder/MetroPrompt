import type { City, Property } from '@/lib/all_types';

// Named businesses give citizens something concrete to talk about. A citizen
// who knows their employer "builds artificial humans" answers "how's work?"
// with something specific; one who only knows the string "Tyrell" doesn't.
//
// These are hand-written rather than model-generated on purpose: the set is
// small and fixed, and most of these are recognizable enough that invented
// descriptions would be worse than the real joke.

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

// One line per company, phrased so a citizen can say it out loud in first
// person ("I'm at Tyrell — we build artificial humans"). Keep them short:
// they land in the citizen prompt and get spoken by TTS.
export const COMPANY_PROFILES: Readonly<Record<string, string>> = {
  'Acme': 'over-engineered gadgets that usually backfire on the customer',
  'Globex': 'a sprawling conglomerate that owns a little bit of everything',
  'Initech': 'enterprise software, mostly patching date bugs in ancient code',
  'Hooli': 'consumer tech at huge scale, obsessed with making the world better',
  'Pied Piper': 'a tiny startup chasing impossibly good file compression',
  'Stark': 'clean energy and robotics, with a lot of showmanship',
  'Wayne': 'heavy industry and R&D funded by very old money',
  'Cyberdyne': 'military AI and autonomous systems research',
  'Tyrell': 'synthetic biology; builds artificial humans',
  'Umbrella': 'pharmaceuticals, with a suspiciously large security division',
  'OCP': 'privatized city services and law-enforcement robotics',
  'Soylent': 'industrial-scale food processing; nobody asks what is in it',
  'Wonka': 'experimental confectionery and edible engineering',
  'Aperture': 'a physics lab full of portals and test chambers',
  'Black Mesa': 'a government research facility studying exotic materials',
  'Massive Dynamic': 'fringe science across basically every field at once',
  'Vandelay': 'importing and exporting industrial latex',
  'Dunder': 'regional paper and office supply distribution',
  'Sterling': 'a midcentury advertising agency that runs on long lunches',
  'Compuserve': 'dial-up online services and email, refusing to die',
  'Gringotts': 'banking and vault security, run extremely conservatively',
  'Buy n Large': 'megastore retail that sells literally everything',
  'Vault-Tec': 'underground shelters and long-term survival systems',
  'Strickland': 'propane and propane accessories',
  'Cyclops': 'precision optics and lens manufacturing',
  'Atlas': 'freight and logistics across the whole region',
  'Helix': 'genomics and DNA sequencing',
  'Nimbus': 'cloud infrastructure and data centers',
  'Solstice': 'solar panels and grid-scale batteries',
  'Verity': 'fact-checking and data verification tools',
};

// Restaurants get a name AND a cuisine, so "I grabbed lunch" can become
// "I grabbed pho at Bánh Mì Saigon". Same static-table reasoning as above.
export type RestaurantProfile = { name: string; cuisine: string; blurb: string };

export const RESTAURANTS: ReadonlyArray<RestaurantProfile> = [
  { name: "Nonna's Table",   cuisine: 'Italian',        blurb: 'handmade pasta and wood-fired pizza' },
  { name: 'Sakura Ramen',    cuisine: 'Japanese',       blurb: 'tonkotsu ramen and gyoza' },
  { name: 'El Farolito',     cuisine: 'Mexican',        blurb: 'street tacos and al pastor' },
  { name: 'Golden Wok',      cuisine: 'Chinese',        blurb: 'dim sum and hand-pulled noodles' },
  { name: 'Spice Route',     cuisine: 'Indian',         blurb: 'curries, biryani, and fresh naan' },
  { name: 'The Greasy Spoon',cuisine: 'American diner', blurb: 'burgers, fries, all-day breakfast' },
  { name: 'Olive & Thyme',   cuisine: 'Mediterranean',  blurb: 'mezze, grilled halloumi, and lamb' },
  { name: 'Seoul Kitchen',   cuisine: 'Korean',         blurb: 'bibimbap, KBBQ, and kimchi stew' },
  { name: 'Bánh Mì Saigon',  cuisine: 'Vietnamese',     blurb: 'bánh mì and pho' },
  { name: 'Le Petit Bistro', cuisine: 'French',         blurb: 'steak frites and onion soup' },
  { name: 'Tandoor House',   cuisine: 'Punjabi',        blurb: 'clay-oven tandoor and butter chicken' },
  { name: "Mama's Soul",     cuisine: 'Southern',       blurb: 'fried chicken, collards, and cornbread' },
  { name: 'Pier 9',          cuisine: 'Seafood',        blurb: 'oysters, chowder, and fish and chips' },
  { name: 'Green Fork',      cuisine: 'Vegetarian',     blurb: 'grain bowls and whatever is in season' },
  { name: 'Casa Brasil',     cuisine: 'Brazilian',      blurb: 'churrasco and pão de queijo' },
  { name: 'Athens Gyro',     cuisine: 'Greek',          blurb: 'gyros, souvlaki, and baklava' },
  { name: 'Smokestack BBQ',  cuisine: 'Barbecue',       blurb: 'brisket and ribs smoked overnight' },
  { name: 'Noodle Bar',      cuisine: 'Pan-Asian',      blurb: 'ramen, pad thai, and dumplings' },
  { name: 'Taco Libre',      cuisine: 'Tex-Mex',        blurb: 'loaded nachos and birria tacos' },
  { name: 'The Daily Grind', cuisine: 'Cafe',           blurb: 'espresso, pastries, and sandwiches' },
];

const RESTAURANTS_BY_NAME: ReadonlyMap<string, RestaurantProfile> = new Map(
  RESTAURANTS.map(r => [r.name, r]),
);

// One-line description of a named business, whatever its type. Returns null
// for the synthesized fallback names ("Office 4"), which have no profile.
export function businessBlurb(p: Property): string | null {
  if (!p.company_name) return null;
  if (p.name === 'restaurant') {
    const r = RESTAURANTS_BY_NAME.get(p.company_name);
    return r ? `${r.cuisine} — ${r.blurb}` : null;
  }
  return COMPANY_PROFILES[p.company_name] ?? null;
}

// Assigns a unique name to every property of one type that doesn't already
// have one. Preserves names already set (so re-running on a city in progress
// is idempotent). If there are more properties than names available, falls
// back to numbered "{fallback} N" labels.
//
// Returns the full list of names of that type currently in the city.
function assignNames(
  city: City,
  type: Property['name'],
  pool: ReadonlyArray<string>,
  fallback: string,
): string[] {
  const matches = city.all_properties.filter(p => p.name === type);

  const taken = new Set<string>();
  for (const m of matches) {
    if (typeof m.company_name === 'string') taken.add(m.company_name);
  }

  // Shuffle the unused names (Fisher-Yates).
  const available = pool.filter(n => !taken.has(n));
  for (let i = available.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [available[i], available[j]] = [available[j], available[i]];
  }

  let cursor = 0;
  let fallbackCounter = 1;
  for (const property of matches) {
    if (typeof property.company_name === 'string') continue;
    if (cursor < available.length) {
      property.company_name = available[cursor++];
    } else {
      // Out of unique names — synthesize a deterministic-ish fallback.
      while (taken.has(`${fallback} ${fallbackCounter}`)) fallbackCounter++;
      property.company_name = `${fallback} ${fallbackCounter}`;
      taken.add(property.company_name);
      fallbackCounter++;
    }
  }

  return matches
    .map(m => m.company_name)
    .filter((n): n is string => typeof n === 'string');
}

// Names every office and every restaurant in the city. Both reuse the
// `company_name` field, which already threads through trip records and the
// property labels, so naming restaurants needed no schema change.
//
// Returns the office names, which is what job assignment draws from.
export function assignCompanyNames(city: City): string[] {
  assignNames(city, 'restaurant', RESTAURANTS.map(r => r.name), 'Restaurant');
  return assignNames(city, 'office', COMPANY_NAMES, 'Office');
}
