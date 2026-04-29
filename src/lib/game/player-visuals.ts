import * as THREE from "three";
import type { MoveVariant, PlayerState } from "./player";
import type { WallNormal } from "./player-queries";
import { config } from "./config.svelte";
import { RADIUS, HEIGHT } from "./player-constants";

const HALF_BODY = HEIGHT / 2 + RADIUS; // 0.8

export type PoseInput = {
	state: PlayerState;
	dt: number;
	facingYaw: number;
	targetYaw: number;
	pitchAngle: number;
	yawSpin: number;
	jumpChain: number;
	wallNormal: WallNormal | null;
	grounded: boolean;
	timeSinceGrounded: number;
	crouching: boolean;
	currentScaleY: number;
	landingSquashT: number; // decaying squash on hard landing
	// Seconds since the current state was entered. Used for phase-based rotation
	// curves (side_flip roll, etc). Reset by caller when state changes.
	stateTime: number;
	// Recovery pose override after touchdown. Set from moveVariant latched at
	// takeoff/trigger, decays with landingStyleT. null when not recovering.
	landingStyle: MoveVariant | null;
	landingStyleT: number;
};

export type PoseOutput = {
	facingYaw: number;
	pitchAngle: number;
	yawSpin: number;
	renderYaw: number;
	renderPitch: number;
	renderRoll: number;
	scaleY: number;
	offsetY: number;
};

/**
 * Compute the visual transform (rotation + scale + offset) from player state.
 * Mutates nothing — caller applies result to visualGroup and writes back the
 * accumulator values (pitchAngle, yawSpin, facingYaw).
 *
 * Sign convention (YXZ euler, pitch around local X):
 *   +pitch = back-lean / backward somersault (head tips toward +Z local)
 *   -pitch = forward lean / forward somersault (head tips toward -Z local)
 */
