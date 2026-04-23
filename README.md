# skyhop

3D platformer physics playground med Mario 64-tunad feel. SvelteKit + Three.js + Rapier.

Live: **https://skyhop-4ok.pages.dev**

## Run

```bash
bun install
bun run dev        # http://localhost:5173
bun run check      # svelte-check
bun run build      # production build
```

Deploy: `bunx wrangler pages deploy .svelte-kit/cloudflare --project-name=skyhop`

## Stack

- **SvelteKit 2 + Svelte 5 (runes)** — UI + config store
- **Three.js** — rendering (raw, no r3f)
- **Rapier3d** (`@dimforge/rapier3d-compat`) — physics + kinematic character controller
- **nipplejs** — mobile touch joystick
- **Cloudflare Pages** — edge deploy
- **Fixed 60Hz physics timestep** — deterministic, replay/multiplayer-ready

## Controls

### Desktop

| Action | Input |
|--------|-------|
| Move | WASD / arrows (camera-relative) |
| Jump (variable height) | Space — hold for full height |
| Long jump | Shift held + running + Space |
| Backflip | Shift held + stationary + Space |
| Side flip | Run one way + reverse stick + Space |
| Double/triple jump | Space within 167ms of landing + forward speed |
| Wall kick | Space within 167ms of wall-touch while airborne |
| Ground pound | Shift tap in air (or E in air with no speed) |
| Dive | E in air with speed |
| Camera yaw + pitch | Drag anywhere on canvas |
| Camera zoom | Scroll wheel |
| Pointer-lock cam | Right-click canvas (toggle) |
| First-person toggle | V |
| Recenter camera | C |
| Respawn | R |
| Tuning panel | T |

### Mobile

| Action | Input |
|--------|-------|
| Move | Virtual joystick (nipplejs, bottom-left) |
| Jump | JUMP button |
| Long/backflip | DUCK button held + JUMP |
| Dive / pound | ACT button (context-sensitive by airborne speed) |
| Camera | Drag anywhere (except buttons) |
| Zoom | Pinch |
| Recenter | ↺ button (top-right) |

### Tuning panel

`T` toggles a live-sliders overlay with **50+ parameters** (physics, camera, visual, ledge, skid, effects). Changes apply immediately. Reset button returns to M64-tuned defaults.

## Physics — M64 decomp-tuned

All velocities in m/s. Source values from `n64decomp/sm64` converted via
`units/frame × 30 × 0.01 = m/s` (M64 runs at 30 FPS, 1 unit ≈ 0.01 m).

| Quantity | Value | M64 source |
|----------|-------|------------|
| Max run speed | 9.6 m/s | 32 u/f |
| Gravity | −36 m/s² | −4 u/f² |
| Terminal velocity | 22.5 m/s | −75 u/f |
| Single jump Vy | 12.6 + 0.25·speed | 42 u/f + 0.25·fVel |
| Double jump Vy | 15.6 + 0.2·speed | 52 u/f + 0.2·fVel |
| Triple jump Vy | 20.7 (flat) | 69 u/f |
| Long jump | Vy=9, VXZ=14.4 | 30 u/f / 48 u/f |
| Backflip | Vy=18.6, VXZ=−4.8 | 62 / −16 u/f |
| Side flip | Vy=18.6, VXZ=2.4 | 62 / 8 u/f |
| Wall kick | Vy=18.6, VXZ=7.2 | 62 / 24 u/f |
| Ground pound | Vy=−15 | −50 u/f |
| Dive | Vy=0, VXZ=14.4 | inherits / 48 u/f |
| Chain window | 167 ms | 5 frames |
| Wall-kick window | 167 ms | 5 frames |
| Slope slide threshold | 20° | NORMAL class |
| Variable jump cut | gravity ×4 on release | `should_strengthen_gravity_for_jump_ascent` |

Modern concessions not in M64: coyote time (80ms) and jump buffer (80ms).

## Feature matrix

**Movement**
- Coyote time + jump buffering
- Variable jump (M64-style gravity multiplier, not velocity cut)
- Skid-turn (reverse >120° at speed → 350ms brake-lean state)
- Crouch-slide (shift on slope = belly glide)
- Dash-slide (shift tap while running = belly slide)
- Slope detection with multi-probe raycast + downhill boost on walkable slopes
- Steep slope (≥20°) = forced slope_slide, no traction
- Ice surface (low friction via config)
- Moving platforms carry player when standing on them
- Running-jump height bonus
- Wall slide with clinging (reduced gravity vs wall)
- Wall kick with same-wall lockout (M64 alternation)
- Ledge grab (3-raycast detection + intent gate)
- Ledge shimmy along wall tangent
- Ledge pull-up with clearance verification + 420ms animation
- Same-state respawn reset (no ghost coyote/combo/wall-kick)

