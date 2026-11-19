const DURATION = 4;

/** A short pluck: exact harmonics with a quick attack and faster decay in the overtones. */
export function pluckedString(frequency: number, sampleRate: number): Float32Array {
	const samples = new Float32Array(Math.ceil(DURATION * sampleRate));
	let peak = 0;
	for (let i = 0; i < samples.length; i++) {
		const time = i / sampleRate;
		let value = 0;
		for (let harmonic = 1; harmonic <= 12 && frequency * harmonic < sampleRate / 2; harmonic++) {
			const strength = Math.sin(Math.PI * harmonic * 0.23) / harmonic ** 1.35;
			const decay = Math.exp(-time * (0.8 + harmonic * 0.45));
			value += strength * decay * Math.sin(2 * Math.PI * frequency * harmonic * time);
		}
		const attack = Math.min(1, time / 0.003);
		const release = Math.min(1, (samples.length - 1 - i) / (sampleRate * 0.08));
		samples[i] = value * attack * release;
		peak = Math.max(peak, Math.abs(samples[i]));
	}
	if (peak > 0) {
		for (let i = 0; i < samples.length; i++) samples[i] *= 0.6 / peak;
	}
	return samples;
}

/** One pluck per session. No microphone access or downloaded audio is needed. */
export class ReferenceNote {
	private stopped = false;
	private context?: AudioContext;
	private source?: AudioBufferSourceNode;

	async play(frequency: number, onEnded: () => void) {
		if (!window.AudioContext) throw new Error('This browser does not support note playback.');
		const context = new AudioContext();
		this.context = context;
		await context.resume();
		if (this.stopped) return;
		const samples = pluckedString(frequency, context.sampleRate);
		const buffer = context.createBuffer(1, samples.length, context.sampleRate);
		buffer.getChannelData(0).set(samples);
		const source = context.createBufferSource();
		this.source = source;
		source.buffer = buffer;
		source.connect(context.destination);
		source.onended = () => {
			this.stop();
			onEnded();
		};
		source.start();
	}

	stop() {
		if (this.stopped) return;
		this.stopped = true;
		if (this.source) {
			this.source.onended = null;
			this.source.stop();
			this.source.disconnect();
		}
		if (this.context) void this.context.close().catch(() => {});
	}
}
