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
		{ key: 'jumpCutMinVel', min: 0, max: 20, step: 0.5 },
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
		{ key: 'longJumpGravityMult', min: 0.1, max: 1, step: 0.05 },
		{ key: 'backflipVelY', min: 5, max: 30, step: 0.1 },
		{ key: 'sideFlipVelY', min: 5, max: 30, step: 0.1 },
		{ key: 'wallKickVelY', min: 3, max: 30, step: 0.1 },
		{ key: 'wallKickVelXZ', min: 3, max: 20, step: 0.1 },
		{ key: 'wallStickMs', min: 50, max: 400, step: 10 },
		{ key: 'groundPoundStartMs', min: 0, max: 250, step: 10 },
		{ key: 'groundPoundStartVelY', min: 0, max: 8, step: 0.1 },
		{ key: 'groundPoundStartGravityMult', min: 0, max: 1, step: 0.05 },
		{ key: 'groundPoundVel', min: -50, max: -5, step: 0.5 },
		{ key: 'groundPoundBounce', min: 0, max: 20, step: 0.5 },
		{ key: 'groundPoundImpactSquashMs', min: 0, max: 400, step: 10 },
		{ key: 'diveVelY', min: 0, max: 10, step: 0.1 },
		{ key: 'diveVelXZ', min: 3, max: 25, step: 0.1 },
		{ key: 'camDistance', min: 4, max: 20, step: 0.5 },
		{ key: 'camHeight', min: 0, max: 10, step: 0.25 },
		{ key: 'camYawSensitivity', min: 0.001, max: 0.02, step: 0.001 },
		{ key: 'camRecenterDelayMs', min: 0, max: 5000, step: 100 },
		{ key: 'camRecenterSpeed', min: 0, max: 4, step: 0.1 },
		{ key: 'rotationSpeed', min: 1, max: 30, step: 0.5 },
		{ key: 'skidReverseDeg', min: 60, max: 180, step: 5 },
		{ key: 'skidDurationMs', min: 0, max: 800, step: 10 },
		{ key: 'skidVelocityCut', min: 0, max: 1, step: 0.05 },
		{ key: 'skidLeanDeg', min: 0, max: 60, step: 1 },
		{ key: 'wallSlidePoseDeg', min: -60, max: 60, step: 1 },
		{ key: 'ledgePoseDeg', min: -60, max: 60, step: 1 },
		{ key: 'ledgeShimmySpeed', min: 0, max: 6, step: 0.1 },
		{ key: 'ledgeShimmyDeadzone', min: 0, max: 1, step: 0.05 },
		{ key: 'ledgeClimbInputDeadzone', min: 0.1, max: 1, step: 0.05 },
		{ key: 'ledgeClimbCommitMs', min: 0, max: 500, step: 10 },
		{ key: 'ledgeClimbDurationMs', min: 100, max: 1000, step: 20 },
		{ key: 'sideFlipVelXZ', min: 0, max: 15, step: 0.1 },
		{ key: 'sideFlipRotationDuration', min: 0.1, max: 1.2, step: 0.05 },
		{ key: 'sideFlipYawSpinRate', min: 0, max: 20, step: 0.5 },
		{ key: 'tripleRotationDuration', min: 0.2, max: 1.5, step: 0.05 },
		{ key: 'backflipRotationDuration', min: 0.2, max: 1.5, step: 0.05 },
		{ key: 'camLookAheadDist', min: 0, max: 8, step: 0.1 },
		{ key: 'camLookAheadSpeedRef', min: 2, max: 20, step: 0.5 },
		{ key: 'camYStabilizeMs', min: 0, max: 1000, step: 10 },
		{ key: 'camFovBase', min: 30, max: 90, step: 1 },
		{ key: 'camFovSpeedBoost', min: 0, max: 20, step: 0.5 },
		{ key: 'camDistSpeedBoost', min: 0, max: 5, step: 0.1 },
		{ key: 'camSpeedBoostLerp', min: 0.5, max: 10, step: 0.25 },
		{ key: 'camLerpRate', min: 1, max: 20, step: 0.5 },
		{ key: 'camDragDeadPx', min: 0, max: 20, step: 1 },
		{ key: 'camPitchSensitivity', min: 0.001, max: 0.02, step: 0.001 },
		{ key: 'camShakeAmp', min: 0, max: 0.5, step: 0.01 },
		{ key: 'camShakeDuration', min: 0, max: 1, step: 0.05 },
		{ key: 'camLedgeFramingUp', min: 0, max: 3, step: 0.1 },
		{ key: 'camRecenterMinSpeed', min: 0, max: 6, step: 0.2 },
		{ key: 'camRecenterMinYawDiff', min: 0, max: 2, step: 0.1 },
		{ key: 'camZoomMin', min: 2, max: 14, step: 0.5 },
		{ key: 'camZoomMax', min: 8, max: 24, step: 0.5 },
		{ key: 'camZoomScrollSpeed', min: 0.1, max: 5, step: 0.1 },
		{ key: 'camZoomPinchSensitivity', min: 0.005, max: 0.1, step: 0.005 },
		{ key: 'camCollisionMinDist', min: 1, max: 10, step: 0.25 },
		{ key: 'ledgeForwardReach', min: 0.3, max: 2, step: 0.05 },
		{ key: 'ledgeUpReach', min: 0.3, max: 2, step: 0.05 },
		{ key: 'ledgeMinFallSpeed', min: 0, max: 5, step: 0.25 },
		{ key: 'poseLerpRate', min: 1, max: 30, step: 0.5 },
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
		config.jumpCutMinVel = 6;
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
		config.longJumpGravityMult = 0.5;
		config.backflipVelY = 18.6;
		config.backflipVelXZ = -4.8;
		config.sideFlipVelY = 18.6;
		config.wallKickVelY = 18.6;
		config.wallKickVelXZ = 7.2;
		config.wallStickMs = 233;
		config.groundPoundStartMs = 367;
		config.groundPoundStartVelY = 6;
		config.groundPoundStartGravityMult = 0;
		config.groundPoundVel = -15;
		config.groundPoundBounce = 0;
		config.groundPoundImpactSquashMs = 220;
		config.diveVelY = 0;
		config.diveVelXZ = 14.4;
		config.sideFlipVelXZ = 2.4;
		config.sideFlipRotationDuration = 0.5;
		config.sideFlipYawSpinRate = 8;
		config.tripleRotationDuration = 0.55;
		config.backflipRotationDuration = 0.7;
		config.camYawSensitivity = 0.006;
		config.camPitchSensitivity = 0.004;
		config.camDistance = 10;
		config.camHeight = 2.3;
		config.camRecenterDelayMs = 1200;
		config.camRecenterSpeed = 1.4;
		config.camRecenterMinSpeed = 1.2;
		config.camRecenterMinYawDiff = 0.4;
		config.camLookAheadDist = 1.0;
		config.camLookAheadSpeedRef = 8;
		config.camYStabilizeMs = 200;
		config.camFovBase = 60;
		config.camFovSpeedBoost = 0;
		config.camDistSpeedBoost = 0;
		config.camSpeedBoostLerp = 2;
		config.camLerpRate = 6;
		config.camDragDeadPx = 3;
		config.camPitchMin = -0.35;
		config.camPitchMax = 0.9;
		config.camZoomMin = 8;
		config.camZoomMax = 14;
		config.camZoomScrollSpeed = 1.5;
		config.camZoomPinchSensitivity = 0.02;
		config.camCollisionMinDist = 5;
		config.camShakeAmp = 0.15;
		config.camShakeDuration = 0.25;
		config.camLedgeFramingUp = 1.5;
		config.rotationSpeed = 12;
		config.skidReverseDeg = 120;
		config.skidDurationMs = 350;
		config.skidVelocityCut = 0.7;
		config.skidLeanDeg = 30;
		config.runJumpBonus = 0.25;
		config.runDoubleJumpBonus = 0.2;
		config.wallSlideGravityMult = 0.35;
		config.ledgeForwardReach = 1.0;
		config.ledgeUpReach = 1.0;
		config.ledgeMinFallSpeed = 1;
		config.ledgeShimmySpeed = 2.0;
		config.ledgeShimmyDeadzone = 0.3;
		config.ledgeClimbInputDeadzone = 0.6;
		config.ledgeClimbCommitMs = 120;
		config.ledgePoseDeg = -30;
		config.ledgeClimbDurationMs = 420;
		config.wallSlidePoseDeg = 22;
		config.poseLerpRate = 8;
		config.sameWallLockoutMs = 500;
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
