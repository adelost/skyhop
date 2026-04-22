export type InputState = {
	moveX: number;
	moveZ: number;
	jumpPressed: boolean;
	jumpHeld: boolean;
	crouchHeld: boolean;
	crouchPressed: boolean;
	actionPressed: boolean;
};

export class Input {
	private keys = new Set<string>();
	private jumpQueued = false;
	private jumpHeld = false;
	private crouchQueued = false;
	private crouchHeld = false;
	private actionQueued = false;
	private touchMoveX = 0;
	private touchMoveZ = 0;
	private touchJumpPressed = false;
	private touchJumpHeld = false;
	private touchCrouchHeld = false;
	private touchCrouchPressed = false;
	private touchActionPressed = false;
	private cleanup: Array<() => void> = [];

	attach(): void {
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.repeat) return;
			this.keys.add(e.code);
			if (e.code === 'Space') {
				this.jumpQueued = true;
				this.jumpHeld = true;
			}
			if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
				this.crouchQueued = true;
				this.crouchHeld = true;
			}
			if (e.code === 'KeyE') {
				this.actionQueued = true;
			}
		};
		const onKeyUp = (e: KeyboardEvent) => {
			this.keys.delete(e.code);
			if (e.code === 'Space') this.jumpHeld = false;
			if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.crouchHeld = false;
		};
		window.addEventListener('keydown', onKeyDown);
		window.addEventListener('keyup', onKeyUp);
		this.cleanup.push(() => window.removeEventListener('keydown', onKeyDown));
		this.cleanup.push(() => window.removeEventListener('keyup', onKeyUp));
	}

	detach(): void {
		for (const fn of this.cleanup) fn();
		this.cleanup = [];
	}

	setTouchMove(x: number, z: number): void {
		this.touchMoveX = x;
		this.touchMoveZ = z;
	}

	pressTouchJump(): void {
		this.touchJumpPressed = true;
		this.touchJumpHeld = true;
	}

	releaseTouchJump(): void {
		this.touchJumpHeld = false;
	}

	pressTouchCrouch(): void {
		this.touchCrouchPressed = true;
		this.touchCrouchHeld = true;
	}

	releaseTouchCrouch(): void {
		this.touchCrouchHeld = false;
	}

	pressTouchAction(): void {
		this.touchActionPressed = true;
	}

	sample(): InputState {
		let mx = 0;
		let mz = 0;
		if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) mx -= 1;
		if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) mx += 1;
		if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) mz -= 1;
		if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) mz += 1;

		mx += this.touchMoveX;
		mz += this.touchMoveZ;

		const len = Math.hypot(mx, mz);
		if (len > 1) {
			mx /= len;
			mz /= len;
		}

		const jumpPressed = this.jumpQueued || this.touchJumpPressed;
		const crouchPressed = this.crouchQueued || this.touchCrouchPressed;
		const actionPressed = this.actionQueued || this.touchActionPressed;
		this.jumpQueued = false;
		this.crouchQueued = false;
		this.actionQueued = false;
		this.touchJumpPressed = false;
		this.touchCrouchPressed = false;
		this.touchActionPressed = false;

		return {
			moveX: mx,
			moveZ: mz,
			jumpPressed,
			jumpHeld: this.jumpHeld || this.touchJumpHeld,
			crouchHeld: this.crouchHeld || this.touchCrouchHeld,
			crouchPressed,
			actionPressed
		};
	}
}
