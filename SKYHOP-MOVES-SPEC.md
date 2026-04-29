# SKYHOP MOVES SPEC

Spec-first review document for the SM64-fidelity pass. Sources:

- **Codex analysis** (claw:p7) as primary source for gap identification, prio
  ordering, and architecture recommendations (renderRoll, landingStyle,
  stateTime, moveVariant, phase-vs-rate).
- **Explore-agent research** (this session) for raw `file:line` refs in both
  `~/lsrc/sm64-decomp/src/game/` and `/home/adelost/lsrc/skyhop/src/lib/game/`.
- Already-shipped fixes (commits referenced inline) marked **DELIVERED**.
  Open items marked **TODO**.

Unit conversion: SM64 `u/f` (units per frame at 30 FPS) × 0.3 = m/s.
Default gravity: `-4 u/f²` = `-36 m/s²`. Long-jump gravity: `-2 u/f²` =
`-18 m/s²`. Terminal: `-75 u/f` = `-22.5 m/s`.

All `SKYHOP FILE` refs are at HEAD = commit `94a5b74` (post 5-fix mechanical
pass + ground-pound rewrite).

---

## Architecture gaps (apply across all moves)

These are infra changes Codex recommends before per-move polish. They unblock
several spec items below — surface here so review covers them as a single
contract change rather than scattered move-by-move.

| Gap | Codex rec | Status |
|---|---|---|
| Single pose per state, no startup/air/land split | Latcha `moveVariant` vid takeoff; landningen vet vad den ska se ut som | TODO |
| No `renderRoll` axis (only pitch + yaw) | Utöka `PoseOutput` (`player-visuals.ts:25`) med renderRoll | TODO — blocks side_flip fix |
| `pitch += k * dt` rate-based for several moves | Phase-baserade kurvor (som ground_pound_start gör nu) | TODO |
| No per-move stateTime | Lägg till generell stateTime i Player, nollställ vid state-byte | TODO |
| Single shared `landingSquashT` for all landings | landingStyle 120–220ms efter touchdown per move | TODO — biggest readability win |

---

## SINGLE JUMP

```
TRIGGER:     A-press from grounded with no special gate
             SM64:    set_jumping_action(m, ACT_JUMP, 0)
                      mario_actions_stationary.c:31, mario_actions_moving.c:1259
             SKYHOP:  player.ts:444 → player-jumps.ts:119 (fallthrough branch)

PHYSICS:     vy = jumpVel + runJumpBonus * horizSpeed (12.6 + 0.25 × spd)
             SM64:    vel[1] = 42.0 + 0.25 * forwardVel; forwardVel *= 0.8
                      mario.c:821-826
             SKYHOP:  config.svelte.ts:40 (jumpVel: 12.6, runJumpBonus: 0.25)
                      jumpCutMinVel: 6 → variable cut only while ascending fast
                      DELIVERED 94a5b74

ROTATION:    PHASE — rise pose / fall pose
             SM64:    MARIO_ANIM_SINGLE_JUMP (single anim, no rise/fall split)
                      mario_actions_airborne.c:456
             SKYHOP:  player-visuals.ts:121-128 (default decay branch — no
                      jump-specific pitch)
             TODO:    Leave as-is. Single jump's signature is the LANDING
                      anim, not the airborne pose.

LIMB POSE:   Arms slightly up
             SKYHOP:  player-visuals.ts:308-313 case "airborne"
                      armL/armR (-0.35,0.3,-0.1) / (0.35,0.3,-0.1)

LANDING:     Distinct ACT_JUMP_LAND → ACT_JUMP_LAND_STOP
             SM64:    numFrames = 4 (mario_actions_moving.c:26-28)
                      anim: MARIO_ANIM_LAND_FROM_SINGLE_JUMP
                      → ACT_JUMP_LAND_STOP (mario_actions_stationary.c:872)
             SKYHOP:  Shared landingSquashT only (player.ts:548)
             TODO:    Add landingStyle="single_jump" tag, ~133ms (4 frames).

FX:          SM64:    SOUND_ACTION_TERRAIN_JUMP (airborne.c:455)
                      play_mario_landing_sound on land
             SKYHOP:  consumeLandEvent → dustPool.emit(pos, 5, 2, 1.5)
                      engine.ts:219-221 (vy < -5 only)

DECOMP REF:  ~/lsrc/sm64-decomp/src/game/mario_actions_airborne.c:446
SKYHOP FILE: /home/adelost/lsrc/skyhop/src/lib/game/player-jumps.ts:119
```

---

## DOUBLE JUMP

