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
		// M64 dive pitches gradually toward ~-60°, not full -90°. Full vertical
		// reads as face-plant rather than superman dive. The lerp lets it settle
		// there instead of snapping.
		pitchAngle = lerpToward(pitchAngle, -Math.PI / 3, 12 * dt);
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
		// M64 side flip is MARIO_ANIM_SLIDEFLIP: a sideways roll plus extra yaw
		// spin, not a forward somersault. Phase-ease the roll over the full
		// duration so it starts and ends softly. Yaw-spin decays over the first
		// half to sell the pirouette without over-rotating.
		const dur = Math.max(0.001, config.sideFlipRotationDuration);
		const t = Math.min(1, input.stateTime / dur);
		renderRoll = easeInOutSine(t) * -(Math.PI * 2);
		pitchAngle = lerpToward(pitchAngle, 0, 12 * dt);
		renderPitch = pitchAngle;
		const spinFrac = Math.max(0, 1 - t * 2);
		yawSpin += config.sideFlipYawSpinRate * dt * spinFrac;
		renderYaw = newFacingYaw + yawSpin;
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
		state !== "slope_slide"
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
		state === "ledge_climb_down"
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

/**
 * Procedural limb positions per state. No rig — just target offsets in the
 * inner-group's local space, lerped toward each frame. Keeps the character
 * readable without animation debt.
 *
 * Convention: +Z = behind player (tail), -Z = in front (nose). +X = right.
 */
export function computeLimbs(
	state: PlayerState,
	horizSpeed: number,
	accumTime: number,
): LimbTargets {
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
			// Arms tucked, legs tucked — compact rotation
			armL.set(-0.25, 0.15, -0.25);
			armR.set(0.25, 0.15, -0.25);
			footL.set(-0.15, -0.35, -0.2);
			footR.set(0.15, -0.35, -0.2);
			break;
		}
		case "side_flip": {
			// Windmill: arms out wide
			armL.set(-0.55, 0.4, 0);
			armR.set(0.55, 0.4, 0);
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
			// Arms straight up grabbing ledge; legs hang
			armL.set(-0.28, 0.7, -0.25);
			armR.set(0.28, 0.7, -0.25);
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
		case "airborne": {
			// Simple jump pose: arms slightly up
			armL.set(-0.35, 0.3, -0.1);
			armR.set(0.35, 0.3, -0.1);
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
