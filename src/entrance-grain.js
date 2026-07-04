export class EntranceGrainField {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d', {
      alpha: false,
      willReadFrequently: true,
    });
    this.audioLevel = 0.03;
    this.bassLevel = 0.02;
    this.highLevel = 0.02;
    this.resizeTimer = 0;
    this.resize = this.resize.bind(this);
    this.resize();
    window.addEventListener('resize', this.resize, { passive: true });
  }

  start() {
    this.draw(0);
  }

  stop() {
    window.clearTimeout(this.resizeTimer);
  }

  setAudioState(audio) {
    if (!audio) return;
    this.audioLevel = lerp(this.audioLevel, audio.smoothedVolume || audio.overallVolume || 0.03, 0.08);
    this.bassLevel = lerp(this.bassLevel, audio.bassEnergy || 0.02, 0.08);
    this.highLevel = lerp(this.highLevel, audio.highEnergy || 0.02, 0.08);
  }

  resize() {
    const width = window.innerWidth || 1;
    const height = window.innerHeight || 1;
    const scale = width < 700 ? 0.54 : 0.38;
    this.bufferWidth = Math.max(150, Math.min(420, Math.floor(width * scale)));
    this.bufferHeight = Math.max(190, Math.min(520, Math.floor(height * scale)));
    this.canvas.width = this.bufferWidth;
    this.canvas.height = this.bufferHeight;
    this.image = this.context.createImageData(this.bufferWidth, this.bufferHeight);
    window.clearTimeout(this.resizeTimer);
    this.resizeTimer = window.setTimeout(() => this.draw(0), 80);
  }

  draw(time) {
    const width = this.bufferWidth;
    const height = this.bufferHeight;
    const data = this.image.data;
    const aspect = width / Math.max(1, height);
    const breath = Math.sin(time * 0.38) * 0.018 + this.audioLevel * 0.024;
    const pinchPull = this.bassLevel * 0.03 + this.audioLevel * 0.015;
    const offset = 0.265 - pinchPull + Math.sin(time * 0.17) * 0.01;
    const topY = 0.5 - offset;
    const bottomY = 0.5 + offset;
    const highGrain = 1 + this.highLevel * 1.6;

    for (let y = 0; y < height; y += 1) {
      const v = y / Math.max(1, height - 1);
      for (let x = 0; x < width; x += 1) {
        const u = x / Math.max(1, width - 1);
        const cx = u - 0.5;
        const cy = v - 0.5;
        const skew = Math.sin(v * 7.1 + time * 0.21) * 0.018 + Math.sin(u * 9.7 - time * 0.13) * 0.01;
        const top = ellipticalGaussian(cx + skew, v - topY, 0.34 + breath, 0.22 + breath * 0.7, aspect);
        const bottom = ellipticalGaussian(cx - skew * 0.6, v - bottomY, 0.37 + breath * 0.7, 0.25 + breath, aspect);
        const pinch = ellipticalGaussian(cx + Math.sin(time * 0.31) * 0.006, cy, 0.105 + this.bassLevel * 0.018, 0.038 + this.audioLevel * 0.012, aspect);
        const waistShadow = ellipticalGaussian(cx, cy, 0.26, 0.16, aspect) * 0.18;
        const paper = fbm(u * 9.5 + 11.3, v * 9.5 - 4.7, time * 0.035);
        const fine = hash3(x * 1.91, y * 2.37, Math.floor(time * 16));
        const dust = hash3(x * 11.7 + 3.1, y * 13.9 - 8.2, Math.floor(time * 5));
        const density = clamp01((top + bottom) * 0.86 + pinch * 0.72 + waistShadow + (paper - 0.5) * 0.13);
        const particle = fine < density * (0.54 + highGrain * 0.16) ? 1 : 0;
        const paperTone = 234 + (paper - 0.5) * 12 + (dust - 0.5) * 8;
        const sootTone = 52 + fine * 28 + paper * 18;
        const densityMix = clamp01(density * (0.74 + particle * 0.58));
        const grainMix = clamp01(densityMix + (particle ? 0.22 : 0) + (dust > 0.985 ? 0.18 : 0));
        const gray = clamp(lerp(paperTone, sootTone, grainMix) + (fine - 0.5) * 28 * highGrain, 18, 243);
        const offsetIndex = (y * width + x) * 4;
        data[offsetIndex] = gray;
        data[offsetIndex + 1] = clamp(gray - 1 + paper * 3, 0, 255);
        data[offsetIndex + 2] = clamp(gray - 5 + paper * 5, 0, 255);
        data[offsetIndex + 3] = 255;
      }
    }

    this.context.putImageData(this.image, 0, 0);
  }

  destroy() {
    this.stop();
    window.removeEventListener('resize', this.resize);
  }
}

function ellipticalGaussian(x, y, sx, sy, aspect) {
  const px = x * aspect / Math.max(0.001, sx);
  const py = y / Math.max(0.001, sy);
  return Math.exp(-(px * px + py * py) * 2.35);
}

function fbm(x, y, z) {
  let value = 0;
  let amplitude = 0.5;
  let frequency = 1;
  for (let octave = 0; octave < 4; octave += 1) {
    value += smoothNoise(x * frequency, y * frequency, z * frequency) * amplitude;
    frequency *= 2.07;
    amplitude *= 0.5;
  }
  return value;
}

function smoothNoise(x, y, z) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const a = hash3(ix, iy, Math.floor(z));
  const b = hash3(ix + 1, iy, Math.floor(z));
  const c = hash3(ix, iy + 1, Math.floor(z));
  const d = hash3(ix + 1, iy + 1, Math.floor(z));
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  return lerp(lerp(a, b, ux), lerp(c, d, ux), uy);
}

function hash3(x, y, z) {
  const value = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453123;
  return value - Math.floor(value);
}

function lerp(from, to, amount) {
  return from + (to - from) * amount;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value) {
  return clamp(value, 0, 1);
}