```
TRIGGER:     A-press during ACT_JUMP_LAND while doubleJumpTimer > 0
             SM64:    set_jump_from_landing() — gates on prevAction +
                      doubleJumpTimer; mario.c:1411 decrements per frame
                      mario_actions_moving.c:1035
             SKYHOP:  canChain when timeSinceLanding ≤ doubleJumpWindowMs/1000
                      (167ms) AND chainOnLanding ≥ 1 AND chain < 3
                      player-jumps.ts:98-117

PHYSICS:     vy = doubleJumpVel + runDoubleJumpBonus × spd  (15.6 + 0.2 × spd)
             SM64:    vel[1] = 52.0 + 0.25 * (forwardVel * 0.8)
                      mario.c:786-787
             SKYHOP:  config.svelte.ts:41 (doubleJumpVel: 15.6, bonus: 0.2)

ROTATION:    PHASE — distinct rise vs fall (Codex: "borde också göra det")
             SM64:    MARIO_ANIM_DOUBLE_JUMP_RISE (ascending)
                      MARIO_ANIM_DOUBLE_JUMP_FALL (descending)
                      mario_actions_airborne.c:462-464
             SKYHOP:  Default decay branch — same as single jump
             TODO:    Latch moveVariant="double", split rise (vy > 0) / fall
                      (vy ≤ 0) poses.

LIMB POSE:   Same as single (case "airborne")
             SKYHOP:  player-visuals.ts:308-313
             TODO:    Need own tucked-mid-air variant for double's flip read.

LANDING:     ACT_DOUBLE_JUMP_LAND with A-press → triple jump path
             SM64:    numFrames = 4 (mario_actions_moving.c:50-52)
                      anim: MARIO_ANIM_LAND_FROM_DOUBLE_JUMP
                      A-press calls set_triple_jump_action
             SKYHOP:  Shared landingSquashT
             TODO:    landingStyle="double_jump" + chain window visible cue.

FX:          SM64:    SOUND_ACTION_TERRAIN_JUMP + SOUND_MARIO_HOOHOO
                      mario_actions_airborne.c:474
             SKYHOP:  Same shared dust event.

DECOMP REF:  ~/lsrc/sm64-decomp/src/game/mario_actions_airborne.c:457
SKYHOP FILE: /home/adelost/lsrc/skyhop/src/lib/game/player-jumps.ts:98
```

---

## TRIPLE JUMP

```
TRIGGER:     A-press during ACT_DOUBLE_JUMP_LAND, requires forwardVel > 6 m/s
             SM64:    set_triple_jump_action(); fspeed > 20 u/f gate
                      mario_actions_moving.c:147-154
             SKYHOP:  chain >= 3 branch; player-jumps.ts:100-107

PHYSICS:     vy = tripleJumpVel = 20.7 m/s (flat, no fspd multiplier)
             SM64:    vel[1] = 69.0 u/f; forwardVel *= 0.8; mario.c:797-798
             SKYHOP:  config.svelte.ts:42 (tripleJumpVel: 20.7)

ROTATION:    PHASE — somersault arc, not constant pitch rate
             SM64:    MARIO_ANIM_TRIPLE_JUMP — full forward somersault choreographed
                      play_flip_sounds at frame 2, 8, 20
                      mario_actions_airborne.c:499
             SKYHOP:  pitchAngle -= 6.5 * dt (rate-based, jumpChain === 3)
                      player-visuals.ts:97-98
             TODO:    Codex: "phase-baserade kurvor" — replace rate with
                      explicit somersault curve over expected airtime.

LIMB POSE:   Falls into generic case "airborne"
             SKYHOP:  player-visuals.ts:308-313
             TODO:    Codex: "Er nuvarande jumpChain===3-gren är för tunn."
                      Need dedicated triple pose per signature move.

LANDING:     Own ACT_TRIPLE_JUMP_LAND with HAHA shout, no double-from-land
             SM64:    numFrames = 4, anim: MARIO_ANIM_TRIPLE_JUMP_LAND
                      unk02 = 0 (no chain), SOUND_MARIO_HAHA on land
                      mario_actions_moving.c:54-56, 1893
             SKYHOP:  Shared landingSquashT
             TODO:    landingStyle="triple_jump" — distinct heavy-landing read.

FX:          SM64:    SOUND_ACTION_TERRAIN_JUMP + SOUND_MARIO_YAHOO (JP only)
                      play_flip_sounds frame 2, 8, 20
                      mario_actions_airborne.c:494-497
             SKYHOP:  Shared dust on land.

DECOMP REF:  ~/lsrc/sm64-decomp/src/game/mario_actions_airborne.c:480
SKYHOP FILE: /home/adelost/lsrc/skyhop/src/lib/game/player-jumps.ts:100
```

---

## BACKFLIP

