/** Where new elements should appear: under the mouse if it's over the canvas, else the middle of the view. */
let fn: () => { x: number; y: number } = () => ({ x: 0, y: 0 });
export const setSpawn = (f: typeof fn) => { fn = f; };
export const spawnPoint = () => fn();
