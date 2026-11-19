import { describe, expect, it } from 'vitest';
import { centsFromTarget, GUITAR_STRINGS } from './pitch';
import { PitchTracker } from './pitch-tracker';

const LOW_E = GUITAR_STRINGS[0].frequency;
const SILENCE = new Float32Array(4096);

function tone(frequency: number, amplitude: number, rate = 48000, time = 0) {
	let seed = 123;
	return Float32Array.from({ length: 4096 }, (_, i) => {
		const phase = 2 * Math.PI * frequency * (time + i / rate);
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
		const noise = (seed / 2 ** 32 - 0.5) * 0.0003;
		return amplitude * (Math.sin(phase) + 0.35 * Math.sin(phase * 2)) + noise;
	});
}

describe('sustained pitch tracking', () => {
	for (const rate of [44100, 48000, 96000]) {
		for (const detuning of [-25, 0, 25]) {
			it(`follows a fading low E for four seconds at ${rate} Hz, ${detuning} cents`, () => {
				const tracker = new PitchTracker();
				const target = LOW_E * 2 ** (detuning / 1200);
				for (let now = 0; now <= 4000; now += 80) {
					const time = now / 1000;
					const reading = tracker.read(tone(target, 0.08 * Math.exp(-time * 0.8), rate, time), rate, now);
					expect(reading.frequency).not.toBeNull();
					expect(reading.held).toBe(false);
					expect(Math.abs(centsFromTarget(reading.frequency!, LOW_E) - detuning)).toBeLessThan(2);
				}
			});
		}
	}

	it('requires an attack before accepting a quiet sustained tone, and resets after silence', () => {
		const tracker = new PitchTracker();
		const quiet = tone(LOW_E, 0.0035);
		expect(tracker.read(quiet, 48000, 0).frequency).toBeNull();
		expect(tracker.read(tone(LOW_E, 0.05), 48000, 80).frequency).not.toBeNull();
		expect(tracker.read(quiet, 48000, 160).frequency).not.toBeNull();
		expect(tracker.read(SILENCE, 48000, 480).frequency).toBeNull();
		expect(tracker.read(quiet, 48000, 800).frequency).toBeNull();
	});

	it('marks a short dropout as held, recovers, and clears sustained silence', () => {
		const tracker = new PitchTracker();
		const initial = tracker.read(tone(LOW_E, 0.05), 48000, 0);
		expect(tracker.read(SILENCE, 48000, 80)).toMatchObject({ frequency: initial.frequency, held: true });
		const recovered = tracker.read(tone(LOW_E, 0.0035), 48000, 160);
		expect(recovered.held).toBe(false);
		expect(tracker.read(SILENCE, 48000, 400)).toMatchObject({ frequency: recovered.frequency, held: true });
		expect(tracker.read(SILENCE, 48000, 480)).toMatchObject({ frequency: null, held: false });
	});

	it('rejects nonperiodic noise even while using the sustain threshold', () => {
		const tracker = new PitchTracker();
		tracker.read(tone(LOW_E, 0.05), 48000, 0);
		let seed = 987;
		const noise = Float32Array.from({ length: 4096 }, () => {
			seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
			return (seed / 2 ** 32 - 0.5) * 0.008;
		});
		expect(tracker.read(noise, 48000, 80).held).toBe(true);
		expect(tracker.read(noise, 48000, 400)).toMatchObject({ frequency: null, held: false });
	});

	it('clears smoothing and sustain sensitivity when switching strings or stopping', () => {
		const tracker = new PitchTracker();
		tracker.read(tone(LOW_E, 0.05), 48000, 0);
		tracker.read(tone(LOW_E, 0.05), 48000, 80);
		tracker.reset();
		expect(tracker.read(tone(LOW_E, 0.0035), 48000, 160).frequency).toBeNull();
		const highE = GUITAR_STRINGS[5].frequency;
		const reading = tracker.read(tone(highE, 0.05), 48000, 240);
		expect(Math.abs(centsFromTarget(reading.frequency!, highE))).toBeLessThan(1);
	});
});
