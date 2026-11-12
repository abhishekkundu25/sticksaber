# STICKSABER design notes

This document records how the game works and why. Sections marked "proposed" are not built.

## Premise

You are Initiate Zero, climbing the Spire. Each floor is one arena and ends when its waves are cleared. Floor V is held by the Forgemaster and floor X by the Proctor, who tests whether you can stop repeating yourself.

The premise exists to justify one mechanic: stronger enemies learn your habits. That mechanic is the game's answer to "repeating one attack should become less effective".

## Combat rules

### Feel

| Element | How it works |
| --- | --- |
| Hit stop | A hit freezes the simulation for 30 to 160 ms, scaled by the move. The struck body shakes during the freeze. |
| Camera | Shake is trauma-based and capped at 10 px. Heavy hits add a zoom kick of at most 3.5%. There is no rotation. |
| Slow motion | A parry, a perfect dodge, the last kill of a wave and a boss kill slow time. Black bars slide in while time is slowed. |
| Blade hits | The hit test sweeps the blade that is drawn, so a swing that visibly passes through a body connects. |
| Input | Presses are buffered for 140 ms, jumps have 90 ms of coyote time, and most recoveries cancel into a dash, a jump (on hit) or the next attack. |
| Assist | With no direction held, an attack turns toward the nearest enemy within 340 units. A step forward stops short of the target instead of pushing through it. |

### Ragdolls

Every fighter has 11 joints. The animated pose and the ragdoll use the same joints, so a fighter can drop into physics from any pose and blend back joint by joint when it stands up.

- Launchers, knockdowns and kills hand the body to the ragdoll. Hitting a ragdoll sets its velocity, so juggles stay predictable while limbs flail.
- Each juggle hit raises gravity on the target by 9%, which ends infinite combos without a hard counter.
- A spike bounces the body off the floor. A hard throw into the arena wall bounces it back.
- A killing blow cuts the bone nearest the blade. The cut ends glow and cool.
- Corpses stay physical for two seconds and can be batted around.

### Defence and recovery

| Tool | Rule |
| --- | --- |
| Guard | Holding guard blocks frontal attacks at no health cost. Each block fills the posture bar. A full bar breaks your guard for one second. |
| Parry | Guard pressed up to 200 ms before impact parries. The attacker recoils and takes posture damage. Mashing guard halves the window. |
| Riposte | An attack within 0.85 s of a parry becomes an invulnerable pass-through cut for 45 damage. |
| Dash | 150 ms of invulnerability, usable once in the air. Dashing through an attack at the last moment slows every enemy to 22% speed for about a second. |
| Rally | 60% of damage taken stays recoverable for 3.2 s. Each hit you land returns half its damage from that pool. |
| Tech | Dash as your body reaches the floor to stand up at once. |
| Mercy | Enemies do not start an attack on a player who is down or standing up. You are invulnerable for 0.7 s after standing. |
| Retry | Death restarts the current wave with full health. |

### Variety

Two systems push the player to mix moves.

1. Staleness applies to every enemy. The game keeps your last ten landed moves. A move absent from that list deals 112% damage. A move that appears twice deals 80%, three times or more 60%. Fresh moves also fill the style rank and the focus meter faster.
2. Adaptation applies to Duelists and the Proctor. Each landed or blocked hit raises a counter for its move family (light strings, heavy strikes, launchers, air combos, plunges, throws). Hits from other families lower it. When a counter passes the enemy's threshold, ADAPTED appears and the HUD names the family. From then on the enemy turns that family aside and counters, or takes 40% damage from it if it is mid-attack. Landing hits from other families clears the read.

A scripted player that only uses the light string climbs to floor X, then dies to the Proctor about 90 times in 40 minutes of game time without winning. A scripted player that mixes its combos and parries most attacks finishes the whole tower.

### Telegraphs

| Signal | Meaning |
| --- | --- |
| White flash on the weapon, high chime | The attack can be blocked or parried. |
| Red flash with a ring, low dissonant tone | Unblockable. Dash through it or jump. |
| Red line on the floor | The path of a charge or lunge. |
| Red sight line | A Marksman or Drone is aiming. The aim locks before the shot. |
| Red ellipse on the floor | Where a boss will land, or the blast radius of a charge. A blast ring fills in as its fuse burns. |
| Red strip on the floor | A flame pillar is about to erupt there. |
| Two blink sounds and a closing ring | A Wraith has reappeared. The second sound is higher. |

A test asserts that every enemy attack fires a telegraph before its first hit.

## Roster

Each type has one silhouette, one rhythm and one clear answer.

