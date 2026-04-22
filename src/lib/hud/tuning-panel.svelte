<script lang="ts">
	import { config } from '$game/config.svelte';

	let { open = $bindable(false) }: { open?: boolean } = $props();

	type SliderDef = { key: keyof typeof config; min: number; max: number; step: number };
	const sliders: SliderDef[] = [
		{ key: 'moveSpeed', min: 1, max: 20, step: 0.1 },
		{ key: 'accel', min: 5, max: 200, step: 1 },
		{ key: 'decel', min: 1, max: 100, step: 1 },
		{ key: 'airControl', min: 0, max: 1, step: 0.05 },
		{ key: 'jumpVel', min: 3, max: 25, step: 0.1 },
		{ key: 'jumpAscentCutMult', min: 1, max: 10, step: 0.25 },
		{ key: 'gravity', min: -80, max: -5, step: 0.5 },
		{ key: 'terminalVel', min: 10, max: 100, step: 0.5 },
		{ key: 'coyoteMs', min: 0, max: 300, step: 10 },
		{ key: 'bufferMs', min: 0, max: 300, step: 10 },
		{ key: 'slopeSlideAngleDeg', min: 10, max: 80, step: 1 },
		{ key: 'slopeBoost', min: 0, max: 20, step: 0.5 },
		{ key: 'doubleJumpWindowMs', min: 50, max: 600, step: 10 },
		{ key: 'doubleJumpVel', min: 5, max: 30, step: 0.1 },
		{ key: 'tripleJumpVel', min: 5, max: 40, step: 0.1 },
		{ key: 'longJumpVelY', min: 3, max: 20, step: 0.1 },
		{ key: 'longJumpVelXZ', min: 5, max: 30, step: 0.1 },
		{ key: 'backflipVelY', min: 5, max: 30, step: 0.1 },
		{ key: 'sideFlipVelY', min: 5, max: 30, step: 0.1 },
		{ key: 'wallKickVelY', min: 3, max: 30, step: 0.1 },
		{ key: 'wallKickVelXZ', min: 3, max: 20, step: 0.1 },
		{ key: 'wallStickMs', min: 50, max: 400, step: 10 },
		{ key: 'groundPoundVel', min: -50, max: -5, step: 0.5 },
		{ key: 'groundPoundBounce', min: 0, max: 20, step: 0.5 },
		{ key: 'diveVelY', min: 0, max: 10, step: 0.1 },
		{ key: 'diveVelXZ', min: 3, max: 25, step: 0.1 },
		{ key: 'camDistance', min: 4, max: 20, step: 0.5 },
		{ key: 'camHeight', min: 0, max: 10, step: 0.25 },
		{ key: 'camYawSensitivity', min: 0.001, max: 0.02, step: 0.001 },
		{ key: 'camRecenterDelayMs', min: 0, max: 5000, step: 100 },
		{ key: 'camRecenterSpeed', min: 0, max: 4, step: 0.1 },
		{ key: 'rotationSpeed', min: 1, max: 30, step: 0.5 },
		{ key: 'skidDurationMs', min: 0, max: 500, step: 10 },
		{ key: 'runJumpBonus', min: 0, max: 1, step: 0.05 },
		{ key: 'runDoubleJumpBonus', min: 0, max: 1, step: 0.05 },
		{ key: 'wallSlideGravityMult', min: 0, max: 1, step: 0.05 },
		{ key: 'iceFriction', min: 0.01, max: 1, step: 0.01 }
	];

	function reset() {
		// Defaults — matches Super Mario 64 decomp values
		config.moveSpeed = 9.6;
		config.accel = 40;
		config.decel = 9;
		config.airControl = 0.3;
		config.jumpVel = 12.6;
		config.jumpAscentCutMult = 4;
		config.gravity = -36;
		config.terminalVel = 22.5;
		config.coyoteMs = 80;
		config.bufferMs = 80;
		config.slopeSlideAngleDeg = 20;
		config.slopeBoost = 5;
		config.iceFriction = 0.2;
		config.doubleJumpWindowMs = 167;
		config.doubleJumpVel = 15.6;
		config.tripleJumpVel = 20.7;
		config.longJumpVelY = 9;
		config.longJumpVelXZ = 14.4;
		config.backflipVelY = 18.6;
		config.backflipVelXZ = -4.8;
		config.sideFlipVelY = 18.6;
		config.wallKickVelY = 18.6;
		config.wallKickVelXZ = 7.2;
		config.wallStickMs = 167;
		config.groundPoundVel = -15;
		config.groundPoundBounce = 0;
		config.diveVelY = 0;
		config.diveVelXZ = 14.4;
		config.camYawSensitivity = 0.006;
		config.camDistance = 10;
		config.camHeight = 2.5;
		config.camRecenterDelayMs = 1500;
		config.camRecenterSpeed = 0.8;
		config.rotationSpeed = 12;
		config.skidReverseDeg = 135;
		config.skidDurationMs = 150;
		config.runJumpBonus = 0.25;
		config.runDoubleJumpBonus = 0.2;
		config.wallSlideGravityMult = 0.35;
		config.ledgeForwardReach = 0.7;
		config.ledgeUpReach = 0.6;
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
