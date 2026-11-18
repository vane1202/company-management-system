export interface TipTriggerRect {
  top: number;
  bottom: number;
  left: number;
  width: number;
}

export interface TipViewport {
  width: number;
  height: number;
}

export type TipPosition = {
  left: number;
  width: number;
  maxHeight: number;
} & ({ top: number; bottom?: undefined } | { bottom: number; top?: undefined });

/**
 * Computes fixed viewport coordinates for an InfoTip popover, flipping above
 * the trigger button when space below is tight and clamping horizontally.
 */
export function computeTipPosition(
  rect: TipTriggerRect,
  viewport: TipViewport,
  options?: { bottomInset?: number },
): TipPosition {
  const edge = 8;
  const gap = 6;
  const bottomInset = options?.bottomInset ?? (viewport.width <= 799 ? 84 : 16);
  const width = Math.max(0, Math.min(280, viewport.width - edge * 2));
  const rawLeft = rect.left + rect.width / 2 - width / 2;
  const maxLeft = Math.max(edge, viewport.width - width - edge);
  const left = Math.min(Math.max(edge, rawLeft), maxLeft);

  const belowTop = Math.max(edge, rect.bottom + gap);
  const spaceBelow = viewport.height - bottomInset - belowTop;
  const spaceAbove = rect.top - gap - edge;

  if (spaceBelow < 160 && spaceAbove > spaceBelow) {
    const bottom = Math.max(bottomInset, viewport.height - (rect.top - gap));
    return {
      bottom,
      left,
      width,
      maxHeight: Math.max(48, Math.floor(viewport.height - bottom - edge)),
    };
  }

  return {
    top: belowTop,
    left,
    width,
    maxHeight: Math.max(48, Math.floor(spaceBelow)),
  };
}
