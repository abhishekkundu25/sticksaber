# STICKSABER design proposal

The brief left the roster, level count, progression, art direction and supporting mechanics open. This document records what the prototype decided, why, and what I propose for the full game. Sections marked "proposed" are not built yet.

## Premise

You are Initiate Zero, climbing the Spire. Each floor is one arena and ends when its waves are cleared. Every third floor is guarded by an examiner, a boss that tests one skill. The top examiner, the Proctor, tests whether you can stop repeating yourself.

The premise exists to justify one mechanic: stronger enemies learn your habits. That mechanic is the game's answer to "repeating one attack should become less effective".

## Combat rules

These are built and playable.

### Feel

| Element | How it works |
| --- | --- |
| Hit stop | A hit freezes the simulation for 30 to 160 ms, scaled by the move. The struck body shakes during the freeze. |
| Camera | Shake is trauma-based and capped at 10 px. Heavy hits add a zoom kick of at most 3.5%. There is no rotation. |
| Slow motion | A parry, a perfect dodge, the last kill of a wave and the boss kill slow time. Black bars slide in while time is slowed. |
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
2. Adaptation applies to Duelists and bosses. Each landed or blocked hit raises a counter for its move family (light strings, heavy strikes, launchers, air combos, plunges, throws). Hits from other families lower it. When a counter passes the enemy's threshold, ADAPTED appears and the HUD names the family. From then on the enemy turns that family aside and counters, or takes 40% damage from it if it is mid-attack. Landing hits from other families clears the read.

A scripted player that only uses the light string clears floors one and two, then dies about 40 times to the Proctor without winning. A scripted player that mixes its combos and parries most attacks beats the Proctor in about a minute.

### Telegraphs

| Signal | Meaning |
| --- | --- |
| White flash on the weapon, high chime | The attack can be blocked or parried. |
| Red flash with a ring, low dissonant tone | Unblockable. Dash through it or jump. |
| Red line on the floor | The path of a charge or lunge. |
| Red sight line | A Marksman is aiming. The aim locks 100 ms before the shot. |
| Red ellipse on the floor | Where the boss will land. It stops tracking 0.4 s before impact. |