```
TRIGGER:     A-press from crouch (any crouch state)
             SM64:    set_jumping_action(m, ACT_BACKFLIP, 0)
                      mario_actions_stationary.c:534, :703, :728
             SKYHOP:  crouchHeld branch in computeJump()
                      player-jumps.ts:65-78

PHYSICS:     vy = 18.6 m/s, vxz = 4.8 m/s backward
             SM64:    vel[1] = 62.0 u/f, forwardVel = -16 u/f
                      mario.c:791-793
             SKYHOP:  config.svelte.ts:55-56 (backflipVelY/XZ)

ROTATION:    PHASE — exactly one back-somersault over rise + early fall
             SM64:    MARIO_ANIM_BACKFLIP, choreographed
                      play_flip_sounds frame 2, 3, 17
                      mario_actions_airborne.c:515
             SKYHOP:  pitchAngle += 8 * dt (constant rate)
                      player-visuals.ts:77-79
             TODO:    Codex: "rotationen är fortfarande för 'integrerad'
                      snarare än koreograferad … exakt en backsomersault över
                      rise+tidig fall, inte pitch += constant."
                      Use phase curve.

LIMB POSE:   Compact tuck for spin
             SKYHOP:  player-visuals.ts:237-244
                      armL/R (∓0.25,0.15,-0.25), feet (∓0.15,-0.35,-0.2)

LANDING:     Reuses triple-jump-land anim
             SM64:    numFrames = 4, anim: MARIO_ANIM_TRIPLE_JUMP_LAND
                      unk02 = 0; SOUND_MARIO_HAHA
                      mario_actions_moving.c:58-60, 1910
             SKYHOP:  Shared landingSquashT
             TODO:    landingStyle="backflip" — can reuse triple's recovery shape.

FX:          SM64:    SOUND_ACTION_TERRAIN_JUMP + SOUND_MARIO_YAH_WAH_HOO
                      mario_actions_airborne.c:514
             SKYHOP:  Shared dust on land.

DECOMP REF:  ~/lsrc/sm64-decomp/src/game/mario_actions_airborne.c:509
SKYHOP FILE: /home/adelost/lsrc/skyhop/src/lib/game/player-jumps.ts:65
```

---

## SIDE FLIP    ⚠️ Largest visual gap

```
TRIGGER:     A-press during turnaround/skid state
             SM64:    A-press in ACT_TURNING_AROUND or ACT_FINISH_TURNING_AROUND
                      mario_actions_moving.c:968, :1019
             SKYHOP:  inSkid branch (= state === 'skid' at call site)
                      player-jumps.ts:82-97; player.ts:910
             DELIVERED 94a5b74 — was previously "input reversed in air"

PHYSICS:     vy = 18.6 m/s, vxz = 2.4 m/s in input direction
             SM64:    vel[1] = 62.0 u/f, forwardVel = 8 u/f
                      faceAngle[1] = intendedYaw
                      mario.c:837-840
             SKYHOP:  config.svelte.ts:57-58 (sideFlipVelY/XZ)

ROTATION:    Roll + yaw spin, NOT pitch (Codex: biggest fail)
             SM64:    MARIO_ANIM_SLIDEFLIP + angle[1] += 0x8000 (180° yaw flip)
                      SOUND_ACTION_SIDE_FLIP_UNK at anim frame 6
                      mario_actions_airborne.c:606
             SKYHOP:  pitchAngle -= 12 * dt (forward-pitch volt — wrong axis)
                      player-visuals.ts:80-82
             TODO:    BLOCKED on PoseOutput.renderRoll. Codex: "Er variant …
                      använder framåt-pitch, vilket egentligen ser ut som fel
                      sorts volt … renderRoll och gjort side flip som roll +
                      lite yaw spin, inte pitch."

LIMB POSE:   Windmill arms wide — appropriate for roll
             SKYHOP:  player-visuals.ts:245-249
                      armL/R (∓0.55,0.4,0)

LANDING:     ACT_SIDE_FLIP_LAND with 180° yaw flip on land
             SM64:    numFrames = 4, anim: MARIO_ANIM_SLIDEFLIP_LAND
                      angle[1] += 0x8000 on entry (mario_actions_moving.c:1815)
                      → ACT_SIDE_FLIP_LAND_STOP (stationary.c:890-892)
             SKYHOP:  Shared landingSquashT
             TODO:    landingStyle="side_flip" + facing flip on land for the
                      "spun around" read.

FX:          SM64:    SOUND_ACTION_TERRAIN_JUMP + SOUND_ACTION_SIDE_FLIP_UNK
                      airborne.c:604, 613
             SKYHOP:  Shared dust on land.

DECOMP REF:  ~/lsrc/sm64-decomp/src/game/mario_actions_airborne.c:606
SKYHOP FILE: /home/adelost/lsrc/skyhop/src/lib/game/player-visuals.ts:80
```

---

## LONG JUMP

