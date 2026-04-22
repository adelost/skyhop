<script lang="ts">
	import { config } from '$game/config.svelte';

	let { open = $bindable(false) }: { open?: boolean } = $props();

	type SliderDef = { key: keyof typeof config; min: number; max: number; step: number };
	const sliders: SliderDef[] = [
		{ key: 'moveSpeed', min: 1, max: 20, step: 0.1 },
		{ key: 'accel', min: 5, max: 200, step: 1 },
		{ key: 'decel', min: 5, max: 200, step: 1 },
		{ key: 'airControl', min: 0, max: 1, step: 0.05 },
		{ key: 'jumpVel', min: 3, max: 25, step: 0.1 },
		{ key: 'jumpCut', min: 0, max: 1, step: 0.05 },
		{ key: 'gravity', min: -80, max: -5, step: 0.5 },
		{ key: 'terminalVel', min: 10, max: 100, step: 1 },
		{ key: 'coyoteMs', min: 0, max: 300, step: 10 },
		{ key: 'bufferMs', min: 0, max: 300, step: 10 },
		{ key: 'slopeSlideAngleDeg', min: 20, max: 80, step: 1 },
		{ key: 'slopeBoost', min: 0, max: 20, step: 0.5 },
		{ key: 'doubleJumpWindowMs', min: 100, max: 600, step: 10 },
		{ key: 'doubleJumpVel', min: 5, max: 25, step: 0.1 },
		{ key: 'tripleJumpVel', min: 5, max: 30, step: 0.1 },
		{ key: 'longJumpVelY', min: 3, max: 15, step: 0.1 },
		{ key: 'longJumpVelXZ', min: 5, max: 25, step: 0.1 },
		{ key: 'backflipVelY', min: 5, max: 25, step: 0.1 },
		{ key: 'sideFlipVelY', min: 5, max: 25, step: 0.1 },
		{ key: 'wallKickVelY', min: 3, max: 20, step: 0.1 },
		{ key: 'wallKickVelXZ', min: 3, max: 20, step: 0.1 },
		{ key: 'groundPoundVel', min: -50, max: -5, step: 0.5 },
		{ key: 'groundPoundBounce', min: 0, max: 20, step: 0.5 },
		{ key: 'diveVelY', min: 0, max: 10, step: 0.1 },
		{ key: 'diveVelXZ', min: 3, max: 25, step: 0.1 }
	];

	function reset() {
		config.moveSpeed = 6;
		config.accel = 50;
		config.decel = 40;
		config.airControl = 0.3;
		config.jumpVel = 10;
		config.jumpCut = 0.45;
		config.gravity = -30;
		config.terminalVel = 40;
		config.coyoteMs = 120;
		config.bufferMs = 120;
		config.slopeSlideAngleDeg = 38;
		config.slopeBoost = 5;
		config.doubleJumpWindowMs = 300;
		config.doubleJumpVel = 12;
		config.tripleJumpVel = 14;
		config.longJumpVelY = 7;
		config.longJumpVelXZ = 14;
		config.backflipVelY = 14;
		config.backflipVelXZ = -6;
		config.sideFlipVelY = 13;
		config.wallKickVelY = 11;
		config.wallKickVelXZ = 8;
		config.wallStickMs = 200;
		config.groundPoundVel = -25;
		config.groundPoundBounce = 6;
		config.diveVelY = 3;
		config.diveVelXZ = 12;
	}
</script>

{#if open}
	<div class="panel">
		<div class="head">
			<strong>tuning</strong>
			<button class="btn" onclick={reset}>reset</button>
			<button class="btn" onclick={() => (open = false)}>×</button>
		</div>
		<div class="body">
			{#each sliders as s (s.key)}
				<label>
					<span class="name">{s.key}</span>
					<span class="val">{config[s.key].toFixed(2)}</span>
					<input
						type="range"
						min={s.min}
						max={s.max}
						step={s.step}
						bind:value={config[s.key]}
					/>
				</label>
			{/each}
		</div>
		<div class="hint">T = toggle · R = respawn</div>
	</div>
{:else}
	<button class="toggle" onclick={() => (open = true)}>⚙</button>
{/if}

<style>
	.panel {
		position: fixed;
		left: 10px;
		bottom: 10px;
		width: 260px;
		max-height: 70vh;
		overflow-y: auto;
		background: rgba(10, 10, 26, 0.88);
		color: #cfe;
		font-family: ui-monospace, Menlo, Consolas, monospace;
		font-size: 11px;
		border-radius: 8px;
		padding: 8px 10px 10px;
		z-index: 20;
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 6px;
		margin-bottom: 6px;
	}
	.btn {
		background: rgba(255, 255, 255, 0.1);
		color: #cfe;
		border: 1px solid rgba(255, 255, 255, 0.2);
		border-radius: 4px;
		padding: 2px 8px;
		font: inherit;
		cursor: pointer;
	}
	.btn:hover {
		background: rgba(255, 255, 255, 0.2);
	}
	.body {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	label {
		display: grid;
		grid-template-columns: 1fr auto;
		grid-template-rows: auto auto;
		column-gap: 8px;
	}
	.name {
		grid-column: 1;
		opacity: 0.8;
	}
	.val {
		grid-column: 2;
		text-align: right;
		font-weight: 600;
	}
	input[type='range'] {
		grid-column: 1 / -1;
		width: 100%;
		margin: 2px 0 4px;
	}
	.hint {
		margin-top: 8px;
		opacity: 0.5;
		font-size: 10px;
	}
	.toggle {
		position: fixed;
		left: 10px;
		bottom: 10px;
		width: 36px;
		height: 36px;
		border-radius: 8px;
		background: rgba(10, 10, 26, 0.55);
		color: #cfe;
		border: 1px solid rgba(255, 255, 255, 0.2);
		font-size: 18px;
		cursor: pointer;
		z-index: 20;
	}
</style>
