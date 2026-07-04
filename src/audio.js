const BAND_COUNT = 48;
const MONITOR_MIN_HZ = 80;
const MONITOR_MAX_HZ = 12000;
const BASS_RANGE = [20, 250];
const MID_RANGE = [250, 4000];
const HIGH_RANGE = [4000, 12000];
const PEAK_MIN_VOLUME = 0.018;
const PEAK_MIN_ENERGY = 0.035;
const PEAK_MIN_PROMINENCE = 0.026;
const DESKTOP_AUDIO_PROFILE = {
  id: 'desktop',
  constraints: {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  },
  inputGain: 1,
  bandGain: 1,
  fluxGain: 1,
  visualActivityGain: 0,
  continuousPeakMix: 0,
  floorFactor: 0.55,
  normalizeGain: 2.6,
  volumeSmooth: 0.18,
  peakMinVolume: PEAK_MIN_VOLUME,
  peakMinEnergy: PEAK_MIN_ENERGY,
  peakLevelGate: 0.46,
};
const IOS_WEBKIT_AUDIO_PROFILE = {
  id: 'iosWebKit',
  constraints: {
    echoCancellation: { ideal: false },
    noiseSuppression: { ideal: false },
    autoGainControl: { ideal: true },
    channelCount: { ideal: 1 },
  },
  inputGain: 4.0,
  bandGain: 2.6,
  fluxGain: 2.1,
  visualActivityGain: 0.95,
  continuousPeakMix: 0.36,
  floorFactor: 0.14,
  normalizeGain: 6.2,
  volumeSmooth: 0.28,
  peakMinVolume: PEAK_MIN_VOLUME * 0.38,
  peakMinEnergy: PEAK_MIN_ENERGY * 0.48,
  peakLevelGate: 0.22,
};

export class AudioScanner {
  constructor() {
    this.profile = createAudioProfile();
    this.context = null;
    this.stream = null;
    this.audioTrack = null;
    this.analyser = null;
    this.frequencyData = null;
    this.previousFrequencyData = null;
    this.timeData = null;
    this.smoothedVolume = 0;
    this.peakLevel = 0;
    this.noiseFloor = 0.015;
    this.available = false;
    this.bandFloors = new Float32Array(BAND_COUNT);
    this.bandPeaks = new Float32Array(BAND_COUNT).fill(0.08);
    this.frequencyNoiseFloor = null;
    this.frequencyPeakFloor = null;
    this.smoothedPeakHz = 0;
    this.smoothedCentroidHz = 0;
    this.smoothedFluxPercent = 0;
    this.smoothedBandGauges = {
      bass: 0,
      mid: 0,
      high: 0,
    };
    this.inputSaturationFrames = 0;
    this.debugState = createAudioDebugState(this.profile);
  }

