# STICKSABER

A side-view action game for the browser. You are a stick figure with an energy sword, climbing a hundred-floor tower one arena at a time.

Every run is generated from a seed: the enemy strains, the champions and sector bosses, the waves, the arenas and their colours. Between floors you draft augments into a build, and you win Focus powers from champions. The game has three difficulties, six arena families, a training room and touch controls. The design notes are in [docs/DESIGN.md](docs/DESIGN.md).

## Play it

https://abhishekkundu25.github.io/sticksaber/

## Run it locally

```
npm start
```

Then open http://localhost:5173. The game uses ES modules, so it needs a local server. Opening `index.html` from disk does not work. There is no build step, and the game has no runtime dependencies.

Start in the training room if you want to judge the movement before fighting anything that hits back. Every power is unlocked there, the number keys spawn each enemy type, `[` spawns a generated strain, `]` a champion and `\` a sector boss.

A run is saved at the start of every floor: seed, difficulty, floor and build. The menu offers CONTINUE from there. A hundred floors take a scripted player about an hour and a half, so expect several sittings.

| Address parameter | Effect |
| --- | --- |
| `?seed=ABC123` | Replay or share a specific run. The seed is shown on the pause and results screens. |
| `?diff=easy`, `normal` or `hard` | Set the difficulty. |
| `?floor=40` | Start a new run on that floor, with the picks the run would have made on the way up. |

## Controls

| Action | Keyboard | Gamepad |
| --- | --- | --- |
| Move | A / D or arrow keys | Stick or d-pad |
| Jump, double jump | Space or W | A |
| Dash (brief invulnerability) | Shift | B |
| Light attack | J (or left mouse) | X |
| Heavy attack, hold to charge | K (or right mouse) | Y |
| Guard, tap on impact to parry | L | RB |
| Use the selected Focus power | I | LB |
| Switch power | U, or 1 to 9 | LT |
| Burst (costs 1 focus, while being hit or knocked down) | I | LB |
| Overdrive (needs a full focus meter) | O | Click either stick |
| Pause | Esc | Start |

Fullscreen is F. Mute is M. G cycles graphics quality between auto, high and low.

### Phones and tablets

Hold the device in landscape. The first touch switches on the touch controls; a desktop never shows them.

- Tap a menu item or a draft card to choose it.
- The left thumb gets a stick that appears wherever it lands. Left and right move. Pulling down is the same as S: stick down plus HEAVY launches on the ground and plunges in the air.
- The right thumb gets LIGHT, HEAVY, JUMP, DASH, GUARD, OVERDRIVE and the power button. The power button carries the name of the selected power. SWAP, which appears once you own a second power, changes it. While you are being hit the power button grows, glows and reads BURST. OVERDRIVE lights up when the meter is full.
- The pause button is at the top centre. In the training room a SPAWN button adds an enemy.
- Phones render at 720p internally.

## Moves

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

The pause screen lists the build. Killed enemies sometimes leave orbs: green restores health, cyan restores focus.

## The hundred floors

The tower has ten sectors of ten floors. Every sector has the same shape, so a run has a rhythm you can learn. What fills the shape is generated.

| Floor of the sector | What happens |
| --- | --- |
| 1 and 2 | Each introduces one of the sector's two new enemy strains, with a line that says what it is. |
| 3 and 4 | Skirmishes. |
| 5 | A champion. Beating it wins a Focus power. |
| 6 to 9 | Skirmishes. One is an event floor: a horde, an elite squad, a duel, a gauntlet or an ambush. |
| 10 | The sector boss. Beating it wins a legendary augment. |

Sector I is the school. Its floors teach the eight base enemies with fixed waves and hints: Initiate, Marksman, Bulwark, Duelist, Brute, Lancer, Wraith and Drone.

Three things are hand-made: those teaching waves, the Forgemaster (who keeps one sector from II to V, a different one each run) and the Proctor on floor 100.

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
- The Forgemaster's hammer heats through each string. You can parry it until it glows white. When it vents steam, hit it.
- The Proctor kneels to heal at 45% and 20% health. Any hit interrupts it and breaks its posture. The saber throw reaches it from across the room.

## Tests and tools

| Command | What it does | Time |
| --- | --- | --- |
| `npm test` | Runs the simulation tests, then the benchmark. Fails on a broken rule or a missed performance budget. | about 10 s |
| `node --test tests/` | Simulation tests only: seeded replays are identical, sixty generated runs obey the rules, generated moves keep their telegraphs, bosses can be beaten, and the build, the powers, the draft and saved runs behave. | about 3 s |
| `npm run bench` | The benchmark alone, in report mode (prints, never fails). | about 7 s |
| `npm run fuzz` | Long soak: random input on sample floors and bosses, then scripted players of three skill levels climb all hundred floors on each difficulty. Prints falls per sector. | several minutes |
| `npm run smoke` | Drives the real game in headless Chrome, reports runtime errors and frame times, and writes screenshots to `tools/out/`. | about 2 min |
| `node tools/strip.js [name]` | Writes frame-by-frame contact sheets of moves to `tools/out/`. | seconds each |
| `node tools/audio-test.js` | Measures every sound in headless Chrome and fails on silence, clipping or errors. With `npm start` running, http://localhost:5173/tools/audio-test.html is a soundboard. | |
| `node tools/arena-shot.js` | Screenshots each arena at several camera positions and seeds. Needs `node tools/serve.js 5182` running. | |

The benchmark renders in headless Chrome with GPU acceleration turned off, which stands in for a weak machine. It checks milliseconds per frame, and also draw calls and megapixels drawn per frame, which do not depend on the machine. The browser tools need Chrome and `npm install` (for `puppeteer-core`). Without them the benchmark runs its simulation half and skips the rest.

## Layout

| Path | Contents |
| --- | --- |
| `src/game/` | Simulation. It has no DOM access, so it runs in Node. `fighter.js` is the shared body, `moves.js` holds every attack as data and builds the generated variants, `combat.js` resolves hits, `enemies.js` holds the base roster and all the brains, `strains.js` generates a run's strains, champions and bosses, `gen.js` generates the hundred floors, `augments.js` and `powers.js` are the build. |
| `src/render/` | Canvas 2D renderer, effects, and the baked arenas. |
| `src/audio/` | Web Audio synthesis. The game ships no audio files. |
| `src/ui/` | HUD, menus, the draft screen and touch controls. |
| `tests/` | Fast simulation tests. |
| `tools/` | Dev server, benchmark and review tools. |
