// Bonds: relationships between enemies that the player can read and break. A bond is made when a
// group spawns together and lasts until one side falls. Each kind changes which enemy to kill first:
//   rider     a humanoid sits on a beast. Launch or knock the rider to unseat it, or kill the mount
//             under it. A mount that loses its rider goes feral.
//   pack      a leader emboldens its pack. Kill the leader and the pack's nerve breaks.
//   ward      a warder halves and halves again the damage its charge takes. Kill the warder first.
//   mend      a mender feeds its partner health through a green thread. Kill the mender first.
//   avenger   two fighters are sworn to each other. When one dies the other enrages.
//   cover     a shield carrier stands between the player and the shooter it guards.
//   combo     one fighter waits for its partner's attack and strikes as it ends.
//   twins     two bodies share one pool of health, and only one of them can be hurt at a time.
import { makeStance } from './moves.js';

export const BONDS = {
  rider: { name: 'RIDER', color: null, hint: (a, b) => `${a} rides ${b}. Launch or knock the rider out of the saddle, or kill the mount under it` },
  pack: { name: 'PACK', color: '#ffd36b', hint: (a, b) => `${b} hunt as a pack behind ${a}. Kill the leader and their nerve breaks` },
  ward: { name: 'WARD', color: '#9fd0ff', hint: (a, b) => `${a} wards ${b}: while the link holds it takes a third of the damage. Kill the warder first` },
  mend: { name: 'MENDER', color: '#7dffb0', hint: (a, b) => `${a} mends ${b}: its wounds close while the green thread holds. Kill the mender first` },
  avenger: { name: 'SWORN', color: '#ff8a30', hint: (a, b) => `${a} and ${b} are sworn to each other. When one falls the other enrages, so finish them close together` },
  cover: { name: 'COVER', color: null, hint: (a, b) => `${a} covers ${b}. Get past the shield, or throw something over it` },
  combo: { name: 'TANDEM', color: null, hint: (a, b) => `${a} and ${b} attack in tandem: the second strikes as the first one ends. Parry twice` },
  twins: { name: 'TWINS', color: '#e6fdff', hint: () => 'They share one life, and only the lit one can be hurt. Watch for the swap' },
};
const SEAT = makeStance({ py: 24, lean: 0.06, f1x: 15, f1y: -12, f2x: -12, f2y: -12 });

// Make a bond between fighters that have just spawned. `m` is the list of members: for a pack the
// leader comes first; for every other kind `m[0]` is the first role named in the comment above.
export function bind(world, type, m, o = {}) {
  const [a, b] = m, bond = { type, a, b, m, line: !!BONDS[type].color, color: BONDS[type].color, t: 0, on: true, ...o };
  if (type === 'rider') {
    a.riding = b; b.rider = a; a.seat = a.stance; a.stance = SEAT; a.tag = 'RIDER';
  } else if (type === 'pack') {
    a.alpha = true; a.tag = 'ALPHA';
    for (let i = 1; i < m.length; i++) { m[i].rate *= 1.12; m[i].packOf = a; }
  } else if (type === 'ward') { b.ward = a; a.tag = 'WARDER'; }
  else if (type === 'mend') a.tag = 'MENDER';
  else if (type === 'cover') { a.ai.guardOf = b; }
  else if (type === 'twins') {
    // One pool: both bodies show it, and `lit` is the one that can be hurt.
    bond.pool = a.hp + b.hp; bond.max = bond.pool; bond.lit = a; bond.swap = 7;
    a.twin2 = b; b.twin2 = a; a.maxHp = b.maxHp = bond.max; a.hp = b.hp = bond.pool; b.dim = true; a.dim = false; b.dmgMul = 0.6;
    a.bondRef = b.bondRef = bond;
  }
  world.bonds.push(bond);
  return bond;
}

export function enrage(world, f, word = 'ENRAGED') {
  if (f.dead || f.enraged) return;
  f.enraged = true; f.rate *= 1.22; f.dmgMul *= 1.25; f.hp = Math.min(f.maxHp, f.hp + f.maxHp * 0.25); f.barT = 4; f.tag = word;
  if (f.ai.cdMul) f.ai.cdMul *= 0.75;
  world.fx.text(f.x, f.j[1] - 50 * f.scale, word, '#ff8a30', 20, 1.2);
  world.fx.ring(f.cx, f.cy, 16, 150, 0.4, '#ff8a30', 1, 5); world.fx.spark(f.cx, f.cy, 0, 3.14, 16, 520, '#ff8a30');
  world.sfx('enrage', f.x);
}

// Throw a rider out of the saddle. `hard` when the mount went down under it.
export function unseat(world, r, hard) {
  const mt = r.riding;
  if (!mt) return;
  r.riding = null; mt.rider = null; r.stance = r.seat || r.stance; r.tag = null;
  if (r.dead || r.rag) return;
  r.onGround = false; r.vy = -360; r.vx = (r.x >= world.player.x ? 1 : -1) * 220;
  if (hard) { r.setState('hitstun', 0.6); world.sfx('dismount', r.x); world.fx.text(r.x, r.j[1] - 40, 'UNSEATED', '#ffd36b', 16, 0.9); }
}

