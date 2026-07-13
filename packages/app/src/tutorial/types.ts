// Window-space rectangle of a spotlight target, as returned by measureInWindow
// (x/y are top-left, in window coordinates). Shared by the registry, the
// controller's measurement, and the overlay's cutout geometry.
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
