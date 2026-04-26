// Pixel-glyph + accent color per tool type. Static class names so Tailwind picks them up.
export type ToolStyle = {
  glyph: string;
  label: string;
  textCls: string;
  borderCls: string;
  bgCls: string;
  dotCls: string;
};

export function toolStyle(name: string): ToolStyle {
  switch (name) {
    case 'place_property':
    case 'place_properties':
      return { glyph: '▣', label: 'BUILD', textCls: 'text-fuchsia-300', borderCls: 'border-fuchsia-400/70', bgCls: 'bg-fuchsia-500/15', dotCls: 'bg-fuchsia-400' };
    case 'place_tile_rect':
    case 'place_tile_rects':
      return { glyph: '▭', label: 'TILE', textCls: 'text-amber-300', borderCls: 'border-amber-400/70', bgCls: 'bg-amber-500/15', dotCls: 'bg-amber-400' };
    case 'place_nature':
    case 'place_natures':
      return { glyph: '✿', label: 'NATURE', textCls: 'text-emerald-300', borderCls: 'border-emerald-400/70', bgCls: 'bg-emerald-500/15', dotCls: 'bg-emerald-400' };
    case 'delete_property':
    case 'delete_properties':
    case 'delete_tile_rect':
    case 'delete_tile_rects':
    case 'delete_nature':
    case 'delete_natures':
      return { glyph: '✕', label: 'REMOVE', textCls: 'text-rose-300', borderCls: 'border-rose-400/70', bgCls: 'bg-rose-500/15', dotCls: 'bg-rose-400' };
    case 'finish':
      return { glyph: '✓', label: 'FINISH', textCls: 'text-sky-300', borderCls: 'border-sky-400/70', bgCls: 'bg-sky-500/15', dotCls: 'bg-sky-400' };
    default:
      return { glyph: '◆', label: name.toUpperCase(), textCls: 'text-white/80', borderCls: 'border-white/40', bgCls: 'bg-white/5', dotCls: 'bg-white/60' };
  }
}

export function formatToolInput(name: string, input: Record<string, unknown>): string {
  const i = input as Record<string, unknown>;
  switch (name) {
    case 'place_property':
      return `${String(i.property)} @ (${i.x},${i.y})`;
    case 'place_tile_rect':
      return `${String(i.tile)} (${i.x1},${i.y1})→(${i.x2},${i.y2})`;
    case 'place_nature':
      return `${String(i.nature)} @ (${i.x},${i.y})`;
    case 'delete_property':
    case 'delete_nature':
      return `@ (${i.x},${i.y})`;
    case 'delete_tile_rect':
      return `(${i.x1},${i.y1})→(${i.x2},${i.y2}) → grass`;
    case 'finish':
      return String(i.reason ?? '');
    default:
      return JSON.stringify(input);
  }
}
