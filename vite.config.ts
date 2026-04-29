// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference types="node" />
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';

const buildTime = new Date().toISOString();
const buildSha = (() => {
	try {
		return execSync('git rev-parse --short HEAD').toString().trim();
	} catch {
		return 'dev';
	}
})();

export default defineConfig({
	plugins: [sveltekit()],
	define: {
		__BUILD_TIME__: JSON.stringify(buildTime),
		__BUILD_SHA__: JSON.stringify(buildSha)
	},
	server: {
		host: true,
		allowedHosts: true
	},
	optimizeDeps: {
		exclude: ['@dimforge/rapier3d-compat']
	}
});