  async start() {
    let stream = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: this.profile.constraints,
      });
    } catch (error) {
      this.available = false;
      if (error?.name === 'NotAllowedError' || error?.name === 'NotFoundError') {
        return false;
      }
      throw error;
    }
    this.stream = stream;
    this.audioTrack = stream.getAudioTracks()[0] || null;
    this.attachTrackDebugEvents(this.audioTrack);

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      this.available = false;
      return false;
    }
    this.context = new AudioContextClass();
    await this.resume();

    const source = this.context.createMediaStreamSource(stream);
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 4096;
    this.analyser.smoothingTimeConstant = 0.68;
    this.analyser.minDecibels = -86;
    this.analyser.maxDecibels = -18;
    source.connect(this.analyser);
    this.frequencyData = new Uint8Array(this.analyser.frequencyBinCount);
    this.previousFrequencyData = new Uint8Array(this.analyser.frequencyBinCount);
    this.timeData = new Uint8Array(this.analyser.fftSize);
    this.frequencyNoiseFloor = new Float32Array(this.analyser.frequencyBinCount);
    this.frequencyPeakFloor = new Float32Array(this.analyser.frequencyBinCount).fill(0.04);
    this.available = true;
    this.updateTrackDebugState();
    return true;
  }

  async resume() {
    if (this.context?.state === 'suspended') {
      await this.context.resume();
    }
  }

  stop() {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.audioTrack = null;
    this.analyser = null;
    this.frequencyData = null;
    this.previousFrequencyData = null;
    this.timeData = null;
    this.available = false;
    this.context?.close?.();
    this.context = null;
    this.debugState = createAudioDebugState(this.profile);
  }

  update() {
    if (!this.analyser) return emptyAudioState(false);

    this.analyser.getByteFrequencyData(this.frequencyData);
    this.analyser.getByteTimeDomainData(this.timeData);

    const sampleRate = this.context?.sampleRate || 0;
    const fftSize = this.analyser.fftSize;
    const spectralCentroidHz = calculateSpectralCentroidHz(this.frequencyData, sampleRate, fftSize);
    const spectralCentroid = calculateSpectralCentroid(this.frequencyData);
    const spectralFlux = clamp01(calculateSpectralFlux(this.frequencyData, this.previousFrequencyData) * this.profile.fluxGain);
    const spectralFluxPercent = spectralFlux * 100;
    const bass = shapeEnergy(averageFrequencyRange(this.frequencyData, sampleRate, fftSize, ...BASS_RANGE) * this.profile.bandGain, 1.22);
    const mid = shapeEnergy(averageFrequencyRange(this.frequencyData, sampleRate, fftSize, ...MID_RANGE) * this.profile.bandGain, 1.08);
    const high = shapeEnergy(averageFrequencyRange(this.frequencyData, sampleRate, fftSize, ...HIGH_RANGE) * this.profile.bandGain, 0.86);
    const spectrumVolume = average(this.frequencyData, 1, this.frequencyData.length) / 255;
    const waveformVolume = rms(this.timeData);
    const rawVolume = Math.max(spectrumVolume * 0.7, waveformVolume);
    const effectiveVolume = clamp01(rawVolume * this.profile.inputGain);

    this.noiseFloor = Math.min(0.16, lerp(this.noiseFloor, effectiveVolume, 0.012));
    const normalizedVolume = clamp01((effectiveVolume - this.noiseFloor * this.profile.floorFactor) * this.profile.normalizeGain);
    const bandActivity = clamp01(bass * 0.48 + mid * 0.42 + high * 0.34 + spectralFlux * 0.42);
    const visualVolume = clamp01(Math.max(normalizedVolume, bandActivity * this.profile.visualActivityGain));
    const peakHz = calculatePeakHz(
      this.frequencyData,
      sampleRate,
      fftSize,
      normalizedVolume,
      this.frequencyNoiseFloor,
      this.frequencyPeakFloor,
      this.profile,
    );

    this.smoothedVolume = lerp(this.smoothedVolume, visualVolume, this.profile.volumeSmooth);
    const rawPeak = Math.max(0, visualVolume - this.smoothedVolume);
    const continuousPeak = bandActivity * this.profile.continuousPeakMix;
    this.peakLevel = Math.max(rawPeak * 4.2, this.peakLevel * 0.86, continuousPeak);
    const frequencyBands = normalizeFrequencyBands(
      compressFrequencyBands(this.frequencyData, BAND_COUNT, this.profile.bandGain),
      this.bandFloors,
      this.bandPeaks,
      normalizedVolume,
    );
    const bassEnergy = clamp01(bass * (0.68 + normalizedVolume * 0.7));
    const midEnergy = clamp01(mid * (0.72 + normalizedVolume * 0.52));
    const highEnergy = clamp01(high * (0.82 + normalizedVolume * 0.48));
    const inputStatus = detectInputStatus(this.timeData, normalizedVolume, this.peakLevel);

    this.smoothedPeakHz = smoothFrequency(this.smoothedPeakHz, peakHz, 0.18);
    this.smoothedCentroidHz = smoothFrequency(this.smoothedCentroidHz, spectralCentroidHz, 0.14);
    this.smoothedFluxPercent = lerp(this.smoothedFluxPercent, spectralFluxPercent, 0.22);
    this.smoothedBandGauges.bass = lerp(this.smoothedBandGauges.bass, bassEnergy, 0.2);
    this.smoothedBandGauges.mid = lerp(this.smoothedBandGauges.mid, midEnergy, 0.2);
    this.smoothedBandGauges.high = lerp(this.smoothedBandGauges.high, highEnergy, 0.2);
    this.inputSaturationFrames = inputStatus ? Math.min(30, this.inputSaturationFrames + 1) : Math.max(0, this.inputSaturationFrames - 1);
    this.updateTrackDebugState({
      rawRMS: waveformVolume,
      rawVolume,
      effectiveVolume,
      noiseFloor: this.noiseFloor,
      normalizedVolume,
      visualVolume,
      peakLevel: this.peakLevel,
    });

    const state = {
      bassEnergy,
      midEnergy,
      highEnergy,
      overallVolume: visualVolume,
      smoothedVolume: clamp01(this.smoothedVolume),
      peakLevel: clamp01(this.peakLevel),
      spectralCentroid,
      spectralFlux,
      rms: waveformVolume,
      rawRMS: waveformVolume,
      rawVolume,
      effectiveVolume,
      normalizedVolume,
      visualVolume,
      noiseFloor: this.noiseFloor,
      peakHz: this.smoothedPeakHz,
      spectralCentroidHz: this.smoothedCentroidHz,
      spectralFluxPercent: clamp(this.smoothedFluxPercent, 0, 100),
      bandGauges: {
        bass: clamp01(this.smoothedBandGauges.bass),
        mid: clamp01(this.smoothedBandGauges.mid),
        high: clamp01(this.smoothedBandGauges.high),
      },
      inputStatus: this.inputSaturationFrames >= 8 ? '入力飽和' : '',
      frequencyBands,
      frequencyData: this.frequencyData,
      sampleRate,
      hasInput: this.available,
      audioContextState: this.context?.state || 'none',
      micStreamActive: Boolean(this.stream?.active),
      audioProfile: this.profile.id,
      peakLevelGate: this.profile.peakLevelGate,
      debug: this.debugState,
    };

    this.previousFrequencyData.set(this.frequencyData);
    return state;
  }

  attachTrackDebugEvents(track) {
    this.debugState = createAudioDebugState(this.profile);
    if (!track) return;
    this.updateTrackDebugState();
    track.addEventListener('mute', () => {
      this.debugState.trackMuted = true;
      this.debugState.lastMuteAt = performance.now();
    });
    track.addEventListener('unmute', () => {
      this.debugState.trackMuted = false;
      this.debugState.lastUnmuteAt = performance.now();
    });
    track.addEventListener('ended', () => {
      this.debugState.trackEnded = true;
      this.debugState.trackReadyState = track.readyState;
    });
  }

  updateTrackDebugState(values = {}) {
    const track = this.audioTrack;
    this.debugState.profile = this.profile.id;
    this.debugState.streamActive = Boolean(this.stream?.active);
    this.debugState.trackReadyState = track?.readyState || 'none';
    this.debugState.trackEnabled = Boolean(track?.enabled);
    this.debugState.trackMuted = Boolean(track?.muted);
    this.debugState.trackEnded = track?.readyState === 'ended' || this.debugState.trackEnded;
    this.debugState.trackSettings = getTrackSettings(track);
    Object.assign(this.debugState, values);
  }
}

