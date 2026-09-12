export function createRng(seed) {
  let state = 0;
  const text = String(seed ?? '');
  for (let i = 0; i < text.length; i++) state = (Math.imul(state, 31) + text.charCodeAt(i)) >>> 0;
  state = (state + 2166136261) >>> 0;
  const next = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  return {
    next,
    pick: array => (array.length ? array[Math.floor(next() * array.length)] : undefined),
    range: (min, max) => min + next() * (max - min)
  };
}
