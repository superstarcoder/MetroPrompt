'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { PROPERTY_DEFAULTS } from '@/lib/all_types';
import type { City, Nature, NatureName, Position, Property, PropertyName } from '@/lib/all_types';
import { isPlacementValid, screenToGrid } from './hitTesting';
import type { EntityDragState, SelectedEntity } from './hitTesting';

type Args = {
  cityRef: RefObject<City>;
  editable: boolean;
  onCityChange?: (city: City) => void;
};

type PaletteItem =
  | { kind: 'property'; name: PropertyName; image: string }
  | { kind: 'nature'; name: NatureName; image: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SceneApi = { scheduleRender: () => void; worldRef: RefObject<any> };

type Result = {
  // For parent JSX (delete-button visibility).
  selectedEntity: SelectedEntity | null;

  // Refs handed to useCityScene so its event handlers can read live state.
  selectedEntityRef: RefObject<SelectedEntity | null>;
  hoveredEntityRef: RefObject<SelectedEntity | null>;
  entityDragRef: RefObject<EntityDragState | null>;
  editableRef: RefObject<boolean>;
  onCityChangeRef: RefObject<((city: City) => void) | undefined>;
  setSelectedEntity: (e: SelectedEntity | null) => void;

  // Parent calls this after useCityScene runs, threading scheduleRender + worldRef
  // back in so the editor callbacks can read them. Resolves the hook-order cycle:
  // scene needs editor refs at call time; editor callbacks need scene outputs.
  bindScene: (api: SceneApi) => void;

  // Editor actions consumed by Palette + the floating delete button.
  onPalettePointerDown: (e: React.PointerEvent<HTMLElement>, item: PaletteItem) => void;
  onDeleteSelected: () => void;
};

// Owns edit-mode state (hover/select/drag refs + selected-entity React state) and
// the editor actions: dragging palette items onto the grid and deleting the
// currently-selected entity. Knows nothing about Pixi or the Mayor stream.
export function useCityEditor({ cityRef, editable, onCityChange }: Args): Result {
  const [selectedEntity, setSelectedEntityState] = useState<SelectedEntity | null>(null);
  const selectedEntityRef = useRef<SelectedEntity | null>(null);
  const hoveredEntityRef = useRef<SelectedEntity | null>(null);
  const entityDragRef = useRef<EntityDragState | null>(null);
  const editableRef = useRef(editable);
  useEffect(() => { editableRef.current = editable; }, [editable]);
  const onCityChangeRef = useRef(onCityChange);
  useEffect(() => { onCityChangeRef.current = onCityChange; }, [onCityChange]);

  const sceneRef = useRef<SceneApi | null>(null);
  const bindScene = useCallback((api: SceneApi) => {
    sceneRef.current = api;
  }, []);

  const setSelectedEntity = useCallback((e: SelectedEntity | null) => {
    selectedEntityRef.current = e;
    setSelectedEntityState(e);
  }, []);

  const onPalettePointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>, item: PaletteItem) => {
      e.preventDefault();
      e.stopPropagation();
      if (!editableRef.current) return;
      const scene = sceneRef.current;
      const world = scene?.worldRef.current;
      const scheduleRender = scene?.scheduleRender;
      if (!world || !scheduleRender) return;
      const city = cityRef.current;

      // Initial position: the cell currently under the cursor (which may be
      // behind the sidebar — that's fine, the sprite renders there until the user
      // moves the cursor onto the open canvas).
      const cell0 = screenToGrid(e.clientX, e.clientY, world.x, world.y, world.scale.x);
      const initialPos: Position = cell0 ? { x: cell0.gx, y: cell0.gy } : { x: 0, y: 0 };

      let sel: SelectedEntity;
      if (item.kind === 'property') {
        const def = PROPERTY_DEFAULTS[item.name];
        const newProp: Property = {
          ...def,
          image: item.image,
          position: initialPos,
          current_occupants: [],
        };
        city.all_properties.push(newProp);
        sel = { kind: 'property', data: newProp };
      } else {
        const newNat: Nature = {
          name: item.name,
          position: initialPos,
          image: item.image,
        };
        city.all_nature.push(newNat);
        sel = { kind: 'nature', data: newNat };
      }

      // Initial cursor is over the palette itself, so the placement starts invalid;
      // releasing without moving discards the entity. The first onMove that lands
      // on the canvas (away from any [data-mayor-ui] surface) recomputes validity.
      entityDragRef.current = {
        sel,
        originalPos: initialPos,
        valid: false,
        isNew: true,
      };
      setSelectedEntity(sel);
      scheduleRender();

      const isOverUI = (ev: PointerEvent) => {
        const el = document.elementFromPoint(ev.clientX, ev.clientY);
        return !!el?.closest('[data-mayor-ui]');
      };

      const onMove = (ev: PointerEvent) => {
        const drag = entityDragRef.current;
        if (!drag) return;
        if (isOverUI(ev)) {
          // Hovering back over a UI surface (palette, header, delete btn) → invalid drop.
          drag.valid = false;
          scheduleRender();
          return;
        }
        const cell = screenToGrid(ev.clientX, ev.clientY, world.x, world.y, world.scale.x);
        if (!cell) {
          drag.valid = false;
          scheduleRender();
          return;
        }
        const newPos = { x: cell.gx, y: cell.gy };
        if (drag.sel.data.position.x === newPos.x && drag.sel.data.position.y === newPos.y) {
          drag.valid = isPlacementValid(city, drag.sel, newPos);
          scheduleRender();
          return;
        }
        drag.sel.data.position = newPos;
        drag.valid = isPlacementValid(city, drag.sel, newPos);
        scheduleRender();
      };

      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        const drag = entityDragRef.current;
        if (!drag) return;
        if (!drag.valid) {
          // Discard the freshly-spawned entity.
          if (drag.sel.kind === 'property') {
            const idx = city.all_properties.indexOf(drag.sel.data);
            if (idx >= 0) city.all_properties.splice(idx, 1);
          } else {
            const idx = city.all_nature.indexOf(drag.sel.data);
            if (idx >= 0) city.all_nature.splice(idx, 1);
          }
          setSelectedEntity(null);
        } else {
          onCityChangeRef.current?.(city);
        }
        entityDragRef.current = null;
        scheduleRender();
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [cityRef, setSelectedEntity],
  );

  const onDeleteSelected = useCallback(() => {
    const sel = selectedEntityRef.current;
    if (!sel) return;
    const scene = sceneRef.current;
    if (!scene) return;
    const city = cityRef.current;
    if (sel.kind === 'property') {
      const idx = city.all_properties.indexOf(sel.data);
      if (idx >= 0) city.all_properties.splice(idx, 1);
    } else {
      const idx = city.all_nature.indexOf(sel.data);
      if (idx >= 0) city.all_nature.splice(idx, 1);
    }
    setSelectedEntity(null);
    hoveredEntityRef.current = null;
    onCityChangeRef.current?.(city);
    scene.scheduleRender();
  }, [cityRef, setSelectedEntity]);

  return {
    selectedEntity,
    selectedEntityRef,
    hoveredEntityRef,
    entityDragRef,
    editableRef,
    onCityChangeRef,
    setSelectedEntity,
    bindScene,
    onPalettePointerDown,
    onDeleteSelected,
  };
}
