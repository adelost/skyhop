import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Physics } from './physics';
import { config } from './config.svelte';
import { RADIUS, HEIGHT } from './player-constants';

export type WallNormal = { x: number; z: number };

/** Downward ground query with multi-probe fallback for reliable slope detection. */
export function queryGroundSurface(
	physics: Physics,
	collider: RAPIER.Collider,
	body: RAPIER.RigidBody,
	outNormal: THREE.Vector3
): string {
	const { world, rapier } = physics;
	const origin = body.translation();
	const rayOrigin = { x: origin.x, y: origin.y + RADIUS, z: origin.z };
	const ray = new rapier.Ray(rayOrigin, { x: 0, y: -1, z: 0 });
	const maxReach = HEIGHT + RADIUS * 2 + 0.5;
	let best = world.castRayAndGetNormal(ray, maxReach, true, undefined, undefined, collider);

	if (!best || best.normal.y > 0.999) {
		const offsets: [number, number][] = [
			[RADIUS * 0.6, 0],
			[-RADIUS * 0.6, 0],
			[0, RADIUS * 0.6],
			[0, -RADIUS * 0.6]
		];
		for (const [ox, oz] of offsets) {
			const probe = new rapier.Ray(
				{ x: origin.x + ox, y: origin.y + RADIUS, z: origin.z + oz },
				{ x: 0, y: -1, z: 0 }
			);
			const h = world.castRayAndGetNormal(
				probe,
				maxReach,
				true,
				undefined,
				undefined,
				collider
			);
			if (h && (!best || h.normal.y < best.normal.y)) best = h;
		}
	}

	if (!best) {
		outNormal.set(0, 1, 0);
		return 'grass';
	}
	outNormal.set(best.normal.x, best.normal.y, best.normal.z);
	if (best.collider.friction() < 0.1) return 'ice';
	return 'grass';
}

/** Horizontal wall contact query in 4 cardinal directions. */
export function queryWallContact(
	physics: Physics,
	collider: RAPIER.Collider,
	body: RAPIER.RigidBody
): WallNormal | null {
	const { world, rapier } = physics;
	const origin = body.translation();
	const reach = RADIUS + 0.15;
	const dirs: [number, number][] = [
		[1, 0],
		[-1, 0],
		[0, 1],
		[0, -1]
	];
	for (const [dx, dz] of dirs) {
		const ray = new rapier.Ray(
			{ x: origin.x, y: origin.y, z: origin.z },
			{ x: dx, y: 0, z: dz }
		);
		const hit = world.castRayAndGetNormal(ray, reach, true, undefined, undefined, collider);
		if (hit && Math.abs(hit.normal.y) < 0.5) {
			return { x: hit.normal.x, z: hit.normal.z };
		}
	}
	return null;
}

export type LedgeGrabContext = {
	physics: Physics;
	collider: RAPIER.Collider;
	body: RAPIER.RigidBody;
	wallNormal: WallNormal | null;
	velocity: THREE.Vector3;
};

export type LedgeGrabResult = {
	pos: { x: number; y: number; z: number };
	/** Wall-surface normal at the chest-hit point. Used for shimmy + pose. */
	normal: WallNormal;
};

/**
 * Try to grab a ledge in front of the player. Strict gates avoid false positives:
 * chest hits wall, head clears it, ledge top above chest, within reach.
 *
 * Returns the grab position AND the actual wall normal at the chest hit —
 * this is more accurate than the coarse 4-cardinal queryWallContact, which
 * misses platform-edge normals that aren't axis-aligned.
 */
