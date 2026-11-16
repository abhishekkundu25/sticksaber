# STICKSABER design notes

This document records how the game works and why. Sections marked "proposed" are not built.

## Premise

You are Initiate Zero, climbing the Spire: a hundred floors in ten sectors. Each floor is one arena and ends when its waves are cleared. Every fifth floor is held by a champion and every tenth by a sector boss. The Forgemaster keeps one of the early sectors and the Proctor waits on floor 100 to test whether you can stop repeating yourself.

The premise exists to justify one mechanic: stronger enemies learn your habits. That mechanic is the game's answer to "repeating one attack should become less effective".

The second idea, added with the hundred floors, is that no two climbs should feel alike. The tower's shape is fixed so that it can be learned. Nearly everything that fills it is generated from the run's seed.

## Combat rules

### Feel

| Element | How it works |
| --- | --- |
| Hit stop | A hit freezes the simulation for 30 to 160 ms, scaled by the move. The struck body shakes during the freeze. Freezes are rationed from a 0.3 s bank that refills as the game runs, so in a crowd they shrink instead of stacking up. Against three enemies the game is frozen up to 23% of the time, as before. Against sixty it is frozen 9% of the time, where it used to be 53%. |
| Camera | Shake is trauma-based and capped at 10 px. Heavy hits add a zoom kick of at most 3.5%. There is no rotation. |
| Slow motion | A parry, a perfect dodge, the last kill of a wave and a boss kill slow time. Black bars slide in while time is slowed. |
| Blade hits | The hit test sweeps the blade that is drawn, so a swing that visibly passes through a body connects. |
| Input | Presses are buffered for 140 ms, jumps have 90 ms of coyote time, and most recoveries cancel into a dash, a jump (on hit) or the next attack. |
| Assist | With no direction held, an attack turns toward the nearest enemy within 340 units. A step forward stops short of the target instead of pushing through it. |
| Mouse | Left, right and middle buttons are light, heavy and power. The wheel switches power. Menu items, draft cards, pause buttons and the power list in the HUD highlight under the pointer and take clicks; a click on the HUD is not an attack. |
| Rumble | A gamepad shakes on hits, parries, slams and boss kills, scaled to the event. |

### Ragdolls

Every fighter has 11 joints. The animated pose and the ragdoll use the same joints, so a fighter can drop into physics from any pose and blend back joint by joint when it stands up.

- Launchers, knockdowns and kills hand the body to the ragdoll. Hitting a ragdoll sets its velocity, so juggles stay predictable while limbs flail.
- Each juggle hit raises gravity on the target by 9%, which ends infinite combos without a hard counter.
- A spike bounces the body off the floor. A hard throw into the arena wall bounces it back.
- A killing blow slices the body. A cut splits one bone into two shorter ones, so both halves stay visible and fly apart along the blade's path. The cut ends glow and cool.
- A light kill cuts once and a heavy kill twice. A riposte, a charged heavy, any kill during Overdrive and a boss kill cut three times.
- The body stays cuttable for 3.4 seconds. Each further hit, or a thrown saber passing through, slices off another piece, up to eight cuts. At five pieces the game shows DICED and pays a small focus and style bonus.

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
| Retry | A fall restarts the current wave with full health and the build intact. On Master it restarts the floor. |
| Lesson | On floor 1, a player who has never passed it meets one instructor that cannot be hurt until it is parried once. The rest of the wave waits. It gives up after 45 seconds, and it is given once per browser. |

### Focus

The meter holds three pips (up to five with the Deep Well augment). Fresh moves fill it (stale hits earn nothing), a parry or a perfect dodge gives a third of a pip, and being hit does not drain it. It is spent three ways, so each pip is a choice between a power, safety and damage.

| Cost | Move | Input | Effect |
| --- | --- | --- | --- |
| 1 or 2 pips | The selected power | I | See the table below. |
| 1 pip | Burst | I while hit, knocked down or deflected | A shockwave within 310 units throws light enemies, interrupts Brutes and bosses, clears enemy projectiles and stands you up with 0.75 s of invulnerability. It deals no damage and has a 1.5 s cooldown. |
| All pips | Overdrive | O | For six seconds the blade is 22% longer and you act 15% faster. No move goes stale or can be read, each hit returns 1.5 health, and every kill cuts three times. Taking a hit ends it. No focus is earned while it runs. |

Burst can interrupt a boss's heal if you are close, but it does not break its posture the way a hit does. Overdrive spends the pips you would need to reach a heal from across the room, which is the trade.

#### Powers

The player owns a list of powers and selects one at any moment: U cycles, the number keys pick a slot, a gamepad uses the left trigger and a phone has a SWAP button. The HUD shows the list under the focus meter with the selected power lit, its key and its cost. The run starts with the saber throw. Each champion offers one more out of three.

| Power | Cost | Effect | Good against |
| --- | --- | --- | --- |
| Saber throw | 1 | The blade flies out and returns, hitting several times. You are unarmed until it comes back. | A kneeling boss across the room, a line of enemies |
| Crescent | 1 | A wave along the floor: 20 damage and a launch to everything in its path. Shields do not stop it. | Shield carriers, crowds on one side |
| Arc | 1 | Lightning jumps between up to four enemies for 16 each and stuns them for 0.6 s. | Drones, interrupting several wind-ups at once |
| Mend | 1 | Restores 12 health plus 20% of the maximum. | Long boss fights |
| Nova | 2 | 24 damage and a knockback to everything within 350 units. Clears projectiles. | Being surrounded |
| Stillpoint | 2 | Enemies run at 22% speed for 3.6 s. | Anything fast, elite squads |
| Mirror | 2 | An image stands at your back for ten seconds and repeats each attack at half damage. | Bosses |
| Judgment | 2 | A pillar of light under up to six enemies after half a second, 34 damage each. | Ranged enemies, spread-out waves |
| Flash step | 2 | You vanish and cut through up to six enemies for 15 each. A beat later each takes 14 more and is thrown. You cannot be hit meanwhile. | Crowds, escaping a corner |

