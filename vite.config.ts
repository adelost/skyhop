import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	server: {
		host: true,
		allowedHosts: true
	},
	optimizeDeps: {
		exclude: ['@dimforge/rapier3d-compat']
	}
});
