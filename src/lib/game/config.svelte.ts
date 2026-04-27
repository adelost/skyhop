// Physics values tuned to match Super Mario 64 (n64decomp/sm64).
// Unit conversion: M64 uses 1 unit = 0.01 m at 30 FPS.
//   velocity (u/f) × 30 × 0.01 = m/s
//   accel    (u/f²) × 900 × 0.01 = m/s²

export const config = $state({
	// Horizontal motion. M64: max run = 32 u/f = 9.6 m/s. Idle decel 1 u/f² = 9 m/s².
	// Brake decel 4 u/f² = 36 m/s². Accel curve is non-linear (fast→slow), we approximate
	// with a single accel rate.
	moveSpeed: 9.6,
	accel: 40,
	decel: 9,
	airControl: 0.3,

	// Variable jump height (M64 style): when A is NOT held during ascent, gravity is
	// multiplied by ~4 so the jump cuts short. Holding A = full height. M64 only
	// applies the cut while vy > 20 u/f = 6 m/s; below that the boost is already
	// gone and additional cut would feel like a dead jump.
	jumpAscentCutMult: 4,
	jumpCutMinVel: 6,

	// Vertical. M64 gravity -4 u/f² = -36 m/s². Terminal -75 u/f = 22.5 m/s.
	gravity: -36,
	terminalVel: 22.5,

	// Modern concessions: M64 has neither coyote nor buffer. We keep small amounts
	// because modern players expect it; M64's snap-to-ground (100 u) did this job.
	coyoteMs: 80,
	bufferMs: 80,

	// Slopes. M64 steep threshold is 20° on normal floors, 15° on very slippery.
	slopeSlideAngleDeg: 20,
	slopeBoost: 5,
	iceFriction: 0.2, // M64 very-slippery decel multiplier

	// Jump vertical velocities. M64:
	//   single 42 u/f + 0.25 × fVel → ~12.6 m/s baseline, +~0.7 with run
	//   double 52 u/f + 0.25 × (fVel×0.8) → ~15.6 m/s
	//   triple 69 u/f flat → 20.7 m/s
	jumpVel: 12.6,
	doubleJumpVel: 15.6,
	tripleJumpVel: 20.7,
	doubleJumpWindowMs: 167, // M64: 5 frames at 30 FPS

	// Special jumps. M64 values:
	//   long jump  Y=30 u/f = 9 m/s,  XZ = fVel × 1.5 cap 48 u/f = 14.4 m/s
	//   backflip   Y=62 u/f = 18.6 m/s,  XZ = -16 u/f = -4.8 m/s
	//   side flip  Y=62,  XZ = 8 u/f = 2.4 m/s (preserves lateral direction)
	//   wall kick  Y=62,  XZ = max(fVel, 24 u/f) = 7.2 m/s min
	longJumpVelY: 9,
	longJumpVelXZ: 14.4,
	// M64 long jump uses half gravity (vel[1] -= 4.0f * 0.5f in mario_step.c)
	// so the arc carries far. Without this the long jump feels like a flat dash.
	longJumpGravityMult: 0.5,
	backflipVelY: 18.6,
	backflipVelXZ: -4.8,
	sideFlipVelY: 18.6,
	sideFlipVelXZ: 2.4, // M64: 8 u/f = 2.4 m/s. Own setting, decoupled from long jump.
	// Side flip visual: M64 ACT_SIDE_FLIP flips render yaw 180° (angle[1]
	// += 0x8000) and plays MARIO_ANIM_SLIDEFLIP. Without skeletal anim we
	// approximate with: body stays mostly upright (small lean), arms do a
	// full windmill, legs arc out. Primary flip illusion comes from the
	// yaw-flip + limb choreography, not root rotation.
	sideFlipRotationDuration: 0.5,
	sideFlipBodyLeanDeg: 20,
	sideFlipArmSpinRate: 4, // arm windmill cycles per second
	// Shimmy hand cycle: alternating release/re-grab while moving along ledge.
	shimmyHandCycleHz: 2,
	shimmyHandLift: 0.18,
	shimmyHandReach: 0.2,
	// Triple jump and backflip rotation: phase-based (easeInOutSine) instead
	// of linear rate, so the somersault starts and ends softly — reads as a
	// choreographed flip rather than a constant tumble.
	tripleRotationDuration: 0.55,
	backflipRotationDuration: 0.7,
	wallKickVelY: 18.6,
	wallKickVelXZ: 7.2,
	// M64 wall-kick window = 2 frames "instant" (ACT_AIR_HIT_WALL) + 5 frames
	// follow-up timer = 7 frames at 30fps ≈ 233ms. Earlier value (167ms) was
	// only the follow-up window and missed the instant phase.
	wallStickMs: 233,

	// Aerial actions.
	// Ground pound (M64 decomp act_ground_pound):
	//   Spin phase = 11 frames at 30fps ≈ 367ms. XZ frozen. Gravity OFF during
	//   spin. Mario rises ~1.1m via position offsets (we use decaying vy for the
	//   same net curve). Then slam: vy = -50 u/f = -15 m/s, normal gravity takes
	//   over (terminal -75 u/f = -22.5 m/s). No bounce on landing.
	// Dive: M64 Y inherits (no set), XZ = fVel+15 cap 48 u/f = 14.4 m/s.
	groundPoundStartMs: 367,
	groundPoundStartVelY: 6,
	groundPoundStartGravityMult: 0,
	groundPoundVel: -15,
	groundPoundBounce: 0,
	groundPoundImpactSquashMs: 220,
	diveVelY: 0,
	diveVelXZ: 14.4,
	// Threshold for action-button kick-vs-dive split. M64 act_jump_kick check:
	// `forwardVel > 28.0f` → ACT_DIVE, else ACT_JUMP_KICK. 28 u/f = 8.4 m/s.
	// Same threshold drives ground-dive vs punch-combo.
	diveSpeedThreshold: 8.4,

	// Punch combo (M64 act_punching / act_move_punching / mario_update_punch_sequence).
	// Three-hit sequence: punch1 → punch2 → kick, each entered by re-tapping action
	// inside the combo window after the active phase. Outside the window, action
	// starts a fresh punch1. Entry caps forward velocity (M64 caps at 6 u/f for
	// moving punch); during the move XZ decays slowly and facing is locked.
	punch1ActiveMs: 200, // hand extends, "active hit" window
	punch1RecoveryMs: 167, // retract — combo input must arrive before this ends
	punch2ActiveMs: 200,
	punch2RecoveryMs: 167,
	kickActiveMs: 233, // M64 kick is the longest of the three
	kickRecoveryMs: 200,
	punchEntryVelCap: 1.8, // m/s — M64 ACT_MOVE_PUNCHING fVel cap = 6 u/f = 1.8 m/s
	punchDecel: 6, // m/s² — XZ decay during punch states
	landPunchMs: 80,

	// Camera. M64-tuned: authentic Lakitu feel. Speed-boost off by default so
	// the camera doesn't "breathe" when moving; look-ahead is subtle.
	camYawSensitivity: 0.006,
	camPitchSensitivity: 0.004,
	camDistance: 10,
	camHeight: 2.3,
	camRecenterDelayMs: 1200, // M64 is pretty eager — follow quickly after idle
	camRecenterSpeed: 1.4, // rad/s
	camRecenterMinSpeed: 1.2, // only recenter if player moves faster than this
	camRecenterMinYawDiff: 0.4, // rad — recenter even for modest drift

	// Look-ahead: subtle bias in velocity direction (M64 barely has this)
	camLookAheadDist: 1.0,
	camLookAheadSpeedRef: 8, // m/s at which look-ahead reaches full

	// Y-stabilization: don't snap cam during brief hops
	camYStabilizeMs: 200,

	// Speed-adaptive FOV + distance. Off by default for M64 feel. Raise for
	// Odyssey-ish speed-sense (2 deg FOV + 0.5 m dist feels right as upper bound).
	camFovBase: 60,
	camFovSpeedBoost: 0,
	camDistSpeedBoost: 0,
	camSpeedBoostLerp: 2,

	// Cam smoothing ("operator lag"). Lower = laggier / more physical.
	camLerpRate: 6,

	// Dead zone on drag: ignore micro-movements (prevents jitter)
	camDragDeadPx: 3,

	// Pitch clamp (radians)
	camPitchMin: -0.35, // look down
	camPitchMax: 0.9, // look up

	// Zoom. camZoomMin matters — too low lets occlusion collapse cam into the
	// player's face ("huge capsule fills screen" bug). 8m is a reasonable floor.
	camZoomMin: 8,
	camZoomMax: 14,
	camZoomScrollSpeed: 1.5,
	camZoomPinchSensitivity: 0.02,

	// Collision shrink floor: min allowed distance when a wall is between cam
	// and target. Must match or slightly undercut camZoomMin so the two play well.
	camCollisionMinDist: 5,

	// Ground-pound shake
	camShakeAmp: 0.15,
	camShakeDuration: 0.25,

	// Ledge-hang framing: raise look-at so player ser ovanpå väggen
	camLedgeFramingUp: 1.5,

	// Character facing rotation (visual). Lerp rad/s and skid-turn duration.
	rotationSpeed: 12,
	skidReverseDeg: 120, // trigger threshold (degrees of input reversal)
	skidDurationMs: 350, // M64 ~10-15 frames, speed-dep; we use flat avg
	skidVelocityCut: 0.7, // how much to preserve on entry (was abrupt 0.5)
	skidLeanDeg: 30, // back-lean during skid (visual brake pose)

	// Running-jump height bonus (M64 single = +0.25 × fVel).
	runJumpBonus: 0.25,
	runDoubleJumpBonus: 0.2,

	// Wall slide cling: gravity multiplier while hugging wall.
	wallSlideGravityMult: 0.35,

	// Ledge grab reach (how far forward + up to scan).
	ledgeForwardReach: 1.0,
	ledgeUpReach: 1.0,
	ledgeMinFallSpeed: 1, // require velocity.y < -this to allow grab
	ledgeShimmySpeed: 2.0, // m/s along the ledge
	ledgeShimmyDeadzone: 0.3,
	ledgeClimbInputDeadzone: 0.6,
	ledgeClimbCommitMs: 120, // require a short deliberate hold before pull-up
	ledgePoseDeg: 0, // body hangs straight; hands handle the grab visually
	ledgeClimbDurationMs: 420, // smooth pull-up animation length (legacy default)
	// M64-style climb variants: fast = A-press (short), slow = forward-stick
	// after hangMin (regular), down = back-stick + crouch (descend to airborne
	// below the ledge face).
	ledgeHangMinMs: 333, // 10 frames at 30fps — forward-stick slow climb gate
	ledgeClimbFastMs: 300,
	ledgeClimbSlowMs: 600,
	ledgeClimbDownMs: 400,
	ledgeClimbDownDropDist: 1.6, // meters descended during climb-down

	// Wall-slide pose. Legs-into-wall, head-away: POSITIVE pitch (with nose facing
	// into wall, positive pitch tips head backward = away from wall).
	wallSlidePoseDeg: 22,

	// Smoothness of transitions between poses (rad/s toward target).
	poseLerpRate: 8,

	// Landing recovery durations per move variant (ms). M64 has move-specific
	// land/recovery animations; we approximate with a short window that holds
	// a pose override before decaying back to grounded. Latched at touchdown
	// from moveVariant (takeoff latch).
	landSingleMs: 120,
	landDoubleMs: 140,
	landTripleMs: 220,
	landBackflipMs: 200,
	landSideFlipMs: 180,
	landLongJumpMs: 180,
	landDiveMs: 260,
	landWallKickMs: 140,
	landGroundPoundMs: 220,

	// Wall-kick lockout: can't re-kick the same wall for this duration.
	sameWallLockoutMs: 500,

	// Camera mode-driven behavior (see SKYHOP-CAMERA-SPEC.md).
	// Distance baseline for slide_chase (applied on top of the user-driven
	// cameraDist from wheel). Spec: 8.5-9.0m; we offset from whatever the user
	// has set rather than hard-overriding so manual zoom still matters.
	camSlideDistanceAdd: 0.8,
	// Reclaim: shorter, more assertive than the legacy camRecenterDelayMs.
	// After this much idle (no drag/wheel), camera starts approaching the
	// behind-facing goal regardless of drift magnitude.
	camReclaimDelayMs: 800,
	// Hysteresis on slide-mode transitions so taps/short slides don't thrash.
	camSlideHysteresisInMs: 80,
	camSlideHysteresisOutMs: 120,
	// Lateral pan: fraction of goal distance that focus shifts along player
	// facing when camera yaw is off-axis. Replaces velocity-lookahead.
	camLateralPanMax: 0.15,
	// Yaw reclaim rates (rad/s). Slide locks behind faster than default.
	// Scaled down when player is nearly still so a standing player doesn't
	// get spun around by a persistent reclaim force.
	camYawFollowDefault: 2.2,
	camYawFollowSlide: 4.5,
	camYawFollowStillMult: 0.3,
	camMovingSpeedThresh: 1.2,
	// Two-layer smoothing: focus catches up faster than camera body, so
	// composition reads quickly while the body has physical lag.
	camFocusFollowH: 20,
	camFocusFollowV: 6,
	camPosFollowH: 6,
	camPosFollowV: 6,
});

export type Config = typeof config;