```
TRIGGER:     A-press during crouch-slide above speed gate
             SM64:    A-press in ACT_CROUCH_SLIDE when forwardVel > 10 u/f
                      mario_actions_moving.c:1461-1464
             SKYHOP:  state === 'crouch_slide' && horizSpeed > 3
                      player-jumps.ts:51-64
             DELIVERED 94a5b74 — was previously "crouchHeld + speed"

PHYSICS:     vy = 9 m/s, vxz = horizSpeed × 1.5 capped at 14.4 m/s
             Half gravity during arc (-18 m/s² instead of -36)
             SM64:    vel[1] = 30 u/f; forwardVel *= 1.5 cap 48 u/f
                      mario.c:864-872
                      mario_step.c:543-547 — vel[1] -= 2.0 (half gravity)
             SKYHOP:  config.svelte.ts:50-54 (Y/XZ + longJumpGravityMult: 0.5)
                      DELIVERED 94a5b74 (gravMult, player.ts:517)

ROTATION:    Two anim variants based on initial speed
             SM64:    MARIO_ANIM_FAST_LONGJUMP / SLOW_LONGJUMP
                      mario_actions_airborne.c:634-638
             SKYHOP:  pitchAngle = lerpToward(pitchAngle, -π/3, 10 * dt)
                      player-visuals.ts:72-73 (single pose)
             TODO:    Codex: "snabb/långsam variant och egen crouch-landning
                      … borde låna." Latch moveVariant="long_jump_fast"
                      vs "long_jump_slow" at takeoff.

LIMB POSE:   Superman — shared with dive
             SKYHOP:  player-visuals.ts:228-235 (case "long_jump"|"dive")
                      armL/R (∓0.3,0.25,-0.5), feet back (±0.15,-0.2,0.3)

LANDING:     Own crouch-from-longjump anim → land-stop
             SM64:    ACT_LONG_JUMP_LAND, numFrames = 6 (mario_actions_moving.c:46-48)
                      anim: MARIO_ANIM_CROUCH_FROM_FAST_LONGJUMP
                            or  MARIO_ANIM_CROUCH_FROM_SLOW_LONGJUMP
                      mario_actions_moving.c:1867-1870
             SKYHOP:  Shared landingSquashT
             TODO:    landingStyle="long_jump" ~200ms (6 frames). Crouched
                      recovery pose distinguishes from regular landing.

FX:          SM64:    SOUND_ACTION_TERRAIN_JUMP + SOUND_MARIO_YAHOO
                      mario_actions_airborne.c:640
             SKYHOP:  Shared dust on land.

DECOMP REF:  ~/lsrc/sm64-decomp/src/game/mario_actions_airborne.c:634
SKYHOP FILE: /home/adelost/lsrc/skyhop/src/lib/game/player-jumps.ts:51
```

---

## DIVE

```
TRIGGER:     B-press airborne (or ground from kick fallback)
             SM64:    set_mario_action(m, ACT_DIVE, 0); B in airborne states
                      mario_actions_airborne.c:529, :596, :619
             SKYHOP:  triggerDive = actionPressed && horizSpeed >= 2.5 in air,
                      not in GP/dive
                      player.ts:458, 471-482

PHYSICS:     vxz boost +15 u/f cap 48 u/f; vy NOT set (inherited fall)
             SM64:    forwardVel = min(forwardVel + 15.0, 48.0) = max 14.4 m/s
                      vel[1] not set (inherits airborne velocity)
                      mario.c:856-861
                      Pitch decrements faceAngle[0] toward -0x2AAA (~-60°)
                      airborne.c:745-750
             SKYHOP:  config.svelte.ts:79-80 (diveVelY: 0, diveVelXZ: 14.4)

ROTATION:    PHASE — gradual nose-down to ~-60°, NOT instant -90°
             SM64:    Pitch decrements toward -0x2AAA = -60° gradually
                      MARIO_ANIM_DIVE
                      mario_actions_airborne.c:732
             SKYHOP:  pitchAngle = lerpToward(pitchAngle, -π/2, 12 * dt)
                      player-visuals.ts:74-76
             TODO:    Codex: "han pitchar gradvis ned mot ungefär -60°, inte
                      direkt till -90° … Er target är för extrem."
                      Change target from -π/2 to ~-π/3, gate on vy < 0.

LIMB POSE:   Superman — shared with long_jump
             SKYHOP:  player-visuals.ts:228-235

LANDING:     ACT_DIVE_SLIDE — full belly-slide with own anim and physics
             SM64:    common_slide_action with MARIO_ANIM_DIVE
                      mario_actions_moving.c:1584
                      Sound: SOUND_ACTION_TERRAIN_BODY_HIT_GROUND
             SKYHOP:  velocity.x *= 0.3, velocity.z *= 0.3, state → 'grounded'
                      player.ts:561-563
                      Shared dust on land.
             TODO:    Codex: "dive leder till stomach slide … splittrat butt_slide
                      och stomach_slide". Create stomach_slide state with friction
                      decel and own pose. landingStyle="stomach_slide".

FX:          SM64:    SOUND_ACTION_THROW + SOUND_MARIO_HOOHOO on entry
                      airborne.c:727
                      PARTICLE_VERTICAL_STAR on wall hit
                      PARTICLE_MIST_CIRCLE on head-stuck land
             SKYHOP:  Generic land dust only.

DECOMP REF:  ~/lsrc/sm64-decomp/src/game/mario_actions_airborne.c:732
SKYHOP FILE: /home/adelost/lsrc/skyhop/src/lib/game/player-visuals.ts:74
```

---

## GROUND POUND

