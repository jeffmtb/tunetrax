<script lang="ts">
	import './layout.css';
	import { onMount } from 'svelte';
	import { asset } from '$app/paths';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	async function startAnalytics() {
		const firebaseConfig = {
			apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
			authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
			projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
			storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
			messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
			appId: import.meta.env.VITE_FIREBASE_APP_ID,
			measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
		};
		if (!firebaseConfig.apiKey || !firebaseConfig.projectId || !firebaseConfig.appId) return;

		try {
			const [{ initializeApp }, { getAnalytics, isSupported }] = await Promise.all([
				import('firebase/app'),
				import('firebase/analytics')
			]);
			if (await isSupported()) getAnalytics(initializeApp(firebaseConfig));
		} catch {
			console.warn('Firebase Analytics could not start.');
		}
	}

	onMount(() => {
		if (import.meta.env.PROD) void startAnalytics();
	});
</script>

<svelte:head>
	<link rel="icon" href={asset('tunetrax-icon-192.png')} />
	<link rel="apple-touch-icon" href={asset('tunetrax-icon-192.png')} />
	<link rel="manifest" href={asset('manifest.webmanifest')} />
	<meta name="theme-color" content="#e8d1a7" />
</svelte:head>

{@render children()}