**Camera**
- Lakitu-orbit follow behind player (yaw + pitch + distance)
- Drag-to-rotate (dead zone 3px)
- Scroll / pinch zoom (4-18m)
- Pointer-lock opt-in (right-click)
- First-person toggle (V)
- Auto-recenter only when: >3s idle + speed >2 m/s + yaw-drift >0.8 rad
- Look-ahead target offset in velocity direction
- Y-stabilization during short hops (300ms)
- Speed-adaptive FOV + distance (subtle)
- Ledge-hang framing lift
- Collision shrink (wall in cam path → shorten)
- Ground-pound shake

**Visuals**
- Nested mesh: outer (physics position) → inner (rotation/scale/offset)
- Body capsule + nose cone + eyes
- Full Euler rotation (YXZ order) for flips
- Triple-jump forward somersault, backflip backward somersault, side-flip pirouette, ground-pound fast tumble
- Long-jump / dive = body horizontal
- Wall-slide pose (legs to wall, head away)
- Ledge-hang pose (hands into wall)
- Crouch scale-from-feet (pivot offset so fötter stannar på marken)
- Blob shadow under player (fades with height)
- Dust puffs on land / skid / pound (pooled, no GC)
- Landing squash (scale.y pulse on hard fall)
- Warmer sun + cooler sky for readable lit/shaded separation

**Feel**
- Haptic feedback (mobile) on jump, wall-kick, dive, pound, ledge-grab, pull-up, hard-land
- Combo-ready glow on JUMP button (yellow) during double/triple window
- Wall-kick-ready glow (purple) during wall-stick window

## File structure

```
src/lib/game/
  engine.ts              # renderer, fixed-step loop, camera system, effects orchestration
  physics.ts             # Rapier world init
  input.ts               # unified keyboard + touch → InputState snapshots
  world.ts               # test arena geometry + moving platforms
  effects.ts             # BlobShadow + DustPool
  config.svelte.ts       # reactive config store (all tunables, M64 defaults)
  player.ts              # Player class — state machine, step(), event flags
  player-constants.ts    # RADIUS + HEIGHT (shared by all helper modules)
  player-mesh.ts         # THREE.js mesh construction
  player-queries.ts      # pure raycast helpers (ground, wall, ledge, clearance)
  player-jumps.ts        # computeJump() + computeWallKick() — pure impulse selection
  player-visuals.ts      # computePose() — state → render transform
src/lib/hud/
  debug-hud.svelte       # live readout: state / vel / speed / slope / FPS
  tuning-panel.svelte    # slider grid bound to config
src/routes/
  +page.svelte           # canvas mount, input bindings, camera gesture handlers
  +layout.svelte         # root layout
```

## Test arena

Procedurally placed obstacles in `world.ts`:

- Flat ground 30×30
- Slopes at 15°, 30°, 45°, 60° (steep ones force slope_slide)
- Wall piece (5×8m) for wall-kick chains
- Gaps at 3/5/7m for jump-distance testing
- Stepped platform 4-tier for combo jumps
- Low ceiling (bump-head test)
- Ice patch (low friction)
- Kinematic moving platform (Y-bounce, carries player)

## State machine

`PlayerState`: `grounded | airborne | wall_slide | ground_pound | dive | long_jump | backflip | side_flip | slope_slide | crouch_slide | skid | ledge_hang`

All state transitions are in `player.ts` `step()`. Some states are "momentum-locked" (no input→velocity accel) to preserve the impulse they were entered with: long_jump, side_flip, dive, ground_pound, slope_slide, crouch_slide, skid.

## Extension points

- Add a new surface: extend `Surface` in `world.ts`, add a `friction < 0.1` check in `queryGroundSurface`, add label in debug HUD
- Add a new move: add state to `PlayerState`, add pose branch in `player-visuals.ts computePose()`, handle velocity/state in `player.ts step()` — or for jumps add a branch in `player-jumps.ts computeJump()`
- Add a new effect: extend `effects.ts` with another class, wire into `engine.ts` loop, consume via player event flags (see `consumePoundImpact()` pattern)

## Roadmap

- ✅ Fas 1 — loop + mobile + fixed timestep
- ✅ Playground — full moveset + M64-tuned physics + test arena
- ✅ Camera — Lakitu orbit + look-ahead + zoom + pitch + first-person + smarter recenter
- ✅ Visuals Fas 1 — blob shadow + dust + landing squash + lit/shaded rebalance
- 🔜 Visuals Fas 2 — mittens + foot-nubs + state-specific procedural poses
- 🔜 Visuals Fas 3 (desktop) — directional shadow map + rim light + vertex-gradients
- Level content — coins, stars, enemies, actual levels
- Persistence — leaderboards via Cloudflare D1
