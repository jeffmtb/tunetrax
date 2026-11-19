import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { centsFromTarget, detectPitch, GUITAR_STRINGS } from './pitch';
import { pluckedString, ReferenceNote } from './reference-note';

describe('plucked reference notes', () => {
	for (const rate of [44100, 48000]) {
		for (const string of GUITAR_STRINGS) {
			it(`plays ${string.note} at concert pitch with ${rate} Hz audio`, () => {
				const samples = pluckedString(string.frequency, rate);
				expect(samples.length).toBe(rate * 4);
				expect(samples[0]).toBe(0);
				expect(Math.abs(samples[samples.length - 1])).toBe(0);
				expect(samples.every((value) => Number.isFinite(value) && Math.abs(value) <= 0.601)).toBe(true);
				for (const time of [0.1, 1]) {
					const offset = Math.floor(time * rate);
					const { frequency } = detectPitch(samples.slice(offset, offset + 4096), rate);
					expect(frequency).not.toBeNull();
					expect(Math.abs(centsFromTarget(frequency!, string.frequency))).toBeLessThan(2);
				}
				const energy = (start: number) => samples.slice(start, start + 4096).reduce((sum, value) => sum + value * value, 0);
				expect(energy(rate * 3)).toBeLessThan(energy(Math.floor(rate * 0.1)) / 20);
			});
		}
	}
});

let audio: FakeAudioContext;
class FakeAudioContext {
	sampleRate = 48000;
	destination = {};
	resume = vi.fn(async () => {});
	close = vi.fn(async () => {});
	source = {
		buffer: null,
		connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(),
		onended: null as (() => void) | null
	};
	createBuffer = vi.fn((_channels: number, length: number) => ({ getChannelData: () => new Float32Array(length) }));
	createBufferSource = vi.fn(() => this.source);
	constructor() { audio = this; }
}

beforeEach(() => {
	vi.stubGlobal('window', { AudioContext: FakeAudioContext });
	vi.stubGlobal('AudioContext', FakeAudioContext);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('reference playback lifecycle', () => {
	it('plays to the speakers and releases audio when the note ends', async () => {
		const ended = vi.fn();
		const note = new ReferenceNote();
		await note.play(110, ended);
		expect(audio.source.connect).toHaveBeenCalledWith(audio.destination);
		expect(audio.source.start).toHaveBeenCalledOnce();
		audio.source.onended!();
		expect(ended).toHaveBeenCalledOnce();
		expect(audio.source.disconnect).toHaveBeenCalledOnce();
		expect(audio.close).toHaveBeenCalledOnce();
		note.stop();
		expect(audio.close).toHaveBeenCalledOnce();
	});

	it('stops playback without reporting a natural end', async () => {
		const ended = vi.fn();
		const note = new ReferenceNote();
		await note.play(110, ended);
		note.stop();
		expect(audio.source.stop).toHaveBeenCalledOnce();
		expect(audio.source.onended).toBeNull();
		expect(audio.close).toHaveBeenCalledOnce();
		expect(ended).not.toHaveBeenCalled();
	});

	it('does not play after cancellation while the audio context is resuming', async () => {
		const note = new ReferenceNote();
		const ended = vi.fn();
		const pending = note.play(110, ended);
		note.stop();
		await pending;
		expect(audio.source.start).not.toHaveBeenCalled();
		expect(audio.close).toHaveBeenCalledOnce();
		expect(ended).not.toHaveBeenCalled();
	});

	it('explains unsupported playback', async () => {
		vi.stubGlobal('window', {});
		await expect(new ReferenceNote().play(110, vi.fn())).rejects.toThrow('does not support note playback');
	});
});