| Enemy | From floor | Silhouette | Behaviour | Answer |
| --- | --- | --- | --- | --- |
| Initiate | I | Hooded, red blade | Slash, two-hit string, leaping overhead. Later: a feint and a lunge. | Anything. Teaches spacing and the parry. |
| Marksman | II | Antenna, rifle, green bolts | Keeps 400 to 600 units away, kicks you off if you close in. Later: a lobbed charge and a three-round burst. | Parry or cut the bolt back at it. |
| Bulwark | III | Broad, flat helm, orange shield arc | Frontal shield stops light attacks. Bash, overhead. Later: a shield charge. | Heavies, a charged heavy, or dash behind it. |
| Duelist | IV | Tall, crested, magenta double-ended staff | Flurry, retreat, block, reads repeated moves. Later: a dive and a thrown staff that leaves it unarmed. | Parry the flurry. Vary your strings. |
| Brute | IV | 1.5x size, horns, wide crimson cleaver | Never flinches. Swing, unblockable smash, wall charge. Later: a leap slam and a low sweep. | Parry the swing, punish recoveries, bait the charge into a wall. |
| Lancer | VI | Conical hat, long blue pike | Out-reaches you and skewers jump-ins. Helpless once you are inside the point. | Parry or sidestep a thrust, then dash in along the floor. |
| Wraith | VII | Swept-back cowl, violet blade, tattered cloak | Vanishes, reappears beside or behind you, strikes, lingers half a second, vanishes again. | Listen for the second blink, turn and parry. Hit it while it lingers. |
| Drone | VIII | Small yellow flying hull | Hovers out of reach, dives or shoots. | Jump attacks, the launcher, or parry the dive. Any hit drops it. |

### Variation

- Extra attacks unlock by floor, so an Initiate on floor VIII is not the Initiate from floor I.
- Each spawn rolls a temperament. Aggressive enemies attack 40% more often and guard less. Cautious ones hold 40 units further back and guard more. Flankers vault over you while they wait their turn.
- From floor VIII a spawn can be an elite with 35% more health and one modifier: swift (25% faster), armored (no flinch during wind-ups) or volatile (bursts 0.8 s after death).

## Bosses

### The Forgemaster (floor V)

1,000 health. It never flinches and cannot be launched. Ordinary hits fill its posture at 40% of the usual rate.

- Its hammer heats through each three-hit string: orange, then yellow, then white. The first two swings can be parried. The white-hot third cannot, and it sends a shockwave along the floor.
- After the third swing or a ground quake the hammer vents steam for 1.7 seconds. Hits during the vent deal 25% more damage and 80% more posture damage.
- It throws three molten charges that land with a blast ring.
- At 50% health the fight changes: it erupts flame pillars in a line along the floor, each marked by a red strip 0.75 seconds or more before it fires, and pauses less between attacks.

The lesson is to read the weapon. The hammer's colour tells you what is coming before any flash does.

### The Proctor (floor X)

900 health. It never flinches and cannot be launched.

- Phase one. A three-hit string whose last hit is delayed to catch early parries. An unblockable lunge with a floor line and a long recovery. A crescent wave you can jump or parry. It blocks, and counters after two blocks.
- At 60% its blade becomes a double-ended staff and its pauses halve. It gains a five-hit spinning advance and a leap off screen that lands on a tracking marker.
- At 45% and 20% it dashes to the far wall and kneels to heal 20% over 4.4 seconds. Any hit interrupts the heal and breaks its posture for 2.6 seconds. A thrown saber reaches it from anywhere.
- Below 25% it leaves an afterimage behind when it attacks. The afterimage repeats the same strike 0.55 seconds later, cannot be hit, and deals 60% damage.
- It adapts at five hits of one family.

### More boss mechanics (proposed)

| Examiner | Mechanic | What observation buys you |
| --- | --- | --- |
| The Archivist | Records your last combo and replays it at you as a ghost four seconds later. | Short, safe strings give it less to use. |
| The Twins | Share one health bar. Only the one whose blade is lit can be hurt, and they swap on a visible cue. | Tracking the cue instead of the nearest target. |
| The Cartographer | Changes the arena. Floor panels light before they drop or electrify. | Reading the floor while fighting. |
| The Mirror | Uses your moveset, including the parry. | Feints, heavies and throws, because it parries anything predictable. |

## Structure and generation

A run is ten floors generated from one 32-bit seed. The same seed always produces the same run, and the simulation's random numbers come from the same seed, so a headless replay is exact.

| Floor | Arena family | Waves | Fixed teaching waves | Generated waves |
| --- | --- | --- | --- | --- |
| I | Causeway | 3 | 2 | 1 |
| II, III | Causeway variants | 3 | 1 | 2 |
| IV | Foundry | 3 | 2 | 1 |
| V | Foundry variant | 1 | Forgemaster | |
| VI | Foundry variant | 3 | 1 | 2 |
| VII, VIII | Hall variants | 3 | 1 | 2 |
| IX | Hall variant | 4 | 0 | 4 |
| X | Examination Hall | 1 | Proctor | |

### How a wave is generated

- Each wave has a threat budget of `2.2 + 0.85 × floor + 0.9 × wave index`.
- Each enemy has a cost: Initiate 1, Drone 1.3, Marksman 1.6, Bulwark and Lancer 2.6, Wraith 2.8, Duelist 3.6, Brute 5. An elite costs 1 more.
- The generator draws enemies unlocked on that floor until the budget or the cap of five is reached. Newer types are slightly more likely.
- Rules: at most one Brute, two ranged enemies, two each of Duelist, Wraith, Bulwark and Lancer, and at least two enemies in any wave.
- The heaviest enemy arrives first. The rest follow 0.7 to 1.5 seconds apart on alternating sides.
- Two enemies may attack at once, three on floor IX. Only one may in the very first wave.

