// Boons: a head start chosen before the first floor. They are earned between runs (the shell keeps
// the list of unlocked ones and hands it to the director) and each is spent as ordinary build, so a
// saved run needs nothing extra to remember one.
import { POWER_IDS } from './powers.js';
import { FORM_IDS } from './forms.js';

const add = (dir, id, n = 1) => { dir.build[id] = (dir.build[id] || 0) + n; };
export const BOONS = {
  hardened: { name: 'Hardened', color: '#7dffb0', glyph: 'plus', text: 'Begin with two levels of Vigor: 24 more maximum health', apply: (w, d) => add(d, 'vigor', 2) },
  honed: { name: 'Honed', color: '#ff6b5c', glyph: 'slash', text: 'Begin with two levels of Keen Edge: all damage +12%', apply: (w, d) => add(d, 'edge', 2) },
  fleet: { name: 'Light Feet', color: '#ffe45c', glyph: 'chev', text: 'Begin with two levels of Fleet: faster on your feet, quicker to dash again', apply: (w, d) => add(d, 'stride', 2) },
  breath: { name: 'Deep Breath', color: '#4fb8ff', glyph: 'bars', text: 'Begin with a fourth Focus pip', apply: (w, d) => add(d, 'well', 1) },
  purse: { name: 'Full Purse', color: '#ffd36b', glyph: 'orb', text: 'Begin with 90 shards', apply: (w) => { w.shards += 90; } },
  gift: { name: 'A Second Power', color: '#56e9ff', glyph: 'star', text: 'Begin with one more Focus power, chosen by the tower',
    apply: (w, d, r) => { const left = POWER_IDS.filter((id) => !w.powers.includes(id)); if (left.length) w.powers.push(left[(r() * left.length) | 0]); } },
  phoenix: { name: 'Unfinished', color: '#ffe08a', glyph: 'wing', text: 'Begin with Second Wind: once per floor a killing blow leaves you standing', apply: (w, d) => add(d, 'wind', 1) },
  twoblades: { name: 'Two Blades', color: '#9fe8ff', glyph: 'twin', text: 'Begin with a Second Sheath and a second weapon already in it',
    apply: (w, d, r) => { add(d, 'sheath', 1); const left = FORM_IDS.filter((id) => id !== w.formId); if (left.length) w.form2 = left[(r() * left.length) | 0]; } },
};
export const BOON_IDS = Object.keys(BOONS);
