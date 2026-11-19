import { PitchTracker } from './pitch-tracker';

export type Reading = ReturnType<PitchTracker['read']>;

export function microphoneError(error: unknown): string {
	const name = error instanceof Error ? error.name : '';
	if (name === 'NotAllowedError' || name === 'SecurityError')
		return 'Microphone access was blocked. Allow microphone access in the browser’s site settings, then try again.';
	if (name === 'NotFoundError') return 'No microphone found. Connect a microphone and try again.';
	if (name === 'NotReadableError')
		return 'The microphone could not be opened. Check whether another app is using it, then try again.';
	return error instanceof Error ? error.message : 'Could not start the microphone. Please try again.';
}

/** One capture session; stop() also cancels a pending permission request. */
export class Microphone {
	private stopped = false;
	private context?: AudioContext;
	private stream?: MediaStream;
	private source?: MediaStreamAudioSourceNode;
	private analyser?: AnalyserNode;
	private timer?: ReturnType<typeof setInterval>;
	private tracker = new PitchTracker();

	resetTracking() {
		this.tracker.reset();
	}

	async start(onReading: (reading: Reading) => void, onInterrupted: () => void) {
		if (!window.isSecureContext)
			throw new Error('Microphone access needs HTTPS or localhost. Use HTTPS when testing on a phone.');
		if (!navigator.mediaDevices?.getUserMedia || !window.AudioContext)
			throw new Error('This browser does not support the required microphone and Web Audio APIs.');
		// Resume in the button gesture, before the asynchronous permission prompt.
		const context = new AudioContext();
		this.context = context;
		await context.resume();
		if (this.stopped) return null;
		const stream = await navigator.mediaDevices.getUserMedia({
			video: false,
			audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false }
		});
		if (this.stopped) {
			stream.getTracks().forEach((track) => track.stop());
			return null;
		}
		this.stream = stream;
		const track = stream.getAudioTracks()[0];
		track.addEventListener('ended', onInterrupted);
		context.onstatechange = () => {
			if (!this.stopped && context.state !== 'running') onInterrupted();
		};
		this.source = context.createMediaStreamSource(stream);
		this.analyser = context.createAnalyser();
		// Capture about 170–186 ms at common device sample rates.
		this.analyser.fftSize = context.sampleRate > 48000 ? 16384 : 8192;
		this.source.connect(this.analyser);
		// No connection to speakers: analyse the microphone without playback.
		const analyser = this.analyser;
		const samples = new Float32Array(analyser.fftSize);
		this.timer = setInterval(() => {
			analyser.getFloatTimeDomainData(samples);
			onReading(this.tracker.read(samples, context.sampleRate, performance.now()));
		}, 80);
		return { label: track.label || 'Default microphone', sampleRate: context.sampleRate };
	}

	stop() {
		this.stopped = true;
		this.tracker.reset();
		clearInterval(this.timer);
		this.source?.disconnect();
		this.analyser?.disconnect();
		this.stream?.getTracks().forEach((track) => track.stop());
		if (this.context) {
			this.context.onstatechange = null;
			void this.context.close().catch(() => {});
		}
	}
}