A power's hits never go stale and never freshen anything, and they earn no focus back.

### Variety

Two systems push the player to mix moves.

1. Staleness applies to every enemy. The game keeps your last ten landed moves. A move absent from that list deals 112% damage. A move that appears twice deals 80%, three times or more 60%. Fresh moves also fill the style rank and the focus meter faster.
2. Adaptation applies to Duelists and the Proctor. Each landed or blocked hit raises a counter for its move family (light strings, heavy strikes, launchers, air combos, plunges, throws). Hits from other families lower it. When a counter passes the enemy's threshold, ADAPTED appears and the HUD names the family. From then on the enemy turns that family aside and counters, or takes 40% damage from it if it is mid-attack. Landing hits from other families clears the read.

A scripted player that only uses the light string gets through sector I, then falls to the champion of sector II eighty times without beating it: a champion never flinches, so the string does nothing but go stale. A scripted player that mixes its combos and parries most attacks finishes the whole tower.

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

- In sector I, extra attacks unlock by floor, so an Initiate on floor 8 is not the Initiate from floor 1.
- Each spawn rolls a temperament. Aggressive enemies attack 40% more often and guard less. Cautious ones hold 40 units further back and guard more. Flankers vault over you while they wait their turn.
- From sector II a spawn can be an elite with 35% more health and one modifier: swift (20% faster), armored (no flinch during wind-ups) or volatile (bursts 0.8 s after death). The chance rises from 15% to 50% over the run.

### Strains

From sector II each sector introduces two strains. A strain is one of the eight base types with its brain kept and almost everything else rolled from the seed.

