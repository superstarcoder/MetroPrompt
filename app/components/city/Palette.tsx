'use client';

import type { NatureName, PropertyName } from '@/lib/all_types';
import { NATURE_PALETTE, PROPERTY_PALETTE } from './paletteData';

export type PaletteItem =
  | { kind: 'property'; name: PropertyName; image: string }
  | { kind: 'nature'; name: NatureName; image: string };

type Props = {
  onPalettePointerDown: (e: React.PointerEvent<HTMLElement>, item: PaletteItem) => void;
};

export function Palette({ onPalettePointerDown }: Props) {
  return (
    <div
      data-mayor-ui
      className="absolute top-4 right-4 w-56 flex flex-col bg-[#0b1220] text-white font-mono border-2 border-white/90"
      style={{
        maxHeight: 'calc(100vh - 2rem)',
        imageRendering: 'pixelated',
        boxShadow: '4px 4px 0 0 rgba(0,0,0,0.85), inset 0 0 0 2px #1a2540',
      }}
    >
      <div className="flex items-center gap-1.5 px-3 py-2 bg-[#1a2540] border-b-2 border-white/90 uppercase tracking-[0.2em] text-[10px] shrink-0">
        <span className="inline-block w-2 h-2 bg-fuchsia-400" />
        <span>Palette</span>
        <span className="opacity-40 text-[9px] tracking-normal ml-auto normal-case">drag onto map</span>
      </div>
      <div className="overflow-y-auto p-2.5 space-y-3 text-[10px]">
        <div>
          <div className="text-[9px] uppercase tracking-[0.3em] text-fuchsia-300/80 mb-1.5">▣ Buildings</div>
          <div className="space-y-2">
            {PROPERTY_PALETTE.map(cat => (
              <div key={cat.name}>
                <div className="text-[9px] uppercase tracking-wider text-white/55 mb-0.5">{cat.label}</div>
                <div className="flex flex-wrap gap-1">
                  {cat.images.map(img => (
                    <div
                      key={img}
                      onPointerDown={(e) => onPalettePointerDown(e, { kind: 'property', name: cat.name, image: img })}
                      title={`${cat.label} — drag to place`}
                      className="w-12 h-12 flex items-center justify-center cursor-grab active:cursor-grabbing border border-white/30 bg-black/40 hover:border-fuchsia-400 hover:bg-fuchsia-500/10 transition-colors"
                      style={{ touchAction: 'none' }}
                    >
                      <img
                        src={img}
                        alt={cat.label}
                        draggable={false}
                        className="max-w-full max-h-full"
                        style={{ imageRendering: 'pixelated' }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="text-[9px] uppercase tracking-[0.3em] text-emerald-300/80 mb-1.5">✿ Nature</div>
          <div className="space-y-2">
            {NATURE_PALETTE.map(cat => (
              <div key={cat.name}>
                <div className="text-[9px] uppercase tracking-wider text-white/55 mb-0.5">{cat.label}</div>
                <div className="flex flex-wrap gap-1">
                  {cat.images.map(img => (
                    <div
                      key={img}
                      onPointerDown={(e) => onPalettePointerDown(e, { kind: 'nature', name: cat.name, image: img })}
                      title={`${cat.label} — drag to place`}
                      className="w-12 h-12 flex items-center justify-center cursor-grab active:cursor-grabbing border border-white/30 bg-black/40 hover:border-emerald-400 hover:bg-emerald-500/10 transition-colors"
                      style={{ touchAction: 'none' }}
                    >
                      <img
                        src={img}
                        alt={cat.label}
                        draggable={false}
                        className="max-w-full max-h-full"
                        style={{ imageRendering: 'pixelated' }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
