# Debt Run Heist Prototype

Playable 3D browser prototype for a debt-driven stealth heist loop.

## Run

Serve this folder locally:

```powershell
python -m http.server 8787 --bind 127.0.0.1
```

Then visit `http://127.0.0.1:8787/`.

Three.js is vendored in `vendor/three.module.js`, so the prototype does not need a CDN while running.

## Controls

- `WASD` / arrow keys: move
- `Shift`: sneak; hold while taking loot to swap a duplicate when available
- `Space`: rush, louder
- `E`: take loot / exit
- `Q`: throw noisemaker
- `F`: ready lockpick prompt near locked loot

## Prototype Features

- Simple low-poly 3D safehouse and heist scenes
- Randomized loot values with higher value on higher-risk items
- Guard sight cones, line-of-sight checks, suspicion timers, noise investigation, and radio backup
- Guard patrol lanes with fallback navigation toward sounds and player sightings
- Alarmed and locked high-value loot
- Duplicate swapping that takes longer but creates less heat
- Shop tools: lockpicks, alarm diffusers, noisemakers, duplicates, bag upgrades
- Safehouse loop with sell/fence payout, debt payment, and furniture upgrades
- Purchased tools/furniture gain UI highlights, and furniture appears as safehouse objects
