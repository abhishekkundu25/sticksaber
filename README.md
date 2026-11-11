# STICKSABER

A side-view action game for the browser. You are a stick figure with an energy sword, climbing a tower one arena at a time.

This is the combat prototype. It has the full player moveset, five enemy types, one boss, three arenas and a training room. The plan for the full game is in [docs/DESIGN.md](docs/DESIGN.md).

## Run it

```
npm start
```

Then open http://localhost:5173. The game uses ES modules, so it needs a local server. Opening `index.html` from disk does not work. There is no build step, and the game has no runtime dependencies.

Start in the training room if you want to judge the movement before fighting anything that hits back. Keys 1 to 6 spawn each enemy type there.

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
| Pause | Esc | Start |

Fullscreen is F. Mute is M.

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

## What to look for

- Every hit freezes the game for a few frames, shakes the camera a little, and throws sparks along the blade's path.
- A white flash on an enemy means the attack can be parried. A red flash means it cannot be blocked, so dash through it.
- Using the same move repeatedly lowers its damage. Duelists and the boss go further: they read a repeated move family, show ADAPTED, then turn the next one aside and counter.
- After you take damage, part of it stays orange on your health bar for three seconds. Landing hits wins it back.
- The boss kneels to heal at 45% and 20% health. Any hit interrupts it and breaks its posture. The saber throw reaches it from across the room.

## Tools

| Command | What it does |
| --- | --- |
| `npm run fuzz` | Runs the simulation headless at 120 Hz with random input and with scripted players of different skill. Fails on any exception or non-finite value, and prints clear times per floor. |
| `npm run smoke` | Drives the real game in headless Chrome, reports runtime errors and frame times, and writes screenshots to `tools/out/`. |
| `node tools/strip.js [name]` | Writes frame-by-frame contact sheets of moves to `tools/out/`. |

The smoke and strip tools need Chrome and `npm install` (for `puppeteer-core`).

## Layout

| Path | Contents |
| --- | --- |
| `src/game/` | Simulation. It has no DOM access, so it runs in Node. `fighter.js` is the shared body, `moves.js` holds every attack as data, `combat.js` resolves hits, `enemies.js` holds the roster and AI. |
| `src/render/` | Canvas 2D renderer, effects, and the baked arenas. |
| `src/audio/` | Web Audio synthesis. The game ships no audio files. |
| `src/ui/` | HUD and menus. |
| `tools/` | Dev server and test tools. |
