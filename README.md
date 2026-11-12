# STICKSABER

A side-view action game for the browser. You are a stick figure with an energy sword, climbing a ten-floor tower one arena at a time.

The game has the full player moveset, eight enemy types, two bosses, three arena families with seeded variants, and a training room. Every run is generated from a seed, so no two climbs are the same. The design notes are in [docs/DESIGN.md](docs/DESIGN.md).

## Play it

https://abhishekkundu25.github.io/sticksaber/

## Run it locally

```
npm start
```

Then open http://localhost:5173. The game uses ES modules, so it needs a local server. Opening `index.html` from disk does not work. There is no build step, and the game has no runtime dependencies.

Start in the training room if you want to judge the movement before fighting anything that hits back. The number keys spawn each enemy type there.

Your progress is the highest floor you have reached. It is saved in the browser, and the menu offers CONTINUE from that floor. Add `?seed=ABC123` to the address to replay or share a specific run. The seed of the current run is shown on the pause and results screens.

## Controls

| Action | Keyboard | Gamepad |
| --- | --- | --- |
| Move | A / D or arrow keys | Stick or d-pad |
| Jump, double jump | Space or W | A |
| Dash (brief invulnerability) | Shift | B |
| Light attack | J (or left mouse) | X |
| Heavy attack, hold to charge | K (or right mouse) | Y |
| Guard, tap on impact to parry | L | RB |
| Throw saber (costs 1 focus) | I | LB |
| Burst (costs 1 focus, while being hit or knocked down) | I | LB |
| Overdrive (needs a full focus meter) | O | Click either stick |
| Pause | Esc | Start |

Fullscreen is F. Mute is M. G cycles graphics quality between auto, high and low.

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
| Overdrive | O with all three focus pips | Six seconds of a longer, faster blade. Nothing goes stale or gets read, and each hit returns 1.5 health. Taking a hit ends it. |

## The ten floors

| Floor | Arena | Introduces |
| --- | --- | --- |
| I | Spire Causeway | Initiate |
| II | Rain Gallery | Marksman |
| III | Signal Bridge | Bulwark |
| IV | Foundry Nine | Duelist, Brute |
| V | The Anvil | Boss: the Forgemaster |
| VI | Slag Works | Lancer |
| VII | Hall of Echoes | Wraith |
| VIII | The Long Gallery | Drone, elite enemies |
| IX | Antechamber | Four generated waves of everything |
| X | Examination Hall | Boss: the Proctor |

The first wave that introduces an enemy is fixed and comes with a hint. Every other wave is generated from the run's seed.

## What to look for

- Every hit freezes the game for a few frames, shakes the camera a little, and throws sparks along the blade's path.
- A white flash on an enemy means the attack can be parried. A red flash means it cannot be blocked, so dash through it.
- Using the same move repeatedly lowers its damage. Duelists and the Proctor go further: they read a repeated move family, show ADAPTED, then turn the next one aside and counter.
- After you take damage, part of it stays orange on your health bar for three seconds. Landing hits wins it back.
- A killing blow cuts the body: once for a light hit, twice for a heavy one, three times for a riposte, a charged heavy or anything in Overdrive. Keep hitting the body, or throw your saber through it, and it comes apart further, up to nine pieces.
- Focus is earned by fresh moves, parries and perfect dodges. Stale hits earn none.
- Enemies learn extra attacks on higher floors, and each one rolls a temperament when it spawns: aggressive, cautious, or a flanker that vaults over you.
- From floor VIII some enemies are elites with a coloured ring at their feet. Gold is fast, blue does not flinch during wind-ups, orange bursts a second after it dies.
- The Forgemaster's hammer heats through each string. You can parry it until it glows white. When it vents steam, hit it.
- The Proctor kneels to heal at 45% and 20% health. Any hit interrupts it and breaks its posture. The saber throw reaches it from across the room.

## Tests and tools

| Command | What it does | Time |
| --- | --- | --- |
| `npm test` | Runs the simulation tests, then the benchmark. Fails on a broken rule or a missed performance budget. | about 6 s |
| `node --test tests/` | Simulation tests only: seeded replays are identical, generated waves obey the rules across 300 seeds, move data is well formed, both bosses can be beaten, and Burst, Overdrive and chopping follow their rules. | under 1 s |
| `npm run bench` | The benchmark alone, in report mode (prints, never fails). | about 5 s |
| `npm run fuzz` | Long soak: random input on every floor, then scripted players of four skill levels climb the whole tower. Prints clear times and falls per floor. | minutes |
| `npm run smoke` | Drives the real game in headless Chrome, reports runtime errors and frame times, and writes screenshots to `tools/out/`. | about 2 min |
| `node tools/strip.js [name]` | Writes frame-by-frame contact sheets of moves to `tools/out/`. | seconds each |
| `node tools/audio-test.js` | Measures every sound in headless Chrome and fails on silence, clipping or errors. With `npm start` running, http://localhost:5173/tools/audio-test.html is a soundboard. | |
| `node tools/arena-shot.js` | Screenshots each arena at several camera positions and seeds. Needs `node tools/serve.js 5182` running. | |

The benchmark renders in headless Chrome with GPU acceleration turned off, which stands in for a weak machine. It checks milliseconds per frame, and also draw calls and megapixels drawn per frame, which do not depend on the machine. The browser tools need Chrome and `npm install` (for `puppeteer-core`). Without them the benchmark runs its simulation half and skips the rest.

## Layout

| Path | Contents |
| --- | --- |
| `src/game/` | Simulation. It has no DOM access, so it runs in Node. `fighter.js` is the shared body, `moves.js` holds every attack as data, `combat.js` resolves hits, `enemies.js` holds the roster and AI, `gen.js` generates a run from a seed. |
| `src/render/` | Canvas 2D renderer, effects, and the baked arenas. |
| `src/audio/` | Web Audio synthesis. The game ships no audio files. |
| `src/ui/` | HUD and menus. |
| `tests/` | Fast simulation tests. |
| `tools/` | Dev server, benchmark and review tools. |
