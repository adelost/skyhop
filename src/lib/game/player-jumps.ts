import type { PlayerState } from './player';
import type { WallNormal } from './player-queries';
import { config } from './config.svelte';

export type FacingUpdate = 'snap-to-velocity' | 'keep' | { yaw: number };

export type JumpOutcome = {
	velocity: { x: number; y: number; z: number };
	state: PlayerState;
	jumpChain: number;
	facing: FacingUpdate;
};

export type JumpContext = {
	crouchHeld: boolean;
	mx: number;
	mz: number;
	horizSpeed: number;
	velocity: { x: number; y: number; z: number };
	facingYaw: number;
	chainOnLanding: number;
	timeSinceLanding: number;
	/** M64 long jump only fires from a real crouch-slide. */
	state: PlayerState;
	/** M64 side flip only fires from skid (turnaround) — not arbitrary input
	 * reversal. Gate side flip on this rather than on velocity vs input. */
	inSkid: boolean;
};

/**
 * Choose and build the right jump impulse from current state + input.
 * Priority: long jump > backflip > side flip > chain jump > normal jump.
 */
export function computeJump(ctx: JumpContext): JumpOutcome {
	const { crouchHeld, mx, mz, horizSpeed, velocity, facingYaw, state, inSkid } = ctx;

	const inputMag = Math.hypot(mx, mz);
	const inputDirX = inputMag > 0.3 ? mx / inputMag : 0;
	const inputDirZ = inputMag > 0.3 ? mz / inputMag : 0;

	const velDirX = horizSpeed > 0.5 ? velocity.x / horizSpeed : 0;
	const velDirZ = horizSpeed > 0.5 ? velocity.z / horizSpeed : 0;

	const windowSec = config.doubleJumpWindowMs / 1000;
	const canChain =
		ctx.timeSinceLanding <= windowSec && ctx.chainOnLanding >= 1 && horizSpeed > 2;

	// M64 long jump (mario_actions_moving.c:1458): only from crouch-slide, not
	// from arbitrary "crouch held + speed". Gating on state keeps long jump as
	// a deliberate slide → A-press combo, not a get-out-of-jail dash.
	if (state === 'crouch_slide' && horizSpeed > 3) {
		const dirX = velDirX || inputDirX;
		const dirZ = velDirZ || inputDirZ;
		return {
			velocity: {
				x: dirX * config.longJumpVelXZ,
				y: config.longJumpVelY,
				z: dirZ * config.longJumpVelXZ
			},
			state: 'long_jump',
			jumpChain: 0,
			facing: 'snap-to-velocity'
		};
	}
	if (crouchHeld) {
		const fx = -Math.sin(facingYaw);
		const fz = -Math.cos(facingYaw);
		return {
			velocity: {
				x: -fx * Math.abs(config.backflipVelXZ),
				y: config.backflipVelY,
				z: -fz * Math.abs(config.backflipVelXZ)
			},
			state: 'backflip',
			jumpChain: 0,
			facing: { yaw: facingYaw }
		};
	}
	// M64 side flip is the A-press during the turnaround/skid state, not a free
	// "input reversed in air" detector. Bound here on inSkid (set when player
	// is in the skid state machine entry from the main step loop).
	if (inSkid) {
		// Side flip launches in input direction; falls back to current velocity
		// direction when the stick has already returned to neutral mid-skid.
		const dirX = inputDirX || velDirX;
		const dirZ = inputDirZ || velDirZ;
		return {
			velocity: {
				x: dirX * config.sideFlipVelXZ,
				y: config.sideFlipVelY,
				z: dirZ * config.sideFlipVelXZ
			},
			state: 'side_flip',
			jumpChain: 0,
			facing: 'snap-to-velocity'
		};
	}
	if (canChain) {
		const chain = ctx.chainOnLanding + 1;
		if (chain >= 3) {
			return {
				velocity: { x: velocity.x, y: config.tripleJumpVel, z: velocity.z },
				state: 'airborne',
				jumpChain: 3,
				facing: 'snap-to-velocity'
			};
		}
		return {
			velocity: {
				x: velocity.x,
				y: config.doubleJumpVel + config.runDoubleJumpBonus * horizSpeed,
				z: velocity.z
			},
			state: 'airborne',
			jumpChain: chain,
			facing: 'keep'
		};
	}
	return {
		velocity: {
			x: velocity.x,
			y: config.jumpVel + config.runJumpBonus * horizSpeed,
			z: velocity.z
		},
		state: 'airborne',
		jumpChain: 1,
		facing: 'keep'
	};
}

/** Wall-kick impulse. */
export function computeWallKick(wallNormal: WallNormal): {
	velocity: { x: number; y: number; z: number };
	targetYaw: number;
} {
	const vx = wallNormal.x * config.wallKickVelXZ;
	const vz = wallNormal.z * config.wallKickVelXZ;
	return {
		velocity: { x: vx, y: config.wallKickVelY, z: vz },
		targetYaw: Math.atan2(-vx, -vz)
	};
}
