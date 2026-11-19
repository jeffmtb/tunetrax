// Standard guitar tuning, from thickest to thinnest, with A4 = 440 Hz.
export const GUITAR_STRINGS = [
	{ number: 6, label: 'low E', note: 'E2', frequency: 440 * 2 ** (-29 / 12) },
	{ number: 5, label: 'A', note: 'A2', frequency: 110 },
	{ number: 4, label: 'D', note: 'D3', frequency: 440 * 2 ** (-19 / 12) },
	{ number: 3, label: 'G', note: 'G3', frequency: 440 * 2 ** (-14 / 12) },
	{ number: 2, label: 'B', note: 'B3', frequency: 440 * 2 ** (-10 / 12) },
	{ number: 1, label: 'high E', note: 'E4', frequency: 440 * 2 ** (-5 / 12) }
] as const;
export const TOLERANCE_CENTS = 5;
export const MIN_RMS = 0.004;

export function centsFromTarget(frequency: number, targetHz: number): number {
	return 1200 * Math.log2(frequency / targetHz);
}

export function tuningStatus(cents: number): string {
	if (Math.abs(cents) > 400) return 'Outside selected string range — check the string';
	if (Math.abs(cents) <= TOLERANCE_CENTS) return 'In tune';
	return cents < 0 ? 'Flat — tune up' : 'Sharp — tune down';
}

/** YIN difference detector: rejects quiet/nonperiodic input without snapping to a note. */
export function detectPitch(samples: Float32Array, sampleRate: number, minRms = MIN_RMS) {
	let mean = 0;
	for (const sample of samples) mean += sample;
	mean /= samples.length;
	let energy = 0;
	for (const sample of samples) energy += (sample - mean) ** 2;
	const rms = Math.sqrt(energy / samples.length);
	const empty = { frequency: null, rms };
	if (rms < minRms || !Number.isFinite(rms)) return empty;

	// High-frequency noise creates false local minima around the true period.
	// Two gentle low-pass stages preserve the tuning range while reducing that jitter.
	const filtered = new Float32Array(samples.length);
	const alpha = 1 - Math.exp(-2 * Math.PI * 1400 / sampleRate);
	let first = samples[0];
	let second = first;
	for (let i = 0; i < samples.length; i++) {
		first += alpha * (samples[i] - first);
		second += alpha * (first - second);
		filtered[i] = second;
	}

	// Exclude the filter's startup transient so it cannot bias the pitch estimate.
	const warmup = Math.min(Math.ceil(sampleRate * 0.002), Math.floor(samples.length / 8));
	const windowSize = Math.floor((samples.length - warmup) / 2);
	const maxLag = Math.min(Math.ceil(sampleRate / 70), windowSize - 1);
	const minLag = Math.max(2, Math.floor(sampleRate / 1000));
	const difference = new Float32Array(maxLag + 1);
	let sum = 0;
	for (let lag = 1; lag <= maxLag; lag++) {
		let value = 0;
		for (let i = 0; i < windowSize; i++) value += (filtered[i + warmup] - filtered[i + warmup + lag]) ** 2;
		sum += value;
		difference[lag] = sum > 0 ? (value * lag) / sum : 1;
	}
	for (let lag = minLag; lag < maxLag; lag++) {
		if (difference[lag] >= 0.15) continue;
		while (lag + 1 < maxLag && difference[lag + 1] < difference[lag]) lag++;
		if (lag >= maxLag) return empty;
		const left = difference[lag - 1];
		const center = difference[lag];
		const right = difference[lag + 1];
		const curvature = left - 2 * center + right;
		const offset = curvature === 0 ? 0 : (left - right) / (2 * curvature);
		const frequency = sampleRate / (lag + offset);
		return frequency >= 70 && frequency <= 1000 ? { frequency, rms } : empty;
	}
	return empty;
}