```
TRIGGER:     Z-press (or action-press) during airborne
             SM64:    set_mario_action(m, ACT_GROUND_POUND, 0); Z in air states
                      mario_actions_airborne.c:451, :470, :489, :511, :533, :600, :623
             SKYHOP:  triggerGP = crouchPressed || (actionPressed && horizSpeed < 2.5)
                      player.ts:457, 459-470

PHYSICS:     PHASE 1 spin (~367ms): XZ frozen, gravity OFF, vy decay 6→0
             PHASE 2 slam: vy = -15 m/s, normal gravity → terminal -22.5
             SM64:    actionState 0: vel[1] = -50 u/f, forwardVel = 0 each
                      frame; position += yOffset (20-2t units, t=0..9, ~1.1m total)
                      airborne.c:934-947
                      actionState 1: perform_air_step + standard gravity
             SKYHOP:  startup XZ=0, vy = startVelY * (1-frac); slam = config.groundPoundVel
                      player.ts:485-501
                      DELIVERED 742a69a (M64-faithful freeze-spin-slam)

ROTATION:    PHASE — full forward somersault during spin, snap upright for slam
             SM64:    MARIO_ANIM_START_GROUND_POUND (spin)
                      MARIO_ANIM_TRIPLE_JUMP_GROUND_POUND (alt for arg=1)
                      MARIO_ANIM_GROUND_POUND (slam)
                      airborne.c:937-938, :949
             SKYHOP:  ground_pound_start: pitchAngle -= (2π/startupSec)*dt
                      ground_pound: lerpToward(pitchAngle, 0.08, 22*dt)
                      player-visuals.ts:87-95
                      DELIVERED 742a69a (phase-curve, lands feet-down exactly)
             TODO:    Codex: separate triple-jump-source variant "egen
                      startup-pose i skyhop" — moveVariant gating.

LIMB POSE:   Tuck during start, arms-crossed legs-down during slam
             SKYHOP:  player-visuals.ts:251-265
                      ground_pound_start: tight tuck
                      ground_pound: arms crossed over chest, legs straight down

LANDING:     ACT_GROUND_POUND_LAND with mist + horizontal star particles + camera shake
             SM64:    MARIO_ANIM_GROUND_POUND_LANDING
                      PARTICLE_MIST_CIRCLE | PARTICLE_HORIZONTAL_STAR
                      set_camera_shake_from_hit(SHAKE_GROUND_POUND)
                      → ACT_BUTT_SLIDE_STOP exit
                      stationary.c:1051; airborne.c:967
             SKYHOP:  poundImpactPending → dustPool.emit(pos, 12, 3, 3)
                      shakeT = camShakeDuration; landingSquashT = 0.22s
                      player.ts:543-555; engine.ts:215-218
             TODO:    PARTICLE_HORIZONTAL_STAR equivalent (radial spark burst).
                      ACT_BUTT_SLIDE_STOP recovery on landing.

FX:          SM64:    SOUND_ACTION_THROW (entry), SOUND_ACTION_SPIN (spin),
                      SOUND_MARIO_GROUND_POUND_WAH (slam transition),
                      SOUND_ACTION_TERRAIN_HEAVY_LANDING (impact)
             SKYHOP:  haptic + dust + cam shake on impact.

DECOMP REF:  ~/lsrc/sm64-decomp/src/game/mario_actions_airborne.c:930
SKYHOP FILE: /home/adelost/lsrc/skyhop/src/lib/game/player.ts:485
```

---

## WALL KICK

```
TRIGGER:     A-press in 2-frame instant window (ACT_AIR_HIT_WALL) +
             5-frame follow-up timer (wallKickTimer) = 7 frames ≈ 233ms
             SM64:    ACT_AIR_HIT_WALL: airborne.c:1314-1319 (2 frame instant)
                      wallKickTimer = 5 frames after, airborne.c:1320-1329
                      ACT_WALL_KICK_AIR (post-kick airborne): airborne.c:618
             SKYHOP:  canWallKick when timeSinceWall ≤ wallStickSec (233ms)
                      AND jumpBufferT ≤ bufferSec
                      player.ts:434-447 → executeWallKick (player.ts:876-888)
                      DELIVERED 94a5b74 — was 167ms (only follow-up window)

PHYSICS:     vy = 18.6 m/s, vxz = 7.2 m/s along wall normal
             SM64:    vel[1] = 62 u/f; forwardVel = max(forwardVel, 24 u/f)
                      mario.c:828-834
             SKYHOP:  config.svelte.ts:59-64 (wallKickVelY/XZ)
                      computeWallKick: player-jumps.ts:132-142

ROTATION:    Slide-jump pose, kept clean per Codex
             SM64:    MARIO_ANIM_START_WALLKICK (during ACT_AIR_HIT_WALL)
                      MARIO_ANIM_SLIDEJUMP (during ACT_WALL_KICK_AIR)
                      airborne.c:1343, :628
             SKYHOP:  Default airborne decay (no wall-kick-specific pitch)
                      player-visuals.ts:121-128
             TODO:    Codex: "håll den ganska ren. Er wall kick bör få egen
                      pose men inte överanimeras." Add minimal slide-jump pose,
                      not full new state — just a lean.

LIMB POSE:   Same as airborne
             SKYHOP:  player-visuals.ts:308-313
             TODO:    Slide-jump pose: arm out, lean.

LANDING:     Lands as ACT_JUMP_LAND (single jump landing)
             SM64:    airborne.c:628 — exits to ACT_JUMP_LAND
             SKYHOP:  Shared landingSquashT
             TODO:    Reuses single_jump landingStyle when implemented.

FX:          SM64:    play_mario_jump_sound (airborne.c:627)
                      PARTICLE_VERTICAL_STAR on bounce path (forwardVel >= 38)
             SKYHOP:  haptic 20ms (player.ts:443). No FX.
             TODO:    Optional: vertical-star equivalent on hard contact.

DECOMP REF:  ~/lsrc/sm64-decomp/src/game/mario_actions_airborne.c:618
SKYHOP FILE: /home/adelost/lsrc/skyhop/src/lib/game/player.ts:434
```

