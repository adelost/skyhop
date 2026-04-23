import * as THREE from "three";
import type { PlayerState } from "./player";
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
};

export type PoseOutput = {
	facingYaw: number;
	pitchAngle: number;
	yawSpin: number;
	renderYaw: number;
	renderPitch: number;
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
	let targetScaleY = 1;

	if (state === "long_jump") {
		pitchAngle = lerpToward(pitchAngle, -Math.PI / 3, 10 * dt);
		renderPitch = pitchAngle;
	} else if (state === "dive") {
		pitchAngle = lerpToward(pitchAngle, -Math.PI / 2, 12 * dt);
		renderPitch = pitchAngle;
	} else if (state === "backflip") {
		pitchAngle += 8 * dt;
		renderPitch = pitchAngle;
	} else if (state === "side_flip") {
		pitchAngle -= 12 * dt;
		renderPitch = pitchAngle;
	} else if (state === "ground_pound_start") {
		// Quick tuck/somersault before the actual stomp commits downward.
		pitchAngle -= 22 * dt;
		renderPitch = pitchAngle;
		targetScaleY = 0.72;
	} else if (state === "ground_pound") {
		// Snap back into a feet-down stomp rather than continuing to tumble.
		pitchAngle = lerpToward(pitchAngle, 0.08, 22 * dt);
		renderPitch = pitchAngle;
		targetScaleY = 0.92;
	} else if (state === "airborne" && input.jumpChain === 3) {
		pitchAngle -= 6.5 * dt;
		renderPitch = pitchAngle;
	} else if (state === "wall_slide" && wallNormal) {
		renderYaw = Math.atan2(wallNormal.x, wallNormal.z);
		const target = (config.wallSlidePoseDeg * Math.PI) / 180;
		pitchAngle = lerpToward(pitchAngle, target, config.poseLerpRate * dt);
		renderPitch = pitchAngle;
	} else if (state === "ledge_hang") {
		const target = (config.ledgePoseDeg * Math.PI) / 180;
		pitchAngle = lerpToward(pitchAngle, target, config.poseLerpRate * dt);
		renderPitch = pitchAngle;
	} else if (state === "skid") {
		const targetLean = (config.skidLeanDeg * Math.PI) / 180;
		pitchAngle = lerpToward(pitchAngle, targetLean, 10 * dt);
		renderPitch = pitchAngle;
	} else if (state === "crouch_slide") {
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

	// Crouch scale with grace period (150ms) so grounded flicker doesn't spam
	// the pose up/down while shift is held.
	const recentlyGrounded = grounded || timeSinceGrounded < 0.15;
	if (
		crouching &&
		recentlyGrounded &&
		state !== "crouch_slide" &&
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
		scaleY,
		offsetY,
	};
}

function shouldRotateFacing(state: PlayerState, jumpChain: number): boolean {
	if (state === "skid" || state === "wall_slide") return false;
	if (
		state === "backflip" ||
		state === "long_jump" ||
		state === "side_flip" ||
		state === "ground_pound_start" ||
		state === "dive" ||
		state === "ground_pound"
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
		case "ledge_hang": {
			// Arms straight up grabbing ledge; legs hang
			armL.set(-0.28, 0.7, -0.25);
			armR.set(0.28, 0.7, -0.25);
			footL.set(-0.18, footY + 0.05, 0.15);
			footR.set(0.18, footY + 0.05, 0.15);
			break;
		}
		case "crouch_slide": {
			// Flat on belly — arms forward, feet back. Scale.y is 0.55 so
			// actual world placement is already low.
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