export function computePose(input: PoseInput): PoseOutput {
	const {
		state,
		dt,
		facingYaw,
		targetYaw,
		wallNormal,
		grounded,
		timeSinceGrounded,
		crouching,
		currentScaleY,
	} = input;
	let { pitchAngle, yawSpin } = input;

	// Lerp base facing toward target. Freeze during skid (brake pose keeps
	// old direction), wall_slide (local yaw uses wall direction), and facing-
	// locked aerial moves (backflip/long/side/dive/pound/triple) — those keep
	// their launch direction through the whole move.
	let newFacingYaw = facingYaw;
	if (shouldRotateFacing(state, input.jumpChain)) {
		newFacingYaw = lerpAngle(facingYaw, targetYaw, config.rotationSpeed * dt);
	}

	let renderPitch = 0;
	let renderYaw = newFacingYaw;
	let renderRoll = 0;
	let targetScaleY = 1;

	if (state === "long_jump") {
		pitchAngle = lerpToward(pitchAngle, -Math.PI / 3, 10 * dt);
		renderPitch = pitchAngle;
	} else if (state === "dive") {
		// M64 dive pitches faceAngle[0] toward roughly -120° (head fully past
		// horizontal so Mario reads as face-down/superman). Skyhop was previously
		// at -60° which read as a gentle lean. -2π/3 ≈ -120° matches M64.
		pitchAngle = lerpToward(pitchAngle, -(Math.PI * 2) / 3, 12 * dt);
		renderPitch = pitchAngle;
	} else if (state === "backflip") {
		// Phase-based backward somersault: easeInOutSine from 0 → +2π over
		// the rotation window, then held at 2π (normalizes to 0 in display).
		// Reads as a choreographed flip instead of a linear tumble.
		const dur = Math.max(0.001, config.backflipRotationDuration);
		const t = Math.min(1, input.stateTime / dur);
		pitchAngle = easeInOutSine(t) * (Math.PI * 2);
		renderPitch = pitchAngle;
	} else if (state === "side_flip") {
		// M64 ACT_SIDE_FLIP (mario_actions_airborne.c:608) flips render yaw
		// 180° (gfx.angle[1] += 0x8000). M64 then drives the spin via the
		// MARIO_ANIM_SLIDEFLIP skeletal animation, which we don't have. Layer
		// three things to recreate the look: cartwheel roll, decaying pirouette
		// over the first half, small forward lean. Without the pirouette the
		// 180° flip reads as a static turn instead of a side volt.
		const leanTarget = (config.sideFlipBodyLeanDeg * Math.PI) / 180;
		pitchAngle = lerpToward(pitchAngle, leanTarget, 10 * dt);
		renderPitch = pitchAngle;
		const dur = Math.max(0.001, config.sideFlipRotationDuration);
		const t = Math.min(1, input.stateTime / dur);
		// Cartwheel direction: Mattias caught CCW reading as wrong-way; flip to
		// CW (positive Z roll) so the body rolls "into" the new face direction
		// instead of away from it.
		renderRoll = easeInOutSine(t) * (Math.PI * 2);
		const spinFrac = Math.max(0, 1 - t * 2);
		yawSpin += config.sideFlipYawSpinRate * dt * spinFrac;
		renderYaw = newFacingYaw + Math.PI + yawSpin;
	} else if (state === "ground_pound_start") {
		// M64: one full forward somersault over the startup window, then the
		// code below lerps back to upright for the slam. Rate is 2π / startupSec
		// so the rotation completes regardless of tuning.
		const startupSec = Math.max(0.001, config.groundPoundStartMs / 1000);
		pitchAngle -= ((Math.PI * 2) / startupSec) * dt;
		renderPitch = pitchAngle;
		targetScaleY = 0.72;
	} else if (state === "ground_pound") {
		// Snap back into a feet-down stomp rather than continuing to tumble.
		pitchAngle = lerpToward(pitchAngle, 0.08, 22 * dt);
		renderPitch = pitchAngle;
		targetScaleY = 0.92;
	} else if (state === "airborne" && input.jumpChain === 3) {
		// Triple jump: one full forward somersault (phase-eased) over the
		// rotation window, then held. Matches M64 pacing where the spin
		// starts and ends softly instead of spinning linearly.
		const dur = Math.max(0.001, config.tripleRotationDuration);
		const t = Math.min(1, input.stateTime / dur);
		pitchAngle = easeInOutSine(t) * -(Math.PI * 2);
		renderPitch = pitchAngle;
	} else if (state === "wall_slide" && wallNormal) {
		renderYaw = Math.atan2(wallNormal.x, wallNormal.z);
		const target = (config.wallSlidePoseDeg * Math.PI) / 180;
		pitchAngle = lerpToward(pitchAngle, target, config.poseLerpRate * dt);
		renderPitch = pitchAngle;
	} else if (
		state === "ledge_hang" ||
		state === "ledge_climb_fast" ||
		state === "ledge_climb_slow" ||
		state === "ledge_climb_down"
	) {
		const target = (config.ledgePoseDeg * Math.PI) / 180;
		pitchAngle = lerpToward(pitchAngle, target, config.poseLerpRate * dt);
		renderPitch = pitchAngle;
	} else if (state === "skid") {
		const targetLean = (config.skidLeanDeg * Math.PI) / 180;
		pitchAngle = lerpToward(pitchAngle, targetLean, 10 * dt);
		renderPitch = pitchAngle;
	} else if (state === "punch_1" || state === "punch_2") {
		// Slight forward lean as the body shifts weight into the punch.
		pitchAngle = lerpToward(pitchAngle, -0.12, 14 * dt);
		renderPitch = pitchAngle;
	} else if (state === "kick") {
		// Kick reads as a slight back-lean (counter-balance for raised leg).
		pitchAngle = lerpToward(pitchAngle, 0.08, 14 * dt);
		renderPitch = pitchAngle;
	} else if (state === "crawl") {
		// Crawl: body horizontal, head leading, low to ground. M64 quadruped pose.
		pitchAngle = lerpToward(pitchAngle, -0.4, 10 * dt);
		renderPitch = pitchAngle;
		targetScaleY = 0.45;
	} else if (state === "aerial_kick") {
		// Upright in air with leg cocked. Distinct from dive (face-down) and
		// ground pound (forward-tumble); reads as a clean spin kick.
		pitchAngle = lerpToward(pitchAngle, 0, 12 * dt);
		renderPitch = pitchAngle;
	} else if (state === "sweep_kick") {
		// Hands-on-ground breakdance pose with full 360° body spin (CCW from
		// above, matching M64 sweep direction). Spin runs over startup +
		// active so it concludes before the recovery retraction.
		const spinDur =
			(config.sweepStartupMs + config.sweepActiveMs) / 1000;
		const t = Math.min(1, input.stateTime / spinDur);
		const spin = easeInOutSine(t) * Math.PI * 2;
		renderYaw = newFacingYaw + spin;
		pitchAngle = lerpToward(pitchAngle, 0.3, 14 * dt);
		renderPitch = pitchAngle;
		targetScaleY = 0.4;
	} else if (state === "crouch_slide") {
		// Butt slide: torso upright with a small back-lean, legs folded under.
		// M64 source of long jump. Pose reads as "sitting and gliding" rather
		// than face-down sprawl.
		pitchAngle = lerpToward(pitchAngle, Math.PI / 8, 10 * dt);
		renderPitch = pitchAngle;
		targetScaleY = 0.55;
	} else if (state === "stomach_slide") {
		// Belly slide after a dive landing. Face-first sprawl.
		pitchAngle = lerpToward(pitchAngle, -Math.PI / 2, 12 * dt);
		renderPitch = pitchAngle;
		targetScaleY = 0.55;
	} else if (state === "slope_slide") {
		pitchAngle = lerpToward(pitchAngle, Math.PI / 5, 10 * dt);
		renderPitch = pitchAngle;
		targetScaleY = 0.7;
	} else {
		// Decay accumulated rotation back to upright. Normalize to [-π, π] first
		// so we don't have to unwind multiple full somersaults.
		const tau = Math.PI * 2;
		pitchAngle = ((((pitchAngle + Math.PI) % tau) + tau) % tau) - Math.PI;
		pitchAngle = lerpToward(pitchAngle, 0, 12 * dt);
		yawSpin = lerpToward(yawSpin, 0, 8 * dt);
		renderPitch = pitchAngle;
	}

	// Per-move landing recovery: moveVariant latched at takeoff is snapshotted
	// into landingStyle on touchdown. During the window, deepen the squat and
	// apply a small pitch tilt so single/double/triple/long/dive/pound all read
	// as different recoveries without extra states.
	if (
		state === "grounded" &&
		input.landingStyle &&
		input.landingStyleT > 0
	) {
		const peakDur = 0.22; // largest window (triple/pound)
		const fade = Math.min(1, input.landingStyleT / peakDur);
		const depth = landingDepth(input.landingStyle);
		const tilt = landingPitchTilt(input.landingStyle) * fade;
		targetScaleY = Math.min(targetScaleY, 1 - (1 - depth) * fade);
		renderPitch = tilt;
		pitchAngle = tilt;
	}

	// Crouch scale with grace period (150ms) so grounded flicker doesn't spam
	// the pose up/down while shift is held.
	const recentlyGrounded = grounded || timeSinceGrounded < 0.15;
	if (
		crouching &&
		recentlyGrounded &&
		state !== "crouch_slide" &&
		state !== "stomach_slide" &&
		state !== "slope_slide" &&
		state !== "crawl" &&
		state !== "sweep_kick"
	) {
		targetScaleY = 0.55;
	}

	// Landing squash: multiply target scale down briefly right after a hard landing.
	// landingSquashT decays linearly from its initial value toward 0 each frame.
	// Window matches the largest value player.ts can assign (pound impact) so
	// early frames don't saturate at max depth instead of easing in.
	const squashMaxT = Math.max(0.18, config.groundPoundImpactSquashMs / 1000);
	const squashFrac = Math.max(
		0,
		Math.min(1, input.landingSquashT / squashMaxT),
	);
	const squashMult = 1 - squashFrac * 0.3; // 1.0 → 0.7 at peak squash

	const scaleY = lerpToward(currentScaleY, targetScaleY * squashMult, 15 * dt);
	const offsetY = -(1 - scaleY) * HALF_BODY;

	return {
		facingYaw: newFacingYaw,
		pitchAngle,
		yawSpin,
		renderYaw,
		renderPitch,
		renderRoll,
		scaleY,
		offsetY,
	};
}

