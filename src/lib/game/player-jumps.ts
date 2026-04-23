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
};

/**
 * Choose and build the right jump impulse from current state + input.
 * Priority: long jump > backflip > side flip > chain jump > normal jump.
 */
export function computeJump(ctx: JumpContext): JumpOutcome {
	const { crouchHeld, mx, mz, horizSpeed, velocity, facingYaw } = ctx;

	const inputMag = Math.hypot(mx, mz);
	const inputDirX = inputMag > 0.3 ? mx / inputMag : 0;
	const inputDirZ = inputMag > 0.3 ? mz / inputMag : 0;

	const velDirX = horizSpeed > 0.5 ? velocity.x / horizSpeed : 0;
	const velDirZ = horizSpeed > 0.5 ? velocity.z / horizSpeed : 0;
	const reversed =
		inputMag > 0.5 &&
		horizSpeed > 0.5 &&
		inputDirX * velDirX + inputDirZ * velDirZ < -0.5;

	const windowSec = config.doubleJumpWindowMs / 1000;
	const canChain =
		ctx.timeSinceLanding <= windowSec && ctx.chainOnLanding >= 1 && horizSpeed > 2;

	if (crouchHeld && horizSpeed > 3) {
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
	if (reversed && horizSpeed > 3) {
		return {
			velocity: {
				x: inputDirX * config.sideFlipVelXZ,
				y: config.sideFlipVelY,
				z: inputDirZ * config.sideFlipVelXZ
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
