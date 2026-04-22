export type InputState = {
	moveX: number;
	moveZ: number;
	jumpPressed: boolean;
	jumpHeld: boolean;
};

export class Input {
	private keys = new Set<string>();
	private jumpQueued = false;
	private jumpHeld = false;
	private touchMoveX = 0;
	private touchMoveZ = 0;
	private touchJumpPressed = false;
	private touchJumpHeld = false;
	private cleanup: Array<() => void> = [];

	attach(): void {
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.repeat) return;
			this.keys.add(e.code);
			if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
				this.jumpQueued = true;
				this.jumpHeld = true;
			}
		};
		const onKeyUp = (e: KeyboardEvent) => {
			this.keys.delete(e.code);
			if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
				this.jumpHeld = false;
			}
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
		this.jumpQueued = false;
		this.touchJumpPressed = false;

		return {
			moveX: mx,
			moveZ: mz,
			jumpPressed,
			jumpHeld: this.jumpHeld || this.touchJumpHeld
		};
	}
}