function easeInOutSine(t: number): number {
	return -(Math.cos(Math.PI * t) - 1) / 2;
}

// Punch/kick extension envelope: ramp 0→1 over startup half of active phase,
// hold 1 through the rest of active, ramp 1→0 over recovery. Reads as
// "wind up, snap, retract" without any baked animation.
function punchExtension(
	stateTime: number,
	activeSec: number,
	totalSec: number,
): number {
	if (stateTime >= totalSec) return 0;
	const ramp = activeSec * 0.5;
	if (stateTime < ramp) return stateTime / ramp;
	if (stateTime < activeSec) return 1;
	const r = (stateTime - activeSec) / Math.max(0.001, totalSec - activeSec);
	return 1 - r;
}

// Minimum scale.y during landing recovery. Heavier moves crunch deeper.
function landingDepth(variant: MoveVariant): number {
	switch (variant) {
		case "dive":
			return 0.5;
		case "ground_pound":
			return 0.55;
		case "long_jump":
			return 0.6;
		case "triple":
		case "backflip":
		case "side_flip":
			return 0.75;
		case "double":
		case "wall_kick":
			return 0.85;
		case "single":
			return 0.95;
		case "punch":
			return 0.97; // negligible — punches don't land, they recover
		case "sweep_kick":
			return 0.5; // crouch-deep recovery
		case "aerial_kick":
			return 0.85; // light recovery, similar to wall_kick
	}
}

