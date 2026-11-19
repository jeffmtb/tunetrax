import { detectPitch, MIN_RMS } from './pitch';

const SUSTAIN_RMS = 0.0012;
const SUSTAIN_WINDOW_MS = 600;
const HOLD_MS = 300;

/** Follow a decaying note, smoothing valid pitches and bridging brief dropouts. */
export class PitchTracker {
	private lastPitchAt = -Infinity;
	private frequency: number | null = null;
	private recent: number[] = [];

	read(samples: Float32Array, sampleRate: number, now: number) {
		const threshold = now - this.lastPitchAt <= SUSTAIN_WINDOW_MS ? SUSTAIN_RMS : MIN_RMS;
		const reading = detectPitch(samples, sampleRate, threshold);
		if (reading.frequency === null) {
			const held = this.frequency !== null && now - this.lastPitchAt <= HOLD_MS;
			if (!held) {
				this.frequency = null;
				this.recent = [];
			}
			return { frequency: this.frequency, rms: reading.rms, held };
		}
		if (now - this.lastPitchAt > HOLD_MS) this.recent = [];
		this.lastPitchAt = now;
		this.recent.push(reading.frequency);
		if (this.recent.length > 3) this.recent.shift();
		this.frequency = [...this.recent].sort((a, b) => a - b)[Math.floor(this.recent.length / 2)];
		return { frequency: this.frequency, rms: reading.rms, held: false };
	}

	reset() {
		this.lastPitchAt = -Infinity;
		this.frequency = null;
		this.recent = [];
	}
}