export function tickBonds(world, dt) {
  const L = world.bonds;
  for (let i = L.length - 1; i >= 0; i--) {
    const B = L[i], { a, b } = B;
    B.t += dt;
    let done = false;
    switch (B.type) {
      case 'rider':
        if (!a.riding) { done = true; if (a.dead && !b.dead) enrage(world, b, 'FERAL'); }
        else if (b.dead || b.rag || b.state === 'stagger' || b.remove) { unseat(world, a, true); done = true; }
        else if (a.dead || a.rag) { unseat(world, a, false); done = true; if (a.dead && !b.dead) enrage(world, b, 'FERAL'); }
        break;
      case 'pack': {
        if (a.dead || a.remove) {
          done = true;
          let any = false;
          for (let k = 1; k < B.m.length; k++) {
            const f = B.m[k];
            if (f.dead || f.remove) continue;
            any = true; f.rate /= 1.12; f.packOf = null; f.temper = 'cautious';
            if (f.ai.cdMul) { f.ai.cdMul *= 1.8; f.ai.rangeAdd = (f.ai.rangeAdd || 0) + 60; f.ai.cd = Math.max(f.ai.cd || 0, 1.6); }
            if (!f.rag && f.onGround && f.state !== 'custom') { f.setState('hitstun', 0.55); f.vx = (f.x >= world.player.x ? 1 : -1) * 320; }
            world.fx.text(f.x, f.j[1] - 40 * f.scale, 'NERVE BROKEN', '#8fa3b8', 13, 1);
          }
          if (any) world.sfx('nerveBreak', a.x);
        } else if (B.m.every((f, k) => k === 0 || f.dead || f.remove)) done = true;
        break;
      }
      case 'ward':
        if (b.dead || b.remove) { done = true; a.tag = null; }
        else if (a.dead || a.remove) {
          done = true; b.ward = null;
          world.fx.text(b.x, b.j[1] - 46 * b.scale, 'WARD BROKEN', '#9fd0ff', 16, 1); world.fx.ring(b.cx, b.cy, 90, 12, 0.35, '#9fd0ff', 1, 4);
          world.sfx('tetherSnap', b.x);
          if (!b.rag && b.state !== 'custom') { b.setState('recoil', 0.7); b.posture += b.maxPosture * 0.3; }
        }
        break;
      case 'mend':
        if (a.dead || b.dead || a.remove || b.remove) { done = true; if (!a.dead) a.tag = null; else if (!b.dead) world.sfx('tetherSnap', b.x, 0.7); }
        else {
          // The thread only shows, and only heals, while there is something to mend and the two are in reach.
          B.line = b.hp < b.maxHp && Math.abs(a.x - b.x) < 760 && !a.rag;
          if (B.line) { b.hp = Math.min(b.maxHp, b.hp + b.maxHp * 0.045 * dt); b.barT = Math.max(b.barT, 0.4); }
        }
        break;
      case 'avenger':
        if (a.dead && b.dead) done = true;
        else if (a.dead || a.remove) { done = true; world.sfx('tetherSnap', b.x, 0.7); enrage(world, b); }
        else if (b.dead || b.remove) { done = true; world.sfx('tetherSnap', a.x, 0.7); enrage(world, a); }
        break;
      case 'cover':
        if (a.dead || b.dead || a.remove || b.remove) { done = true; a.ai.guardOf = null; }
        break;
      case 'combo':
        if (a.dead || b.dead || a.remove || b.remove) done = true;
        else if (a.atkSerial !== B.seen && a.state === 'attack') {
          // The partner is cleared to strike as this attack ends.
          B.seen = a.atkSerial;
          if (b.ai.cd !== undefined && b.state === 'free') b.ai.cd = Math.min(b.ai.cd, a.move.dur * 0.6);
        }
        break;
      case 'twins': {
        // Damage dealt to either body has already been taken from the pool by combat.
        if (B.pool <= 0) { done = true; break; }
        a.hp = b.hp = B.pool;
        if (!a.dead && a.state !== 'custom') a.fade = a.dim ? 0.5 : 1;
        if (!b.dead && b.state !== 'custom') b.fade = b.dim ? 0.5 : 1;
        if ((B.swap -= dt) <= 0 && !a.rag && !b.rag) {
          B.swap = 6 + (B.pool / B.max) * 3;
          B.lit = B.lit === a ? b : a; a.dim = B.lit !== a; b.dim = B.lit !== b;
          // The unlit twin still cuts, but with less behind it.
          a.dmgMul = a.dim ? 0.6 : 1; b.dmgMul = b.dim ? 0.6 : 1;
          world.fx.ring(B.lit.cx, B.lit.cy, 120, 14, 0.4, B.lit.color, 1, 5); world.fx.zap(a.cx, a.cy, b.cx, b.cy, '#e6fdff', 0.3);
          world.fx.text(B.lit.x, B.lit.j[1] - 60 * B.lit.scale, 'EXPOSED', B.lit.color, 16, 1);
          world.sfx('twinSwap', B.lit.x);
        }
        break;
      }
    }
    if (done) L.splice(i, 1);
  }
}
