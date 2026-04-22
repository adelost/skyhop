# skyhop

3D platformer PoC — SvelteKit + Three.js + Rapier. Mario 64-inspirerad physics playground.

## Run

```bash
bun install
bun run dev
```

Deploy: `bunx wrangler pages deploy .svelte-kit/cloudflare --project-name=skyhop`
Live: https://skyhop-4ok.pages.dev

## Stack

- SvelteKit 2 + Svelte 5 (runes)
- Three.js (raw) — rendering
- Rapier3d — physics + kinematic character controller
- nipplejs — mobile touch joystick
- Cloudflare Pages — edge deploy
- Fixed 60Hz timestep — deterministic

## Controls

**Desktop**
- WASD / arrows: rörelse
- Space: jump (hold = högre)
- Shift (håll) + space: long jump (om running) / backflip (stillastående)
- Flip stick 180° + space medan running: side flip
- E: dive (i luft, med fart) / punch (grounded)
- Shift tap i luft: ground pound
- T: toggle tuning panel
- R: respawn

**Mobile**
- Joystick (nedre vänstra): rörelse
- JUMP: hopp (tap snabbt efter landing = double/triple)
- DUCK + JUMP: long/backflip
- ACT: dive (i luft + fart) / ground pound (i luft utan fart)

## Moveset (impulse-baserat)

| Move | Trigger | Vy | VXZ |
|------|---------|----|----|
| Normal jump | grounded + jump | 10 | behåller |
| Double | jump <300ms efter landing + fwd | 12 | behåller |
| Triple | jump <300ms efter double-landing | 14 | behåller |
| Long jump | crouch + running + jump | 7 | 14 i riktning |
| Backflip | crouch + still + jump | 14 | −6 (bakåt) |
| Side flip | stick-flip + running + jump | 13 | ny riktning |
| Wall kick | jump <200ms efter wall-touch | 11 | 8 från vägg |
| Ground pound | crouch tap / action (still) i luft | −25 | 0 |
| Dive | action + running i luft | 3 | 12 fwd |

## Physics features

- Live-tunable config (25 sliders, T-toggle)
- Coyote time + jump buffering
- Variable jump height
- Slope detection + slide (>38°) + downhill momentum boost
- Ice surface (10% friction via config)
- Moving platforms (kinematic)
- Debug HUD: state/surface/velocity/speed/grounded/FPS

## Test-arena

4 sluttningar (15/30/45/60°), gaps (3/5/7m), bump-head-tak, ice-patch, hög plattform, moving Y-bounce platform, wall för wall-kick.

## Structure

```
src/lib/game/
  engine.ts          # renderer, game loop, camera
  physics.ts         # rapier wrapper
  input.ts           # unified keyboard + touch
  player.ts          # state machine + all moves
  world.ts           # test arena + moving platforms
  config.svelte.ts   # reactive physics config ($state)
src/lib/hud/
  debug-hud.svelte   # live debug overlay
  tuning-panel.svelte # slider panel
```

## Roadmap

1. ✅ Fas 1 — loop + one level + mobile
2. ✅ Physics playground — moveset + tuning + test arena
3. Camera — Lakitu-style follow + manual rotate + collision shrink
4. Content — multiple levels, coins, stars
5. Persistence — leaderboards via Cloudflare D1