---

## LEDGE HANG

```
TRIGGER:     AIR_STEP_GRABBED_LEDGE result, falling, intent gate
             SM64:    AIR_STEP_GRABBED_LEDGE → drop_and_set_mario_action(m, ACT_LEDGE_GRAB, 0)
                      airborne.c:431
             SKYHOP:  not grounded, ledgeEligibleState, vy < -ledgeMinFallSpeed,
                      cooldown ≤ 0, hasIntent (input or vel into wall)
                      player.ts:609-635 → tryLedgeGrab (player-queries.ts:106)

PHYSICS:     Pinned at ledgePos; velocity zeroed
             SM64:    stop_and_set_height_to_floor(m); velocity zero
                      mario_actions_automatic.c:595
             SKYHOP:  body.setTranslation(ledgePos, true); velocity.set(0,0,0)
                      player.ts:766-767
                      ledgeBodyHandle tracks moving platforms (carryLedgeOnPlatform)

ROTATION:    Idle-hang pose, head tilted into wall
             SM64:    MARIO_ANIM_IDLE_ON_LEDGE
                      mario_actions_automatic.c:595
             SKYHOP:  pitchAngle = lerpToward(pitchAngle, ledgePoseDeg (-30°),
                                              poseLerpRate * dt)
                      player-visuals.ts:104-107

LIMB POSE:   Arms up grabbing ledge, legs hang
             SKYHOP:  player-visuals.ts:275-281
                      armL/R (∓0.28,0.7,-0.25), feet (∓0.18, footY+0.05, 0.15)

LANDING:     n/a (terminates via climb or drop)

FX:          SM64:    SOUND_MARIO_WHOA on grab (mario_actions_automatic.c:591)
             SKYHOP:  haptic 30ms on grab (player.ts:631)

DECOMP REF:  ~/lsrc/sm64-decomp/src/game/mario_actions_automatic.c:543
SKYHOP FILE: /home/adelost/lsrc/skyhop/src/lib/game/player.ts:609
```

---

## LEDGE FAST CLIMB

```
TRIGGER:     A-press in hang (or auto when heightAboveFloor < 100u)
             SM64:    A in ACT_LEDGE_GRAB, mario_actions_automatic.c:560-561
                      Auto < 100u: mario_actions_automatic.c:586-587
             SKYHOP:  climbIntentT >= ledgeClimbCommitMs (120ms) with input
                      into wall + verifyClearanceAbove passes
                      player.ts:771-785
             TODO:    Codex: "Ledge: hang/fast/slow/down" — currently no
                      A-vs-stick distinction; A-press should map to FAST.

PHYSICS:     update_ledge_climb tween to standing
             SM64:    update_ledge_climb(m, MARIO_ANIM_FAST_LEDGE_GRAB, ACT_IDLE)
                      mario_actions_automatic.c:646
             SKYHOP:  Cubic-eased tween climbStart → climbEnd over
                      ledgeClimbDurationMs (420ms)
                      player.ts:678-698

ROTATION:    Fast-grab anim (snappy)
             SM64:    MARIO_ANIM_FAST_LEDGE_GRAB
             SKYHOP:  Same pitch as hang (no animation change)
             TODO:    Climb-specific arm-pull pose during tween.

LIMB POSE:   Same as ledge_hang
             SKYHOP:  player-visuals.ts:275-281

LANDING:     Lands as ACT_IDLE
             SM64:    update_ledge_climb final exit
             SKYHOP:  state = 'grounded', ledgeGrabCooldown = 0.3
                      player.ts:694-698

FX:          SM64:    SOUND_MARIO_UH2 on initiate
                      SOUND_ACTION_TERRAIN_LANDING at frame 8
                      mario_actions_automatic.c:644, :649
             SKYHOP:  haptic 20ms on climb start (player.ts:785)

DECOMP REF:  ~/lsrc/sm64-decomp/src/game/mario_actions_automatic.c:560
SKYHOP FILE: /home/adelost/lsrc/skyhop/src/lib/game/player.ts:771
```

---

## LEDGE SLOW CLIMB

```
TRIGGER:     Forward stick during hang (after actionTimer ≥ 10) when intendedDYaw
             within ±0x4000 and space available — DISTINCT from A-press path
             SM64:    mario_actions_automatic.c:570-578
                      Switches to SLOW_2 at anim frame 17 (auto:619-621)
             SKYHOP:  GAP — same path as fast climb (player.ts:771)
             TODO:    Codex: "tre presentationstyper: hang, fast_climb,
                      slow_climb, plus climb_down. Det matchar SM64 bättre."
                      Distinguish A-press → fast vs forward-stick → slow.

PHYSICS:     Slower tween (~28+ frames)
             SM64:    update_ledge_climb(m, MARIO_ANIM_SLOW_LEDGE_GRAB, ACT_IDLE)
                      mario_actions_automatic.c:616
             SKYHOP:  Same 420ms tween as fast
             TODO:    Slow tween ~700-900ms with mid-pause feel.

ROTATION:    Slow-grab anim
             SM64:    MARIO_ANIM_SLOW_LEDGE_GRAB
             SKYHOP:  Same as fast (no separate handling)

LIMB POSE:   Same as ledge_hang
             SKYHOP:  player-visuals.ts:275-281

LANDING:     Lands as ACT_IDLE
             SKYHOP:  Same as fast

FX:          SM64:    SOUND_MARIO_EEUH at timer frame 10
                      mario_actions_automatic.c:612-613
             SKYHOP:  Same haptic as fast

DECOMP REF:  ~/lsrc/sm64-decomp/src/game/mario_actions_automatic.c:616
SKYHOP FILE: /home/adelost/lsrc/skyhop/src/lib/game/player.ts:771
```