A test generates 300 runs and checks every wave against these rules.

### What else varies per run

- Arena variants. Floors I, IV and X use the canonical look of their arena. Every other floor is a seeded variant with a different skyline layout, palette shift, weather and set piece.
- Temperaments and elite modifiers, described above.
- Enemy damage rises 5% per floor.

### Progression (proposed)

The game still has no unlock system. If it gets one, I recommend unlocking techniques, not raising stats. Larger numbers would blur the combat feel. Each cleared floor could offer a choice of two techniques, such as a second air dash, a parry that reflects melee damage, or a saber throw that pins an enemy to a wall.

## Art direction

The style is ink and neon. Fighters are near-black silhouettes with a thin coloured outline. Blades, sparks and impacts are the only bright things on screen. Each arena uses one dominant hue and one accent, and keeps the band behind the fighters calm so silhouettes read at a glance.

| Arena family | Palette | Mood |
| --- | --- | --- |
| Causeway | Teal and indigo, magenta accent | Rain, a megacity below, a wet deck |
| Foundry | Charcoal and umber, amber glow | Crucibles, chains, drifting embers |
| Hall | Violet and black, pale gold | An eclipse through a circular window, pillars, polished floor |

Colour also carries meaning. Cyan is the player. Each enemy type owns one blade colour. Pure white and pure red are reserved for telegraphs. Green means healing. Gold, blue and orange rings mark elites.

## Rendering and performance

- Each arena is painted once at load into a few offscreen canvases. Static light, shadow, fog and floor reflections are baked into them. One arena is held in memory at a time and released when the floor changes.
- Dynamic light comes from one half-resolution additive layer that holds blades, trails, sparks and telegraphs. The renderer downsamples it three times, sums the three bloom levels at quarter resolution, folds the sum back into the layer, and blends the result onto the screen once.
- That blend, and the floor reflection, cover only the screen rectangle that contains light this frame.
- Blade cores are redrawn at full resolution on top so edges stay sharp.
- Internal resolution is capped at 1080p. If the smoothed frame time passes 21 ms the renderer first drops the backdrop to half resolution, then lowers the whole canvas in steps down to 55%. It steps back up when frames are fast. G pins quality to high or low.
- The simulation sub-steps so no step exceeds 1/120 s at any refresh rate.
- Sparks are recycled from a pool, and the per-frame paths create no gradients.

Measured in headless Chrome on an Apple-silicon laptop, in the same crowded fight (nine fighters) before and after the performance work:

| Setup | Before | After |
| --- | --- | --- |
| GPU off, 1280x720 | 21.9 ms per frame | 8.6 ms |
| GPU off, 1920x1080 | 50.5 ms | 19.4 ms |
| GPU on, 1280x720 | 0.67 ms | 0.62 ms |
| GPU on, 1920x1080 | 0.88 ms | 0.69 ms |

With the GPU off the game is about 2.5 times faster. With a working GPU it was already at 5% of the frame budget and barely changed. A little over half of the saving came from the arenas (merged layers and a baked floor reflection) and the rest from the glow compositing.

The half-resolution backdrop tier cuts the pixels drawn per frame by 41% (3.83 to 2.25 megapixels at 720p) but saves little time in software raster, where it measured within noise of full resolution. It is kept as the first step down because it should matter on GPUs that are limited by fill rate. That has not been measured on such a machine.

## Tests

`npm test` runs in about six seconds.

- Simulation tests (Node, under a second): the same seed replays a fight exactly, different seeds differ, 300 generated runs obey the wave rules, threat rises with the floor, move data is well formed and every enemy attack telegraphs, the whole roster fights without errors, floor I can be cleared, and both bosses can be beaten.
- Benchmark: simulation cost per step, then rendering in headless Chrome with the GPU off. It asserts milliseconds per frame against a loose budget, and draw calls and megapixels per frame against tight ones, because those two do not depend on the machine.

`npm run fuzz` is the slow soak. It drives random input through every floor and sends scripted players of four skill levels up the whole tower.

## Sound

Every sound is synthesized with the Web Audio API. A saber hum rises from 88 Hz to 115 Hz with swing speed. The parryable telegraph is a bright glint centred near 4.5 kHz and the unblockable one is a low buzz near 0.5 kHz, so the two are distinct by ear. Music is generative and its intensity follows the number of enemies and your style rank. Slow motion sweeps a low-pass filter over the mix. Nobody has listened to any of it yet. The balance was set from measurements, so expect to retune it by ear.

## Open questions

1. Difficulty. Scripted players say floors I to IV are forgiving and the two bosses are the walls. Is that the curve you want once you have played it?
2. Run length. A scripted player takes about ten minutes for the ten floors. A person will take longer. Is that the right length for one sitting?
3. Tone of kills. Bodies are cut apart with glowing ends. Keep it, or hold dismemberment back for finishers only?
4. Progression. Should the next step be the technique unlocks described above, or more floors and examiners?