function emptyAudioState(hasInput) {
  return {
    bassEnergy: 0,
    midEnergy: 0,
    highEnergy: 0,
    overallVolume: 0,
    smoothedVolume: 0,
    peakLevel: 0,
    spectralCentroid: 0,
    spectralFlux: 0,
    rms: 0,
    peakHz: 0,
    spectralCentroidHz: 0,
    spectralFluxPercent: 0,
    rawRMS: 0,
    rawVolume: 0,
    effectiveVolume: 0,
    visualVolume: 0,
    noiseFloor: 0,
    bandGauges: {
      bass: 0,
      mid: 0,
      high: 0,
    },
    inputStatus: '',
    frequencyBands: new Float32Array(BAND_COUNT),
    frequencyData: new Uint8Array(0),
    sampleRate: 0,
    hasInput,
    audioContextState: 'none',
    micStreamActive: false,
    audioProfile: 'desktop',
    peakLevelGate: DESKTOP_AUDIO_PROFILE.peakLevelGate,
    debug: createAudioDebugState(DESKTOP_AUDIO_PROFILE),
  };
}

function average(data, start, end) {
  let total = 0;
  const safeEnd = Math.min(end, data.length);
  const safeStart = Math.max(0, Math.min(start, safeEnd - 1));
  for (let index = safeStart; index < safeEnd; index += 1) {
    total += data[index];
  }
  return total / Math.max(1, safeEnd - safeStart);
}

function averageFrequencyRange(data, sampleRate, fftSize, minHz, maxHz) {
  if (!sampleRate || !fftSize) return 0;
  const start = Math.max(1, Math.ceil((minHz * fftSize) / sampleRate));
  const end = Math.min(data.length, Math.floor((maxHz * fftSize) / sampleRate) + 1);
  return average(data, start, end) / 255;
}