---

## LEDGE CLIMB DOWN

```
TRIGGER:     Stick away from wall during hang
             SM64:    Entered from some landing actions
                      Function: mario_actions_automatic.c:626-636
             SKYHOP:  input.crouchPressed || wantsDrop (stick away)
                      → state = 'airborne' (no descend animation)
                      player.ts:800-807
             TODO:    Add explicit climb-down state with hang-down anim →
                      release at bottom.

PHYSICS:     Anim plays, then returns to ACT_LEDGE_GRAB at lower position
             SM64:    update_ledge_climb_down (auto.c:633)
             SKYHOP:  Direct release to airborne, no descend interpolation
             TODO:    Reverse-tween climbStart/End for descend pose.

ROTATION:    Climb-down anim
             SM64:    MARIO_ANIM_CLIMB_DOWN_LEDGE
             SKYHOP:  None — instant transition to airborne
             TODO:    Reverse of fast-climb pose during reverse tween.

LIMB POSE:   n/a (instant transition currently)
             SKYHOP:  player-visuals.ts:275-281 (last hang pose, then airborne)

LANDING:     Returns to ACT_LEDGE_GRAB at lower position
             SKYHOP:  Goes to airborne (no re-grab)

FX:          SM64:    No specific (auto from anim).
             SKYHOP:  None

DECOMP REF:  ~/lsrc/sm64-decomp/src/game/mario_actions_automatic.c:626
SKYHOP FILE: /home/adelost/lsrc/skyhop/src/lib/game/player.ts:800
```

---

## CROUCH SLIDE  (renaming → BUTT SLIDE per Codex)

```
TRIGGER:     Z-press while running on flat (or auto on slope-with-crouch)
             SM64:    set_mario_action(m, ACT_CROUCH_SLIDE, 0)
                      mario_actions_moving.c:896-901
             SKYHOP:  wantsDashSlide (Z-tap during run > 4 m/s) OR
                      wantsCrouchSlide (crouchHeld + slope ≥ 5°)
                      player.ts:295-299

PHYSICS:     Decel via apply_slope_decel; long-jump available within first
             30 frames if speed > 10 u/f
             SM64:    common_slide_action_with_jump
                      mario_actions_moving.c:1484
             SKYHOP:  approach(vx, 0, 5*dt) friction; slope-along boost via
                      gravity-along-slope projection
                      player.ts:390-399

ROTATION:    Crouch pose (forward lean)
             SM64:    MARIO_ANIM_START_CROUCHING then slide pose
             SKYHOP:  pitchAngle = lerpToward(pitchAngle, -π/2, 12*dt)
                      targetScaleY = 0.55
                      player-visuals.ts:113-114

LIMB POSE:   ⚠️ Currently belly-slide pose — should be butt-slide
             SKYHOP:  player-visuals.ts:283-290 — flat-on-belly
                      armL/R (∓0.3,-0.1,-0.4), feet back
             TODO:    Codex: "Er crouch slide gör den som belly slide. Men i
                      SM64 är långhoppets källa mer butt/crouch-slide, medan
                      dive leder till stomach slide. Jag hade splittrat detta
                      i butt_slide och stomach_slide."
                      Sit-pose with arms back, legs forward, smaller scale.

LANDING:     n/a (ground state; exits to ACT_CROUCHING / ACT_JUMP / ACT_FREEFALL)
             SKYHOP:  Same — exits to grounded when input released or speed = 0

FX:          SM64:    PARTICLE_DUST per step (via common_slide_action)
             SKYHOP:  No dust during slide; only on hard landing afterward.
             TODO:    Continuous dust trail while sliding (low rate emit).

DECOMP REF:  ~/lsrc/sm64-decomp/src/game/mario_actions_moving.c:1484
SKYHOP FILE: /home/adelost/lsrc/skyhop/src/lib/game/player.ts:295
```

---

## SKID / TURNAROUND

