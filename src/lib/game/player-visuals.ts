import type { PlayerState } from './player';
import type { WallNormal } from './player-queries';
import { config } from './config.svelte';

const RADIUS = 0.4;
const HEIGHT = 0.8;
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
		currentScaleY
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

	if (state === 'long_jump') {
		pitchAngle = lerpToward(pitchAngle, -Math.PI / 3, 10 * dt);
		renderPitch = pitchAngle;
	} else if (state === 'dive') {
		pitchAngle = lerpToward(pitchAngle, -Math.PI / 2, 12 * dt);
		renderPitch = pitchAngle;
	} else if (state === 'backflip') {
		pitchAngle += 8 * dt;
		renderPitch = pitchAngle;
	} else if (state === 'side_flip') {
		pitchAngle -= 12 * dt;
		renderPitch = pitchAngle;
	} else if (state === 'ground_pound') {
		pitchAngle -= 18 * dt;
		renderPitch = pitchAngle;
	} else if (state === 'airborne' && input.jumpChain === 3) {
		pitchAngle -= 6.5 * dt;
		renderPitch = pitchAngle;
	} else if (state === 'wall_slide' && wallNormal) {
		renderYaw = Math.atan2(wallNormal.x, wallNormal.z);
		const target = (config.wallSlidePoseDeg * Math.PI) / 180;
		pitchAngle = lerpToward(pitchAngle, target, config.poseLerpRate * dt);
		renderPitch = pitchAngle;
	} else if (state === 'ledge_hang') {
		const target = (config.ledgePoseDeg * Math.PI) / 180;
		pitchAngle = lerpToward(pitchAngle, target, config.poseLerpRate * dt);
		renderPitch = pitchAngle;
	} else if (state === 'skid') {
		const targetLean = (config.skidLeanDeg * Math.PI) / 180;
		pitchAngle = lerpToward(pitchAngle, targetLean, 10 * dt);
		renderPitch = pitchAngle;
	} else if (state === 'crouch_slide') {
		pitchAngle = lerpToward(pitchAngle, -Math.PI / 2, 12 * dt);
		renderPitch = pitchAngle;
		targetScaleY = 0.55;
	} else if (state === 'slope_slide') {
		pitchAngle = lerpToward(pitchAngle, Math.PI / 5, 10 * dt);
		renderPitch = pitchAngle;
		targetScaleY = 0.7;
	} else {
		// Decay accumulated rotation back to upright. Normalize to [-π, π] first
		// so we don't have to unwind multiple full somersaults.
		const tau = Math.PI * 2;
		pitchAngle = (((pitchAngle + Math.PI) % tau) + tau) % tau - Math.PI;
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
		state !== 'crouch_slide' &&
		state !== 'slope_slide'
	) {
		targetScaleY = 0.55;
	}

	const scaleY = lerpToward(currentScaleY, targetScaleY, 15 * dt);
	const offsetY = -(1 - scaleY) * HALF_BODY;

	return {
		facingYaw: newFacingYaw,
		pitchAngle,
		yawSpin,
		renderYaw,
		renderPitch,
		scaleY,
		offsetY
	};
}

function shouldRotateFacing(state: PlayerState, jumpChain: number): boolean {
	if (state === 'skid' || state === 'wall_slide') return false;
	if (
		state === 'backflip' ||
		state === 'long_jump' ||
		state === 'side_flip' ||
		state === 'dive' ||
		state === 'ground_pound'
	) {
		return false;
	}
	if (state === 'airborne' && jumpChain === 3) return false;
	return true;
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
