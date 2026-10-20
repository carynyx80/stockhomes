/** Positions on the facade, as percentages of the 1000 × 1300 viewBox, for the HTML layers over the SVG. */

const W = 1000;
const H = 1300;

const box = (x: number, y: number, w: number, h: number) => ({
  left: `${(x / W) * 100}%`,
  top: `${(y / H) * 100}%`,
  width: `${(w / W) * 100}%`,
  height: `${(h / H) * 100}%`,
});

export const DOOR = box(400, 790, 200, 400);
export const SIGN = box(646, 876, 86, 64);
/** Light falling out of the door onto the steps. */
export const SPILL = box(300, 1190, 400, 110);

/** Scale origin for the walk-in: the centre of the doorway. */
export const DOOR_ORIGIN = `50% ${((790 + 200) / H) * 100}%`;
