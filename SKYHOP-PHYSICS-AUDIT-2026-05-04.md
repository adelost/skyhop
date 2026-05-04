# Skyhop physics audit vs M64 decomp

**Audit date:** 2026-05-04
**Audited at HEAD:** `f90da6e` (revert side flip to simple forward somersault)
**Decomp source:** `~/lsrc/sm64-decomp/` (vendored from `n64decomp/sm64`, 86 MB, persistent)
**Auditor:** claw:p4 (cross-check of Agentus/claw:p? rotation work)

## Status

8 source-verified deviations from M64 reference values found in jump physics.
**No fixes applied yet** — list is delivered as a worklist for whoever picks
this up. Coordinate with whoever is editing `player-jumps.ts` /
`player-visuals.ts` / `config.svelte.ts` before applying.

## Coordination warning

Multiple agents have been touching skyhop physics in parallel (rotation
fidelity work + this physics-value audit). Before editing:

```bash
ax done --since 4h | grep -E "skyhop|player-(jumps|visuals)"
git -C ~/lsrc/skyhop log --oneline -10
```

If another agent has WIP on the same file → ping them, don't overwrite.

## Findings

Unit conversion: M64 `u/f` (units per frame at 30 FPS) × 0.3 = m/s.
All `M64` refs are in `~/lsrc/sm64-decomp/src/game/`.
All `SKYHOP` refs are at HEAD `f90da6e`.

### #1 — `runDoubleJumpBonus = 0.2`, should be `0.25`

**M64** `mario.c:786`: `set_mario_y_vel_based_on_fspeed(m, 52.0f, 0.25f)` — double jump uses the same 0.25 forward-speed multiplier as the single jump (`mario.c:824`).

**SKYHOP** `config.svelte.ts:206`: `runDoubleJumpBonus: 0.2`. Single jump is 0.25, double is 0.2 — arbitrary asymmetry.

**Effect:** double jump at full run speed loses ~3% apex.

**Fix:** `runDoubleJumpBonus: 0.25`.

### #2 — Missing `forwardVel *= 0.8f` on jumps

**M64** reduces XZ velocity to 80% on takeoff for:
- single (`mario.c:825`): `m->forwardVel *= 0.8f;`
- double (`mario.c:787`): same
- triple (`mario.c:798`): same

**SKYHOP** preserves 100% of XZ on every jump variant (`player-jumps.ts:106` triple, `player-jumps.ts:115-117` double, `player-jumps.ts:127-129` single):
```ts
velocity: { x: velocity.x, ... z: velocity.z }
```

**Effect:** all jumps carry farther horizontally than M64. Most pronounced on triple (full-speed-preservation from running).

**Fix:** multiply incoming `velocity.x` and `velocity.z` by 0.8 in all three branches.

### #3 — Long jump XZ is fixed 14.4 m/s

**M64** `mario.c:870-872`:
```c
if ((m->forwardVel *= 1.5f) > 48.0f) {
    m->forwardVel = 48.0f;
}
```
Multiply incoming `forwardVel` by 1.5×, cap at 48 u/f = 14.4 m/s.

**SKYHOP** `player-jumps.ts:57-59`: `velocity.x = dirX * config.longJumpVelXZ` (always 14.4, regardless of incoming speed).

**Effect:** crouch-slide at 6 m/s → long jump:
- M64: 6 × 1.5 = 9 m/s
- Skyhop: 14.4 m/s (cap-value always)

→ Long jumps overshoot at medium running speeds.

**Fix:** `velocity.x = dirX * Math.min(horizSpeed * 1.5, config.longJumpVelXZ)` (and same for z).

### #4 — Dive zeroes vertical velocity

**M64** `mario.c:856-861`: `act_dive` set_mario_action_airborne handler does NOT touch `m->vel[1]` — preserves whatever the y-velocity was before dive triggered.

**SKYHOP** `config.svelte.ts:101`: `diveVelY: 0` snaps vertical to zero.

**Effect:** dive while ascending drops straight in Skyhop. M64-dive can carry briefly upward. Tap-jump → dive should bridge over a small gap; in Skyhop it commits to falling immediately.

**Fix:** in player-jumps.ts dive branch, replace `y: config.diveVelY` with `y: velocity.y` to preserve.

### #5 — Dive XZ is fixed 14.4 m/s