export function tryLedgeGrab(ctx: LedgeGrabContext): LedgeGrabResult | null {
	const { physics, collider, body, wallNormal, velocity } = ctx;
	const { world, rapier } = physics;
	const origin = body.translation();
	const chestY = origin.y + 0.1;
	const headY = origin.y + HEIGHT / 2 + config.ledgeUpReach;

	let fwd: THREE.Vector3;
	if (wallNormal) {
		const invLen = 1 / Math.hypot(wallNormal.x, wallNormal.z);
		fwd = new THREE.Vector3(-wallNormal.x * invLen, 0, -wallNormal.z * invLen);
	} else {
		const horizSp = Math.hypot(velocity.x, velocity.z);
		if (horizSp < 0.5) return null;
		fwd = new THREE.Vector3(velocity.x / horizSp, 0, velocity.z / horizSp);
	}
	const reach = config.ledgeForwardReach;

	const chestHit = world.castRayAndGetNormal(
		new rapier.Ray({ x: origin.x, y: chestY, z: origin.z }, { x: fwd.x, y: 0, z: fwd.z }),
		reach,
		true,
		undefined,
		undefined,
		collider
	);
	if (!chestHit || Math.abs(chestHit.normal.y) > 0.3) return null;

	const intoWall = fwd.x * -chestHit.normal.x + fwd.z * -chestHit.normal.z;
	if (intoWall < 0.4) return null;

	const headHit = world.castRay(
		new rapier.Ray({ x: origin.x, y: headY, z: origin.z }, { x: fwd.x, y: 0, z: fwd.z }),
		reach + 0.15,
		true,
		undefined,
		undefined,
		collider
	);
	if (headHit) return null;

	const probeX = origin.x + fwd.x * (chestHit.timeOfImpact + 0.1);
	const probeZ = origin.z + fwd.z * (chestHit.timeOfImpact + 0.1);
	const aboveWall = { x: probeX, y: headY, z: probeZ };
	const downHit = world.castRayAndGetNormal(
		new rapier.Ray(aboveWall, { x: 0, y: -1, z: 0 }),
		config.ledgeUpReach + 0.3,
		true,
		undefined,
		undefined,
		collider
	);
	if (!downHit || downHit.normal.y < 0.7) return null;

	const ledgeY = aboveWall.y - downHit.timeOfImpact;
	if (ledgeY <= chestY) return null;
	if (ledgeY - chestY > config.ledgeUpReach + HEIGHT / 2) return null;

	const grabY = ledgeY - HEIGHT / 2 - 0.05;
	const wallX = origin.x + fwd.x * chestHit.timeOfImpact;
	const wallZ = origin.z + fwd.z * chestHit.timeOfImpact;
	// Normalize & snap the chest-hit normal to a horizontal WallNormal (project out Y).
	let nx = chestHit.normal.x;
	let nz = chestHit.normal.z;
	const nMag = Math.hypot(nx, nz) || 1;
	nx /= nMag;
	nz /= nMag;
	return {
		pos: {
			x: wallX - fwd.x * (RADIUS + 0.05),
			y: grabY,
			z: wallZ - fwd.z * (RADIUS + 0.05)
		},
		normal: { x: nx, z: nz }
	};
}

/** Verify a candidate shimmy position still has a grabable ledge (chest hits, head clears). */
export function verifyLedgeAt(
	physics: Physics,
	collider: RAPIER.Collider,
	wallNormal: WallNormal | null,
	pos: { x: number; y: number; z: number }
): boolean {
	if (!wallNormal) return false;
	const { world, rapier } = physics;
	const chestY = pos.y + 0.1;
	const headY = pos.y + HEIGHT / 2 + config.ledgeUpReach;
	const fwd = new THREE.Vector3(-wallNormal.x, 0, -wallNormal.z).normalize();
	const reach = config.ledgeForwardReach + 0.1;

	const chest = world.castRayAndGetNormal(
		new rapier.Ray({ x: pos.x, y: chestY, z: pos.z }, { x: fwd.x, y: 0, z: fwd.z }),
		reach,
		true,
		undefined,
		undefined,
		collider
	);
	if (!chest || Math.abs(chest.normal.y) > 0.3) return false;

	const head = world.castRay(
		new rapier.Ray({ x: pos.x, y: headY, z: pos.z }, { x: fwd.x, y: 0, z: fwd.z }),
		reach,
		true,
		undefined,
		undefined,
		collider
	);
	if (head) return false;
	return true;
}

/**
 * Check that the space the player will occupy AFTER pull-up is clear of geometry.
 * Runs a downward ray from above the target pull-up position looking for nearby
 * ceiling + a horizontal check for walls. Called before committing climb so we
 * don't shove the player into a ceiling or thick ledge lip.
 *
 * @param topPos Target stand-on-ledge position (player body center).
 */
export function verifyClearanceAbove(
	physics: Physics,
	collider: RAPIER.Collider,
	topPos: { x: number; y: number; z: number }
): boolean {
	const { world, rapier } = physics;
	// Space above player (must be clear for at least HEIGHT/2 + RADIUS headroom)
	const clearance = HEIGHT + RADIUS;
	const rayUp = world.castRay(
		new rapier.Ray(
			{ x: topPos.x, y: topPos.y, z: topPos.z },
			{ x: 0, y: 1, z: 0 }
		),
		clearance,
		true,
		undefined,
		undefined,
		collider
	);
	if (rayUp) return false;

	// Space in lateral directions (capsule radius) — no wall inside the body
	const dirs: [number, number][] = [
		[1, 0],
		[-1, 0],
		[0, 1],
		[0, -1]
	];
	for (const [dx, dz] of dirs) {
		const ray = world.castRay(
			new rapier.Ray(
				{ x: topPos.x, y: topPos.y, z: topPos.z },
				{ x: dx, y: 0, z: dz }
			),
			RADIUS + 0.05,
			true,
			undefined,
			undefined,
			collider
		);
		if (ray) return false;
	}
	return true;
}
