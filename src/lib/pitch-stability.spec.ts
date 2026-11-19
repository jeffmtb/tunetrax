import { describe, expect, it } from 'vitest';
import { centsFromTarget } from './pitch';
import { PitchTracker } from './pitch-tracker';

describe('continuous reference tone stability', () => {
	for (const sampleRate of [44100, 48000, 96000]) {
		for (const detuning of [-20, 0, 20]) {
			it(`tracks a noisy 196 Hz tone at ${sampleRate} Hz, ${detuning} cents`, () => {
				const tracker = new PitchTracker();
				const target = 196 * 2 ** (detuning / 1200);
				const size = sampleRate > 48000 ? 16384 : 8192;
				let seed = 431;
				for (let frame = 0; frame < 40; frame++) {
					const now = frame * 80;
					const samples = Float32Array.from({ length: size }, (_, i) => {
						const time = now / 1000 + i / sampleRate;
						seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
						return 0.03 * Math.sin(2 * Math.PI * target * time)
							+ 0.009 * Math.sin(4 * Math.PI * target * time)
							+ 0.02 * (seed / 2 ** 32 - 0.5);
					});
					const reading = tracker.read(samples, sampleRate, now);
					expect(reading.frequency).not.toBeNull();
					expect(reading.held).toBe(false);
					expect(Math.abs(centsFromTarget(reading.frequency!, 196) - detuning)).toBeLessThan(2);
				}
			});
		}
	}
});
