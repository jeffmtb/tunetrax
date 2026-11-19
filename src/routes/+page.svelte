<script lang="ts">
	import { onMount } from 'svelte';
	import { asset } from '$app/paths';
	import { Microphone, microphoneError } from '#lib/microphone.ts';
	import { GUITAR_STRINGS, MIN_RMS, centsFromTarget, tuningStatus } from '#lib/pitch.ts';
	import { ReferenceNote } from '#lib/reference-note.ts';

	let selectedString = $state<(typeof GUITAR_STRINGS)[number]>(GUITAR_STRINGS[0]);
	let mode = $state<'listen' | 'play'>('listen');
	let phase = $state<'idle' | 'starting' | 'listening'>('idle');
	let frequency = $state<number | null>(null);
	let holdingPitch = $state(false);
	let rms = $state(0);
	let error = $state('');
	let interrupted = $state(false);
	const microphoneOff = 'Microphone off. Tap the mic or a tuning key.';
	let message = $state(microphoneOff);
	let device = $state('');
	let offlineReady = $state(false);
	let session: Microphone | null = null;
	let reference: ReferenceNote | null = null;
	let playing = $state(false);
	let playbackId = $state(0);
	const waveCycles = $derived(Math.round(2 * selectedString.frequency / GUITAR_STRINGS[0].frequency));
	const waveDuration = $derived(2.1 / Math.sqrt(selectedString.frequency / GUITAR_STRINGS[0].frequency));
	const wavePath = $derived.by(() => {
		// Two repeating windows let the trace travel continuously through the glass.
		return Array.from({ length: 257 }, (_, i) => {
			const position = i / 128;
			const phase = position * waveCycles * Math.PI * 2;
			const amplitude = Math.sin(phase) + 0.18 * Math.sin(phase * 2) + 0.07 * Math.sin(phase * 3);
			return `${i === 0 ? 'M' : 'L'}${(48 + amplitude * 24).toFixed(2)} ${(48 + position * 344).toFixed(2)}`;
		}).join(' ');
	});
	const cents = $derived(frequency === null ? null : centsFromTarget(frequency, selectedString.frequency));
	const waitingForPitch = $derived(rms < MIN_RMS ? 'Play a note close to the mic' : 'Waiting for a steady pitch');
	const feedback = $derived(holdingPitch ? 'Signal fading…' : cents === null
		? (phase === 'listening' ? waitingForPitch : 'Ready to tune')
		: tuningStatus(cents));
	const audioStatus = $derived(phase === 'listening'
		? `Listening for ${selectedString.note} · ${cents === null ? waitingForPitch : holdingPitch ? 'Signal fading…' : 'Pitch detected'}`
		: message);
	const active = $derived(phase !== 'idle' || playing);
	const audioActive = $derived(phase === 'listening' || playing);
	const inTune = $derived(phase === 'listening' && !holdingPitch && cents !== null && Math.abs(cents) <= 5);
	const pitchOffset = $derived(inTune ? 0 : -Math.max(-50, Math.min(50, cents ?? 0)) * 3.44);
	const keyPositions: Record<number, { x: number; y: number }> = {
		4: { x: 3.8, y: 16.1 }, 5: { x: 3.8, y: 34.6 }, 6: { x: 3.8, y: 51.4 },
		3: { x: 79.2, y: 16.1 }, 2: { x: 79.2, y: 34.6 }, 1: { x: 79.2, y: 51.4 }
	};

	function changeMode(next: typeof mode) {
		if (mode !== next) {
			stop();
			stopPlayback();
			mode = next;
			error = '';
			if (next === 'play') message = 'Tap a tuning key to hear its reference tone.';
		}
		if (next === 'listen') void start();
	}

	function selectString(string: (typeof GUITAR_STRINGS)[number]) {
		if (string.number !== selectedString.number) {
			selectedString = string;
			frequency = null;
			holdingPitch = false;
			rms = 0;
			session?.resetTracking();
		}
		if (mode === 'play') void playNote();
		else void start();
	}

	function stop(reason?: string) {
		session?.stop();
		session = null;
		phase = 'idle';
		frequency = null;
		holdingPitch = false;
		rms = 0;
		device = '';
		interrupted = reason !== undefined;
		message = reason ?? microphoneOff;
	}

	function stopPlayback() {
		reference?.stop();
		reference = null;
		playing = false;
	}

	async function playNote() {
		stop();
		stopPlayback();
		error = '';
		const active = new ReferenceNote();
		reference = active;
		playing = true;
		playbackId += 1;
		message = `Playing ${selectedString.label} (${selectedString.note})…`;
		try {
			await active.play(selectedString.frequency, () => {
				if (reference !== active) return;
				stopPlayback();
				message = 'Note finished. Play it again to compare with your string.';
			});
		} catch (cause) {
			if (reference !== active) return;
			stopPlayback();
			message = 'Note playback stopped.';
			error = cause instanceof Error ? cause.message : 'Could not play the note. Try again.';
		}
	}

	async function start() {
		if (phase !== 'idle') return;
		stopPlayback();
		error = '';
		interrupted = false;
		phase = 'starting';
		message = 'Allow microphone access…';
		const active = new Microphone();
		session = active;
		try {
			const info = await active.start((reading) => {
				if (session !== active) return;
				rms = reading.rms;
				frequency = reading.frequency;
				holdingPitch = reading.held;
			}, () => {
				if (session === active) stop('Microphone interrupted. Tap the mic to reconnect.');
			});
			if (session !== active || !info) return;
			device = `${info.label} · ${info.sampleRate.toLocaleString()} Hz sample rate`;
			phase = 'listening';
		} catch (cause) {
			if (session !== active) return;
			stop();
			error = microphoneError(cause);
		}
	}

	onMount(() => {
		let mounted = true;
		if ('serviceWorker' in navigator) {
			void navigator.serviceWorker.ready.then(() => { if (mounted) offlineReady = true; });
		}
		const pause = () => {
			if (playing) {
				stopPlayback();
				message = 'Note stopped while the app was away.';
			}
			if (session) stop('Microphone paused. Tap the mic to resume.');
		};
		const visibility = () => { if (document.hidden) pause(); };
		document.addEventListener('visibilitychange', visibility);
		window.addEventListener('pagehide', pause);
		return () => {
			mounted = false;
			document.removeEventListener('visibilitychange', visibility);
			window.removeEventListener('pagehide', pause);
			stop();
			stopPlayback();
		};
	});
