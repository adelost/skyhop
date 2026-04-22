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
	// multiplied by ~4 so the jump cuts short. Holding A = full height.
	jumpAscentCutMult: 4,

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
	backflipVelY: 18.6,
	backflipVelXZ: -4.8,
	sideFlipVelY: 18.6,
	wallKickVelY: 18.6,
	wallKickVelXZ: 7.2,
	wallStickMs: 167, // M64: 5 frames

	// Aerial actions.
	// Ground pound: M64 -50 u/f = -15 m/s. No bounce in M64 (we offer small one optionally).
	// Dive: M64 Y inherits (no set), XZ = fVel+15 cap 48 u/f = 14.4 m/s.
	groundPoundVel: -15,
	groundPoundBounce: 0,
	diveVelY: 0,
	diveVelXZ: 14.4,

	// Camera. M64 Lakitu: base distance 10 m, look-at target at Mario + 1.25 m.
	// Camera elevation ~2.5 m with slight pitch down.
	camYawSensitivity: 0.006,
	camDistance: 10,
	camHeight: 2.5,
	camRecenterDelayMs: 1500,
	camRecenterSpeed: 0.8, // rad/s

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
	ledgePoseDeg: -30, // head tilted INTO wall (hands grabbing)

	// Wall-slide pose. Legs-into-wall, head-away: POSITIVE pitch (with nose facing
	// into wall, positive pitch tips head backward = away from wall).
	wallSlidePoseDeg: 22,

	// Smoothness of transitions between poses (rad/s toward target).
	poseLerpRate: 8,

	// Wall-kick lockout: can't re-kick the same wall for this duration.
	sameWallLockoutMs: 500
});

export type Config = typeof config;
