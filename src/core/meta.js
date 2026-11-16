// What carries over between runs: a record of everything met and beaten, kept in the browser.
// The simulation knows nothing of it. The shell passes it the director's events (`note`), and the
// codex screen reads `data`.
const KEY = 'sticksaber.meta';
const blank = () => ({ v: 1, kills: {}, bosses: {}, surprises: {}, feats: {}, objectives: {}, forms: {}, runs: 0, wins: 0, best: {}, floors: 0, shades: 0 });

export class Meta {
  constructor() {
    this.data = blank();
    try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && s.v === 1) this.data = { ...blank(), ...s }; } catch { /* no storage: nothing is kept */ }
    this.dirty = false;
  }
  save() { if (!this.dirty) return; this.dirty = false; try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch { /* play on */ } }
  // Ids of the boons earned so far (see src/game/boons.js). None until feats exist to earn them.
  boons() { return []; }
  bump(table, key, n = 1) { if (!key) return; this.data[table][key] = (this.data[table][key] || 0) + n; this.dirty = true; }
  // `e` is a world or director event. Kills are filed under what the thing is underneath: the base
  // type of a strain, the body plan of an animal.
  note(e, world, dir) {
    const D = this.data;
    if (e.type === 'kill') {
      if (e.boss) this.bump('bosses', e.kind === 'shade' ? 'shade' : world.def(e.kind)?.champion ? 'champion' : world.def(e.kind)?.warden ? `warden:${world.def(e.kind).base}` : e.kind.replace(/[AB]$/, ''));
      else this.bump('kills', e.beast || e.base || e.kind);
      if (e.kind === 'shade') { D.shades++; }
    } else if (e.type === 'surprise') this.bump('surprises', e.kind);
    else if (e.type === 'feat') this.bump('feats', e.kind);
    else if (e.type === 'floor') { D.floors++; this.dirty = true; if (e.objective) this.bump('objectives', e.objective); this.bump('forms', world.formId); this.save(); }
    else if (e.type === 'run') {
      D.runs++; if (e.won) D.wins++;
      const k = `${e.mode}:${e.diff}`;
      if (!D.best[k] || e.score > D.best[k].score) D.best[k] = { score: e.score, floor: e.floor, won: e.won };
      this.dirty = true; this.save();
    }
  }
}
