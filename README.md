# TuneTrax tuning workshop

A Svelte 5 / SvelteKit 3 PWA with a hand-drawn steampunk headstock and six clickable brass tuning keys. It tunes **all six open guitar strings in standard tuning (E2, A2, D3, G3, B3, E4)** using standard A4 = 440 Hz tuning. Tuning and reference tones run entirely in the browser. Microphone audio stays on the device.

## Run the tuner

Use Node.js 24.12 or later and Yarn Classic (1.x). Install dependencies and start the dev server from the project directory.

```sh
yarn install
yarn dev
```

Open the localhost URL printed by Vite. In microphone mode, tap a brass tuning key, allow microphone access, and pluck that open string. The **microphone icon** starts or resumes listening for the currently selected string. The left keys are D, A, and low E from top to bottom. The right keys are G, B, and high E. The selected key's letter turns blue. Switching strings clears the previous reading. Mute the other strings as you tune.

Wave bars on the mic icon show that capture is active and brighten when the mic picks up a strong enough signal. Permission status, interruptions, and errors appear above the guitar. Tap **?** below the guitar to see the input device and audio-context sample rate while listening.

The gauge shows a horizontal brass line once it detects a pitch. The line rises for sharp notes and falls for flat notes. Within ±5 cents of the target, it snaps into alignment with the markers on both sides. A pulsing green glow covers the middle of the line, leaving both brass ends visible. With reduced motion enabled, the mic bars stay still and the in-tune glow stays steady. Pitch feedback is available to screen readers.

Use the **pause button in the wooden triangle** to release the microphone or cancel a pending permission request. Leaving or hiding the page also stops capture. Tap the mic or a tuning key to resume when you return.

## Tune by ear

Select the **speaker icon** or use the brass switch, then tap a tuning key to hear a four-second synthesized guitar pluck at its target pitch. Match your open string to the sound. Tap the key again to repeat it or use the **pause button in the wooden triangle** to cut it short. Playback needs no microphone permission and works offline once the app is cached.

The gauge shows a traveling wave based on the selected pitch. Lower strings have broader, slower curves. The trace narrows as the note fades, and reduced-motion settings keep it still. Selecting another string replaces the playing note. Leaving or hiding the page stops playback.

## Test the PWA

Build and preview the production app to test service-worker caching.

```sh
yarn build
yarn preview
```

1. Open the printed localhost URL and wait for **Ready for offline use** in the **?** menu below the guitar.
2. Start listening and test each string. Verify that the mic bars brighten with sound and that the brass line follows the note.
3. Stop capture, switch your browser to offline mode, reload, and try both tuning and reference tones. The app shell is cached and audio processing is local.
4. Install through the browser's **Install app** / **Add to Home Screen** option, if offered. Test microphone permission and capture again in the installed app.
5. Test denying permission, retrying after enabling it in site settings, stopping/restarting, switching apps and returning, and unplugging an external microphone.

**Use HTTPS to test the microphone on a phone connecting to your computer.** On the development computer itself, `http://localhost` works. For phone testing, use a trusted HTTPS development proxy or deploy the build to Firebase Hosting. [MDN microphone secure-context requirements](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia#privacy_and_security)

The app includes a manifest, 192 px and 512 px icons, and a versioned app-shell cache. After the browser downloads an update, close all tabs and installed app windows using the older version to let the new service worker activate. [SvelteKit service-worker docs](https://svelte.dev/docs/kit/service-workers)

## Deploy to Firebase Hosting

The static adapter builds the site into `build/`. The `tunetrax` Hosting target is configured for the `tune-trax` site in the `tune-trax` Firebase project. Deploying requires an existing Hosting site and a Firebase account with deploy access. [Firebase Hosting targets](https://firebase.google.com/docs/hosting/multisites)

Install the Firebase CLI, then sign in, build, and deploy to the configured Hosting site. [Firebase CLI setup](https://firebase.google.com/docs/cli)

```sh
firebase login
yarn build
firebase deploy --only hosting:tunetrax --project tune-trax
```

### Optional Firebase Analytics

To turn on Analytics, enable it in your Firebase project and fill in the Git-ignored `.env.local` with your **Web App** configuration from Firebase Console → Project settings → General → Your apps. On a fresh checkout, copy `.env.example` to `.env.local` first. Rebuild after changing these settings. Analytics initializes in supported browsers on production builds when `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_PROJECT_ID`, and `VITE_FIREBASE_APP_ID` are set. [Firebase Analytics setup](https://firebase.google.com/docs/analytics/web/get-started)

The Firebase web API key is visible to browsers in the deployed client code. Keep server credentials and service account keys out of `VITE_*` variables. [Firebase API key docs](https://firebase.google.com/docs/projects/api-keys) · [Vite environment variable docs](https://vite.dev/guide/env-and-mode)

## Checks

```sh
yarn run check
yarn test
yarn build
```

Pitch tests cover all six strings at 44.1, 48, and 96 kHz, including detuning, harmonics, quiet input, noise, and tolerance boundaries. Mocked microphone tests cover D3 and G3 in a single capture session, interruptions, cancellation, and cleanup. Reference-note tests check all six synthesized pitches, decay, output bounds, playback cleanup, and cancellation.

Tests run in Node. Use `yarn test:unit` for watch mode and the PWA checklist above for microphone, browser, and installed-app checks.

## Implementation and limits

- `src/lib/microphone.ts`: permission request, `AudioContext`, capture lifecycle, and an 8192-sample analyser (16384 above 48 kHz). This captures about 170–186 ms at common 44.1/48/96 kHz sample rates, with readings every 80 ms. Requests disabled echo cancellation, noise suppression and automatic gain control; browsers/devices may handle these requests differently. Audio is never connected to speaker output.
- `src/lib/reference-note.ts`: locally synthesized plucked-string reference notes and playback lifecycle.
- `src/lib/pitch.ts`: YIN-style difference detector over 70–1000 Hz, an RMS gate and periodicity threshold. A two-stage 1400 Hz low-pass filter reduces high-frequency noise before period estimation; the initial 2 ms filter transient is excluded. Uses the actual context sample rate, with interpolated periods. The RMS gate still measures the original input.
- `src/lib/pitch-tracker.ts`: median over up to three readings, with an acquisition RMS threshold of 0.004 and a sustain threshold of 0.0012. Brief detection gaps retain a dimmed reading for up to 300 ms and report “Signal fading…” to screen readers. The sustain threshold resets after 600 ms without a valid pitch. Switching strings or stopping resets tracking.
- `src/routes/+page.svelte`: illustrated six-string controls, microphone/tone switch, tuning feedback and start/stop controls.
- `src/routes/+layout.svelte`: app styles, PWA metadata, and optional Firebase Analytics initialization.
- `static/images/steampunk-headstock.webp`: optimized headstock artwork. Original illustrations and generation prompts are in `design/tuner-concepts/`.
- `src/service-worker/index.ts`: precaches the prerendered page, scripts, styles and static assets.

This is a feasibility prototype, not a calibrated tuner. A single isolated note in a quiet room is the intended input. Chords, strong background tones, pluck transients and weak fundamentals can confuse pitch detection. The analyser runs about 12 times per second on the main thread; broader device/performance testing would precede a full tuner.
