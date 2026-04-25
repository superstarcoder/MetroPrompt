'use client';

import Link from 'next/link';
import { use, useCallback, useEffect, useState } from 'react';
import CityRendererWrapper from '@/components/CityRendererWrapper';
import { getCity, updateCity, type SavedCity } from '@/lib/cityStore';
import type { City } from '@/lib/all_types';

export default function CityViewerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [saved, setSaved] = useState<SavedCity | null | undefined>(undefined);

  useEffect(() => {
    setSaved(getCity(id));
  }, [id]);

  if (saved === undefined) {
    // First client render — localStorage hasn't been read yet.
    return (
      <main className="w-screen h-screen flex items-center justify-center bg-[#0b1220] text-white font-mono text-[11px] uppercase tracking-[0.3em]">
        loading…
      </main>
    );
  }

  if (saved === null) {
    return (
      <main className="w-screen h-screen flex items-center justify-center bg-[#0b1220] text-white font-mono">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="text-[11px] uppercase tracking-[0.3em] text-rose-300">
            ▒▒ city not found ▒▒
          </div>
          <div className="text-white/50 text-[11px]">
            This city may have been deleted, or this link is from another browser.
          </div>
          <Link
            href="/cities"
            className="mt-2 px-4 py-2 bg-fuchsia-500 hover:bg-fuchsia-400 text-black text-[11px] font-bold uppercase tracking-[0.2em] border-2 border-white/90"
            style={{ boxShadow: '3px 3px 0 0 rgba(0,0,0,0.85)' }}
          >
            ← back to My Cities
          </Link>
        </div>
      </main>
    );
  }

  return <ViewerInner saved={saved} />;
}

function ViewerInner({ saved }: { saved: SavedCity }) {
  const handleCityChange = useCallback(
    (city: City) => {
      updateCity(saved.id, city);
    },
    [saved.id],
  );

  return (
    <main className="w-screen h-screen overflow-hidden">
      <CityRendererWrapper
        readOnly
        editable
        initialCity={saved.city}
        cityName={saved.name}
        onCityChange={handleCityChange}
      />
    </main>
  );
}