// Recovery pitch tilt (radians) at peak of landing window. Fades to 0.
function landingPitchTilt(variant: MoveVariant): number {
	switch (variant) {
		case "dive":
			return -Math.PI / 5; // face-first sprawl
		case "long_jump":
			return -Math.PI / 8; // forward tumble
		case "backflip":
			return Math.PI / 10; // slight back lean on recovery
		case "ground_pound":
			return 0.1; // compact stomp, minimal tilt
		default:
			return 0;
	}
}

function shouldRotateFacing(state: PlayerState, jumpChain: number): boolean {
	if (state === "skid" || state === "wall_slide") return false;
	if (
		state === "backflip" ||
		state === "long_jump" ||
		state === "side_flip" ||
		state === "ground_pound_start" ||
		state === "dive" ||
		state === "ground_pound" ||
		state === "stomach_slide" ||
		state === "ledge_climb_fast" ||
		state === "ledge_climb_slow" ||
		state === "ledge_climb_down" ||
		state === "punch_1" ||
		state === "punch_2" ||
		state === "kick" ||
		state === "sweep_kick" ||
		state === "aerial_kick"
	) {
		return false;
	}
	if (state === "airborne" && jumpChain === 3) return false;
	return true;
}

export type LimbTargets = {
	armL: THREE.Vector3;
	armR: THREE.Vector3;
	footL: THREE.Vector3;
	footR: THREE.Vector3;
};

export type LimbInput = {
	state: PlayerState;
	horizSpeed: number;
	accumTime: number;
	stateTime: number;
	shimmyDir: number;
	jumpChain: number;
};

/**
 * Procedural limb positions per state. No rig — just target offsets in the
 * inner-group's local space, lerped toward each frame. Keeps the character
 * readable without animation debt.
 *
 * Convention: +Z = behind player (tail), -Z = in front (nose). +X = right.
 */
