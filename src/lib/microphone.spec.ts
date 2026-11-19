import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Microphone, microphoneError } from './microphone';
import { centsFromTarget, GUITAR_STRINGS, TOLERANCE_CENTS } from './pitch';

const TARGET_HZ = GUITAR_STRINGS[5].frequency;

let audio: FakeAudioContext;
class FakeAudioContext {
	state = 'running';
	sampleRate = 48000;
	frequency = TARGET_HZ;
	amplitude = 0.3;
	onstatechange: (() => void) | null = null;
	resume = vi.fn(async () => {});
	close = vi.fn(async () => { this.state = 'closed'; });
	source = { connect: vi.fn(), disconnect: vi.fn() };
	analyser = {
		fftSize: 4096,
		disconnect: vi.fn(),
		getFloatTimeDomainData: vi.fn((buffer: Float32Array) => {
			for (let i = 0; i < buffer.length; i++) {
				buffer[i] = this.amplitude * Math.sin(2 * Math.PI * this.frequency * i / this.sampleRate);
			}
		})
	};
	constructor() { audio = this; }
	createMediaStreamSource = vi.fn(() => this.source);
	createAnalyser = vi.fn(() => this.analyser);
}

function fakeStream() {
	const track = { label: 'Test microphone', stop: vi.fn(), addEventListener: vi.fn() };
	return { track, stream: { getTracks: () => [track], getAudioTracks: () => [track] } };
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.stubGlobal('window', { isSecureContext: true, AudioContext: FakeAudioContext });
	vi.stubGlobal('AudioContext', FakeAudioContext);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('microphone lifecycle', () => {
	it('measures input with the context sample rate and releases every resource on stop', async () => {
		const { stream, track } = fakeStream();
		const getUserMedia = vi.fn(async () => stream);
		vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
		const session = new Microphone();
		const reading = vi.fn();
		expect(await session.start(reading, vi.fn())).toEqual({ label: 'Test microphone', sampleRate: 48000 });
		expect(getUserMedia).toHaveBeenCalledWith({ video: false, audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
		expect(audio.analyser.fftSize).toBe(8192);
		vi.advanceTimersByTime(80);
		expect(reading.mock.calls[0][0].frequency).toBeCloseTo(TARGET_HZ, 0);
		session.stop();
		expect(track.stop).toHaveBeenCalledOnce();
		expect(audio.source.disconnect).toHaveBeenCalledOnce();
		expect(audio.analyser.disconnect).toHaveBeenCalledOnce();
		expect(audio.close).toHaveBeenCalledOnce();
		vi.advanceTimersByTime(800);
		expect(reading).toHaveBeenCalledTimes(1);
	});

	it('keeps a long enough analysis window on a 96 kHz audio device', async () => {
		class HighRateContext extends FakeAudioContext { sampleRate = 96000; }
		vi.stubGlobal('AudioContext', HighRateContext);
		const { stream } = fakeStream();
		vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => stream } });
		const session = new Microphone();
		const reading = vi.fn();
		await session.start(reading, vi.fn());
		expect(audio.analyser.fftSize).toBe(16384);
		vi.advanceTimersByTime(80);
		expect(audio.analyser.getFloatTimeDomainData.mock.calls[0][0].length).toBe(16384);
		expect(reading.mock.calls[0][0].frequency).toBeCloseTo(TARGET_HZ, 0);
		session.stop();
	});

	it('reads steady D3 and G3 tones when switching strings in one capture session', async () => {
		const { stream } = fakeStream();
		const getUserMedia = vi.fn(async () => stream);
		vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
		const session = new Microphone();
		const reading = vi.fn();
		await session.start(reading, vi.fn());
		audio.amplitude = 0.012;

		for (const { frequency } of GUITAR_STRINGS.slice(2, 4)) {
			session.resetTracking();
			audio.frequency = frequency;
			vi.advanceTimersByTime(80);
			const result = reading.mock.lastCall![0];
			expect(result.frequency).not.toBeNull();
			expect(result.held).toBe(false);
			expect(Math.abs(centsFromTarget(result.frequency, frequency))).toBeLessThan(TOLERANCE_CENTS);
		}

		expect(getUserMedia).toHaveBeenCalledOnce();
		session.stop();
	});

	it('stops a late-arriving stream after cancellation during permission', async () => {
		const { stream, track } = fakeStream();
		const permission = Promise.withResolvers<typeof stream>();
		const getUserMedia = vi.fn(() => permission.promise);
		vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
		const session = new Microphone();
		const started = session.start(vi.fn(), vi.fn());
		await Promise.resolve();
		expect(getUserMedia).toHaveBeenCalledOnce();
		session.stop();
		permission.resolve(stream);
		expect(await started).toBeNull();
		expect(track.stop).toHaveBeenCalledOnce();
		expect(audio.createMediaStreamSource).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
	});

	it('does not request permission if cancelled while the audio context resumes', async () => {
		const getUserMedia = vi.fn();
		vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
		const session = new Microphone();
		const started = session.start(vi.fn(), vi.fn());
		session.stop();
		expect(await started).toBeNull();
		expect(getUserMedia).not.toHaveBeenCalled();
		expect(audio.close).toHaveBeenCalledOnce();
	});

	it('reports context interruption and device disconnect', async () => {
		const { stream, track } = fakeStream();
		vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => stream } });
		const session = new Microphone();
		const interrupted = vi.fn();
		await session.start(vi.fn(), interrupted);
		audio.state = 'suspended';
		audio.onstatechange?.();
		expect(interrupted).toHaveBeenCalledOnce();
		expect(track.addEventListener).toHaveBeenCalledWith('ended', interrupted);
		session.stop();
		expect(audio.onstatechange).toBeNull();
	});

	it('explains unsupported/insecure environments', async () => {
		vi.stubGlobal('window', { isSecureContext: false });
		await expect(new Microphone().start(vi.fn(), vi.fn())).rejects.toThrow('HTTPS or localhost');
		vi.stubGlobal('window', { isSecureContext: true });
		vi.stubGlobal('navigator', {});
		await expect(new Microphone().start(vi.fn(), vi.fn())).rejects.toThrow('does not support');
	});

	it('maps permission and missing-device failures to actionable messages', () => {
		expect(microphoneError(new DOMException('', 'NotAllowedError'))).toContain('site settings');
		expect(microphoneError(new DOMException('', 'NotFoundError'))).toContain('No microphone');
		expect(microphoneError(new DOMException('', 'NotReadableError'))).toContain('another app');
	});
});
