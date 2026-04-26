import type { Property, PropertyName, Trip } from '@/lib/all_types';

// Human-readable labels for each property type.
export const PROPERTY_LABELS: Record<PropertyName, string> = {
  park: 'Park',
  hospital: 'Hospital',
  school: 'School',
  grocery_store: 'Grocery Store',
  house: 'House',
  apartment: 'Apartment',
  office: 'Office',
  restaurant: 'Restaurant',
  fire_station: 'Fire Station',
  police_station: 'Police Station',
  power_plant: 'Power Plant',
  shopping_mall: 'Shopping Mall',
  theme_park: 'Theme Park',
};

// "Hooli (Office)" for offices with a company name; otherwise the type label.
export function formatPropertyLabel(p: Property | null | undefined): string {
  if (!p) return '—';
  const label = PROPERTY_LABELS[p.name] ?? p.name;
  if (p.name === 'office' && p.company_name) return `${p.company_name} (Office)`;
  return label;
}

// Same convention as formatPropertyLabel, but reads from a Trip record (which
// stores destination_name + optional destination_company instead of a full
// Property reference).
export function formatTripDestination(t: Pick<Trip, 'destination_name' | 'destination_company'>): string {
  const label = PROPERTY_LABELS[t.destination_name] ?? t.destination_name;
  if (t.destination_name === 'office' && t.destination_company) {
    return `${t.destination_company} (Office)`;
  }
  return label;
}