</script>



<svelte:head>
	<title>TuneTrax — guitar tuner</title>
	<meta name="description" content="A pocket guitar tuner with brass tuning keys, a vertical pitch gauge, and reference tones." />
</svelte:head>

{#snippet audioIcon(kind: 'listen' | 'play')}
	<svg viewBox={kind === 'listen' ? '-2 0 36 32' : '0 0 32 32'} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
		{#if kind === 'listen'}
			<rect x="12" y="3" width="8" height="17" rx="4" />
			<path d="M8 14v2a8 8 0 0 0 16 0v-2M16 24v5m-5 0h10M12 8h4m-4 4h4" />
			{#if phase === 'listening'}
				<path class="mic-wave" d="M3 9v12M29 9v12" stroke-width="1.5" />
				<path class="mic-wave mic-wave-outer" d="M-1 11v8M33 11v8" stroke-width="1.5" />
			{/if}
		{:else}
			<path d="M4 12h6l8-7v22l-8-7H4zM23 11a8 8 0 0 1 0 10m4-14a13 13 0 0 1 0 18" />
		{/if}
	</svg>
{/snippet}

<main>
	<h1 class="sr-only">TuneTrax guitar tuner</h1>
	<section class="instrument" aria-label="Guitar tuner">
		<p class={phase === 'starting' || interrupted ? 'audio-status' : 'sr-only'} role="status">{audioStatus}</p>
		{#if error}<p role="alert" class="error">{error}</p>{/if}
		<div class="headstock">
			<img src={asset('images/steampunk-headstock.webp')} alt="Hand-drawn walnut guitar headstock with six brass tuning keys, copper strings and ornamental gears." width="1024" height="1536" fetchpriority="high" draggable="false" />
			<div class="mode-controls" aria-label="Tuner mode">
				<button class="mode-icon" class:chosen={mode === 'listen'} class:receiving={rms >= MIN_RMS} aria-label="Microphone tuning mode" aria-pressed={mode === 'listen'} title="Tune with your microphone" onclick={() => changeMode('listen')}>
					{@render audioIcon('listen')}
				</button>
				<button class="mode-switch" class:play-mode={mode === 'play'} role="switch" aria-checked={mode === 'play'} aria-label="Reference tone mode" title={mode === 'listen' ? 'Switch to reference tones' : 'Switch to microphone tuning'} onclick={() => changeMode(mode === 'listen' ? 'play' : 'listen')}>
					<span class="switch-track"><span class="switch-thumb"></span></span>
				</button>
				<button class="mode-icon" class:chosen={mode === 'play'} aria-label="Reference tone mode" aria-pressed={mode === 'play'} title="Play reference tones" onclick={() => changeMode('play')}>
					{@render audioIcon('play')}
				</button>
			</div>

			{#each GUITAR_STRINGS as string (string.number)}
				<button class="tuning-key"
					class:selected={selectedString.number === string.number}
					class:sounding={selectedString.number === string.number && audioActive}
					class:right-key={string.number <= 3}
					style:left="{keyPositions[string.number].x}%"
					style:top="{keyPositions[string.number].y}%"
					aria-label="{mode === 'listen' ? 'Tune' : 'Play'} {string.label} string ({string.note})"
					aria-pressed={selectedString.number === string.number}
					title="{string.label} · {string.frequency.toFixed(2)} Hz"
					onclick={() => selectString(string)}
				><span class="note-label" aria-hidden="true">{string.note[0]}{#if string.number === 6 || string.number === 1}<sub>{string.note.slice(1)}</sub>{/if}</span></button>
			{/each}

			<div class="gauge" class:has-pitch={cents !== null} class:holding-pitch={holdingPitch} class:in-tune={inTune}>
				<svg viewBox="0 0 96 440" preserveAspectRatio="none" role="img" aria-label={mode === 'listen'
					? selectedString.note + ' tuning gauge. ' + (cents === null ? 'Waiting for pitch.' : feedback + '. ' + cents.toFixed(1) + ' cents from target.')
					: selectedString.note + ' reference tone. ' + (playing ? 'Playing.' : 'Stopped.')}>
					<defs>
						<linearGradient id="brass" x1="0" y1="0" x2="1" y2="0">
							<stop stop-color="#704520" /><stop offset=".18" stop-color="#e8bd72" /><stop offset=".4" stop-color="#f3d899" /><stop offset=".7" stop-color="#a37538" /><stop offset="1" stop-color="#65401f" />
						</linearGradient>
						<linearGradient id="pitch-brass" x1="0" y1="0" x2="0" y2="1">
							<stop stop-color="#ffe2a2" /><stop offset=".45" stop-color="#e8bd72" /><stop offset="1" stop-color="#ad7838" />
						</linearGradient>
						<linearGradient id="glass" x1="0" y1="0" x2="1" y2="0">
							<stop stop-color="#152c25" /><stop offset=".5" stop-color="#2b4636" /><stop offset="1" stop-color="#11241f" />
						</linearGradient>
						<linearGradient id="tuning-spectrum" x1="0" y1="0" x2="0" y2="1">
							<stop stop-color="#b15b42" /><stop offset=".25" stop-color="#d7a34f" />
							<stop offset=".45" stop-color="#64b68b" /><stop offset=".55" stop-color="#64b68b" />
							<stop offset=".75" stop-color="#d7a34f" /><stop offset="1" stop-color="#b15b42" />
						</linearGradient>
						<linearGradient id="wave-spectrum" gradientUnits="userSpaceOnUse" x1="24" y1="0" x2="72" y2="0">
							<stop stop-color="#d2845a" /><stop offset=".22" stop-color="#edbe65" />
							<stop offset=".45" stop-color="#8ed6a5" /><stop offset=".55" stop-color="#8ed6a5" />
							<stop offset=".78" stop-color="#edbe65" /><stop offset="1" stop-color="#d2845a" />
						</linearGradient>
						<clipPath id="wave-window"><rect x="19" y="48" width="58" height="344" rx="20" /></clipPath>
					</defs>
					<rect x="3" y="3" width="90" height="434" rx="43" fill="url(#brass)" stroke="#482913" stroke-width="4" />
					<rect x="9" y="9" width="78" height="422" rx="37" fill="none" stroke="#ffe4aa" stroke-opacity=".6" />
					<rect x="14" y="14" width="68" height="412" rx="31" fill="url(#glass)" stroke="#805b32" stroke-width="2" />
					{#each [28, 412] as y}
						<circle cx="48" cy={y} r="5" fill="url(#brass)" stroke="#725029" />
						<path d="M45 {y + 2}l6-4" stroke="#694420" />
					{/each}
					{#if mode === 'listen'}
						<rect class="gradient-column" x="37.5" y="48" width="21" height="344" rx="10.5" fill="url(#tuning-spectrum)" />
						<path d="M42.5 59v322" stroke="#fff4c3" stroke-opacity=".2" stroke-width="2" />
						<g class="center-marks">
							<path d="M22 202.8h8m-8 34.4h8m36-34.4h8m-8 34.4h8" stroke-width="2" />
							<path d="M18 220h10m40 0h10" stroke-width="3" />
						</g>
						<rect class="pitch-line" class:waiting={cents === null} x="25" y="217" width="46" height="6" rx="3" fill="url(#pitch-brass)" style:transform="translateY({pitchOffset}px)" />
						{#if inTune}
							<rect class="tune-bubble" x="34" y="202.8" width="28" height="34.4" rx="14" fill="#a0f5bc" />
						{/if}
					{:else}
						<path d="M48 48v344" stroke="#8ed6a5" stroke-opacity=".12" />
						<g clip-path="url(#wave-window)">
							{#key playbackId}
								<g class="wave-envelope" class:sounding={playing}>
									<g class="wave-trace" style:animation-duration="{waveDuration}s">
										<path class="wave-glow" d={wavePath} />
										<path class="wave-line" d={wavePath} />
									</g>
								</g>
							{/key}
						</g>
					{/if}
				</svg>
			</div>

			<button class="pause-button" disabled={!active} aria-label={phase === 'starting' ? 'Cancel microphone request' : 'Pause audio'} title="Pause audio" onclick={() => { stop(); stopPlayback(); if (mode === 'play') message = 'Paused. Tap a tuning key to play again.'; }}>
				<svg viewBox="0 0 20 20" aria-hidden="true" fill="currentColor"><rect x="5" y="4" width="3" height="12" rx="1" /><rect x="12" y="4" width="3" height="12" rx="1" /></svg>
			</button>
		</div>
	</section>
	<div class="utility">
		<span class="tuning-label">STANDARD TUNING</span>
		<details class="help">
			<summary aria-label="Tuning help" title="Tuning help"><span aria-hidden="true">?</span></summary>
			<div class="help-content">
				<p>Tap the microphone to start listening for the selected string, or tap a brass key to listen for that string. In speaker mode, tap a key to hear its reference tone.</p>
				<p>The brass line rises for sharp notes and falls for flat notes. It lines up with the center marks and the green bubble lights up when the pitch is within ±5 cents.</p>
				<p>Use the pause button in the triangular wooden cover to stop audio. In speaker mode, tap a key again to repeat its tone.</p>
				<p>Microphone audio stays on your device and is never recorded.</p>
				{#if device}<p>{device}</p>{/if}
				<p>{offlineReady ? 'Ready for offline use.' : 'Offline use is available after loading the production app online.'}</p>
			</div>
		</details>
	</div>
</main>

<style>
	.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
	main { width: 100%; max-width: 500px; min-height: 100svh; margin: 0 auto; display: flex; flex-direction: column; justify-content: center; padding: max(8px, env(safe-area-inset-top)) 0 max(8px, env(safe-area-inset-bottom)); }
	.instrument { width: 100%; }
	.audio-status { margin: 0 12px 4px; color: #624522; font-size: 13px; line-height: 1.4; text-align: center; }
	.headstock { position: relative; width: 100%; isolation: isolate; container-type: inline-size; }
	.headstock img { display: block; width: 100%; height: auto; mix-blend-mode: multiply; user-select: none; mask-image: linear-gradient(to right, transparent, #000 3%, #000 97%, transparent), linear-gradient(to bottom, transparent, #000 2%, #000 97.5%, transparent); mask-composite: intersect; }
	.mode-controls { position: absolute; top: 10.8%; left: 27%; width: 46%; height: 6.2%; display: flex; align-items: center; justify-content: space-between; gap: 3%; }
	.mode-icon { border: 0; background: transparent; color: #e7b968; width: 24%; height: 100%; padding: 2%; border-radius: 30%; filter: drop-shadow(0 2px 1px #35160d); transition: color .2s, filter .2s; position: relative; touch-action: manipulation; }
	.mode-icon::after { content: ''; position: absolute; width: max(100%, 44px); height: max(100%, 44px); left: 50%; top: 50%; transform: translate(-50%, -50%); }
	.mode-icon svg { width: 100%; height: 100%; }
	.mode-icon.chosen { color: #75e1c4; filter: drop-shadow(0 0 5px #60dec097); }
	.mic-wave { opacity: .58; transform-box: fill-box; transform-origin: center; animation: mic-wave .8s ease-in-out infinite alternate; transition: opacity .18s; }
	.mic-wave-outer { animation-delay: -.5s; }
	.receiving .mic-wave { opacity: 1; }
	.mode-switch { position: relative; width: 52%; height: 76%; border-radius: 50px; padding: 4px; border: 2px solid #5f3a1f; background: linear-gradient(160deg, #ffdb84, #90602b 45%, #e6ad4d 75%, #66401f); box-shadow: 0 2px 3px #230b07, inset 0 0 0 1px #f6d68a; touch-action: manipulation; }
	.mode-switch::after { content: ''; position: absolute; inset: -8px 0; }
	.switch-track { display: block; width: 100%; height: 100%; border-radius: inherit; padding: 2px; border: 1px solid #54311a; background: linear-gradient(90deg, #1b655d, #35251b 65%); box-shadow: inset 0 2px 6px #190e0c; }
	.switch-thumb { display: block; width: 46%; height: 100%; border-radius: 50%; border: 1px solid #ffe4a8; background: repeating-linear-gradient(125deg, #ffe1a044 0 1px, transparent 1px 3px), linear-gradient(140deg, #ffe4a0, #be7c2e 50%, #f7c46c); box-shadow: 1px 2px 3px #1d100dcc, inset 0 0 0 2px #995c29; transition: transform .22s ease; }
	.play-mode .switch-thumb { transform: translateX(117%); }
	.play-mode .switch-track { background: linear-gradient(90deg, #35251b 35%, #1b655d); }
	.tuning-key { position: absolute; display: grid; place-items: center; width: 17%; height: 11.8%; border: 0; background: transparent; border-radius: 65% 30% 26% 60% / 55% 38% 25% 45%; padding: 0; touch-action: manipulation; }
	.tuning-key.right-key { border-radius: 30% 65% 60% 26% / 38% 55% 45% 25%; }
	.note-label { color: #3e2512; font-family: Georgia, 'Times New Roman', serif; font-size: 9cqi; font-weight: 700; line-height: 1; text-shadow: 0 1px 1px #ffe2a066; transition: color .18s, text-shadow .18s; pointer-events: none; user-select: none; }
	.note-label sub { font-size: .46em; vertical-align: -.18em; margin-left: -.05em; }
	.selected .note-label { color: #075fbd; text-shadow: 0 1px 1px #ffe7ae88; }
	.sounding .note-label { color: #0878dc; text-shadow: 0 0 4px #78c8ffbb, 0 0 12px #49a2f080, 0 1px #ffe7ae; }
	.tuning-key:active .note-label { color: #075fbd; }
	/* The toggle ends at 16.25% and the wooden cover starts at 50.5%:
	   leave 2.75% of the artwork height clear at both ends of the gauge. */
	.gauge { position: absolute; left: 45%; top: 19%; width: 10%; height: 28.75%; filter: drop-shadow(1px 2px 1px #30140d88); pointer-events: none; }
	.gauge svg { display: block; width: 100%; height: 100%; }
	.gradient-column { opacity: .5; transition: opacity .2s; }
	.has-pitch .gradient-column { opacity: 1; }
	.holding-pitch .gradient-column { opacity: .5; }
	.center-marks { stroke: #8dd2a6; }
	/* Keep the confirmation visibly lit for as long as the note stays in tune. */
	.in-tune .center-marks { animation: tune-confirm 1.4s ease-in-out infinite; }
	.tune-bubble { filter: drop-shadow(0 0 3px #85ffb49c); animation: tune-bubble-confirm 1.4s ease-in-out infinite; }
	.pitch-line { transition: transform .18s ease-out; }
	.in-tune .pitch-line { transition: none; }
	.holding-pitch .pitch-line { opacity: .4; }
	.pitch-line.waiting { opacity: 0; }
	.wave-envelope { transform-origin: 48px 220px; transform: scaleX(.1); opacity: .3; }
	.wave-envelope.sounding { opacity: 1; animation: pluck-decay 4s linear both; }
	.wave-trace { animation: wave-travel linear infinite; animation-play-state: paused; }
	.sounding .wave-trace { animation-play-state: running; }
	.wave-line, .wave-glow { fill: none; stroke: url(#wave-spectrum); stroke-linecap: round; stroke-linejoin: round; }
	.wave-line { stroke-width: 3.5; }
	.wave-glow { stroke-width: 9; opacity: .16; }
	.pause-button { position: absolute; left: 50%; top: 67%; transform: translate(-50%, -50%); display: grid; place-items: center; width: 8%; min-width: 24px; max-width: 40px; aspect-ratio: 1; border: 1px solid #e0b56b; border-radius: 50%; color: #f2d19a; background: radial-gradient(circle at 35% 25%, #936631, #3d2819); box-shadow: 0 2px 3px #1c0c08aa, inset 0 0 0 3px #71491e; padding: 0; touch-action: manipulation; }
	.pause-button::after { content: ''; position: absolute; width: max(100%, 44px); height: max(100%, 44px); left: 50%; top: 50%; transform: translate(-50%, -50%); }
	.pause-button svg { width: 45%; height: 45%; }
	.pause-button:disabled { opacity: .4; cursor: default; }
	.error { margin: 0 15px 8px; padding: 10px 12px; border: 1px solid #a16c43; border-radius: 5px; color: #7d2d20; background: #f6e6c7; font-size: 13px; }
	.utility { display: flex; justify-content: center; align-items: center; gap: 12px; position: relative; margin: 0 18px; min-height: 44px; }
	.tuning-label { color: #795a36; font: 10px ui-monospace, monospace; letter-spacing: 1.5px; }
	.help summary { display: grid; place-items: center; width: 44px; height: 44px; list-style: none; cursor: pointer; color: #886237; }
	.help summary::-webkit-details-marker { display: none; }
	.help summary span { display: grid; place-items: center; border: 1px solid #ae8c5a; width: 21px; height: 21px; border-radius: 50%; font-size: 13px; }
	.help-content { position: absolute; z-index: 3; bottom: 48px; left: 0; right: 0; max-height: 65svh; overflow-y: auto; padding: 10px 18px; background: #f3e2c2fa; border: 1px solid #ae8c5a; border-radius: 7px; box-shadow: 0 4px 22px #48291333; font-size: 13px; color: #624522; }
	.help-content p { margin: 10px 0; overflow-wrap: anywhere; }
	@keyframes mic-wave { from { transform: scaleY(.35); } to { transform: scaleY(1); } }
	@keyframes wave-travel { to { transform: translateY(-344px); } }
	@keyframes tune-confirm { 0%, 100% { stroke: #b9fbd0; filter: drop-shadow(0 0 6px #85ffb4bb); } 50% { stroke: #e0ffea; filter: drop-shadow(0 0 12px #85ffb4); } }
	@keyframes tune-bubble-confirm { 50% { fill: #caffdc; filter: drop-shadow(0 0 5px #85ffb4); } }
	@keyframes pluck-decay { 0% { transform: scaleX(1); } 15% { transform: scaleX(.82); } 45% { transform: scaleX(.5); } 75% { transform: scaleX(.25); } 100% { transform: scaleX(.1); } }
	@media (hover: hover) {
		.tuning-key:not(.selected):hover .note-label { color: #075fbd; text-shadow: 0 1px #ffe7ae; }
		.mode-icon:hover { color: #fff0b6; }
	}
	@media (orientation: landscape) and (max-height: 540px) {
		main { max-width: 340px; }
	}
	@media (prefers-reduced-motion: reduce) {
		*, *::before, *::after { transition: none !important; animation: none !important; }
		.wave-envelope.sounding { transform: scaleX(1); }
		.in-tune .center-marks { stroke: #c1fbd2; filter: drop-shadow(0 0 6px #85ffb4bb); }
	}
</style>
