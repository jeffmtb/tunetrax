import { self } from '$app/service-worker';
import { version } from '$app/env';
import { assets, immutable, prerendered } from '$app/manifest';

const prefix = `tunetrax-${self.registration.scope}-`;
const cacheName = `${prefix}${version}`;
const paths = new Set([...assets, ...immutable, ...prerendered].map(
	({ path }) => new URL(path, self.registration.scope).pathname
));

self.addEventListener('install', (event) => {
	event.waitUntil(caches.open(cacheName).then((cache) => cache.addAll([...paths])));
});

self.addEventListener('activate', (event) => {
	event.waitUntil((async () => {
		for (const key of await caches.keys()) {
			if (key.startsWith(prefix) && key !== cacheName) await caches.delete(key);
		}
		await self.clients.claim();
	})());
});

// Cache this build's app shell. Updates activate after old tabs close.
self.addEventListener('fetch', (event) => {
	const url = new URL(event.request.url);
	if (event.request.method !== 'GET' || url.origin !== self.location.origin || !paths.has(url.pathname)) return;
	event.respondWith((async () => {
		const cache = await caches.open(cacheName);
		return (await cache.match(url.pathname)) ?? fetch(event.request);
	})());
});