export function computeLimbs(input: LimbInput): LimbTargets {
	const { state, horizSpeed, accumTime, stateTime, shimmyDir, jumpChain } =
		input;
	// Defaults: arms at sides, feet straight below. All pose branches override.
	const shoulder = 0.15; // Y offset for arms in stand pose
	const footY = -HALF_BODY + 0.04;
	const armL = new THREE.Vector3(-RADIUS - 0.08, shoulder, 0);
	const armR = new THREE.Vector3(RADIUS + 0.08, shoulder, 0);
	const footL = new THREE.Vector3(-0.15, footY, 0);
	const footR = new THREE.Vector3(0.15, footY, 0);

	// Running swing for ground states. Phase from accumulated time (simple sine).
	// Faster horizontal speed → wider swing + higher frequency.
	const isGroundish = state === "grounded" || state === "skid";
	if (isGroundish && horizSpeed > 1) {
		const intensity = Math.min(1, horizSpeed / 6);
		const freq = 6 + intensity * 3;
		const phase = Math.sin(accumTime * freq);
		const swing = 0.25 * intensity;
		armL.z = phase * swing;
		armR.z = -phase * swing;
		// Feet swing in anti-phase to arms (natural gait)
		footL.z = -phase * swing * 0.7;
		footR.z = phase * swing * 0.7;
		footL.y = footY + Math.max(0, -phase) * 0.1 * intensity;
		footR.y = footY + Math.max(0, phase) * 0.1 * intensity;
	}

	switch (state) {
		case "long_jump":
		case "dive": {
			// Superman: arms forward, legs back
			armL.set(-0.3, 0.25, -0.5);
			armR.set(0.3, 0.25, -0.5);
			footL.set(-0.15, -0.2, 0.3);
			footR.set(0.15, -0.2, 0.3);
			break;
		}
		case "backflip": {
			// Tuck (first half) → extend (second half). Drives a readable
			// "compress → release" silhouette instead of a static shape.
			const tDur = Math.max(0.001, config.backflipRotationDuration);
			const tFrac = Math.min(1, stateTime / tDur);
			const tuck = tFrac < 0.5 ? tFrac * 2 : (1 - tFrac) * 2; // 0→1→0
			const r = 0.25 - tuck * 0.1; // arms come in as tuck deepens
			const zBack = 0.15 + tuck * 0.18;
			armL.set(-r, 0.18, -zBack);
			armR.set(r, 0.18, -zBack);
			const footZ = 0.1 - tuck * 0.4; // legs tuck toward the chest
			footL.set(-0.15, -0.2 - tuck * 0.2, footZ);
			footR.set(0.15, -0.2 - tuck * 0.2, footZ);
			break;
		}
		case "side_flip": {
			// M64 MARIO_ANIM_SLIDEFLIP approximation: arms do a windmill around
			// the shoulder axis over the duration; legs arc sideways. Body
			// rotation is intentionally tiny (see computePose) — the flip
			// illusion comes from the limb motion and the 180° yaw flip.
			const dur = Math.max(0.001, config.sideFlipRotationDuration);
			const phase = Math.min(1, stateTime / dur) * Math.PI * 2;
			const spin = config.sideFlipArmSpinRate;
			const p = phase * Math.max(1, spin / 4); // rough control over rev count
			// Right arm sweeps the front hemisphere, left arm follows 180° off.
			const r = 0.55;
			armR.set(Math.cos(p) * r, 0.3 + Math.sin(p) * 0.35, 0);
			armL.set(Math.cos(p + Math.PI) * r, 0.3 + Math.sin(p + Math.PI) * 0.35, 0);
			// Legs arc out opposite of arms, tighter radius.
			footL.set(-0.25, footY + Math.sin(p) * 0.15, Math.cos(p) * 0.2);
			footR.set(0.25, footY + Math.sin(p + Math.PI) * 0.15, Math.cos(p + Math.PI) * 0.2);
			break;
		}
		case "ground_pound_start": {
			// Tight tuck before the slam.
			armL.set(-0.22, 0.18, -0.28);
			armR.set(0.22, 0.18, -0.28);
			footL.set(-0.14, -0.26, -0.22);
			footR.set(0.14, -0.26, -0.22);
			break;
		}
		case "ground_pound": {
			// Arms crossed over chest, legs straight down driving into ground.
			armL.set(0.1, 0.15, -0.15);
			armR.set(-0.1, 0.15, -0.15);
			footL.set(-0.1, footY - 0.08, -0.04);
			footR.set(0.1, footY - 0.08, -0.04);
			break;
		}
		case "wall_slide": {
			// Arms splayed against wall (nose faces wall so -Z = wall direction)
			armL.set(-0.38, 0.45, -0.3);
			armR.set(0.38, 0.45, -0.3);
			footL.set(-0.18, footY, -0.1);
			footR.set(0.18, footY, -0.1);
			break;
		}
		case "ledge_hang":
		case "ledge_climb_slow":
		case "ledge_climb_down": {
			// Arms straight up grabbing ledge; legs hang. Body stays vertical
			// (see computePose — ledgePoseDeg = 0); the hands do the work.
			armL.set(-0.28, 0.7, -0.25);
			armR.set(0.28, 0.7, -0.25);
			// Shimmy: alternating hand-step cycle. Active hand rises + reaches
			// in the travel direction, anchor hand stays put. Phase cycles at
			// shimmyHandCycleHz.
			if (state === "ledge_hang" && shimmyDir !== 0) {
				const cycle = accumTime * config.shimmyHandCycleHz * Math.PI * 2;
				const lift = config.shimmyHandLift;
				const reach = config.shimmyHandReach * shimmyDir;
				// Sin goes -1..1; clamp to 0..1 so only the "up half" of the cycle
				// releases the hand.
				const lPhase = Math.max(0, Math.sin(cycle));
				const rPhase = Math.max(0, Math.sin(cycle + Math.PI));
				armL.y += lPhase * lift;
				armR.y += rPhase * lift;
				armL.x += lPhase * reach;
				armR.x += rPhase * reach;
			}
			footL.set(-0.18, footY + 0.05, 0.15);
			footR.set(0.18, footY + 0.05, 0.15);
			break;
		}
		case "ledge_climb_fast": {
			// Fast pop-up: arms wider, knees coming up faster
			armL.set(-0.38, 0.55, -0.3);
			armR.set(0.38, 0.55, -0.3);
			footL.set(-0.15, footY + 0.25, -0.05);
			footR.set(0.15, footY + 0.25, -0.05);
			break;
		}
		case "crouch_slide": {
			// Butt slide: arms out back for balance, feet forward and slightly
			// bent. Torso handled by back-lean pitch in computePose.
			armL.set(-0.45, 0.05, 0.25);
			armR.set(0.45, 0.05, 0.25);
			footL.set(-0.15, -0.1, -0.3);
			footR.set(0.15, -0.1, -0.3);
			break;
		}
		case "stomach_slide": {
			// Belly slide after dive: flat on belly — arms forward, feet back.
			// Scale.y is 0.55 so actual world placement is already low.
			armL.set(-0.3, -0.1, -0.4);
			armR.set(0.3, -0.1, -0.4);
			footL.set(-0.15, -0.1, 0.35);
			footR.set(0.15, -0.1, 0.35);
			break;
		}
		case "slope_slide": {
			// Sitting on slope — arms back for balance
			armL.set(-0.45, 0.1, 0.3);
			armR.set(0.45, 0.1, 0.3);
			footL.set(-0.15, footY, -0.15);
			footR.set(0.15, footY, -0.15);
			break;
		}
		case "skid": {
			// Feet forward-braking, arms out to sides for balance
			armL.set(-0.55, 0.2, 0);
			armR.set(0.55, 0.2, 0);
			footL.set(-0.18, footY, -0.2);
			footR.set(0.18, footY, -0.2);
			break;
		}
		case "punch_1": {
			// Right-hand jab. Arm extends forward during active phase, retracts
			// during recovery. Active fraction = stateTime / activeMs/1000;
			// after that, ext linearly retracts.
			const activeSec = config.punch1ActiveMs / 1000;
			const totalSec = activeSec + config.punch1RecoveryMs / 1000;
			const ext = punchExtension(stateTime, activeSec, totalSec);
			armR.set(0.15 + ext * 0.08, 0.25, -0.2 - ext * 0.45); // right fist forward
			armL.set(-0.4, 0.18, 0.15); // left arm pulled back, guard
			footL.set(-0.18, footY, 0.05);
			footR.set(0.18, footY, -0.1);
			break;
		}
		case "punch_2": {
			// Mirror of punch_1: left-hand jab.
			const activeSec = config.punch2ActiveMs / 1000;
			const totalSec = activeSec + config.punch2RecoveryMs / 1000;
			const ext = punchExtension(stateTime, activeSec, totalSec);
			armL.set(-0.15 - ext * 0.08, 0.25, -0.2 - ext * 0.45);
			armR.set(0.4, 0.18, 0.15);
			footL.set(-0.18, footY, -0.1);
			footR.set(0.18, footY, 0.05);
			break;
		}
		case "kick": {
			// Right kick: leg snaps forward + up during active, retracts on
			// recovery. Arms stay slightly out for counter-balance.
			const activeSec = config.kickActiveMs / 1000;
			const totalSec = activeSec + config.kickRecoveryMs / 1000;
			const ext = punchExtension(stateTime, activeSec, totalSec);
			footR.set(0.1, footY + ext * 0.45, -0.15 - ext * 0.45);
			footL.set(-0.18, footY, 0.1);
			armL.set(-0.45, 0.2, 0.1);
			armR.set(0.5, 0.15, 0.18);
			break;
		}
		case "crawl": {
			// Quadruped: arms forward + down, feet behind, alternating gait.
			// Anti-phase: left arm + right foot lead, then right arm + left foot.
			// Frequency scales with speed so animation stays in sync with motion.
			const intensity = Math.min(1, horizSpeed / 2);
			const freq = 4 + intensity * 2; // 4-6 Hz at full crawl
			const phase = Math.sin(accumTime * freq);
			const swing = 0.18 * intensity;
			armL.set(-0.25, -0.05 + Math.max(0, phase) * 0.08, -0.3 - phase * swing);
			armR.set(0.25, -0.05 + Math.max(0, -phase) * 0.08, -0.3 + phase * swing);
			footL.set(-0.18, footY + 0.05, 0.18 + phase * swing);
			footR.set(0.18, footY + 0.05, 0.18 - phase * swing);
			break;
		}
		case "aerial_kick": {
			// Spin kick: right leg out front and slightly up, left leg tucked
			// near the body, arms spread for counter-rotation. Phase ramps the
			// extension in over the first 100ms of stateTime so the kick
			// reads as "snap" rather than already extended at trigger.
			const ext = Math.min(1, stateTime / 0.1);
			footR.set(0.05, footY + 0.15 + ext * 0.2, -0.15 - ext * 0.45);
			footL.set(-0.12, footY - 0.05, 0.1);
			armL.set(-0.45, 0.25, 0.05);
			armR.set(0.45, 0.25, 0.15);
			break;
		}
		case "sweep_kick": {
			// Breakdance pose: hands planted on ground, leg extended for the sweep.
			// Phase envelope: ramp up across startup, hold across active, ramp down
			// across recovery. ext drives leg extension and arm-press depth.
			const startup = config.sweepStartupMs / 1000;
			const active = config.sweepActiveMs / 1000;
			const total = startup + active + config.sweepRecoveryMs / 1000;
			let ext: number;
			if (stateTime < startup) ext = stateTime / startup;
			else if (stateTime < startup + active) ext = 1;
			else if (stateTime < total)
				ext = 1 - (stateTime - startup - active) / (total - startup - active);
			else ext = 0;
			// Arms press into ground in front of the body
			armL.set(-0.32, -0.2 - ext * 0.1, -0.25);
			armR.set(0.32, -0.2 - ext * 0.1, -0.25);
			// Right leg sweeps out wide and forward; left tucked as anchor
			footR.set(0.15 + ext * 0.5, footY + ext * 0.08, -0.1 - ext * 0.4);
			footL.set(-0.15, footY + 0.05, 0.15);
			break;
		}
		case "airborne": {
			if (jumpChain === 3) {
				// Triple jump: phase-based tuck → extend silhouette, matches
				// the forward somersault rotation in computePose. Compact in
				// the middle of the rotation, opens up on the way out.
				const tDur = Math.max(0.001, config.tripleRotationDuration);
				const tFrac = Math.min(1, stateTime / tDur);
				const tuck = tFrac < 0.5 ? tFrac * 2 : (1 - tFrac) * 2; // 0→1→0
				const r = 0.28 - tuck * 0.1;
				const zBack = 0.05 + tuck * 0.2;
				armL.set(-r, 0.2, -zBack);
				armR.set(r, 0.2, -zBack);
				const footZ = 0.1 - tuck * 0.35;
				footL.set(-0.15, -0.15 - tuck * 0.2, footZ);
				footR.set(0.15, -0.15 - tuck * 0.2, footZ);
			} else {
				// Simple jump pose: arms slightly up
				armL.set(-0.35, 0.3, -0.1);
				armR.set(0.35, 0.3, -0.1);
			}
			break;
		}
	}

	return { armL, armR, footL, footR };
}

function lerpAngle(current: number, target: number, step: number): number {
	const tau = Math.PI * 2;
	let d = target - current;
	while (d > Math.PI) d -= tau;
	while (d < -Math.PI) d += tau;
	if (Math.abs(d) <= step) return target;
	return current + Math.sign(d) * step;
}

function lerpToward(current: number, target: number, step: number): number {
	const d = target - current;
	if (Math.abs(d) <= step) return target;
	return current + Math.sign(d) * step;
}
