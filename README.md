# skyhop

3D platformer PoC — SvelteKit + Three.js + Rapier.

## Run

```bash
bun install
bun run dev
```

## Stack

- **SvelteKit 2 + Svelte 5** — routing, HUD, backend hook
- **Three.js** (raw) — rendering
- **Rapier3d** — physics + kinematic character controller
- **nipplejs** — mobile touch joystick
- **Cloudflare adapter** — edge deploy
- **Biome** — lint/format
- **Fixed timestep** (60Hz) — deterministic, replay/multiplayer-ready

## Controls

- **Desktop**: WASD/arrows, Space to jump
- **Mobile**: left half = virtual joystick, right button = jump

## Structure

```
src/lib/game/
  engine.ts     # renderer, game loop, camera
  physics.ts    # rapier wrapper
  input.ts      # unified keyboard + touch
  player.ts     # kinematic character controller
  world.ts      # level data + mesh/collider build
```

## Roadmap

1. ✅ Loop, one level, jump, mobile-ready — **Fas 1**
2. Platformer feel: coyote time ✓, jump buffering ✓, variable jump ✓; next: double jump, wall-jump
3. Content: multiple levels, collectibles, timer, menu
4. Persistence: leaderboards via Cloudflare D1
5. Level editor in browser, shareable URLs
