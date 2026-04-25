// Local-only persistence for saved cities. Uses localStorage with split keys:
//   metroprompt:index           → SavedCityMeta[]  (cheap to read on the list page)
//   metroprompt:city:<id>       → City             (full schema; only loaded on view)
//
// If we outgrow localStorage's ~5MB cap (e.g. 500x500 cities), swap this module
// to IndexedDB without touching callers.

import type { City } from './all_types';

const INDEX_KEY = 'metroprompt:index';
const CITY_PREFIX = 'metroprompt:city:';

export type SavedCityMeta = {
  id: string;
  name: string;
  createdAt: number;
  originalGoal: string;
  propertyCount: number;
  natureCount: number;
};

export type SavedCity = SavedCityMeta & { city: City };

function hasStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function readIndex(): SavedCityMeta[] {
  if (!hasStorage()) return [];
  const raw = window.localStorage.getItem(INDEX_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeIndex(index: SavedCityMeta[]): void {
  if (!hasStorage()) return;
  window.localStorage.setItem(INDEX_KEY, JSON.stringify(index));
}

export function listCities(): SavedCityMeta[] {
  // Newest first.
  return readIndex().slice().sort((a, b) => b.createdAt - a.createdAt);
}

export function getCity(id: string): SavedCity | null {
  if (!hasStorage()) return null;
  const meta = readIndex().find(m => m.id === id);
  if (!meta) return null;
  const raw = window.localStorage.getItem(CITY_PREFIX + id);
  if (!raw) return null;
  try {
    const city = JSON.parse(raw) as City;
    return { ...meta, city };
  } catch {
    return null;
  }
}

export function saveCity(input: { name: string; originalGoal: string; city: City }): SavedCityMeta {
  if (!hasStorage()) throw new Error('localStorage unavailable');
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const meta: SavedCityMeta = {
    id,
    name: input.name,
    createdAt: Date.now(),
    originalGoal: input.originalGoal,
    propertyCount: input.city.all_properties.length,
    natureCount: input.city.all_nature.length,
  };
  // Strip citizens — sim isn't built yet and they'd bloat storage.
  const cityToSave: City = {
    tile_grid: input.city.tile_grid,
    all_properties: input.city.all_properties,
    all_nature: input.city.all_nature,
    all_citizens: [],
    day: input.city.day,
  };
  window.localStorage.setItem(CITY_PREFIX + id, JSON.stringify(cityToSave));
  const index = readIndex();
  index.push(meta);
  writeIndex(index);
  return meta;
}

export function updateCity(id: string, city: City): SavedCityMeta | null {
  if (!hasStorage()) return null;
  const index = readIndex();
  const idx = index.findIndex(m => m.id === id);
  if (idx === -1) return null;
  const cityToSave: City = {
    tile_grid: city.tile_grid,
    all_properties: city.all_properties,
    all_nature: city.all_nature,
    all_citizens: [],
    day: city.day,
  };
  window.localStorage.setItem(CITY_PREFIX + id, JSON.stringify(cityToSave));
  const updated: SavedCityMeta = {
    ...index[idx],
    propertyCount: city.all_properties.length,
    natureCount: city.all_nature.length,
  };
  index[idx] = updated;
  writeIndex(index);
  return updated;
}

export function deleteCity(id: string): void {
  if (!hasStorage()) return;
  window.localStorage.removeItem(CITY_PREFIX + id);
  writeIndex(readIndex().filter(m => m.id !== id));
}
