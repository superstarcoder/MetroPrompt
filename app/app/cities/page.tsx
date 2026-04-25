'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { listCities, deleteCity, type SavedCityMeta } from '@/lib/cityStore';

function formatRelative(ts: number): string {
  const diffMs = Date.now() - ts;
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(ts).toLocaleDateString();
}

export default function CitiesPage() {
  const [cities, setCities] = useState<SavedCityMeta[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(() => {
    setCities(listCities());
  }, []);

  useEffect(() => {
    refresh();
    setLoaded(true);
  }, [refresh]);

  const onDelete = useCallback((id: string, name: string) => {
    if (!confirm(`Delete "${name}"? This can't be undone.`)) return;
    deleteCity(id);
    refresh();
  }, [refresh]);

  return (
    <main className="w-screen h-screen overflow-y-auto bg-[#0b1220] text-white font-mono">
      <div className="max-w-5xl mx-auto px-6 py-10">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="text-[11px] uppercase tracking-[0.25em] text-white/60 hover:text-white"
            >
              ← Home
            </Link>
            <span className="opacity-30">|</span>
            <h1
              className="text-2xl font-bold uppercase tracking-[0.3em]"
              style={{ textShadow: '3px 3px 0 #1a2540' }}
            >
              My Cities
            </h1>
          </div>
          <Link
            href="/build"
            className="px-4 py-2 bg-cyan-500 hover:bg-cyan-400 text-black text-[11px] font-bold uppercase tracking-[0.2em] border-2 border-white/90 transition-colors"
            style={{ boxShadow: '3px 3px 0 0 rgba(0,0,0,0.85)' }}
          >
            ▶ Build New
          </Link>
        </div>

        {/* List */}
        {loaded && cities.length === 0 && (
          <div className="border-2 border-white/30 bg-black/30 p-10 text-center">
            <div className="text-white/40 text-[11px] uppercase tracking-[0.3em] mb-3">
              ▒▒ no saved cities yet ▒▒
            </div>
            <Link
              href="/build"
              className="inline-block mt-2 text-cyan-300 hover:text-cyan-200 text-[11px] uppercase tracking-[0.2em] underline"
            >
              Build one →
            </Link>
          </div>
        )}

        {cities.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {cities.map(c => (
              <div
                key={c.id}
                className="border-2 border-white/80 bg-[#0d1424] p-4 flex flex-col gap-2"
                style={{ boxShadow: '4px 4px 0 0 rgba(0,0,0,0.85)' }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="text-base font-bold text-fuchsia-300 break-all">
                    {c.name || '(unnamed)'}
                  </div>
                  <button
                    onClick={() => onDelete(c.id, c.name)}
                    className="shrink-0 px-2 py-0.5 text-[10px] uppercase tracking-wider text-rose-300/80 hover:text-rose-200 hover:bg-rose-500/10 border border-rose-400/40 transition-colors"
                    title="Delete this city"
                  >
                    🗑 delete
                  </button>
                </div>
                <div className="text-[11px] text-white/60 leading-relaxed line-clamp-3">
                  {c.originalGoal || <span className="opacity-40">(no goal)</span>}
                </div>
                <div className="flex items-center gap-3 text-[10px] uppercase tracking-wider text-white/50 pt-1">
                  <span>{formatRelative(c.createdAt)}</span>
                  <span className="opacity-40">·</span>
                  <span>▣ {c.propertyCount}</span>
                  <span className="opacity-40">·</span>
                  <span>✿ {c.natureCount}</span>
                </div>
                <Link
                  href={`/cities/${c.id}`}
                  className="mt-2 block py-2 text-center bg-fuchsia-500 hover:bg-fuchsia-400 text-black text-[11px] font-bold uppercase tracking-[0.2em] border-2 border-white/90 transition-colors"
                  style={{ boxShadow: '3px 3px 0 0 rgba(0,0,0,0.85)' }}
                >
                  ▶ Open
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