The shortest enemy wind-up is 0.22 s (the Duelist's flurry, after a visible dash). Most are 0.45 s or longer.

## Roster

Built. Each type has one silhouette, one rhythm and one clear answer.

| Enemy | Silhouette | Behaviour | Answer |
| --- | --- | --- | --- |
| Initiate | Hooded, red blade | Slow slash, two-hit string, leaping overhead. Guards sometimes. | Anything. Teaches spacing and the parry. |
| Bulwark | Broad, flat helm, orange shield arc | Frontal shield stops light attacks. Shield bash, overhead. Takes 0.55 s to turn around. | Heavies, a charged heavy, or dash behind it. |
| Duelist | Tall, thin, crested, magenta double-ended staff | Darts in for a three-hit flurry, retreats, blocks, reads repeated moves. Unblockable spin. | Parry the flurry. Vary your strings. |
| Marksman | Antenna, rifle, green bolts | Keeps 400 to 600 units away. Kicks you off if you close in. | Parry or cut the bolt back at it. |
| Brute | 1.5x size, horns, wide crimson cleaver | Never flinches. Parryable swing, unblockable smash with shockwaves, a charge. | Parry the swing, punish the smash recovery, or dodge the charge so it hits a wall and stuns itself. |

Proposed additions for later floors, each one built to demand a tool the current roster does not:

| Enemy | Idea | Demands |
| --- | --- | --- |
| Lancer | Long pike, attacks from outside your reach and anti-airs jumps | Dashing in after a whiff |
| Wraith | Blinks behind you and strikes after a visible shimmer | Turning to parry, awareness behind you |
| Warden pair | Two fighters linked by a beam that hurts to cross | Positioning, splitting them with a throw |
| Drone | Flying, weak, harasses from above | Air combos and the plunge |
| Adept | An Initiate that parries your third consecutive light | A gentle first lesson in variety before the Duelist |

## Bosses

### The Proctor (built)

900 health, never flinches, cannot be launched.

- Phase one. A three-hit string whose last hit is delayed to catch early parries. An unblockable lunge across the room with a floor line and a long recovery. A crescent wave you can jump or parry. It blocks, and counters after two blocks.
- At 60% it shifts phase. It knocks you back, its blade becomes a double-ended staff, and its pauses between attacks halve. It gains a five-hit spinning advance and a leap off screen that lands on a tracking marker.
- At 45% and 20% it dashes to the far wall and kneels to heal 20% over 4.4 seconds, sending shockwaves along the floor. Any hit interrupts the heal and breaks its posture for 2.6 seconds. A thrown saber reaches it from anywhere, so holding one pip of focus in reserve is the observant play.
- It adapts at five hits of one family.

### Boss mechanics I propose for the other examiners

Each examiner should test one skill and reward watching it.

| Examiner | Mechanic | What observation buys you |
| --- | --- | --- |
| The Archivist | Records your last combo and replays it at you as a ghost four seconds later. | Short, safe strings give it less to use. Parrying your own ghost fills focus. |
| The Twins | Share one health bar. Only the one whose blade is lit can be hurt, and they swap on a visible cue. | Tracking the cue instead of the nearest target. |
| The Forgemaster | Overheats. Its blade whitens through each string, and the final swing vents heat. | Hits during the vent deal double posture damage. Attacking earlier burns you. |
| The Cartographer | Changes the arena. Floor panels light before they drop or electrify. | Reading the floor while fighting. |
| The Mirror | Uses your moveset, including the parry. | Feints, heavies and throws, because it parries anything predictable. |

Interruptible actions work beyond healing. An examiner could summon reinforcements, charge an arena-wide attack, or repair its shield, each with a visible channel that a hit cancels.

## Structure and progression

The prototype has three floors: two with three waves each, then the Proctor. It takes a scripted player two to three minutes.

Proposed full game: 12 floors in four acts of three. Each act has its own arena family and ends with an examiner.

| Act | Floors | Arena family | New enemies | Examiner |
| --- | --- | --- | --- | --- |
| I | 1 to 3 | Causeway, exterior, rain | Initiate, Marksman, Bulwark | The Archivist |
| II | 4 to 6 | Foundry, heat | Duelist, Brute, Adept | The Forgemaster |
| III | 7 to 9 | Archive, cold light, glass | Lancer, Wraith, Drone | The Twins |
| IV | 10 to 12 | Sanctum | Warden pair, mixed elites | The Proctor |

### Progression system (proposed)

I recommend unlocking techniques, not raising stats. Larger numbers would blur the combat feel that the prototype exists to judge.

- Each cleared floor offers a choice of two techniques. Examples: a second air dash, a parry that reflects melee damage, a saber throw that pins an enemy to a wall, a charged launcher, a dash that leaves a damaging afterimage.
- Blade crystals change one rule each. A red crystal converts rally into damage. A white crystal widens the parry window and removes guard. Each also changes the blade colour.
- The style rank earned on a floor pays out as focus at the start of the next, so playing with variety has a reward that carries forward.
- Three difficulty settings change enemy aggression and the parry window. They do not change health.

Two alternatives I considered and rejected for now. A roguelike run structure adds replay value but hides whether the base combat is good. A skill tree with stat nodes is quick to build but leads to the stat inflation described above. Either could return later.

## Art direction

The style is ink and neon. Fighters are near-black silhouettes with a thin coloured outline. Blades, sparks and impacts are the only bright things on screen. Each arena uses one dominant hue and one accent, and keeps the band behind the fighters calm so silhouettes read at a glance.

| Arena | Palette | Mood |
| --- | --- | --- |
| Spire Causeway | Teal and indigo, magenta accent | Rain, a megacity below, a wet deck |
| Foundry Nine | Charcoal and umber, amber glow | Crucibles, chains, drifting embers |
| Examination Hall | Violet and black, pale gold | An eclipse through a circular window, pillars, polished floor |

Colour also carries meaning. Cyan is the player. Each enemy type owns one blade colour. Pure white and pure red are reserved for telegraphs. Green means healing.

## Rendering and performance

- Each arena is painted once at load into a few offscreen canvases: sky, far structures, play plane, foreground. Static light, shadow, fog and floor reflections are baked into them. A frame draws them as parallax layers plus about a hundred small animated marks for rain, embers or dust.
- Dynamic light comes from one half-resolution additive layer that holds blades, trails, sparks and telegraphs. The renderer downsamples it three times for bloom and mirrors it into the floor for reflections. It uses no `shadowBlur` and no per-frame filters.
- Blade cores are redrawn at full resolution on top so edges stay sharp.
- Internal resolution is capped at 1080p. If the smoothed frame time passes 21 ms the renderer lowers its resolution in steps down to 55%, and raises it again when frames are fast.
- The simulation sub-steps so no step exceeds 1/120 s at any refresh rate.

Measured in headless Chrome at 1280x720 with six enemies fighting: median frame 16.7 ms, 95th percentile 16.7 ms.

## Sound

Every sound is synthesized with the Web Audio API. A saber hum rises from 88 Hz to 115 Hz with swing speed. The parryable telegraph is a bright glint centred near 4.5 kHz and the unblockable one is a low buzz near 0.5 kHz, so the two are distinct by ear. Music is generative and its intensity follows the number of enemies and your style rank. Slow motion sweeps a low-pass filter over the mix. Nobody has listened to any of it yet. The balance was set from measurements, so expect to retune it by ear.

## Open questions for you

1. Structure. Fixed 12-floor campaign as proposed, or a roguelike run with random floors and technique drafts?
2. Tone of kills. Bodies are cut apart with glowing ends. Keep it, or hold dismemberment back for finishers only?
3. Difficulty. The prototype is tuned so floor one is forgiving and the Proctor is a wall for button mashing. Is that the right curve once you have played it?
4. Controls. Is J K L with Shift comfortable, or do you want mouse aiming or a different layout?
5. Scope of the next step. I suggest tuning feel from your notes first, then building Act I in full with the progression system, before adding more enemies.
