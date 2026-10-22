import { useState, useCallback, useRef } from 'react';

const LONG_PRESS_MS = 500;

export interface ContextMenuState<T> {
  target: T;
  anchor: { x: number; y: number };
}

/**
 * Right-click (desktop) + long-press (touch) + explicit kebab-button menu
 * state, anchored to a point via a 1px fixed trigger (Radix 2.x dropdown
 * has no virtual anchor).
 *
 * Usage:
 *   const menu = useContextMenu<Channel>();
 *   <div {...menu.triggerProps(channel)}>…</div>
 *   <button onClick={(e) => {
 *     const r = e.currentTarget.getBoundingClientRect();
 *     menu.open(channel, r.right, r.bottom);
 *   }}>⋮</button>
 *   <DropdownMenu open={!!menu.state} onOpenChange={(o) => !o && menu.close()}>
 *     …1px trigger at menu.state.anchor…
 *   </DropdownMenu>
 */
export function useContextMenu<T>() {
  const [state, setState] = useState<ContextMenuState<T> | null>(null);
  const longPressTimer = useRef<number | null>(null);

  const close = useCallback(() => setState(null), []);

  const open = useCallback((target: T, x: number, y: number) => {
    setState({ target, anchor: { x, y } });
  }, []);

  const clearLongPress = useCallback(() => {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const triggerProps = useCallback(
    (target: T) => ({
      onContextMenu: (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        clearLongPress();
        setState({ target, anchor: { x: e.clientX, y: e.clientY } });
      },
      onPointerDown: (e: React.PointerEvent) => {
        if (e.pointerType !== 'touch') return;
        const { clientX, clientY } = e;
        longPressTimer.current = window.setTimeout(() => {
          longPressTimer.current = null;
          setState({ target, anchor: { x: clientX, y: clientY } });
        }, LONG_PRESS_MS);
      },
      onPointerMove: (e: React.PointerEvent) => {
        if (e.pointerType === 'touch') clearLongPress();
      },
      onPointerUp: clearLongPress,
      onPointerCancel: clearLongPress,
      onPointerLeave: clearLongPress,
    }),
    [clearLongPress],
  );

  return { state, close, open, triggerProps };
}
