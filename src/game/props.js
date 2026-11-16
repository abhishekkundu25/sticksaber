// Things in the room that can be broken. A prop is a fighter with no brain that never moves: it is
// hit, shows a health bar and breaks like one, and the renderer draws it as an object instead of a body.
//   core    a signal core. While any stands, the floor keeps sending reinforcements.
//   cache   a supply cache. Break it for shards.
//   cell    a holding cell with another climber inside. Break it and they fight for you.
import { ENEMIES } from './enemies.js';

const base = { ...ENEMIES.dummy, ctrl: null, rooted: true, noRagdoll: true, armor: 2, posture: 99999, postureRegen: 0, runSpeed: 0, blade: { len: 1, gun: true }, ribbons: [], deco: undefined, scale: 1 };
export const PROPS = {
  core: { ...base, kind: 'core', thing: 'core', name: 'Signal Core', team: 1, hp: 90, scales: true, color: '#ff5c8a', outline: '#ffd0dc' },
  cache: { ...base, kind: 'cache', thing: 'cache', name: 'Supply Cache', team: 2, hp: 70, scales: true, color: '#ffd36b', outline: '#fff0c0' },
  cell: { ...base, kind: 'cell', thing: 'cell', name: 'Holding Cell', team: 2, hp: 60, scales: true, color: '#b9f6ff', outline: '#ffffff' },
};