```
TRIGGER:     Stick reversed > 120° while running > 4 m/s grounded
             SM64:    analog_stick_held_back during walking
                      mario_actions_moving.c:962, :980 (split in TURNING_AROUND
                      vs FINISH_TURNING_AROUND)
             SKYHOP:  state === 'grounded' && horizSpeed > 4 && hasInput
                      && |deltaYaw| > skidReverseDeg (120°)
                      player.ts:374-386

PHYSICS:     Decel at 2 u/f²; transitions to FINISH at vel ≤ 8 u/f
             SM64:    apply_slope_decel; PARTICLE_DUST per frame
                      mario_actions_moving.c:962, :993
             SKYHOP:  velocity *= skidVelocityCut (0.7) on entry
                      skidT counts up to skidDurationMs (350ms)
                      player.ts:381-386

ROTATION:    PHASE — TURNING_PART1 (high speed) → TURNING_PART2 (low)
             SM64:    MARIO_ANIM_TURNING_PART1 / PART2
                      angle[1] += 0x8000 every frame in PART2 phase
                      mario_actions_moving.c:1013
             SKYHOP:  pitchAngle = lerpToward(pitchAngle, skidLeanDeg (30°),
                                              10 * dt)
                      Facing frozen during skid
                      player-visuals.ts:108-111

LIMB POSE:   Feet forward braking, arms wide for balance
             SKYHOP:  player-visuals.ts:300-307
                      armL/R (∓0.55,0.2,0), feet (∓0.18, footY,-0.2)

LANDING:     n/a (ground state)

FX:          SM64:    PARTICLE_DUST + SOUND_MOVING_TERRAIN_SLIDE
                      mario_actions_moving.c:983, :993
             SKYHOP:  skidStartPending → dustPool.emit(pos, 4, 1, 2.2)
                      engine.ts:222-224
             TODO:    Continuous dust during skid, not just on entry.

DECOMP REF:  ~/lsrc/sm64-decomp/src/game/mario_actions_moving.c:962
SKYHOP FILE: /home/adelost/lsrc/skyhop/src/lib/game/player.ts:374
```

---

## LANDING STYLES (cross-cutting recommendation)

Codex recommendation: introduce `landingStyle` tag set 120-220ms post-touchdown
per move-variant. Today skyhop has a single shared `landingSquashT` (0-220ms
decay) for all landings, so single jump, double, triple, backflip, side flip,
long jump, dive, ground pound all read identically.

**Proposed style per move (durations are SM64 numFrames × 33ms, rounded):**

| moveVariant | duration | shape (proposed) | notes |
|---|---|---|---|
| single_jump | 133ms | mild squash + bounce | baseline, can chain |
| double_jump | 133ms | mild squash + chain hint | shows window for triple |
| triple_jump | 133ms | heavier squash + HAHA equivalent | signature read |
| backflip | 133ms | reuses triple shape (per SM64) | flat recovery |
| side_flip | 133ms | yaw flip + windmill recovery | "spun around" read |
| long_jump | 200ms | crouched recovery | distinct slide-out |
| dive | n/a (anim-driven) | enters stomach_slide state | continuous slide |
| ground_pound | 220ms (current) | heavy squash + radial dust + shake | DELIVERED-ish |

Implementation skeleton (Codex):
1. Latch `moveVariant` at takeoff/trigger
2. Engine consumes per-style on landing event (extend `consumeLandEvent` to
   carry style enum)
3. `landingSquashT` becomes per-style amplitude × shape function
4. Optionally: per-style limb pose during recovery window

---

## SHIMMY (intentional non-SM64 feature)

Per user direction: **keep**. SM64 has no edge shimmy — `act_ledge_grab` is
hang + climb only. Skyhop adds tangent-shimmy (`player.ts:730-744`,
`verifyLedgeAt` at `player-queries.ts`) as a deliberate playground extension.

This spec documents the intent so future M64-fidelity passes do not regress
the shimmy feature.

---

## DELIVERED SUMMARY (reference)

| Item | Commit |
|---|---|
| Render interpolation (60Hz physics → 120/144/240Hz display) | 3475870 |
| Idle-decel direction preservation | 344f649 |
| Moving-platform shimmy carry (purple bouncing platform) | 06423a5 |
| Thin-platform shimmy fix (ceiling 0.3m slab, chest-ray height) | 44fcdc0 |
| Ground-pound M64-faithful (freeze-spin-slam, full somersault) | 742a69a |
| Side flip turnaround-gate (was velocity-reversal in air) | 94a5b74 |
| Long jump from crouch_slide only (was crouchHeld + speed) | 94a5b74 |
| Variable jump cut gate (vy > 6 m/s threshold) | 94a5b74 |
| Wall-kick window 167→233ms (instant + follow-up) | 94a5b74 |
| Long-jump half gravity (longJumpGravityMult 0.5) | 94a5b74 |

---

## IMPLEMENTATION PRIO ORDER (from Codex + this spec)

For atomic-commit sequence after spec approval:

1. **Side flip roll-fix** — only visibly-wrong move. Add `renderRoll` to
   `PoseOutput`, replace pitch with roll + yaw spin. Single commit.
2. **landingStyles infra** — `moveVariant` latch at takeoff, per-style
   landingStyle dispatch. Foundation for #3-#5.
3. **Crouch / butt vs stomach slide split** — rename current crouch-slide
   pose to butt-slide; add stomach_slide state for dive landing.
4. **Triple + backflip phase-based curves** — replace `pitch += k*dt` with
   explicit phase functions (like ground_pound_start does).
5. **Ledge variants** — split fast / slow / down with distinct triggers and
   tween durations.

Atomic per move. Manual-eyeball-test in browser before each commit. Skip
air-control polar refactor (separate session per user direction).
