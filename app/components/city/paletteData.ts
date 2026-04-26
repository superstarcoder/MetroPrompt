import {
  PROPERTY_DEFAULTS,
  HOUSE_IMAGES,
  APARTMENT_IMAGES,
  OFFICE_IMAGES,
  RESTAURANT_IMAGES,
  TREE_IMAGES,
  FLOWER_PATCH_IMAGES,
  BUSH_IMAGES,
} from '@/lib/all_types';
import type { PropertyName, NatureName } from '@/lib/all_types';

// Palette categories — each property name and nature name is one category. Multi-variant
// items (house, apartment, office, tree) display every variant; single-variant items
// fall back to PROPERTY_DEFAULTS / *_IMAGES with one entry.
export type PropPaletteCategory = { kind: 'property'; name: PropertyName; label: string; images: string[] };
export type NaturePaletteCategory = { kind: 'nature'; name: NatureName; label: string; images: string[] };

export const PROPERTY_PALETTE: PropPaletteCategory[] = [
  { kind: 'property', name: 'house',          label: 'House',          images: HOUSE_IMAGES },
  { kind: 'property', name: 'apartment',      label: 'Apartment',      images: APARTMENT_IMAGES },
  { kind: 'property', name: 'office',         label: 'Office',         images: OFFICE_IMAGES },
  { kind: 'property', name: 'park',           label: 'Park',           images: [PROPERTY_DEFAULTS.park.image] },
  { kind: 'property', name: 'hospital',       label: 'Hospital',       images: [PROPERTY_DEFAULTS.hospital.image] },
  { kind: 'property', name: 'school',         label: 'School',         images: [PROPERTY_DEFAULTS.school.image] },
  { kind: 'property', name: 'grocery_store',  label: 'Grocery Store',  images: [PROPERTY_DEFAULTS.grocery_store.image] },
  { kind: 'property', name: 'restaurant',     label: 'Restaurant',     images: RESTAURANT_IMAGES },
  { kind: 'property', name: 'shopping_mall',  label: 'Shopping Mall',  images: [PROPERTY_DEFAULTS.shopping_mall.image] },
  { kind: 'property', name: 'theme_park',     label: 'Theme Park',     images: [PROPERTY_DEFAULTS.theme_park.image] },
  { kind: 'property', name: 'fire_station',   label: 'Fire Station',   images: [PROPERTY_DEFAULTS.fire_station.image] },
  { kind: 'property', name: 'police_station', label: 'Police Station', images: [PROPERTY_DEFAULTS.police_station.image] },
  { kind: 'property', name: 'power_plant',    label: 'Power Plant',    images: [PROPERTY_DEFAULTS.power_plant.image] },
];

export const NATURE_PALETTE: NaturePaletteCategory[] = [
  { kind: 'nature', name: 'tree',         label: 'Tree',    images: TREE_IMAGES },
  { kind: 'nature', name: 'flower_patch', label: 'Flowers', images: FLOWER_PATCH_IMAGES },
  { kind: 'nature', name: 'bush',         label: 'Bush',    images: BUSH_IMAGES },
];