**M64** `mario.c:857-860`:
```c
if ((forwardVel = m->forwardVel + 15.0f) > 48.0f) {
    forwardVel = 48.0f;
}
```
Add 15 u/f = 4.5 m/s boost to current `forwardVel`, cap at 48 u/f = 14.4 m/s.

**SKYHOP** `config.svelte.ts:102`: `diveVelXZ: 14.4` (fixed).

**Effect:** dive at 6 m/s incoming:
- M64: 6 + 4.5 = 10.5 m/s
- Skyhop: 14.4 m/s

→ Dive feels like a cannon blast at slow speeds rather than a momentum boost.

**Fix:** in player-jumps.ts dive branch, compute `dirX * Math.min(horizSpeed + 4.5, config.diveVelXZ)`.

### #6 — Wall kick XZ is fixed 7.2 m/s

**M64** `mario.c:830-833`:
```c
set_mario_y_vel_based_on_fspeed(m, 62.0f, 0.0f);
if (m->forwardVel < 24.0f) {
    m->forwardVel = 24.0f;
}
```
Minimum 24 u/f = 7.2 m/s, but preserves higher incoming speed.

**SKYHOP** `player-jumps.ts:143-144`: `vx = wallNormal.x * config.wallKickVelXZ` (always 7.2).

**Effect:** wall-kicking off a wall while running fast loses momentum in Skyhop.

**Fix:** `vx = wallNormal.x * Math.max(horizSpeed, config.wallKickVelXZ)` (and z). Note the wall direction comes from wallNormal, not from incoming velocity, so this needs care — preserve magnitude from `horizSpeed`, not direction.

### #7 — Dive pitch -60° (`-π/3`)

**M64** `MARIO_ANIM_SLIDEFLIP_2` (binary anim) puts Mario fully horizontal (-90°) in a flying-superman pose during ACT_DIVE.

**SKYHOP** `player-visuals.ts` dive branch: `lerpToward(pitchAngle, -Math.PI / 3, 12 * dt)` → -60°.

**History:** commit `7c6134c "dive: pitch target -60° instead of -90° (M64 fidelity #6)"` deliberately changed -90° → -60°. Comment claims "M64 fidelity" but M64's actual pose is -90°. Either the commit was mislabeled or it was a readability tradeoff that should not be tagged as "fidelity".

**Fix:** `-Math.PI / 2` (-90°). Or document explicitly that the deviation is intentional for visual reasons.

### #8 — Long jump pitch -60° (`-π/3`)

**M64** `MARIO_ANIM_SLIDE_KICK` body during ACT_LONG_JUMP: horizontal superman pose.

**SKYHOP** `player-visuals.ts` long jump branch: lerp to -π/3 = -60°.

Same fix as #7: `-Math.PI / 2`.

## Excluded from worklist (not source-verifiable)

- **Side flip roll direction.** Earlier reverted at `f90da6e` to plain forward somersault, so the roll-direction question is moot at HEAD. If roll is restored later: M64's roll comes from `MARIO_ANIM_SLIDEFLIP` binary data, not the C source — only verifiable by A/B-testing against M64 emulator.
- **Triple jump and backflip somersault directions.** Procedural `±2π` pitch matches visual observation but the actual M64 directions are in animation data.
- **Ground pound spin direction.** Same — anim data.

## Suggested apply order

If applying as a single PR or sequential commits:

1. **Config-only fixes first** (#1, #7, #8): one commit, no logic changes, easy to verify.
2. **Velocity-formula fixes** (#2, #3, #5, #6): change in `player-jumps.ts`, requires running playtest after.
3. **Dive y-vel preservation** (#4): tiny change but behaviorally significant — playtest.

Each commit should reference this doc by file path.

## Cross-references

- `SKYHOP-MOVES-SPEC.md` — Codex's move-by-move M64 fidelity spec (covers
  rotation curves, animation, landing). This audit is the
  **physics-values** sibling spec.
- `SKYHOP-CAMERA-SPEC.md` — camera (orthogonal scope).
- `~/lsrc/sm64-decomp/src/game/mario.c` — `set_mario_action_airborne`
  switch (line 776+), the central dispatch where almost every fix lands.
- `~/lsrc/sm64-decomp/src/game/mario_step.c` — gravity, jump cut.
- `~/lsrc/sm64-decomp/src/game/mario_actions_airborne.c` — per-action
  step handlers (gravity/anim/transitions).
