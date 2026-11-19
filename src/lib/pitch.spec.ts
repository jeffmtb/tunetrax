import { describe, expect, it } from 'vitest';
import { centsFromTarget, detectPitch, GUITAR_STRINGS, tuningStatus } from './pitch';

const TARGET_HZ = GUITAR_STRINGS[5].frequency;

function tone(frequency: number, sampleRate: number, harmonics = false) {
	return Float32Array.from({ length: 4096 }, (_, i) => {
		const phase = 2 * Math.PI * frequency * i / sampleRate;
		return harmonics
			? Math.exp(-i / sampleRate * 3) * (0.15 * Math.sin(phase) + 0.3 * Math.sin(2 * phase) + 0.1 * Math.sin(3 * phase))
			: 0.3 * Math.sin(phase);
	});
}

describe('pitch detection', () => {
	for (const string of GUITAR_STRINGS) {
		for (const rate of [44100, 48000, 96000]) {
			for (const cents of [-100, -20, 0, 20, 100]) {
				it(`measures ${string.note} at ${cents} cents with a ${rate} Hz sample rate`, () => {
					const result = detectPitch(tone(string.frequency * 2 ** (cents / 1200), rate), rate);
					expect(result.frequency).not.toBeNull();
					expect(Math.abs(centsFromTarget(result.frequency!, string.frequency) - cents)).toBeLessThan(1);
				});
			}
			it(`finds ${string.note} with a stronger second harmonic at ${rate} Hz`, () => {
				const result = detectPitch(tone(string.frequency, rate, true), rate);
				expect(result.frequency).not.toBeNull();
				expect(Math.abs(centsFromTarget(result.frequency!, string.frequency))).toBeLessThan(2);
			});
		}
	}
	it('rejects silence, quiet input and DC offset', () => {
		expect(detectPitch(new Float32Array(4096), 48000).frequency).toBeNull();
		expect(detectPitch(new Float32Array(4096).fill(0.2), 48000).frequency).toBeNull();
		expect(detectPitch(tone(TARGET_HZ, 48000).map((x) => x / 100), 48000).frequency).toBeNull();
	});
	it('rejects nonperiodic noise', () => {
		let seed = 123;
		const noise = Float32Array.from({ length: 4096 }, () => {
			seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
			return (seed / 2 ** 32 - 0.5) * 0.5;
		});
		expect(detectPitch(noise, 48000).frequency).toBeNull();
	});
	it('does not mistake the low E string for high E', () => {
		const result = detectPitch(tone(TARGET_HZ / 4, 48000), 48000);
		expect(result.frequency).not.toBeNull();
		expect(tuningStatus(centsFromTarget(result.frequency!, TARGET_HZ))).toContain('Outside selected string range');
	});
	it('classifies the tolerance boundaries and tuning direction', () => {
		expect(tuningStatus(-5)).toBe('In tune');
		expect(tuningStatus(5)).toBe('In tune');
		expect(tuningStatus(-5.1)).toBe('Flat — tune up');
		expect(tuningStatus(5.1)).toBe('Sharp — tune down');
	});
});
