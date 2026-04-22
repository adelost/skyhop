import type RAPIER from '@dimforge/rapier3d-compat';

let rapierMod: typeof RAPIER | null = null;

export async function loadRapier(): Promise<typeof RAPIER> {
	if (rapierMod) return rapierMod;
	const mod = await import('@dimforge/rapier3d-compat');
	await mod.init();
	rapierMod = mod;
	return mod;
}

export type Physics = {
	world: RAPIER.World;
	rapier: typeof RAPIER;
};

export async function createPhysics(): Promise<Physics> {
	const rapier = await loadRapier();
	const gravity = { x: 0, y: -30, z: 0 };
	const world = new rapier.World(gravity);
	return { world, rapier };
}
