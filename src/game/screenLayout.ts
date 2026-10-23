// Where the screen's controls may sit so none lies over another (1.9.7.1.2): rectangles in CSS
// px, worked out headlessly from the rectangles already on screen. Pure: src/ui/liftLine.ts
// measures the control cluster and the manual's band and asks this where the lift line goes.

/** A box on screen, CSS px from the viewport's top left. */
export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** True when `a` and `b` share any area (touching edges do not count). */
export function overlaps(a: Rect, b: Rect): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/** What the lift line's box is placed from. */
export interface LiftLineInput {
  /** The viewport's size. */
  viewport: { width: number; height: number };
  /** The control cluster (the menu, and the ?tune gear when shown): the line hangs below it, on its side. */
  cluster: Rect;
  /** The manual's band, or null when there is none. */
  strip: Rect | null;
  /** The line's touch band's width, and the knob's radius, which overhangs the line's ends. */
  hitWidth: number;
  knobRadius: number;
  /** The space kept between the line's knob and its neighbours. */
  gap: number;
}

/**
 * The lift line's touch band: under the control cluster, centred on it, so it is always on the
 * menu's side; from below the cluster to above the manual's band when the band lies beneath it
 * (portrait), else to the screen's foot. The knob's travel ends `knobRadius` inside either end,
 * so the knob never reaches the cluster or the band. Held inside the viewport sideways. Null when
 * there is no room for a line between them, or a band shares its column beside the cluster.
 */
export function liftLineBox({ viewport, cluster, strip, hitWidth, knobRadius, gap }: LiftLineInput): Rect | null {
  const half = hitWidth / 2;
  const centre = Math.min(viewport.width - half, Math.max(half, (cluster.left + cluster.right) / 2));
  const left = centre - half;
  const right = centre + half;
  const inColumn = strip !== null && strip.left < right && left < strip.right;
  // A band in the line's column that reaches up beside the cluster leaves the line no room.
  if (inColumn && strip.top < cluster.bottom) return null;
  const floor = inColumn ? strip.top : viewport.height;
  const top = cluster.bottom + gap + knobRadius;
  const bottom = floor - gap - knobRadius;
  return bottom > top ? { left, top, right, bottom } : null;
}

/** What the manual fan's box is placed from. */
export interface FanBoxInput {
  /** The viewport's size. */
  viewport: { width: number; height: number };
  /** The control cluster (the menu, and the ?tune gear when shown); the fan is level with it. */
  cluster: Rect;
  /** The catalog's thumb, beside the cluster, or null when there is none: the fan starts past it (else past the cluster). */
  thumb: Rect | null;
  /** The manual's band, or null when there is none: when it reaches the top row (landscape, down the right edge) the fan ends short of it. */
  strip: Rect | null;
  /** The fan's height. */
  height: number;
  /** The space kept between the fan and its neighbours. */
  gap: number;
  /** The space kept to the viewport's edge when no band stands there. */
  margin: number;
}

/**
 * The manual fan's row (1.9.9.3): across the top from the catalog thumb's right edge to the manual's
 * side — the viewport's right edge upright, the band's left edge in landscape, where the band runs the
 * screen's height — a gap off each, its top level with the cluster. Never narrower than nothing, so a
 * crowded top leaves an empty box rather than an inverted one.
 */
export function fanBox({ viewport, cluster, thumb, strip, height, gap, margin }: FanBoxInput): Rect {
  const left = (thumb ?? cluster).right + gap;
  const top = cluster.top;
  const bandInRow = strip !== null && strip.right > left && strip.top < top + height && strip.bottom > top;
  const right = Math.max(left, bandInRow ? strip.left - gap : viewport.width - margin);
  return { left, top, right, bottom: top + height };
}