| Part | What is rolled |
| --- | --- |
| Body | Overall size, limb proportions from seven silhouettes (lanky, stocky, long-armed and so on), line weight, one of thirteen head shapes, a scarf, a cloak or neither, the blade's length and style (plain, wide, thin or double-ended). Drones get one of four hulls. |
| Colour | Any hue except a band around the player's cyan. |
| Numbers | Health, posture, speed and damage, tied to size: big strains are tougher and slower. |
| Traits | One trait in sectors II to IV, two after that: swift, armored, volatile, vampiric (heals when it hits you), splitter (leaves two small Shards), regenerating (heals when left alone for three seconds), shielded (a frontal shield like the Bulwark's) and reader (adapts to repeated move families and counters). |
| Moves | Its base type's attacks, about a third of them swapped for faster or slower copies. One or two attacks borrowed from another base type, with ranges rescaled to its reach. Often one new string made by joining two of its attacks. |

The move generator has two operations. A tempo copy scales every time in a move by 0.82, 0.9, 1.15 or 1.18: quick copies hit 15% lighter, slow ones harder. A chain cuts one move short after its last hit and runs a second straight on. Both keep the telegraphs. The first tell of any generated move comes at least 0.2 s before its hit, or the variant is thrown away and the original used. Moves that jump are never rescaled, because their timing depends on the flight.

The floor that introduces a strain says what it is in one line, for example "EMBER HALBERDIER: a Lancer strain. It does not flinch during wind-ups. It has learned the Wraith's rising cut".

### Animals

From sector II each sector adds one animal species. Animals are not reskinned humanoids: they have their own rig, gaits and attacks. They do reuse the humanoid's eleven joints with a new meaning (shoulder, hip, two front limbs, two hind limbs, head), which is why hit detection works on them unchanged.

A knocked-down or dead animal stays an animal. Its limp body is the same eleven joints plus its snout, tail and extra legs, and it is drawn with the same shapes as the living one, so nothing changes shape when it goes down or gets back up. Knees bend only their own way, and a stiff sting keeps its curl. Each plan has its own weight: a charger or an ape travels less when launched and slides when it lands, a toad bounces, a flyer folds its wings and drops, and a stalker or a scorpion curls its legs. A scorpion twists to land on its back. A dead stalker does the same. Lift changes little from plan to plan, so air combos work on every animal. An animal that ends up on its back rolls over as it gets up. Animals are not cut apart. A blow to a dead animal knocks the body about instead.

| Plan | Silhouette | Behaviour | Answer | Cost |
| --- | --- | --- | --- | --- |
| Hound | Lean dog, glowing jaw | Paces at range, snaps or pounces. A packmate on your side leaps over you to come from the other. About 35 health | Parry the lunge, kill it fast | 0.8 to 1.7 |
| Charger | Barrel body: bull, boar, rhino, ram or elk | Never flinches. Paws the ground, then charges along a red line and stuns itself on a wall. Gores, and rears for a stomp with shockwaves. Can be ridden | Jump or dash the charge, bait it into a wall | 3.6 to 6.5 |
| Raptor | Biped with a long stiff tail | Fast. Hind-claw rake, a high leap that lands claws first, a snap. Can be ridden | Parry the rake, dash out from under the leap | 2.2 to 4.1 |
| Stalker | Spider with arching legs | Creeps, then darts past you and lunges at your back | Turn with it and parry | 2.0 to 4.3 |
| Scorpion | Low, pincers, a tail arched over its back | A white sting, a pincer snap, and a slow red impale | Parry the white sting, dash the red one | 2.4 to 4.6 |
| Flyer | Bat, hawk or moth | Hovers out of reach, swoops or strafes at head height. Any hit drops it | Jump to meet it, or parry the swoop | 1.2 to 2.6 |
| Ape | Knuckle-walking gorilla with glowing fists | A looping hook, a two-fist slam with shockwaves, a leap onto you | Jump the shockwave, punish the recovery | 3.5 to 6.4 |
| Spitter | Toad or lizard with a swelling throat | Keeps 380 to 620 units away. An aimed bolt, a lobbed glob, a shove up close | Parry the spit back, then close in | 1.5 to 3.5 |

Generation rolls the body (spine, legs, neck, head, girth, tail), the kind within a plan (five chargers, three flyers, three spitters), features (ears, ruff, crest, quills, frill, plates, extra legs), the natural weapon, line weight and colour. Health, posture and speed follow from size. Deeper animals learn a third move and take one or two traits. Their attacks go through the same generated-move rules as everything else, so each telegraphs at least 0.2 s ahead and every unblockable one shows red for at least 0.7 s.

A run uses every plan before any repeats.

### Bonds

A bond is a relationship between enemies that spawn as a group. It exists so that a wave is a problem to read, not a queue: the bond decides which enemy to kill first. Each sector rolls two bonds from its own strains, its animal and the base roster, uses the same pairings throughout, and introduces each on its own floor with one line of text.

| Bond | Rule | Shown by | Counter |
| --- | --- | --- | --- |
| Rider | A humanoid sits on a charger or raptor and fights from the saddle. The mount moves, the rider strikes | RIDER over the rider | A launch or a knockdown unseats the rider. Killing or staggering the mount throws it. A mount whose rider dies goes feral: 22% faster, 25% more damage |
| Pack | A leader makes two or three pack members 12% faster | ALPHA over the leader | Kill the leader. The pack is staggered, backs off, and waits 80% longer between attacks |
| Ward | The charge takes 35% damage and half posture damage while its warder lives | A blue thread, WARDED on hits | Kill the warder. The charge recoils and loses a third of its posture |
| Mender | The partner heals 4.5% of its health a second | A green thread while it heals | Kill the mender |
| Sworn | When one of the pair dies the other enrages and heals a quarter | An orange thread | Bring both low, then finish them together |
| Cover | A shield carrier keeps itself between the player and the shooter it guards | Positioning | Dash through, jump over, or use a power that ignores shields |
| Tandem | When one starts an attack the other is cleared to strike as it ends | Timing | Parry twice, or kill the opener |

The chance that a generated wave contains a bonded group rises from 35% in sector II to 75%. A group is paid for from the wave's budget as one unit, at the sum of its members plus half a point.

## Bosses

### Champions (every fifth floor)

A champion is a strain grown to boss size: 1.2 to 1.7 times the scale, a cloak, a generated name ("Vorrak the Unbroken"), a health bar across the screen and two traits. It never flinches and cannot be launched, so the light string alone does nothing to it. It fights with the ordinary melee brain and a larger move list. At half health it kneels and calls two of its sector's cheaper fighters. Beating it opens a draft of three Focus powers.

### Sector bosses (every tenth floor)

Eight or nine of the ten sector bosses are generated. Each one is built from a fighting school, which fixes its weapon, stance and core attacks, and then drifts from it.

| School | Weapon | Core | Set pieces |
| --- | --- | --- | --- |
| Executioner | Wide greatsword, 1.4 to 1.55 times size | The Brute's swing, smash, sweep, leap slam and charge | Reinforcements, a leap onto a marker |
| Blademaster | Long blade, sometimes double-ended later | A three-hit verdict, flurry, spin, a lunge down a floor line, a crescent wave, a dive. Blocks, reads you and counters | Blinks to your back, afterimages |
| Pikelord | Pike with twice the usual reach | Thrust, double thrust, shove, lunge, low sweep, a line of flame pillars | A leap onto a marker, reinforcements |
| Phantom | Short blade, dark cloak | Cross cuts, a spinning advance, crescent waves, a dive | Two kinds of blink, afterimages, a kneeling heal |
| Warlock | Short blade, keeps its distance | Lobbed charges, flame pillars, crescent waves, a shove if you close in | Reinforcements, a kneeling heal, a leap |

On top of the school, each boss borrows one or two attacks from another school and holds them back for phase two, swaps some attacks for tempo copies, may take one extra set piece, and may or may not heal. The first two sector bosses have one phase change at 50% health. Later ones change at 66% and 33%, speed up a little each time, and change colour. Afterimages appear from the last phase. The banner at each change is the boss's own.

All set pieces are telegraphed the way the hand-made bosses do it: a red ellipse where a leap will land, a closing ring where a blink arrives, a green ring around a healing boss with a bar that shows how much it will restore. When a boss dies, whatever it called in dies with it.

### The Forgemaster (one of floors 20 to 50)

Hand-made. It keeps a different sector each run, always in the foundry. 1,000 health before the floor's scaling. It never flinches and cannot be launched. Ordinary hits fill its posture at 40% of the usual rate.

- Its hammer heats through each three-hit string: orange, then yellow, then white. The first two swings can be parried. The white-hot third cannot, and it sends a shockwave along the floor.
- After the third swing or a ground quake the hammer vents steam for 1.7 seconds. Hits during the vent deal 25% more damage and 80% more posture damage.
- It throws three molten charges that land with a blast ring.
- At 50% health the fight changes: it erupts flame pillars in a line along the floor, each marked by a red strip 0.75 seconds or more before it fires, and pauses less between attacks.

The lesson is to read the weapon. The hammer's colour tells you what is coming before any flash does.

### The Proctor (floor 100)

Hand-made, and always in the Examination Hall. 900 health before the floor's scaling, which makes it about 8,200. It never flinches and cannot be launched.

- Phase one. A three-hit string whose last hit is delayed to catch early parries. An unblockable lunge with a floor line and a long recovery. A crescent wave you can jump or parry. It blocks, and counters after two blocks.
- At 60% its blade becomes a double-ended staff and its pauses halve. It gains a five-hit spinning advance and a leap off screen that lands on a tracking marker.
- At 45% and 20% it dashes to the far wall and kneels to heal 20% over 4.4 seconds. Any hit interrupts the heal and breaks its posture for 2.6 seconds. A thrown saber reaches it from anywhere.
- Below 25% it leaves an afterimage behind when it attacks. The afterimage repeats the same strike 0.55 seconds later, cannot be hit, and deals 60% damage.
- It adapts at five hits of one family.

### The Twins (floor 60 or 70)

Hand-made. Castor is quick and close, Pollux holds the range with a pike. They share one pool of health, shown as one bar, and only the lit twin can be hurt: hits on the other show UNLIT and do nothing. The unlit twin still attacks at 60% damage. They swap every six to nine seconds with a flash and a thread between them. Until half health only one of them attacks at a time. After that they stop taking turns. When the pool empties both fall.

The lesson is target discipline: the nearest enemy is often the wrong one.

### The Cartographer (floor 80 or 90)

Hand-made, in a room with charged walls. It fights with a long pike, and between attacks it plants the pike and redraws the floor. An alarm sounds first.

- Phase one: alternating strips of floor erupt after 1.2 seconds. The pattern flips each time.
- Phase two, from 66%: a wall of fire walks across the room, one strip every 0.07 seconds, with two gaps in it. The gaps are visible from the start.
- Phase three, from 33%: three light bridges appear and the whole floor is marked. It burns 1.9 seconds later for 0.9 seconds. Anything standing on the floor is hit once; a bridge or the air is safe.

The lesson is to read the floor while fighting. It is also the one place where the bridges are not optional.

### The finisher

A killing blow on any champion or sector boss slows time to 12% for 2.4 seconds. The camera closes in on the falling body, a card names it, and four more cuts land on it a third of a second apart.

### More boss mechanics (proposed)

| Examiner | Mechanic | What observation buys you |
| --- | --- | --- |
| The Archivist | Records your last combo and replays it at you as a ghost four seconds later. | Short, safe strings give it less to use. |
| The Lamplighter | Fights from the ceiling and the light bridges, and puts out the bridges you stand on. | Fighting upward, and choosing where to stand. |

The Twins and the Cartographer used to be on this list and are now built. A boss that fights with your moveset became the Mirror power instead.

## Structure and generation

A run is generated from one 32-bit seed, a difficulty and a length. The same three always produce the same run, and the simulation's random numbers come from the same seed, so a headless replay is exact. Generating a run takes under ten milliseconds.

### Two lengths

The owner played the hundred floors and found they became repetitive. Three things were the same on every floor: the goal (kill everything), the path (no choice of where to go) and the room (a flat floor). Everything in this section after the sector's shape answers one of those three. The first answer is length.

| | Sprint | Climb |
| --- | --- | --- |
| Floors, sectors | 30, 3 | 100, 10 |
| First sector | Generated like every other: its own strains, animal and bonds | The school: the eight base enemies, one at a time |
| Depth of floor `n`, which sets health, damage and wave size | `6 + 1.6 (n-1)`, so floor 30 hits like floor 52 of the climb | `n` |
| Hand-made keepers | One of the three on floor 20, the Proctor on floor 30 | All three, and the Proctor on floor 100 |
| Time for a scripted player | 25 to 40 minutes | 70 to 80 minutes |

The sprint is the default. The Cartographer was made for a build of seventy cards, so in a sprint, where it meets about twenty, it has 62% of its health and deals 75% of its damage. The daily run is a sprint whose seed is a hash of the date.

A sector's place in the roster (`q`: which strains, animal, champion and keeper it uses) is kept apart from its place in the run and from the depth that scales it. On the climb all three are the floor number, so the climb generated before this change is unchanged floor for floor.

### The shape of a sector

| Floor of the sector | Kind | Waves | Pays out |
| --- | --- | --- | --- |
| 1, 2 | Introduces one of the sector's two strains: the strain with light support and a hint, then a generated wave | 2 | An augment |
| 3 | Introduces the sector's animal the same way | 2 | An augment |
| 4 | Introduces the sector's first bond: the bonded group nearly alone, with a hint, then a generated wave | 2 | An augment |
| 5 | Champion | 1 | A Focus power |
| 6 | A skirmish whose first wave introduces the second bond | 2 | An augment |
| 7 to 9 | Skirmishes, one of them an event | 1 to 3 | An augment, a rare one and a technique after an event |
| 10 | Sector boss | 1 | A legendary augment and 10 maximum health |

Sector I is the school. Its eight ordinary floors each open with a hand-made wave that teaches one base enemy, and its hints teach the parry, Focus, the launcher, champions, powers and keepers.

| Event | What it is |
| --- | --- |
| Horde | One wave of eight to twelve cheap enemies arriving fast, with one more attacker allowed |
| Elite squad | One wave of up to four enemies, all elites |
| Duel | The sector's two strongest fighters and nothing else. Brutes are left out |
| Gauntlet | Three smaller waves with no healing between them |
| Ambush | Two melee waves that drop in close on both sides at once |

### How a wave is generated

- Each wave has a threat budget. It climbs steeply through the school (`2.2 + 0.85 × floor`) and slowly after it (`10.7 + 0.085 × (floor - 10)`), plus `0.9 × wave index`. From sector II most of the rising difficulty comes from strains, health, damage and pace, not from head count.
- Each enemy has a cost: Initiate 1, Drone 1.3, Marksman 1.6, Bulwark and Lancer 2.6, Wraith 2.8, Duelist 3.6, Brute 5. A strain costs its base type's price plus 18% per trait and 0.3 per borrowed or joined move. An elite costs 1 more.
- The pool is every base type plus every strain introduced so far. The current sector's strains are three times as likely as anything else, and base types fade as the run goes on.
- The generator draws from the pool until the budget or the head-count cap is reached: five enemies in sectors I to IV, six in V to VIII, seven after.
- Rules: at most one Brute-class enemy, two ranged enemies, two each of the Duelist, Wraith, Bulwark and Lancer classes, and at least two enemies in any wave.
- The heaviest enemy arrives first. The rest follow 0.7 to 1.5 seconds apart on alternating sides.
- Two enemies may attack at once in sectors I to IV, three in V to VIII, four after.

### How the tower scales

| Per floor `n` | Formula | Floor 50 | Floor 100 |
| --- | --- | --- | --- |
| Enemy health | `1 + 0.028 (n-1) + 0.00035 (n-1)²`, then up to 34% more over floors 40 to 100 | 3.3 times | 9.7 times |
| Enemy damage | `1 + 0.014 (n-1) + 0.0002 (n-1)²`, then up to 57% more over floors 40 to 100 | 2.3 times | 6.8 times |
| Enemy animation speed | 1.4% faster per sector | 5.6% | 12.6% |
| Gap between enemy attacks | 3.5% shorter per sector, to a floor of 68% | 86% | 68.5% |

The curves bend upward because the player's build compounds. The extra push (`1 + 0.004 (n-40) + 0.011 (n-70)`, each term from zero) starts at floor 40 because shops, rooms and bonus cards make a build grow faster than the floors do, and steepens over the last three sectors because a build is nearly complete by then. `n` here is the floor's depth, which in a sprint runs ahead of the floor number.

### Anomalies

From sector II a floor without a boss has a 17% chance of an anomaly. The first wave's hint and the HUD name it.

| Anomaly | Rule it bends |
| --- | --- |
| Low gravity | Everything falls at 62% speed, so jumps and juggles last longer |
| Frenzy | Enemies are 15% faster with 25% less health |
| Glass | Every hit, yours and theirs, deals 50% more |
| Surge | Focus builds twice as fast |
| Unstable | Every enemy bursts when it dies |
| Bounty | Three times the orbs |

### Terrain

About half the ordinary floors from sector II have terrain, a fifth of the teaching floors, and three in ten generated boss floors (vents or walls only).

| Terrain | Rule | Why |
| --- | --- | --- |
| Light bridges | One to three one-way platforms 130 to 170 units up. Bodies and ragdolls land on them. A bridge that the player stands on for 3.2 seconds overloads, drops out for 4.5 seconds and returns | A breather and a launch point for plunges, not a refuge: melee enemies cannot follow, so the timer stops camping |
| Vents | Two or three marked strips that arm for 0.95 seconds and erupt every five to seven and a half seconds. They burn everyone | A hazard to fight around and to knock enemies into |
| Charged walls | A body knocked into the wall at speed takes 16 damage (before the floor's scaling) and a stagger, once every 0.8 seconds. A corpse is cut again | Rewards launches and knockbacks toward the edges |

A kill by a vent, a wall or the Cartographer's floor pays 20 focus and a style bonus. Terrain positions are stored as fractions of the arena's width, because arenas differ in size. Terrain is drawn straight onto the frame instead of through the bloom layer, so it does not widen the area the bloom has to cover.

### Surprises

One per sector, on a random floor that is never a champion's or a keeper's, from a random stream of its own. A surprise waits for the floor's last wave, so the first wave can still be read in peace. It is announced by a banner that tears in two colours, a sting and a red flash.

| Surprise | When | Rule |
| --- | --- | --- |
| Your Shade | After the last wave | See below |
| Blackout | As the last wave starts | A dark layer is drawn over the room and the bodies, and under the glow, the blade cores and the tells |
| Bad blood | As the last wave starts | The kinds in the room are split into two sides. Their attacks hit the other side, and each fighter goes for the nearest of the other side unless the player is much closer. With one kind in the room it becomes a supply drop |
| A prisoner | As the last wave starts | A cell with 60 health. Broken, it frees a climber on the player's side for the rest of the floor |
| Stampede | 3 to 5.5 s in | Three passes of three to five of the sector's animal, each announced for 1.5 s with chevrons at the edge it will come from. 15 damage and a knockdown to anything on the ground, enemies included |
| Courier | 3 to 5.5 s in | A runner that flees, vaults over the player when cornered and leaves after 15 s. Killing it pays 50 shards and a rare card |
| A rival | 3 to 5.5 s in | A climber on a side of its own that attacks whoever is nearest. It leaves when the floor ends. Killing it pays 45 shards |
| The Spire shifts | 3 to 5.5 s in | Bridges drop out, three vents open, the walls go live |
| Storm front | 3 to 5.5 s in | Twenty seconds of pillars at random places, every third one aimed at where the player is heading |
| Supply drop | 3 to 5.5 s in | A cache with 70 health that pays shards and three orbs |

The Shade appears once in a sprint and three times in the climb, spread over the run. The others turn up once each before any repeats.

Three of these need fighters that fight someone other than the player. Every enemy brain was written against `world.player`, so a fighter with a quarrel of its own is handed its target in the player's place for the length of its own update (`World.foeOf`). That one substitution makes an ally, a rival and a feud out of brains that already existed.

### The Shade

The owner's idea: a dark version of the player with all their powers, different every time.

- It is built at the moment it arrives, from the weapon in the player's hand and the powers they own (`shade.js`).
- It runs on the sector bosses' brain with a kit made on the spot: the weapon's light string, heavy, dash attack and launcher, then one entry for each of the player's powers.
- The player's own moves are far too quick to read from the other side (the first light lands in 0.05 s). The Shade uses copies: the same poses played 22% slower behind a held wind-up, so the first cut never lands before 0.34 s, each one is announced with a flash, and all of it can be parried.
- Powers map to things bosses already do: the throw to a thrown blade, Crescent to a wave, Arc to a line of pillars, Nova to a spin, Flash Step to a blink, Judgment to a leap that lands on a marker, Mirror to an afterimage, Mend to a kneeling heal that can be interrupted. Stasis maps to nothing. Freezing the player is never fair.
- Each appearance is a tier. Tier 1 uses two powers and has one phase. Tier 2 adds a fourth hit to the string, a heavy that cannot be blocked, a third power and a second phase. Tier 3 takes four powers.
- It pays a legendary card.

### Objectives and challenges

An objective replaces the two waves of a skirmish on floors 7 to 9, on about seven in ten of the plain ones. The floor's own waves become reinforcements that return each time the room thins out.

| Objective | Rule |
| --- | --- |
| Hold out | A timer of 34 to 42 s. When it ends, whatever is left leaves |
| The mark | The toughest enemy of the last wave gets 60% more health and a gold rim. When it dies the rest leave |
| Hold the ring | A ring 400 wide charges in 15 s of standing in it and drains at a third of that speed outside. Full, it kills everything in the room |
| Signal cores | Three cores with 90 health each. When the last breaks, everything in the room dies |

A challenge is an extra condition on about three in ten of the other floors, and pays 25 to 45 shards: take no damage, clear the floor in time, use no powers, parry three times, kill two enemies in the air, or kill one with the room. A fall forfeits it.

### Doors, rooms and shards

After floors 2, 4, 6, 8 and 9 of a sector the player picks one of three doors. Before a champion (after 4) and a keeper (after 9) the three are rooms: sanctuary, quartermaster, shrine or armoury. Elsewhere the first is always the stair and the other two are drawn from an elite guard, a cursed hall, an unmarked door, and a quartermaster or sanctuary.

| Door | Rule |
| --- | --- |
| Elite guard | Every eligible spawn on the next floor is an elite and enemies have 10% more health. The card after it is one tier better and it pays 40 shards |
| Cursed hall | One curse for the next floor: 30% more damage taken, enemies 14% faster, the lights out, no healing between waves, or one more enemy in each wave. Two cards after it |
| Sanctuary | 45% of maximum health |
| Quartermaster | Four cards at 45, 80, 110 or 150 shards by rarity, a weapon at 60 and repairs (40% health) at 35 |
| Shrine | Three pacts, or refuse |
| Armoury | Three other weapons, or keep the one in hand |
| Unmarked | A gift of 60 shards (one in three), a sanctuary, an elite guard, a shrine or an armoury |

Shards drop from everything that falls: 2 to 8 by the enemy's health, double for an elite, 40 for a champion, 60 for the Shade and 80 for a keeper. A scripted player earns 1,400 to 2,000 in a sprint and spends most of them.

Between floors the player keeps their health, with a floor of 40% of the maximum. It was 60% before sanctuaries existed, when it made a rest worth nothing.

The pacts: Glass Heart (40% more damage, 30 less health), Hunger (6 health per kill, none between waves), Debt (150 shards, enemies 15% tougher), Hubris (60% more focus, half a pip lost per hit taken), Last Stand (double damage under 40% health, all healing halved), Overclock (faster and longer-bladed, enemies 10% faster), Blood Tithe (a power costs health when the meter is empty) and Greed (double shards, 15% more damage taken).

### Shaped rooms

About one floor in five, never a champion's or a keeper's.

| Room | Rule |
| --- | --- |
| Open edges | 250 to 340 units of floor are missing at each side. A fighter does not walk, run or charge over the lip. One that is knocked, thrown or leaps past it falls. An enemy that falls is dead and the room gets the kill. The player and anything too heavy to throw is hauled back for 16% (6% for a boss) of maximum health |
| High ground | Two or three fixed ledges. Up to two of each wave's shooters are posted on them and hold them until knocked off |
| Sliding bridge | A platform that crosses half the room every eight seconds and carries whoever stands on it, with one side open |
| The lift | 400 units open at each side, shaft lights running past, and a small sliding bridge over the middle |

Nothing is ever dropped in over an open edge. A leap after a player who stands on the lip can carry the leaper over, and that is left in on purpose: it is the player's reward for standing somewhere dangerous.

### Difficulty

| | Student | Adept | Master |
| --- | --- | --- | --- |
| Enemy damage | 70% | 100% | 120% |
| Enemy health | 85% | 100% | 115% |
| Gap between attacks | 125% | 100% | 85% |
| Wave budget | 0.7 less | | 1 more |
| Elite chance | half | | half again |
| Attackers at once | | | one more |
| Healing after a wave | 40% | 30% | 22% |
| A fall restarts | the wave | the wave | the floor |

### What else varies per run

- Sector names, floor names and boss titles.
- Arenas. Each sector has two wings, one arena family each, drawn so that a run visits all six families. Every floor is its own seeded variant of its family (layout, weather, one set piece), and each sector rotates the whole palette by its own hue. Floor 1, the Forgemaster's floor and floor 100 keep the canonical look.
- Which sector the Forgemaster keeps.
- The augments and powers offered after each floor. They are drawn from the seed too, so a shared seed offers the same choices.

## The build

After every floor the game stops and offers three cards. The pick is kept for the run, shown on the pause screen, and saved with the run.

| Rarity | Offered | Examples |
| --- | --- | --- |
| Common (11, up to 3 to 6 copies each) | Most picks | Keen Edge: +6% damage. Vigor: +12 health. Flow: +15% focus. Long Blade, Fleet, Heavy Hand, Quick Cuts, Skyward, Field Salve, Leech, Harvest |
| Rare (13, up to 2 or 3 copies) | About a quarter of the cards early, half late, and every card after an event floor | Fault Line: 8% of hits strike twice as hard. Cinder Edge: hits burn. Live Wire: every fourth hit arcs. Deep Well: one more pip. Coup de Grace: executions. Counterweight, Afterimage, Iron Guard, Sustained, Aftershock, Returning Edge, Poise, Improviser |
| Legendary (8, one copy) | After each sector boss | Second Wind, Unbroken, Stormcaller, Wellspring, Conduit, Colossus, Whetstone, Reaper |

All augments reduce to one table of modifiers that combat reads, so an augment is one line of data. A full build roughly doubles blade damage before the chance effects. That is why the tower's curves bend upward.

I chose numbers and mechanics over new techniques for the build, against my own earlier advice in this document, because a hundred floors need about a hundred picks and techniques run out after ten. The techniques went into the powers instead.

Sustain comes from several small sources on purpose: 2 health per kill, the rally pool, healing after each wave, orbs (a 6% chance of a health orb per kill, 18% when you are under 40% health), Mend, and augments. No single one is enough to ignore being hit.

A fall keeps the build. On Student and Adept it restarts the wave, on Master the floor.

### Weapon forms

A run played by a person opens with a choice of weapon, saved with the run. An armoury, the quartermaster or a card can trade it on the way up, and a Second Sheath carries two. A form is a blade and a complete move list on the same inputs, so the choice changes how the whole game is played, not a number.

| Form | Blade | Character | Damage on one target, against the saber |
| --- | --- | --- | --- |
| Saber | 74 units | Four-hit string, Comet finisher | |
| Twin blades | Two of 50, 10% faster on foot | A six-hit string that alternates hands, a five-hit air string, 5.5 hits a second at about 5 damage. Light on posture, so guards are its weak spot | 5% below on the ground, 6% above in the air |
| Greatsword | 104, wide, 12% slower on foot | Three sweeping lights, every swing armoured against light hits, posture damage of 28 to 80 a hit, a chargeable overhead that cracks the floor | 3% above |
| Staff | 62 at each end | Spins that hit in front and behind, long thrusts, a helicopter air move | 17% below, made up in a crowd |
| Lash | A whip of 150, drawn as a chain that lags and cracks | Only the outer two thirds connect, and a hit scales from 0.6 times at the inner edge to 1.3 times at the tip. Each crack gives a little ground. The heavy wraps a target and drags it in to whip range; a boss, an armoured or mounted enemy drags you to it instead. The launcher yanks upward, the air heavy wraps and slams. A blocked crack recoils the lash | 5% above |
| Gauntlets | A short blade on each fist, 8% faster on foot | Five-hit strings at 0.22 seconds a punch, each stepping in. Every punch that lands adds an eighth of a charge, shown as brighter fists and an arc round the weapon fist; the charge cools after four idle seconds. The heavy spends it on a shockwave that grows from 70 to 180 units and from 4 to 30 damage; at full charge it launches everything in range and breaks guards | Level |
| Drawblade | 96, thin, kept in a sheath at the hip | Lights draw, cut and sheathe with a click. Some cuts only mark what they pass, and the marks are cut when the blade goes home. The heavy holds in the sheath through three levels (0.3, 0.7 and 1.1 seconds of charge, each with a flash and a tick), then dashes about 270 units through the line; the cut lands on everything passed as the blade clicks home, 8 to 38 damage by level. Releasing within 0.14 seconds of a tick is a perfect draw, 1.4 times. Hits taken while charging count as punishes | 3% below |

Mechanics a form adds live on the fighter, not the world, so any fighter can use a form: `equipForm(f, id)` in forms.js gives one, and charging is driven by `f.holdCharge`, which the player's controller sets from the heavy button.

### Techniques

Six augments of a fourth kind, one copy each, change what a move does: the launcher drags enemies within 300 units in first (Undertow), a parry sends most of the blocked damage back without being able to kill (Mirror Guard), the thrown saber stuns for 1.3 seconds (Nailing Throw), a dash cuts whatever it passes through for 12 (Razor Step), a plunge calls a pillar down where it lands (Meteor), and the player gets a second air jump and air dash (Aerialist). One is always on offer after an event floor, and each ordinary draft has a one in ten chance of showing one.

## Art direction

The style is ink and neon. Fighters are near-black silhouettes with a thin coloured outline. Blades, sparks and impacts are the only bright things on screen. Each arena uses one dominant hue and one accent, and keeps the band behind the fighters calm so silhouettes read at a glance.

| Arena family | Palette | Mood | Set pieces |
| --- | --- | --- | --- |
| Causeway | Teal and indigo, magenta accent | Rain, a megacity below, a wet deck | Searchlights, twin spires, a moon |
| Foundry | Charcoal and umber, amber glow | Crucibles, chains, drifting embers | A molten pour, hooks, a furnace mouth |
| Hall | Violet and black, pale gold | An eclipse through a circular window, pillars, polished floor | Banners, lamps, a cracked window |
| Hanging Gardens | Teal and green, amber lamps | A glass dome over silhouetted trees and vines, shallow water underfoot, fireflies | A great tree, waterfalls, lanterns |
| Cryo Vault | Icy blue and white, red status lights | Rows of frosted stasis pods fading into fog, mist along the floor, falling ice dust | A reactor core, a breached pod venting frost, a gantry crane |
| Storm Apex | Indigo and violet, electric white | A deck above a sea of clouds, antenna masts, lightning inside the storm cells | A ringed planet, a huge moon, a storm vortex |

Each sector also rotates the whole palette by its own hue, so the same family reads as a different place: a rose-red Storm Apex, a green Cryo Vault. The rotation keeps perceived lightness, never adds saturation, and mutes anything that lands near red, so the band behind the fighters stays calm and the red telegraphs keep their meaning. With the three set pieces, the seeded layouts and nine hues, a family has far more looks than a run can show.

Colour also carries meaning. Cyan is the player, and no generated enemy may use a hue near it. Each enemy type and strain owns one blade colour. Pure white and pure red are reserved for telegraphs. Green means healing. Gold, blue and orange rings mark elites. The player's own Judgment pillars are marked in pale gold, never red.

## Rendering and performance

- Each arena is painted once at load into a few offscreen canvases. Static light, shadow, fog and floor reflections are baked into them. One arena is held in memory at a time and released when the floor changes.
- Dynamic light comes from one half-resolution additive layer that holds blades, trails, sparks and telegraphs. The renderer downsamples it three times, sums the three bloom levels at quarter resolution, folds the sum back into the layer, and blends the result onto the screen once.
- That blend, and the floor reflection, cover only the screen rectangle that contains light this frame.
- Blade cores are redrawn at full resolution on top so edges stay sharp.
- A generated strain costs the same to draw as a base enemy: a few more lines for its head shape and one text label.
- An animal costs the same as a humanoid to simulate and about twice as much to draw (9 to 10 microseconds against 4 to 5 in headless Chrome), because the big plans fill their bodies. A wave holds at most a handful.
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

After the hundred-floor work the same crowded fight, measured back to back with the previous version on the same machine, is between level and about 10% slower when only the saber throw is used. The extra is the larger HUD and the name labels. When a scripted player fires every power as fast as it can, the effects add up to another 10 draw calls per frame for as long as they last. The six arena families measure between 8.2 and 10.0 ms per frame at 720p with the GPU off, and the new three are within the range of the old three.

The half-resolution backdrop tier cuts the pixels drawn per frame by 41% (3.83 to 2.25 megapixels at 720p) but saves little time in software raster, where it measured within noise of full resolution. It is kept as the first step down because it should matter on GPUs that are limited by fill rate. That has not been measured on such a machine.

## Tests

`npm test` runs the simulation tests in about forty seconds, then the benchmark.

- Simulation tests (Node):
  - The same seed replays a fight exactly, and a run is a pure function of seed, difficulty and length.
  - Generated runs of both lengths obey the rules: sector shape, unlock order, strains never before their introduction, caps, one Forgemaster, every arena family used, no enemy in the player's colour.
  - Health, damage and budget rise with the floor, and the difficulties are ordered.
  - Every move, generated ones included, is well formed and telegraphs in time.
  - A champion, three sector bosses, the Forgemaster and the Proctor can be beaten.
  - Augments, each of the nine powers, the cards, saved runs, strain traits, bonds, bridges, vents, walls and techniques behave.
  - Every weapon is complete, reachable and within its damage band, and a fighter that is not the player can use each one's signature.
  - Every animal plan generates for fifty seeds, fights, falls limp as itself, gets up and dies.
  - Every sector has one surprise, the Shade returns stronger, and each surprise breaks in, does what it says and leaves the floor finishable.
  - The Shade is built from the weapon and powers in hand, and none of its copied cuts lands unannounced.
  - Each objective is won by doing the thing. A challenge pays when met and not otherwise.
  - Doors, the quartermaster, pacts, the armoury, the second sheath and boons do what their cards say.
  - Open edges, ledges and the sliding bridge behave: nothing is dropped over an edge, nothing walks off one, a knocked enemy falls and the room gets the kill, the player is hauled back.
  - What carries over between runs is filed where the codex reads it, and survives missing or corrupt storage.
- Benchmark: simulation cost per step on a late floor with a full build and in a crowd of 120, then rendering in headless Chrome with the GPU off. It asserts milliseconds per frame against a loose budget, and draw calls and megapixels per frame against tight ones, because those two do not depend on the machine.

`npm run fuzz` is the slow soak. It drives random input through sample floors, champions, bosses, every surprise and every objective, then sends scripted players of three skill levels through sprints and up all hundred floors on each difficulty, and prints where they fell. `npm run smoke` plays the real page in headless Chrome, a boss fight to the end included, and fails on any runtime error.

### What the scripted players say

These are the only balance data there is. The owner has played the hundred floors as they were before this layer; nobody has played it since.

| Run, on Adept | Skilled script (reacts to 85% of threats) | Average (50 to 60%) |
| --- | --- | --- |
| Sprint | Wins in 23 to 39 minutes with 0 to 9 falls | Wins in 28 to 42 minutes with 3 to 17 falls |
| Climb | Wins in about 70 minutes with about 4 falls | Wins in about 90 minutes with about 6 falls |

On Master a skilled script wins a sprint with 6 to 9 falls, most of them in the first sector, where a fall restarts the floor and the build is still small. Falls gather at the first champion and at the keeper on floor 20. The three new weapons win sprints in scripted hands, the drawblade with the most falls. A script reacts better than a person and plans worse, so expect a person to fall more often and to make more of the doors.

## Sound

Every sound is synthesized with the Web Audio API. A saber hum rises from 88 Hz to 115 Hz with swing speed. The parryable telegraph is a bright glint centred near 4.5 kHz and the unblockable one is a low buzz near 0.5 kHz, so the two are distinct by ear. Music is generative and its intensity follows the number of enemies and your style rank. Each sector has its own theme: the combat and boss tracks change key, tempo (within 10%), chord colour (dorian, phrygian, harmonic minor or a brighter major-led set), the timbre of the arpeggio and pad, and sometimes the kick pattern or swing. A theme change waits for the next downbeat. Sector I plays the tracks as they were written. The powers, the draft, orbs, champions and sector changes have their own sounds, 21 in all. A further 29 cover the animals (growl, bite, roar, screech, hooves, wings, hiss, stomp, built from saws and noise through vowel filters so they sound like throats), a swing for each weapon form, the terrain, the bonds, the room bosses and the finisher. Slow motion sweeps a low-pass filter over the mix. Nobody has listened to any of it yet. The balance was set from measurements, so expect to retune it by ear.

## Open questions

1. Difficulty. The curve was set with scripted players, which parry better and plan worse than people. Sector bosses are the walls and the last sector is the hardest. Is that the curve you want once you have played it?
2. Run length. A hundred floors take a script an hour and a half and will take a person longer. The run is saved every floor. Is that right, or should a sector be shorter?
3. Generated bosses. They share five schools and a set of set pieces. Do they feel like different fights, or does the sixth one feel like the second?
4. Build balance. The scripts take the first card every time. A person choosing well will be stronger than they were, and some augments are certainly better than others.
5. Tone of kills. Bodies are cut apart with glowing ends. Keep it, or hold dismemberment back for finishers only?
6. Weapon forms. Their damage was balanced with a script, and the greatsword in particular needs a human's timing. Which one feels best, and is any of them a trap?
7. Bonds. Are the threads and tags enough to read a bond in the middle of a fight, or does it need a stronger cue?
8. Surprises. Do they feel like the tower doing something to you, or like a second wave with a banner? Which ones would you cut?
9. The Shade. Its cuts are your moves slowed by a fifth so they can be parried. Does it still feel like fighting yourself?
10. Run length. The sprint is thirty floors and half an hour for a script. Is that the right default, and is the climb still worth keeping?
11. Money. A script earns about a thousand shards in a sprint and spends most of them. Are the prices right, and is there anything worth saving for?
