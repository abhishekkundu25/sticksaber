// Weapon forms: the blade the player commits to for a run. Each has its own blade and may name its
// own move for any of the player's slots. Placeholder list until the other forms land.
export const FORMS = {
  saber: { id: 'saber', name: 'SABER', text: 'The balanced blade', blade: { len: 74 }, dmg: 1, speed: 1, moves: {} },
};
export const FORM_IDS = Object.keys(FORMS);
