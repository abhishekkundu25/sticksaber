# STICKSABER

A side-view action game for the browser. You are a stick figure with an energy sword, climbing a tower one arena at a time: thirty floors in a sprint, or all hundred in the long climb.

Every run is generated from a seed: the enemy strains, the animals, the bonds between them, the champions and sector bosses, the waves, the rooms, the arenas and their colours, and one surprise in every sector that you cannot plan for. You choose a weapon before the first floor, draft augments into a build between floors, win Focus powers from champions, and choose your way up through doors: an elite guard, a cursed hall, a sanctuary, a quartermaster, a shrine, an armoury. The game has three difficulties, a daily run on one seed for everyone, six arena families, a training room, a codex, and keyboard, mouse, gamepad and touch controls. The design notes are in [docs/DESIGN.md](docs/DESIGN.md).

## Play it

https://abhishekkundu25.github.io/sticksaber/

## Run it locally

```
npm start
```

Then open http://localhost:5173. The game uses ES modules, so it needs a local server. Opening `index.html` from disk does not work. There is no build step, and the game has no runtime dependencies.

Start in the training room if you want to judge the movement before fighting anything that hits back. Every power is unlocked there, the number keys spawn each enemy type, `[` spawns a generated strain, `B` an animal, `]` a champion and `\` a sector boss. `Y` switches weapon form. The room has one light bridge to practise on.

The menu has two lengths of run. A sprint is thirty floors in three sectors and takes a scripted player about half an hour. The climb is a hundred floors in ten sectors and takes about an hour and a quarter. The DAILY CLIMB is a sprint on one seed that is the same for everyone that day, on the middle difficulty, with a score at the end. On the results screen `C` copies the score and a link that replays the same tower.

A run is saved at the start of every floor: seed, length, difficulty, floor, build, weapons, shards and the door you took. The menu offers CONTINUE from there.

| Address parameter | Effect |
| --- | --- |
| `?seed=ABC123` | Replay or share a specific run. The seed is shown on the pause and results screens. |
| `?mode=sprint` or `climb` | Set the length of the run. |
| `?diff=easy`, `normal` or `hard` | Set the difficulty. |
| `?floor=40` | Start a new run on that floor, with the picks the run would have made on the way up. |
| `?daily` or `?daily=2026-11-16` | Go straight into the daily run for today, or for that date. |
| `?boons=all` | Offer every boon before the first floor, earned or not. |

## Controls

| Action | Keyboard | Gamepad |
| --- | --- | --- |
| Move | A / D or arrow keys | Stick or d-pad |
| Jump, double jump | Space or W | A |
| Dash (brief invulnerability) | Shift | B |
| Light attack | J, or left mouse button | X |
| Heavy attack, hold to charge | K, or right mouse button | Y |
| Guard, tap on impact to parry | L | RB |
| Use the selected Focus power | I, or middle mouse button | LB |
| Switch power | U, 1 to 9, the mouse wheel, or click a power in the HUD | LT |
| Switch weapon (with a Second Sheath) | T | |
| Drop through a light bridge | S + Space | Down + A |
| Burst (costs 1 focus, while being hit or knocked down) | I | LB |
| Overdrive (needs a full focus meter) | O | Click either stick |
| Pause | Esc | Start |

Fullscreen is F. Mute is M. G cycles graphics quality between auto, high and low.

Everything outside a fight works with the mouse: menu items, cards, doors, the quartermaster's stock and the pause buttons highlight under the pointer and take a click. Esc leaves a room that can be left. A gamepad rumbles on hits, parries and boss kills where the browser supports it.

### Phones and tablets

Hold the device in landscape. The first touch switches on the touch controls; a desktop never shows them.

- Tap a menu item or a draft card to choose it.
- The left thumb gets a stick that appears wherever it lands. Left and right move. Pulling down is the same as S: stick down plus HEAVY launches on the ground and plunges in the air.
- The right thumb gets LIGHT, HEAVY, JUMP, DASH, GUARD, OVERDRIVE and the power button. The power button carries the name of the selected power. SWAP, which appears once you own a second power, changes it. While you are being hit the power button grows, glows and reads BURST. OVERDRIVE lights up when the meter is full.
- The pause button is at the top centre. In the training room a SPAWN button adds an enemy. BLADE appears beside it once you carry two weapons, and switches between them.
- Phones render at 720p internally.

## Moves

These are the saber's. The other weapon forms use the same inputs with their own moves.

| Move | Input | Use |
| --- | --- | --- |
| Light string | J J J J | Fast damage. The fourth hit knocks the target away. |
| Breaker | J K | Quick overhead that breaks a guard. |
| Launcher | S + K, or J J K | Sends the target up. Hold K or Space to rise with it. |
| Comet | J J J K | Somersault smash. Bounces the target off the floor. |
| Charged heavy | Hold K | Breaks shields in one hit. |
| Air string | J J J in the air | Keeps a launched target airborne. |
| Spike | K in the air | Slams the target into the floor. |
| Plunge | S + K in the air | Dive with a shockwave on landing. |
| Dash cut | Shift, then J | Slice on the way through. |
| Parry | Tap L up to 0.2 s before a hit lands | Staggers the attacker. |
| Riposte | J or K after a parry | Pass-through cut. Kills an Initiate outright. |
| Recover | Shift as you hit the floor | Skips the knockdown. |
| Burst | I while you are being hit, knocked down or deflected | A shockwave throws light enemies, interrupts heavy ones and bosses, clears enemy projectiles and stands you up. No damage. 1.5 s cooldown. |
| Overdrive | O with a full focus meter | Six seconds of a longer, faster blade. Nothing goes stale or gets read, and each hit returns 1.5 health. Taking a hit ends it. |

## Weapon forms

A new run opens with a choice of seven weapons. Each has a complete move list of its own on the same inputs. An armoury, the quartermaster or a card can trade it for another on the way up, and your build comes with you.

| Form | Blade | How it plays |
| --- | --- | --- |
| Saber | One blade | The balanced one: a four-hit string and the Comet finisher. |
| Twin blades | Two short blades | Fast and short. A six-hit string that alternates hands, a long air string, about five hits a second for little damage each. Weak against guards. |
| Greatsword | One long wide blade | Slow, wide arcs that hit several enemies. Its wind-ups shrug off light hits, and it breaks posture quickly. Three lights and a chargeable overhead that cracks the floor. |
| Staff | A blade at each end | Spins that hit in front and behind at once, and long thrusts. Light damage on one target, strong in a crowd. |
| Lash | A whip of light | Twice the saber's reach. The tip cracks and hits hardest; right up close it misses. The heavy wraps a target and drags it to you, or drags you to something too big to pull. |
| Gauntlets | A short blade on each fist | The fastest strings and the shortest reach. Every punch that lands charges the fists, and the heavy spends the charge on a shockwave that grows with it. |
| Drawblade | A long blade kept in its sheath | Quick draw cuts. Hold heavy to charge in the sheath through three levels, release to dash through the line, and the cuts land as the blade clicks home. Release just after a level's tick for a perfect draw. |

Against a single target the twin blades and the greatsword deal within 6% of the saber's damage and the staff about 15% less.

## Focus powers

You start with the saber throw. Each champion you beat offers one more out of three. The HUD lists the powers you own under the focus meter: the selected one is lit and shows its key and its cost. U cycles, a number key picks a slot directly, and you can switch at any moment, mid-swing included.

| Power | Cost | Effect |
| --- | --- | --- |
| Saber throw | 1 | The blade flies out, cuts everything in its path and returns. You are unarmed until it does. |
| Crescent | 1 | A wave of light runs along the floor and launches whatever it meets. |
| Arc | 1 | Lightning jumps between up to four enemies and stuns them. |
| Mend | 1 | Restores about a quarter of your health. |
| Nova | 2 | A ring of blades bursts outward: heavy damage and a knockback to everything near you. |
| Stillpoint | 2 | Time all but stops for your enemies for three and a half seconds. |
| Mirror | 2 | An image of you fights at your back for ten seconds and repeats every attack at half damage. |
| Judgment | 2 | Pillars of light erupt under up to six enemies. |
| Flash step | 2 | You vanish and cut through up to six enemies one after another. The cuts land a beat later. |

## The build

After every floor you take one augment out of three. Augments stack. Common ones are numbers (damage, health, focus gain, blade length). Rare ones add a mechanic: critical hits, burning, lightning that jumps on every fourth hit, executions, a longer Overdrive, a Burst that hurts. Event floors pay out rares. Each sector boss pays out a legendary, one copy only: Second Wind refuses one killing blow per floor, Stormcaller strikes the nearest enemy with lightning on every kill, Conduit makes the first power of each wave free. Each boss you beat also raises your maximum health by 10.

Techniques are a fourth kind, one copy each, offered after event floors and now and then elsewhere. A technique changes what a move does: Undertow makes the launcher drag nearby enemies in first, Mirror Guard makes a parry throw the damage back, Nailing Throw makes the thrown saber hold its target in place, Razor Step makes a dash cut, Meteor makes a plunge call down a pillar, and Aerialist adds an air jump and an air dash.

Every card has its own colour and picture. The pause screen lists the build. Killed enemies sometimes leave orbs: green restores health, cyan restores focus.

Everything that falls also leaves shards, the gold diamonds. They are the run's money. A floor's challenge, an objective, a courier and a supply cache pay more of them.

| Where shards and choices go | What it is |
| --- | --- |
| Quartermaster | Sells four cards (a technique, rares and a legendary), a weapon and field repairs. Buy as many as you can pay for. |
| Shrine | Offers three pacts. A pact gives a great deal and takes something back for the rest of the run: Glass Heart is 40% more damage for 30 less health, Hunger heals on every kill and never between waves, Debt is 150 shards now and a tougher tower. You may refuse. |
| Armoury | Trades the weapon in your hand for one of three others. Your build comes with you. A weapon also turns up among the cards now and then. |
| Second Sheath | A legendary. With it the next weapon you take joins the one you hold, T switches between them, and the first hit after a switch lands half again as hard. |
| Boons | A head start chosen before the first floor, earned by feats in earlier runs. The codex on the title screen lists the feats. |

## The run

The tower is built in sectors of ten floors: three in a sprint, ten in the climb. Every sector has the same shape, so a run has a rhythm you can learn. What fills the shape is generated.

| Floor of the sector | What happens |
| --- | --- |
| 1 and 2 | Each introduces one of the sector's two new enemy strains, with a line that says what it is. |
| 3 | Introduces the sector's animal. |
| 4 | Introduces the sector's first bond: a group of enemies that work together. |
| 5 | A champion. Beating it wins a Focus power. |
| 6 | Introduces the sector's second bond. |
| 7 to 9 | Skirmishes. One is an event floor (a horde, an elite squad, a duel, a gauntlet or an ambush), and one or two have an objective. |
| 10 | The sector boss. Beating it wins a legendary augment. |

In the climb, sector I is the school. Its floors teach the eight base enemies with fixed waves and hints: Initiate, Marksman, Bulwark, Duelist, Brute, Lancer, Wraith and Drone. A sprint has no school: every base enemy is there from the first floor, and the tower gets harder about half again as fast.

Five things are hand-made: those teaching waves, the Proctor on the last floor, and three bosses. In the climb the Forgemaster keeps one of sectors II to V, the Twins VI or VII and the Cartographer VIII or IX. A sprint meets one of the three, on floor 20.

### Surprises

Each sector hides one surprise, on a floor you cannot predict and never on a champion's or a keeper's. It breaks in during the floor's last wave.

| Surprise | What happens |
| --- | --- |
| Your Shade | The floor clears, the lights dim, and a dark copy of you drops in with the weapon you hold and the powers you have taken. Every cut it makes is announced and can be parried. It comes once in a sprint and three times in the climb, each time with more of your powers and a longer string. It leaves a legendary. |
| Blackout | The lights go out. Blades, eyes and tells still glow. |
| Bad blood | Two kinds of enemy in the room turn on each other, and their blades cut their own side. |
| A prisoner | A holding cell stands in the room. Break it and another climber fights beside you for the floor. |
| Stampede | A herd runs through from wall to wall, three times, and hits everyone in its way. Jump. |
| Courier | A gold runner carries a card. Cut it down before it gets out. |
| A rival | Another climber, with a weapon of their own, who fights you and the enemies alike. |
| The Spire shifts | Bridges fall, vents open and the walls go live. |
| Storm front | Lightning walks the floor. Every third bolt is aimed at you. |
| Supply drop | A cache lands. Break it open for shards and orbs. |

### Objectives and challenges

Some skirmishes are not won by killing two waves.

| Objective | How to win |
| --- | --- |
| Hold out | They keep coming for about forty seconds. Be alive at the end. |
| The mark | One enemy is marked in gold. Kill it and the rest leave. |
| Hold the ring | Stand in the ring to charge it. When it is full it clears the room. |
| Signal cores | Reinforcements come for as long as a core stands. Break all three. |

About a quarter of the other floors carry a challenge, shown under the floor number: take no damage, clear the floor in time, use no powers, parry three times, kill two enemies in the air, or kill one with the room itself. Meeting it pays shards. A fall forfeits it.

### Doors

After the second, fourth, sixth, eighth and ninth floor of a sector the way up splits into three doors.

| Door | What is behind it |
| --- | --- |
| The Stair | The next floor as it is. |
| Elite Guard | Every enemy on the next floor is an elite. It pays a better card and 40 shards. |
| Cursed Hall | The next floor carries a curse: you take more damage, they are faster, the lights are out, nothing heals between waves, or every wave brings one more. You take two cards after it. |
| Sanctuary | Recover 45% of your health. |
| Quartermaster, Shrine, Armoury | See the build. |
| Unmarked | One of the others, or a gift of shards. |

Before a champion or a keeper the three doors are always rooms, never risks.

### Animals

Each generated sector adds one animal species, generated from one of eight body plans. A knocked-down or dead animal keeps its own body: a hound falls like a hound, a scorpion lands on its back, a flyer folds its wings. Two animals of the same plan from different seeds look like different species: proportions, horns, tails, crests, colour and weapon all vary.

| Plan | What it does | Answer |
| --- | --- | --- |
| Hound | A weak pack hunter that snaps and pounces. Packmates leap over you to come from the other side. | Parry the lunge and kill it fast. |
| Charger | A bull, boar, rhino, ram or elk. Never flinches. Paws the ground, then charges along a red line. | Jump or dash the charge, bait it into a wall, punish. |
| Raptor | A fast two-legged runner. Rakes with a hind claw and leaps to land claws first. | Parry the rake, dash out from under the leap. |
| Stalker | A spider. Darts past you and lunges at your back. | Turn with it and parry. |
| Scorpion | A sting over its head and a slow unblockable impale. | Parry the white sting, dash the red one. |
| Flyer | A bat, hawk or moth that hovers out of reach and swoops. | Jump to meet it or parry the swoop. Any hit drops it. |
| Ape | A knuckle-walker. A looping hook, and a two-fist slam with shockwaves. | Jump the shockwave and punish the long recovery. |
| Spitter | A toad or lizard that keeps its distance and spits. | Parry the spit back, then close in. |

### Bonds

Enemies that arrive as a group are bonded, and the bond decides which one to kill first. Each sector has two bonds, made from its own enemies and introduced with a hint.

| Bond | What it does | How to break it |
| --- | --- | --- |
| Rider | A humanoid sits on a charger or a raptor. | Launch or knock the rider out of the saddle, or kill the mount. A mount that loses its rider goes feral. |
| Pack | A leader makes its pack faster. | Kill the leader: the pack staggers, backs off and attacks less. |
| Ward | A warder cuts the damage its charge takes to a third. A blue thread joins them. | Kill the warder first. |
| Mender | A mender heals its partner through a green thread. | Kill the mender first. |
| Sworn | Two fighters are joined by an orange thread. When one dies the other enrages. | Finish them close together. |
| Cover | A shield carrier stands between you and the shooter it guards. | Get past the shield, or throw something over it. |
| Tandem | One strikes as its partner's attack ends. | Parry twice. |

### Terrain

About half the floors from sector II have terrain.

- Light bridges: platforms you can jump onto for a breather or a plunge. A bridge overloads and drops you after about three seconds of standing on it, and comes back a few seconds later. S + Space drops through.
- Vents: marked strips of floor that erupt on a timer and burn anyone standing there, enemies included.
- Charged walls: a body knocked or thrown into the wall takes a shock.

About one floor in five has a shape of its own.

- Open edges: the floor ends before the wall. An enemy knocked over the edge is gone. Enemies do not walk off, but one that leaps at you while you stand on the lip can carry itself over. A fall costs you a sixth of your health.
- High ground: fixed ledges that do not overload, with the floor's shooters posted on them.
- Sliding bridge: a platform that crosses the room and carries whoever stands on it, with one side of the floor open.
- The lift: both sides open all the way up, and a small bridge sliding over the middle.

A kill made by the room shows ENVIRONMENT and pays extra focus.

### Difficulty

| Setting | What changes |
| --- | --- |
| Student | Enemies deal 30% less, have less health, wait longer between attacks and come in smaller waves. More healing between waves. |
| Adept | The intended climb. |
| Master | Enemies deal 20% more, waves are bigger, one more enemy may attack at once, and a fall restarts the floor instead of the wave. |

## What to look for

- Every hit freezes the game for a few frames, shakes the camera a little, and throws sparks along the blade's path.
- A white flash on an enemy means the attack can be parried. A red flash means it cannot be blocked, so dash through it.
- Using the same move repeatedly lowers its damage. Duelists, some strains and several bosses go further: they read a repeated move family, show ADAPTED, then turn the next one aside and counter.
- After you take damage, part of it stays orange on your health bar for three seconds. Landing hits wins it back.
- A killing blow cuts the body: once for a light hit, twice for a heavy one, three times for a riposte, a charged heavy or anything in Overdrive. Keep hitting the body, or throw your saber through it, and it comes apart further, up to nine pieces.
- Focus is earned by fresh moves, parries and perfect dodges. Stale hits earn none.
- A strain is a base enemy that has drifted: its own body shape, head, colour and blade, one or two traits (fast, unflinching, explosive, vampiric, splitting, regenerating, shielded, or able to read you) and a move list that mixes its own attacks with ones borrowed from other enemies, faster or slower copies, and two attacks joined into a new string.
- Each spawn rolls a temperament: aggressive, cautious, or a flanker that vaults over you. From sector II some spawns are elites with a coloured ring at their feet. Gold is fast, blue does not flinch during wind-ups, orange bursts a second after it dies.
- Now and then a floor has an anomaly that bends one rule: low gravity, frenzy, glass, surge, unstable or bounty. The HUD names it.
- Sector bosses are generated from five fighting schools, with borrowed attacks, two or three phases and set pieces: a leap that lands on a marker, a blink to your back, reinforcements, afterimages, a kneeling heal you can interrupt.
- The Twins share one life, and only the lit one can be hurt. The other still cuts, at reduced damage. They take turns until half health, then stop.
- The Cartographer redraws the floor. First strips that erupt, then a wall of fire that walks across the room with two gaps in it, and in its last phase the whole floor, with three light bridges to stand on.
- A champion or a keeper is announced by name as it lands. A boss kill ends with a finisher: time slows, the camera closes in and the body keeps coming apart.
- The Shade uses copies of your own moves, played slower behind a held wind-up. Change weapon or take different powers and the next Shade fights differently.
- A first-time player gets a parry lesson on floor 1: the instructor cannot be hurt until you parry it once.
- The Forgemaster's hammer heats through each string. You can parry it until it glows white. When it vents steam, hit it.
- The Proctor kneels to heal at 45% and 20% health. Any hit interrupts it and breaks its posture. The saber throw reaches it from across the room.

## Tests and tools

| Command | What it does | Time |
| --- | --- | --- |
| `npm test` | Runs the simulation tests, then the benchmark. Fails on a broken rule or a missed performance budget. | about 10 s |
| `node --test tests/` | Simulation tests only: seeded replays are identical, generated runs of both lengths obey the rules, generated moves keep their telegraphs, bosses can be beaten, and the build, the powers, the cards, saved runs, bonds, terrain, techniques, the weapons, the animals, every surprise, every objective, the doors and rooms, pacts, the Shade and the shaped rooms behave. | about 40 s |
| `npm run bench` | The benchmark alone, in report mode (prints, never fails). | about 7 s |
| `npm run fuzz` | Long soak: random input on sample floors, bosses, every surprise and every objective, then scripted players of three skill levels play sprints and climb all hundred floors on each difficulty. Prints falls per sector. `node tools/fuzz.js quick` stops after the sprints. | an hour, or a few minutes for `quick` |
| `npm run smoke` | Drives the real game in headless Chrome, reports runtime errors and frame times, and writes screenshots to `tools/out/`. | about 2 min |
| `node tools/strip.js [name]` | Writes frame-by-frame contact sheets of moves to `tools/out/`. | seconds each |
| `node tools/form-strip.js [form]`, `node tools/form-dps.js` | Contact sheets of each weapon form's strings, and its damage measured against the saber. | |
| `node tools/beast-shot.js` | A line-up of every animal plan, several seeds of each, and strips of gaits and attacks. | |
| `node tools/audio-test.js` | Measures every sound in headless Chrome and fails on silence, clipping or errors. With `npm start` running, http://localhost:5173/tools/audio-test.html is a soundboard. | |
| `node tools/arena-shot.js` | Screenshots each arena at several camera positions and seeds. Needs `node tools/serve.js 5182` running. | |

The benchmark renders in headless Chrome with GPU acceleration turned off, which stands in for a weak machine. It checks milliseconds per frame, and also draw calls and megapixels drawn per frame, which do not depend on the machine. The browser tools need Chrome and `npm install` (for `puppeteer-core`). Without them the benchmark runs its simulation half and skips the rest.

## Layout

| Path | Contents |
| --- | --- |
| `src/game/` | Simulation. It has no DOM access, so it runs in Node. `fighter.js` is the shared body, `moves.js` holds every attack as data and builds the generated variants, `combat.js` resolves hits, `enemies.js` holds the base roster and all the brains, `strains.js` generates a run's strains, champions and bosses, `beasts.js` is the animal rig and its generator, `bonds.js` links enemies, `gen.js` generates the floors of a run and lays surprises, objectives, challenges, shaped rooms and doors over them, `encounters.js` is the director that runs a floor and everything between floors, `surprises.js` is what each surprise does, `shade.js` builds the Shade and the other climbers from the player's own moves, `props.js` holds the breakable things, `forms.js` holds the weapons, `augments.js`, `powers.js` and `boons.js` are the build. |
| `src/core/` | Input, maths, and `meta.js`: what carries over between runs. |
| `src/render/` | Canvas 2D renderer, effects, and the baked arenas. |
| `src/audio/` | Web Audio synthesis. The game ships no audio files. |
| `src/ui/` | HUD, menus, the draft screen and touch controls. |
| `tests/` | Fast simulation tests. |
| `tools/` | Dev server, benchmark and review tools. |