function lerp(from, to, amount) {
  return from + (to - from) * amount;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function shapeEnergy(value, exponent) {
  return Math.pow(clamp01(value * 1.35), exponent);
}

function rms(data) {
  let total = 0;
  for (let index = 0; index < data.length; index += 1) {
    const centered = (data[index] - 128) / 128;
    total += centered * centered;
  }
  return Math.sqrt(total / data.length);
}

function calculateSpectralCentroid(data) {
  let weighted = 0;
  let total = 0;
  for (let index = 1; index < data.length; index += 1) {
    const value = data[index] / 255;
    weighted += value * index;
    total += value;
  }
  return total > 0 ? clamp01(weighted / total / data.length) : 0;
}

function calculatePeakHz(data, sampleRate, fftSize, volume, noiseFloor, peakFloor, profile) {
  if (!sampleRate || !fftSize) return 0;
  const start = Math.max(1, Math.ceil((MONITOR_MIN_HZ * fftSize) / sampleRate));
  const end = Math.min(data.length, Math.floor((MONITOR_MAX_HZ * fftSize) / sampleRate) + 1);
  const peakMinVolume = profile?.peakMinVolume ?? PEAK_MIN_VOLUME;
  const peakMinEnergy = profile?.peakMinEnergy ?? PEAK_MIN_ENERGY;
  if (volume < peakMinVolume) {
    updateFrequencyNoiseFloor(data, noiseFloor, peakFloor, start, end, 0.018);
    return 0;
  }

  let maxIndex = 0;
  let maxScore = 0;
  let maxCleanEnergy = 0;
  updateFrequencyNoiseFloor(data, noiseFloor, peakFloor, start, end, volume < 0.08 ? 0.01 : 0.0025);

  for (let index = start + 2; index < end - 2; index += 1) {
    const energy = data[index] / 255;
    const floor = noiseFloor?.[index] || 0;
    const cleanEnergy = Math.max(0, energy - floor * 1.1);
    const localAverage = (
      Math.max(0, data[index - 2] / 255 - (noiseFloor?.[index - 2] || 0) * 1.1) +
      Math.max(0, data[index - 1] / 255 - (noiseFloor?.[index - 1] || 0) * 1.1) +
      Math.max(0, data[index + 1] / 255 - (noiseFloor?.[index + 1] || 0) * 1.1) +
      Math.max(0, data[index + 2] / 255 - (noiseFloor?.[index + 2] || 0) * 1.1)
    ) * 0.25;
    const prominence = cleanEnergy - localAverage;
    const stablePeak = Math.max(cleanEnergy, peakFloor?.[index] || 0.04);
    const score = prominence * 0.68 + cleanEnergy * 0.32 - stablePeak * 0.05;
    if (cleanEnergy > peakMinEnergy && prominence > PEAK_MIN_PROMINENCE && score > maxScore) {
      maxScore = score;
      maxCleanEnergy = cleanEnergy;
      maxIndex = index;
    }
  }

  if (!maxIndex || maxCleanEnergy < peakMinEnergy) return 0;
  return interpolatePeakHz(data, maxIndex, sampleRate, fftSize, noiseFloor);
}

function calculateSpectralCentroidHz(data, sampleRate, fftSize) {
  if (!sampleRate || !fftSize) return 0;
  let weighted = 0;
  let total = 0;
  const end = Math.min(data.length, Math.floor((MONITOR_MAX_HZ * fftSize) / sampleRate) + 1);
  for (let index = 1; index < end; index += 1) {
    const energy = data[index] / 255;
    weighted += binToHz(index, sampleRate, fftSize) * energy;
    total += energy;
  }
  return total > 0.0001 ? weighted / total : 0;
}

function updateFrequencyNoiseFloor(data, noiseFloor, peakFloor, start, end, amount) {
  if (!noiseFloor || !peakFloor) return;
  for (let index = start; index < end; index += 1) {
    const energy = data[index] / 255;
    const floorSpeed = energy < noiseFloor[index] ? 0.12 : amount;
    noiseFloor[index] = Math.min(0.42, lerp(noiseFloor[index], energy, floorSpeed));
    const peakSpeed = energy > peakFloor[index] ? 0.08 : 0.006;
    peakFloor[index] = Math.max(0.035, lerp(peakFloor[index], energy, peakSpeed));
  }
}

function interpolatePeakHz(data, peakIndex, sampleRate, fftSize, noiseFloor) {
  const left = cleanedBinEnergy(data, peakIndex - 1, noiseFloor);
  const center = cleanedBinEnergy(data, peakIndex, noiseFloor);
  const right = cleanedBinEnergy(data, peakIndex + 1, noiseFloor);
  const denominator = left - 2 * center + right;
  const offset = Math.abs(denominator) > 0.000001
    ? clamp(0.5 * (left - right) / denominator, -0.5, 0.5)
    : 0;
  return binToHz(peakIndex + offset, sampleRate, fftSize);
}

function cleanedBinEnergy(data, index, noiseFloor) {
  if (index < 0 || index >= data.length) return 0;
  return Math.max(0, data[index] / 255 - (noiseFloor?.[index] || 0) * 1.1);
}

function binToHz(binIndex, sampleRate, fftSize) {
  return (binIndex * sampleRate) / fftSize;
}

function smoothFrequency(current, incoming, amount) {
  if (!incoming) return lerp(current, 0, amount * 0.36);
  if (!current) return incoming;
  return lerp(current, incoming, amount);
}

function calculateSpectralFlux(current, previous) {
  let flux = 0;
  for (let index = 1; index < current.length; index += 1) {
    const delta = (current[index] - previous[index]) / 255;
    if (delta > 0) flux += delta * delta;
  }
  return clamp01(Math.sqrt(flux / current.length) * 9);
}

function detectInputStatus(timeData, volume, peakLevel) {
  let clippedSamples = 0;
  for (let index = 0; index < timeData.length; index += 1) {
    const value = timeData[index];
    if (value <= 2 || value >= 253) clippedSamples += 1;
  }
  const clippedRatio = clippedSamples / timeData.length;
  return clippedRatio > 0.018 || (volume > 0.92 && peakLevel > 0.5);
}

function compressFrequencyBands(data, bandCount, gain = 1) {
  const bands = new Float32Array(bandCount);
  const minIndex = 1;
  const maxIndex = data.length - 1;
  const minLog = Math.log(minIndex);
  const maxLog = Math.log(maxIndex);
  for (let band = 0; band < bandCount; band += 1) {
    const t0 = band / bandCount;
    const t1 = (band + 1) / bandCount;
    const start = Math.max(minIndex, Math.floor(Math.exp(minLog + t0 * (maxLog - minLog))));
    const end = Math.max(start + 2, Math.floor(Math.exp(minLog + t1 * (maxLog - minLog))));
    const bandT = band / Math.max(1, bandCount - 1);
    const raw = average(data, start, Math.min(end, data.length)) / 255 * gain;
    const sensitivity = 1.08 + bandT * 1.72;
    const exponent = bandT < 0.18 ? 1.12 : bandT > 0.72 ? 0.64 : 0.82;
    bands[band] = shapeEnergy(raw * sensitivity, exponent);
  }
  return bands;
}

function normalizeFrequencyBands(rawBands, floors, peaks, volume) {
  const normalized = new Float32Array(rawBands.length);
  for (let band = 0; band < rawBands.length; band += 1) {
    const bandT = band / Math.max(1, rawBands.length - 1);
    const raw = rawBands[band];
    const floorSpeed = raw < floors[band] ? 0.12 : 0.008;
    const peakSpeed = raw > peaks[band] ? 0.18 : 0.014;
    floors[band] = lerp(floors[band], raw, floorSpeed);
    peaks[band] = Math.max(0.045, lerp(peaks[band], raw, peakSpeed));

    const dynamicRange = Math.max(0.055, peaks[band] - floors[band]);
    const local = clamp01((raw - floors[band] * 0.82) / dynamicRange);
    const highLift = smoothstep(0.48, 1, bandT) * (0.12 + volume * 0.12);
    const lowTame = 1 - smoothstep(0, 0.22, bandT) * 0.16;
    normalized[band] = clamp01((raw * 0.32 + local * 0.68 + highLift) * lowTame);
  }
  return normalized;
}

function smoothstep(edge0, edge1, value) {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function createAudioProfile() {
  return isIOSLikeWebKitRuntime() ? IOS_WEBKIT_AUDIO_PROFILE : DESKTOP_AUDIO_PROFILE;
}

function isIOSLikeWebKitRuntime() {
  if (typeof navigator === 'undefined') return false;
  const userAgent = navigator.userAgent || '';
  const platform = navigator.platform || '';
  const maxTouchPoints = navigator.maxTouchPoints || 0;
  return /iPhone|iPad|iPod/i.test(userAgent)
    || /iPhone|iPad|iPod/i.test(platform)
    || (platform === 'MacIntel' && maxTouchPoints > 1);
}

function createAudioDebugState(profile) {
  return {
    profile: profile.id,
    streamActive: false,
    trackReadyState: 'none',
    trackEnabled: false,
    trackMuted: false,
    trackEnded: false,
    trackSettings: {},
    rawRMS: 0,
    rawVolume: 0,
    effectiveVolume: 0,
    noiseFloor: 0,
    normalizedVolume: 0,
    peakLevel: 0,
    lastMuteAt: 0,
    lastUnmuteAt: 0,
  };
}

function getTrackSettings(track) {
  if (!track?.getSettings) return {};
  try {
    return track.getSettings();
  } catch (error) {
    console.warn('Unable to read audio track settings', error);
    return {};
  }
}
