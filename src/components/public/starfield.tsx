/**
 * Night sky over Dar es Salaam — the backdrop behind every translucent dark section of the
 * public site. Now a still, CSS-only layer (.pub-backdrop in globals.css: two soft lights and
 * a fine star dust painted once) instead of an animated canvas: no JavaScript, no frame loop,
 * nothing for a phone to keep redrawing.
 */
export function Starfield() {
  return <div aria-hidden="true" className="pub-backdrop" />;
}
