'use client';

import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type { City, Property } from '@/lib/all_types';
import { gridToScreen } from './constants';
import { PROPERTY_LABELS } from './propertyLabels';

type Props = {
  property: Property;
  cityRef: RefObject<City>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  worldRef: RefObject<any>;
  onClose: () => void;
};

export function PropertyInfoPopup({ property, cityRef, worldRef, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const world = worldRef.current;
      const el = ref.current;
      if (world && el) {
        const wx = world.x;
        const wy = world.y;
        const ws = world.scale.x;
        const { x, y } = gridToScreen(property.position.x, property.position.y);
        const sx = x * ws + wx;
        // Anchor above the building anchor cell with a generous offset that
        // clears the tallest building sprite (apartment_v4 ~ -129 px offset).
        const sy = y * ws + wy - 100 * ws;
        el.style.left = `${sx}px`;
        el.style.top = `${sy}px`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [property, worldRef]);

  // Filter on object identity — `inside_property` is a Property reference, so
  // this gives us the actual citizens currently inside this building. (We do
  // not rely on `current_occupants` for display since it stores names, which
  // can collide; the reference filter is unambiguous.)
  const occupants = cityRef.current.all_citizens.filter(c => c.inside_property === property);
  const label = PROPERTY_LABELS[property.name] ?? property.name;
  const heading = property.company_name ? `${property.company_name}` : label;
  const subhead = property.company_name ? label : null;

  return (
    <div
      data-mayor-ui
      ref={ref}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      className="absolute z-20 bg-[#0b1220] text-white border-2 border-white/90 px-4 py-3 font-mono text-[11px] leading-tight"
      style={{
        left: 0,
        top: 0,
        transform: 'translate(-50%, -100%)',
        boxShadow: '3px 3px 0 0 rgba(0,0,0,0.85)',
        minWidth: '260px',
        maxWidth: '320px',
      }}
    >
      <div className="flex justify-between items-start mb-2 pb-1 border-b border-white/20 gap-3">
        <div className="flex flex-col leading-tight min-w-0">
          <span className="text-fuchsia-300 uppercase tracking-wider truncate">{heading}</span>
          {subhead && <span className="text-white/40 text-[9px] uppercase tracking-wider">{subhead}</span>}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-white/60 hover:text-white px-1 leading-none shrink-0"
          aria-label="Close info"
        >
          ✕
        </button>
      </div>
      <div className="flex justify-between mb-2 text-white/70">
        <span>Inside</span>
        <span className="tabular-nums">
          <span className="text-white">{occupants.length}</span>
          <span className="text-white/40"> / {property.capacity}</span>
        </span>
      </div>
      {occupants.length > 0 ? (
        <div className="space-y-0.5 max-h-44 overflow-y-auto pr-1">
          {occupants.map((c, i) => (
            <div key={i} className="flex justify-between gap-2 items-baseline">
              <span className="text-white/90 truncate">{c.name}</span>
              <span className="text-white/45 truncate text-[10px] shrink-0">
                {c.job ? `Eng @ ${c.job}` : '—'}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-white/40 italic">Empty</div>
      )}
    </div>
  );
}
