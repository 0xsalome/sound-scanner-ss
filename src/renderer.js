import * as THREE from 'three';
import { MODES, SAMPLE_PRESETS } from './modes.js';

const TRAIL_COUNT = 3;
const TRAIL_CAPTURE_INTERVAL = 145;
const SPECTRUM_BANDS = 48;
const SPECTRUM_HISTORY = 64;
const SPECTRUM_LINE_STRIDE = 4;
const LINE_SEGMENTS_PER_SAMPLE = 18;
const DEBUG_FORCE_RESONANCE = false;
const CYMATIC_RESONANCE_HOLD_MS = 280;
const CYMATIC_PATTERN_HOLD_MS = 300;
const CYMATIC_PATTERN_FADE_MS = 850;
const IOS_CYMATIC_MIN_REACTIVE_HZ = 50;
const CYMATIC_PATTERN_TYPES = {
  LOW: 'LOW',
  LOW_MID: 'LOW_MID',
  MID: 'MID',
  HIGH: 'HIGH',
};
const POINT_MODE_ORTHO_HEIGHT = 5.25;
const COLOR_PALETTES = [
  { label: 'REAL', filter: 'none', realColor: true },
  { label: 'DEFAULT', filter: 'none' },
  { label: 'MONO', filter: 'grayscale(1) contrast(1.28) brightness(1.05)' },
  { label: 'PSY', filter: 'saturate(2.55) hue-rotate(96deg) contrast(1.18)' },
  { label: 'SOFT', filter: 'sepia(0.22) saturate(1.22) hue-rotate(24deg) contrast(0.96) brightness(1.12)' },
  { label: 'AURA', filter: 'invert(0.18) saturate(2.15) hue-rotate(188deg) contrast(1.22) brightness(1.03)' },
];
const CYMATIC_MODE_TABLE = [
  { freq: 72, n: 1, m: 2, label: 'low-1' },
  { freq: 94, n: 2, m: 1, label: 'low-2' },
  { freq: 131, n: 2, m: 3, label: 'low-mid-1' },
  { freq: 178, n: 3, m: 2, label: 'mid-1' },
  { freq: 236, n: 3, m: 4, label: 'mid-2' },
  { freq: 310, n: 4, m: 3, label: 'mid-high-1' },
  { freq: 420, n: 5, m: 4, label: 'high-1' },
  { freq: 560, n: 6, m: 5, label: 'high-2' },
  { freq: 740, n: 7, m: 6, label: 'high-3' },
  { freq: 980, n: 8, m: 7, label: 'high-4' },
];

const vertexShader = `
  precision highp float;
  attribute vec3 color;
  attribute float baseBrightness;
  attribute float edgeStrength;
  attribute float randomSeed;
  varying vec3 vColor;
  varying float vBrightness;
  varying float vEdge;
  varying float vScan;
  uniform float uTime;
  uniform float uBass;
  uniform float uMid;
  uniform float uHigh;
  uniform float uVolume;
  uniform float uPeak;
  uniform float uIntensity;
  uniform float uPointSize;
  uniform float uMode;
  uniform float uCentroid;
  uniform float uFlux;

  float hash(float n) {
    return fract(sin(n) * 43758.5453123);
  }

  void main() {
    vec3 transformed = position;
    float t = uTime * 0.001;
    float seed = randomSeed * 6.2831853;
    float highFizz = (hash(randomSeed + floor(uTime * 0.026)) - 0.5) * uHigh;

    transformed.x += sin(t * 1.8 + seed) * uMid * 0.09 * uIntensity;
    transformed.y += highFizz * 0.13 * uIntensity;

    if (uMode > 0.5 && uMode < 1.5) {
      float radial = length(position.xy);
      float wave = sin(radial * 8.0 - t * (3.6 + uFlux * 4.5));
      transformed.x += sin(position.y * 4.2 + t * 2.1) * (uMid + 0.04) * 0.045 * uIntensity;
      transformed.y += cos(position.x * 3.8 + t * 1.9) * uMid * 0.025 * uIntensity;
      transformed.z += wave * (uBass + uFlux * 0.2 + 0.03) * 0.095 * uIntensity;
      transformed.z += smoothstep(0.06, 0.0, abs(fract(radial * 1.8 - t * (0.35 + uFlux * 0.7)) - 0.5)) * (uPeak * 0.3 + uFlux * 0.18) * 0.095;
    }

    if (uMode > 1.5) {
      transformed.z *= 0.18;
      transformed.z += edgeStrength * (0.22 + uBass * 0.18) + baseBrightness * 0.06;
      transformed.x += sin(t * 1.3 + position.y * 7.0 + seed) * uMid * 0.028;
      transformed.y += cos(t * 1.1 + position.x * 7.0 + seed) * uMid * 0.028;
    }

    vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
    float scan = smoothstep(0.955, 1.0, sin(position.y * 18.0 - uTime * 0.012) * 0.5 + 0.5);
    float sizePulse = uMode > 0.5 && uMode < 1.5
      ? 0.92 + uVolume * 0.72 + uHigh * 0.42 + uBass * 0.28 + baseBrightness * 0.52 + edgeStrength * 0.48 + scan * uHigh * 0.28 + uFlux * 0.22
      : 1.0 + uVolume * 1.65 + uHigh * 1.45 + uBass * 0.65 + baseBrightness * 0.65 + edgeStrength * 0.85 + scan * uHigh + uFlux * 0.75;
    if (uMode > 1.5) {
      sizePulse = 0.72 + edgeStrength * 1.9 + uBass * 0.5 + uHigh * 0.7;
    }
    gl_PointSize = uMode > 1.5
      ? clamp(uPointSize * sizePulse, 0.75, 2.8)
      : clamp(uPointSize * sizePulse, 1.15, 5.6);
    gl_Position = projectionMatrix * mvPosition;

    vColor = color;
    vBrightness = baseBrightness;
    vEdge = edgeStrength;
    vScan = scan;
  }
`;

const fragmentShader = `
  precision highp float;
  varying vec3 vColor;
  varying float vBrightness;
  varying float vEdge;
  varying float vScan;
  uniform float uHigh;
  uniform float uVolume;
  uniform float uPeak;
  uniform float uMode;
  uniform float uCentroid;
  uniform float uFlux;
  uniform float uRealColor;

  void main() {
    vec2 coord = gl_PointCoord - vec2(0.5);
    float dist = length(coord);
    if (dist > 0.5) discard;
    float core = smoothstep(0.42, 0.08, dist);
    float halo = smoothstep(0.5, 0.16, dist) * 0.38;
    if (uMode > 1.5) {
      float ink = clamp(vBrightness * 0.84 + vEdge * 0.18, 0.0, 1.0);
      if (uRealColor > 0.5) {
        if (ink < 0.018) discard;
        float realAlpha = (core + halo * 0.18) * smoothstep(0.018, 0.82, ink) * 0.76;
        gl_FragColor = vec4(vColor, realAlpha);
        return;
      }
      if (uMode > 2.5) {
        if (ink < 0.001) discard;
        vec3 thermalInk = vColor * (0.62 + ink * 0.78 + uVolume * 0.22);
        thermalInk += vec3(0.08, 0.28, 0.22) * vEdge * (0.35 + uHigh * 0.3);
        vec2 squareEdge = 1.0 - smoothstep(vec2(0.38), vec2(0.5), abs(coord));
        float squareAlpha = squareEdge.x * squareEdge.y;
        float dustAlpha = max(squareAlpha, core * 0.65 + halo * 0.08) * (0.42 + smoothstep(0.01, 0.72, ink) * 0.58);
        gl_FragColor = vec4(thermalInk, dustAlpha);
        return;
      }
      if (ink < 0.018) discard;
      vec3 surveyInk = mix(vec3(0.34, 0.44, 0.43), vec3(0.78, 0.86, 0.82), smoothstep(0.04, 0.74, ink));
      surveyInk += vec3(0.04, 0.09, 0.08) * vEdge;
      gl_FragColor = vec4(surveyInk, (core + halo * 0.18) * smoothstep(0.018, 0.82, ink) * 0.68);
      return;
    }
    vec3 scanTint = vec3(0.50, 0.86, 1.0);
    vec3 ghostTint = vec3(1.0, 0.43, 0.31);
    vec3 terrainTint = vec3(0.64, 0.58, 0.95);
    vec3 modeTint = mix(scanTint, terrainTint, step(0.5, uMode));
    modeTint = mix(modeTint, ghostTint, step(1.5, uMode));
    float frequencyMode = step(0.5, uMode) * (1.0 - step(1.5, uMode));
    vec3 frequencyTint = mix(vec3(0.70, 0.70, 0.70), vec3(1.0, 0.98, 0.94), clamp(uCentroid * 0.72 + uFlux * 0.18, 0.0, 1.0));
    modeTint = mix(modeTint, frequencyTint, frequencyMode);
    vec3 litColor = mix(vColor, modeTint, 0.18 + uHigh * 0.18 + vScan * 0.34 + uFlux * 0.16);
    litColor += modeTint * (vEdge * 0.24 + vScan * uHigh * 0.38 + uFlux * 0.25);
    litColor *= 0.26 + vBrightness * 1.28 + uVolume * 0.48 + uPeak * 0.82 + frequencyMode * 0.26;
    float alpha = (core + halo) * (0.46 + vBrightness * 0.38 + vEdge * 0.2 + uVolume * 0.22 + uPeak * 0.28 + frequencyMode * 0.12);
    if (uRealColor > 0.5) {
      gl_FragColor = vec4(vColor, alpha);
      return;
    }
    gl_FragColor = vec4(litColor, alpha);
  }
`;

const trailVertexShader = `
  precision highp float;
  attribute vec3 color;
  attribute float age;
  varying vec3 vColor;
  varying float vAge;
  uniform float uTime;
  uniform float uBass;
  uniform float uHigh;
  uniform float uMode;

  void main() {
    vec3 transformed = position;
    transformed.z -= age * (0.34 + uBass * 0.65);
    transformed.x += sin(uTime * 0.0013 + age * 3.0 + position.y * 2.0) * uHigh * 0.16;
    vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
    gl_PointSize = clamp(1.25 + uHigh * 2.2, 1.0, 4.2);
    gl_Position = projectionMatrix * mvPosition;
    vColor = color;
    vAge = age;
  }
`;

const trailFragmentShader = `
  precision highp float;
  varying vec3 vColor;
  varying float vAge;
  uniform float uVolume;
  uniform float uPeak;
  uniform float uRealColor;

  void main() {
    vec2 coord = gl_PointCoord - vec2(0.5);
    if (length(coord) > 0.5) discard;
    float alpha = smoothstep(0.5, 0.1, length(coord));
    vec3 tint = uRealColor > 0.5 ? vColor : mix(vColor, vec3(0.95, 0.38, 0.28), 0.38);
    gl_FragColor = vec4(tint * (0.55 + uPeak), alpha * (0.22 + uVolume * 0.18) * (1.0 - vAge * 0.22));
  }
`;

export class SoundScannerRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(0x020407, 1);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
    this.cymaticCanvas = document.createElement('canvas');
    this.cymaticCanvas.className = 'cymatic-canvas';
    this.cymaticCanvas.setAttribute('aria-hidden', 'true');
    this.cymaticCanvas.style.cssText = [
      'position:fixed',
      'inset:0',
      'display:block',
      'width:100%',
      'height:100%',
      'opacity:0',
      'pointer-events:none',
      'background:#050505',
      'transition:opacity 180ms ease',
    ].join(';');
    canvas.insertAdjacentElement('afterend', this.cymaticCanvas);
    this.cymaticContext = this.cymaticCanvas.getContext('2d', { alpha: false });
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(58, 1, 0.1, 100);
    this.camera.position.z = 5.8;
    this.pointCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    this.pointCamera.position.z = 5.8;
    this.group = new THREE.Group();
    this.scene.add(this.group);

    this.modeIndex = 0;
    this.densityIndex = 1;
    this.intensity = 0.86;
    this.colorPaletteIndex = 0;
    const initialSample = this.pickSampleSize(this.densityIndex);
    this.sampleWidth = initialSample.width;
    this.sampleHeight = initialSample.height;
    this.aspectBucket = this.getAspectBucket();
    this.running = false;
    this.audioAvailable = false;
    this.lastCaptureTime = 0;
    this.lastShockwaveTime = 0;
    this.lastRenderTime = 0;
    this.frameBudgetMs = 0;
    this.scanPhase = 0;
    this.hasCameraFrame = false;
    this.visiblePointCount = 0;
    this.averageBrightness = 0;
    this.layout = this.getLayoutMetrics();
    this.spectrumHistory = Array.from({ length: SPECTRUM_HISTORY }, () => new Float32Array(SPECTRUM_BANDS));
    this.spectrumCursor = 0;
    this.shockwaves = [];
    this.edgePlanBuffers = null;
    this.cymaticParticleX = null;
    this.cymaticParticleY = null;
    this.cymaticVelocityX = null;
    this.cymaticVelocityY = null;
    this.cymaticBaseX = null;
    this.cymaticBaseY = null;
    this.cymaticBrightness = null;
    this.cymaticCanvasWidth = 0;
    this.cymaticCanvasHeight = 0;
    this.cymaticParticleTotal = 0;
    this.cymaticPhase = 0;
    this.cymaticPattern = CYMATIC_PATTERN_TYPES.LOW;
    this.previousCymaticPattern = CYMATIC_PATTERN_TYPES.LOW;
    this.pendingCymaticPattern = CYMATIC_PATTERN_TYPES.LOW;
    this.pendingCymaticPatternSince = 0;
    this.cymaticPatternTransition = 1;
    this.cymaticPatternTransitionStart = 0;
    this.cymaticResonanceEnvelope = 0;
    this.cymaticShock = 0;
    this.resonanceStrength = 0;
    this.resonanceHoldMs = 0;
    this.selectedCymaticMode = CYMATIC_MODE_TABLE[0];
    this.cymaticDebug = {
      selectedFreq: this.selectedCymaticMode.freq,
      selectedN: this.selectedCymaticMode.n,
      selectedM: this.selectedCymaticMode.m,
      nearestFreq: this.selectedCymaticMode.freq,
      freqError: 0,
      relativeError: 0,
      modeEnergy: 0,
      rmsGate: 0,
      energyGate: 0,
      frequencyMatch: 0,
      loudEnough: 0,
      resonanceStrength: 0,
      holdMs: 0,
    };

    this.material = new THREE.ShaderMaterial({
      uniforms: sharedUniforms(this.intensity),
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.trailMaterial = new THREE.ShaderMaterial({
      uniforms: sharedUniforms(this.intensity),
      vertexShader: trailVertexShader,
      fragmentShader: trailFragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.spectrumMaterial = new THREE.PointsMaterial({
      size: 0.032,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.spectrumLineMaterial = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.68,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.lineSupportMaterial = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.74,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.rebuildGeometry();
    this.rebuildSpectrumLayer();
    this.updateModeStyle();
    this.applyColorPalette();
    this.resize();
  }

  get modeName() {
    return MODES[this.modeIndex].name;
  }

  get densityLabel() {
    return SAMPLE_PRESETS[this.densityIndex].label;
  }

  get performanceLabel() {
    if (!this.frameBudgetMs) return 'FPS --';
    return `FPS ${Math.round(1000 / Math.max(1, this.frameBudgetMs))}`;
  }

  get pointCount() {
    return this.sampleWidth * this.sampleHeight;
  }

  get sampleResolutionLabel() {
    return `${this.sampleWidth}x${this.sampleHeight}`;
  }

  get visibleStatsLabel() {
    return `${this.visiblePointCount}/${this.pointCount} visible, avg ${this.averageBrightness.toFixed(3)}`;
  }

  getRecordingSourceCanvas() {
    return this.modeIndex === 3 ? this.cymaticCanvas : this.canvas;
  }

  get sampleIntervalMs() {
    const densityCost = this.densityIndex * 7;
    const heatGuard = this.frameBudgetMs > 38 ? 18 : 0;
    return 24 + densityCost + heatGuard;
  }

  setSampleSize(width, height) {
    this.sampleWidth = width;
    this.sampleHeight = height;
    this.rebuildGeometry();
  }

  setAudioAvailable(available) {
    this.audioAvailable = available;
  }

  start() {
    this.running = true;
  }

  pause() {
    this.running = false;
  }

  resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.updatePointCameraFrustum(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isCoarsePointer() ? 1.5 : 2));
    this.renderer.setSize(width, height, false);
    this.resizeCymaticCanvas(width, height);
    this.layout = this.getLayoutMetrics();
    const nextBucket = this.getAspectBucket();
    if (nextBucket !== this.aspectBucket) {
      this.aspectBucket = nextBucket;
      const sample = this.pickSampleSize(this.densityIndex);
      this.sampleWidth = sample.width;
      this.sampleHeight = sample.height;
      this.rebuildGeometry();
    }
  }

  updatePointCameraFrustum(width = window.innerWidth, height = window.innerHeight) {
    const aspect = width / Math.max(1, height);
    const viewHeight = POINT_MODE_ORTHO_HEIGHT;
    const viewWidth = viewHeight * aspect;
    this.pointCamera.left = -viewWidth / 2;
    this.pointCamera.right = viewWidth / 2;
    this.pointCamera.top = viewHeight / 2;
    this.pointCamera.bottom = -viewHeight / 2;
    this.pointCamera.updateProjectionMatrix();
  }

  nextMode() {
    this.setMode((this.modeIndex + 1) % MODES.length);
  }

  setMode(modeIndex) {
    this.modeIndex = clamp(Math.round(modeIndex), 0, MODES.length - 1);
    this.material.uniforms.uMode.value = this.modeIndex;
    this.trailMaterial.uniforms.uMode.value = this.modeIndex;
    if (this.modeIndex !== 1) this.clearShockwaves();
    this.updateModeStyle();
  }

  updateModeStyle() {
    const lineMode = this.modeIndex === 2;
    const cymaticMode = this.modeIndex === 3;
    this.renderer.setClearColor(lineMode ? 0xffffff : cymaticMode ? 0x020504 : 0x020407, 1);
    this.canvas.style.opacity = cymaticMode ? '0' : '1';
    this.cymaticCanvas.style.opacity = cymaticMode ? '1' : '0';
    this.material.blending = THREE.AdditiveBlending;
    this.trailMaterial.blending = THREE.AdditiveBlending;
    if (this.points) this.points.visible = !lineMode;
    if (this.trails) this.trails.visible = this.modeIndex === 1;
    if (this.spectrumPoints) this.spectrumPoints.visible = this.modeIndex === 1;
    if (this.spectrumLines) this.spectrumLines.visible = this.modeIndex === 1;
    if (this.lineSupport) this.lineSupport.visible = lineMode;
    this.lineSupportMaterial.blending = lineMode ? THREE.NormalBlending : THREE.AdditiveBlending;
    this.lineSupportMaterial.opacity = lineMode ? 0.92 : 0;
    this.material.needsUpdate = true;
    this.trailMaterial.needsUpdate = true;
    this.lineSupportMaterial.needsUpdate = true;
  }

  adjustIntensity(delta) {
    this.intensity = clamp(this.intensity + delta, 0.2, 1.8);
    this.material.uniforms.uIntensity.value = this.intensity;
    this.trailMaterial.uniforms.uIntensity.value = this.intensity;
  }

  adjustDensity(direction) {
    this.densityIndex = clamp(this.densityIndex + direction, 0, SAMPLE_PRESETS.length - 1);
    const preset = this.pickSampleSize(this.densityIndex);
    this.sampleWidth = preset.width;
    this.sampleHeight = preset.height;
    this.rebuildGeometry();
  }

  nextColorPalette() {
    this.colorPaletteIndex = (this.colorPaletteIndex + 1) % COLOR_PALETTES.length;
    this.applyColorPalette();
    return this.colorPaletteLabel;
  }

  get colorPaletteLabel() {
    return COLOR_PALETTES[this.colorPaletteIndex]?.label || COLOR_PALETTES[0].label;
  }

  get isRealColorPalette() {
    return Boolean((COLOR_PALETTES[this.colorPaletteIndex] || COLOR_PALETTES[0]).realColor);
  }

  applyColorPalette() {
    const palette = COLOR_PALETTES[this.colorPaletteIndex] || COLOR_PALETTES[0];
    this.canvas.style.filter = palette.filter;
    this.cymaticCanvas.style.filter = palette.filter;
    const realColor = palette.realColor ? 1 : 0;
    if (this.material?.uniforms.uRealColor) this.material.uniforms.uRealColor.value = realColor;
    if (this.trailMaterial?.uniforms.uRealColor) this.trailMaterial.uniforms.uRealColor.value = realColor;
  }

  getAspectBucket() {
    const aspect = window.innerWidth / Math.max(1, window.innerHeight);
    if (aspect < 0.8) return 'portrait';
    if (aspect > 1.35) return isCoarsePointer() ? 'mobile-landscape' : 'desktop';
    return 'square';
  }

  pickSampleSize(densityIndex) {
    const table = {
      portrait: [
        { width: 64, height: 96 },
        { width: 96, height: 128 },
        { width: 112, height: 160 },
      ],
      'mobile-landscape': [
        { width: 96, height: 64 },
        { width: 128, height: 96 },
        { width: 160, height: 112 },
      ],
      desktop: [
        { width: 128, height: 96 },
        { width: 160, height: 120 },
        { width: 192, height: 144 },
      ],
      square: [
        { width: 96, height: 96 },
        { width: 128, height: 128 },
        { width: 160, height: 160 },
      ],
    };
    const bucket = this.getAspectBucket();
    return table[bucket][densityIndex] || SAMPLE_PRESETS[densityIndex];
  }

  getLayoutMetrics() {
    const bucket = this.getAspectBucket();
    const viewportAspect = window.innerWidth / Math.max(1, window.innerHeight);
    const mobilePortrait = bucket === 'portrait';
    const modeScale = mobilePortrait ? 1.16 : bucket === 'desktop' ? 1.2 : 1.14;
    const xBoost = bucket === 'desktop'
      ? clamp(viewportAspect / 1.22, 1.25, 1.72)
      : bucket === 'mobile-landscape'
        ? clamp(viewportAspect / 1.28, 1.12, 1.45)
        : bucket === 'square'
          ? 1.08
          : 1;
    const yBoost = mobilePortrait ? 1.42 : bucket === 'desktop' ? 1.06 : 1.12;
    const linePlaneWidth = bucket === 'desktop'
      ? clamp(viewportAspect * 5.95, 9.2, 12.4)
      : bucket === 'mobile-landscape'
        ? clamp(viewportAspect * 4.15, 6.6, 8.6)
        : bucket === 'square'
          ? 5.15
          : 3.05;
    const linePlaneAspect = bucket === 'desktop'
      ? clamp(viewportAspect * 1.02, 2.0, 2.62)
      : bucket === 'mobile-landscape'
        ? clamp(viewportAspect * 0.92, 1.65, 2.15)
        : bucket === 'square'
          ? 1.28
          : 0.78;
    const linePlaneHeight = linePlaneWidth / linePlaneAspect;
    const lineYOffset = bucket === 'portrait' ? 0 : bucket === 'desktop' ? 0.42 : 0.24;
    const lineScale = bucket === 'portrait' ? 1.16 : bucket === 'desktop' ? 1.08 : 1.1;
    const spectrumWidth = bucket === 'desktop'
      ? clamp(viewportAspect * 3.35, 5.75, 7.25)
      : bucket === 'mobile-landscape'
        ? clamp(viewportAspect * 2.4, 4.45, 5.8)
        : bucket === 'square'
          ? 4.25
          : 3.35;

    return {
      bucket,
      modeScale,
      xBoost,
      yBoost,
      linePlaneWidth,
      linePlaneHeight,
      lineYOffset,
      lineScale,
      spectrumWidth,
    };
  }

  getLineScanPoint(x, y, edge, contour, bass, mid, high, seed, time) {
    const layout = this.layout || this.getLayoutMetrics();
    const sampleAspect = this.sampleWidth / Math.max(1, this.sampleHeight);
    const u = this.sampleWidth > 1 ? x / (this.sampleWidth - 1) : 0.5;
    const v = this.sampleHeight > 1 ? y / (this.sampleHeight - 1) : 0.5;
    const centeredX = u - 0.5;
    const centeredY = 0.5 - v;
    const portrait = layout.bucket === 'portrait';

    if (portrait) {
      const coverHeight = MODES[2].spread * 2.45;
      const coverWidth = coverHeight * sampleAspect;
      const fineJitter = (seed - 0.5) * high * 0.028;
      return {
        x: centeredX * coverWidth + Math.sin(time * 0.0008 + y * 0.045) * mid * 0.018 + fineJitter,
        y: centeredY * coverHeight + Math.cos(time * 0.0009 + x * 0.04) * mid * 0.014,
        z: -1.58 + edge * 0.12 + contour * 0.035 + bass * 0.045,
      };
    }

    const topBias = smoothstep(0.12, 0.86, 1 - v) * 0.1;
    const mapShear = Math.sin((v - 0.5) * Math.PI * 2) * layout.linePlaneWidth * 0.018;
    const cameraAspectComp = clamp(sampleAspect / Math.max(0.7, layout.linePlaneWidth / layout.linePlaneHeight), 0.52, 0.86);
    const horizontalInset = (1 - cameraAspectComp) * Math.sin(v * Math.PI) * 0.5;
    const reflowedX = (centeredX * (1 - horizontalInset) + mapShear / layout.linePlaneWidth) * layout.linePlaneWidth;
    const reflowedY = centeredY * layout.linePlaneHeight + layout.lineYOffset + topBias;
    const fineJitter = (seed - 0.5) * high * 0.038;

    return {
      x: reflowedX + Math.sin(time * 0.001 + y * 0.055) * mid * 0.032 + fineJitter,
      y: reflowedY + Math.cos(time * 0.0011 + x * 0.045) * mid * 0.024,
      z: -1.64 + edge * 0.18 + contour * 0.045 + bass * 0.075,
    };
  }

  getEdgePlanPoint(x, y, edge, light, seed, time) {
    const layout = this.layout || this.getLayoutMetrics();
    const sampleAspect = this.sampleWidth / Math.max(1, this.sampleHeight);
    const u = this.sampleWidth > 1 ? x / (this.sampleWidth - 1) : 0.5;
    const v = this.sampleHeight > 1 ? y / (this.sampleHeight - 1) : 0.5;
    const centeredX = u - 0.5;
    const centeredY = 0.5 - v;
    const paperWidth = layout.bucket === 'portrait'
      ? MODES[3].spread * sampleAspect * 1.18
      : layout.linePlaneWidth * 0.94;
    const paperHeight = layout.bucket === 'portrait'
      ? MODES[3].spread * 1.48
      : layout.linePlaneHeight * 0.92;
    const paperWarp = Math.sin(v * Math.PI) * Math.sin(u * Math.PI * 2) * 0.018;
    return {
      x: centeredX * paperWidth + paperWarp + (seed - 0.5) * 0.003,
      y: centeredY * paperHeight + (layout.bucket === 'portrait' ? 0 : layout.lineYOffset * 0.42),
      z: -1.72 + edge * 0.045 + (1 - light) * 0.018 + Math.sin(time * 0.00045 + seed * 6.283) * 0.002,
    };
  }

  resizeCymaticCanvas(width = window.innerWidth, height = window.innerHeight) {
    const nextWidth = Math.max(1, Math.floor(width));
    const nextHeight = Math.max(1, Math.floor(height));
    if (this.cymaticCanvas.width === nextWidth && this.cymaticCanvas.height === nextHeight) return;
    this.cymaticCanvas.width = nextWidth;
    this.cymaticCanvas.height = nextHeight;
    this.cymaticCanvasWidth = nextWidth;
    this.cymaticCanvasHeight = nextHeight;
    this.rebuildCymaticCanvasParticles();
  }

  rebuildCymaticCanvasParticles() {
    const total = this.sampleWidth * this.sampleHeight;
    const width = this.cymaticCanvas.width || window.innerWidth || 1;
    const height = this.cymaticCanvas.height || window.innerHeight || 1;
    this.cymaticParticleTotal = total;
    this.cymaticBaseX = new Float32Array(total);
    this.cymaticBaseY = new Float32Array(total);
    this.cymaticParticleX = new Float32Array(total);
    this.cymaticParticleY = new Float32Array(total);
    this.cymaticVelocityX = new Float32Array(total);
    this.cymaticVelocityY = new Float32Array(total);
    this.cymaticBrightness = new Float32Array(total);

    const cellW = width / this.sampleWidth;
    const cellH = height / this.sampleHeight;
    for (let y = 0; y < this.sampleHeight; y += 1) {
      for (let x = 0; x < this.sampleWidth; x += 1) {
        const index = y * this.sampleWidth + x;
        const baseX = x * cellW + cellW / 2;
        const baseY = y * cellH + cellH / 2;
        this.cymaticBaseX[index] = baseX;
        this.cymaticBaseY[index] = baseY;
        this.cymaticParticleX[index] = baseX;
        this.cymaticParticleY[index] = baseY;
      }
    }
  }

  renderCymaticCanvas(frame, audio, cymaticState, time, dt) {
    const ctx = this.cymaticContext;
    if (!ctx) return;
    this.resizeCymaticCanvas();
    const total = this.sampleWidth * this.sampleHeight;
    if (!this.cymaticBaseX || this.cymaticParticleTotal !== total) {
      this.rebuildCymaticCanvasParticles();
    }

    const width = this.cymaticCanvas.width;
    const height = this.cymaticCanvas.height;
    const rms = getCymaticRms(audio);
    const volume = audio.smoothedVolume || audio.overallVolume || rms;
    const peakLevel = audio.peakLevel || 0;
    const peakHz = audio.peakHz || 0;
    const centroid = audio.spectralCentroid || 0;
    const centroidHz = audio.spectralCentroidHz || (audio.spectralCentroid || 0) * 12000;
    const flux = audio.spectralFlux || 0;
    const bands = {
      bass: audio.bassEnergy || 0,
      mid: audio.midEnergy || 0,
      high: audio.highEnergy || 0,
    };
    const realColorMode = this.isRealColorPalette;
    const iosCymatic = audio.audioProfile === 'iosWebKit';
    const iosCymaticFrequencyActive = !iosCymatic || peakHz >= IOS_CYMATIC_MIN_REACTIVE_HZ;
    const iosCymaticQuiet = iosCymatic && (!iosCymaticFrequencyActive || (rms < 0.008 && audio.peakLevel < 0.075 && flux < 0.045));
    const modeEnergy = this.cymaticDebug?.modeEnergy || 0;
    const step = clamp(dt / 16.7, 0.45, 2.4);
    const rawResonance = clamp01(
      iosCymaticFrequencyActive
        ? (cymaticState?.strength || 0) * 0.72 +
          smoothstep(iosCymatic ? 0.0055 : 0.012, iosCymatic ? 0.032 : 0.058, rms) * 0.38 +
          smoothstep(iosCymatic ? 0.045 : 0.09, iosCymatic ? 0.34 : 0.58, peakLevel) * 0.24 +
          smoothstep(iosCymatic ? 0.026 : 0.05, iosCymatic ? 0.27 : 0.44, flux) * 0.18
        : 0,
    );
    const envelopeAmount = rawResonance > this.cymaticResonanceEnvelope ? 0.18 : 0.035;
    this.cymaticResonanceEnvelope = lerp(this.cymaticResonanceEnvelope, rawResonance, envelopeAmount * step);
    this.cymaticShock = Math.max(this.cymaticShock * Math.pow(0.88, step), smoothstep(0.45, 0.95, flux) * this.cymaticResonanceEnvelope);

    const nextPattern = selectCymaticPattern({ peakHz, centroid, bands });
    if (nextPattern !== this.cymaticPattern) {
      if (nextPattern !== this.pendingCymaticPattern) {
        this.pendingCymaticPattern = nextPattern;
        this.pendingCymaticPatternSince = time;
      } else if (time - this.pendingCymaticPatternSince >= CYMATIC_PATTERN_HOLD_MS) {
        this.previousCymaticPattern = this.cymaticPattern;
        this.cymaticPattern = nextPattern;
        this.cymaticPatternTransitionStart = time;
        this.cymaticPatternTransition = 0;
      }
    } else {
      this.pendingCymaticPattern = nextPattern;
      this.pendingCymaticPatternSince = time;
    }
    this.cymaticPatternTransition = clamp01((time - this.cymaticPatternTransitionStart) / CYMATIC_PATTERN_FADE_MS);

    const phaseSpeed = iosCymaticQuiet
      ? 0.008
      : 0.018 + bands.bass * 0.025 + bands.mid * 0.045 + bands.high * 0.07 + flux * 0.08 + centroid * 0.04;
    this.cymaticPhase = (this.cymaticPhase || 0) + phaseSpeed * step;

    ctx.fillStyle = `rgba(0, 5, 10, ${0.38 - this.cymaticResonanceEnvelope * 0.1})`;
    ctx.fillRect(0, 0, width, height);

    const resonanceGate = iosCymatic
      ? smoothstep(0.09, 0.42, this.cymaticResonanceEnvelope)
      : smoothstep(0.14, 0.5, this.cymaticResonanceEnvelope);
    const iosCymaticIdle = iosCymatic && (!iosCymaticFrequencyActive || (rms < 0.012 && peakLevel < 0.11 && flux < 0.07));
    const motionGate = iosCymatic
      ? resonanceGate * smoothstep(0.12, 0.24, resonanceGate)
      : resonanceGate;
    const patternGate = iosCymatic && (iosCymaticQuiet || iosCymaticIdle) ? 0 : motionGate;
    const visibilityGate = iosCymatic ? Math.max(patternGate, 0.14) : resonanceGate;
    const displacementStrength = iosCymaticQuiet
      ? 0
      : (iosCymatic ? motionGate : resonanceGate) * (iosCymatic ? 0.34 + volume * 1.45 + peakLevel * 0.28 : 0.26 + volume * 1.15 + peakLevel * 0.22) + this.cymaticShock * 0.18;
    const maxDisplacement = Math.min(width, height) * 0.085;
    const returnForce = iosCymatic
      ? 0.2 + (1 - motionGate) * 0.24
      : 0.12 + (1 - resonanceGate) * 0.16;
    const damping = iosCymatic
      ? Math.pow(0.58 - motionGate * 0.04, step)
      : Math.pow(0.74 - resonanceGate * 0.08, step);
    let visible = 0;
    let brightnessTotal = 0;
    for (let index = 0; index < total; index += 1) {
      const pixelIndex = index * 4;
      const red = frame[pixelIndex] / 255;
      const green = frame[pixelIndex + 1] / 255;
      const blue = frame[pixelIndex + 2] / 255;
      const brightness = red * 0.299 + green * 0.587 + blue * 0.114;
      const smoothedBrightness = this.cymaticBrightness[index] + (brightness - this.cymaticBrightness[index]) * 0.3;
      this.cymaticBrightness[index] = smoothedBrightness;
      brightnessTotal += smoothedBrightness;

      let particleX = this.cymaticParticleX[index];
      let particleY = this.cymaticParticleY[index];
      let velocityX = this.cymaticVelocityX[index];
      let velocityY = this.cymaticVelocityY[index];
      const baseX = this.cymaticBaseX[index];
      const baseY = this.cymaticBaseY[index];
      const u = width > 1 ? baseX / width : 0.5;
      const v = height > 1 ? baseY / height : 0.5;
      const previousField = cymaticPatternField(this.previousCymaticPattern, u, v, {
        phase: this.cymaticPhase,
        peakHz,
        centroid,
        bands,
      });
      const currentField = cymaticPatternField(this.cymaticPattern, u, v, {
        phase: this.cymaticPhase,
        peakHz,
        centroid,
        bands,
      });
      const fade = smoothstep(0, 1, this.cymaticPatternTransition);
      const fieldX = lerp(previousField.dx, currentField.dx, fade);
      const fieldY = lerp(previousField.dy, currentField.dy, fade);
      const fieldValue = lerp(previousField.value, currentField.value, fade);
      const imageWeight = iosCymaticFrequencyActive ? 0.38 + smoothedBrightness * 0.8 : 0;
      const flickerGate = iosCymatic ? patternGate : this.cymaticResonanceEnvelope;
      const flicker = (hash01(index * 31.73 + Math.floor(time * 0.034)) - 0.5) * bands.high * flickerGate * 2.6;
      const targetX = baseX + clamp(fieldX * maxDisplacement * displacementStrength * imageWeight + flicker, -maxDisplacement, maxDisplacement);
      const targetY = baseY + clamp(fieldY * maxDisplacement * displacementStrength * imageWeight + flicker * 0.5, -maxDisplacement, maxDisplacement);
      let forceX = (targetX - particleX) * returnForce;
      let forceY = (targetY - particleY) * returnForce;
      if (this.cymaticShock > 0.01) {
        const cx = u - 0.5;
        const cy = v - 0.5;
        const distance = Math.max(0.08, Math.sqrt(cx * cx + cy * cy));
        const shockWave = Math.sin(distance * 28 - this.cymaticPhase * 7) * this.cymaticShock * 2.4;
        forceX += (cx / distance) * shockWave;
        forceY += (cy / distance) * shockWave;
      }

      velocityX = (velocityX + forceX * step) * damping;
      velocityY = (velocityY + forceY * step) * damping;
      particleX += velocityX * step;
      particleY += velocityY * step;
      particleX = clamp(particleX, 0, width);
      particleY = clamp(particleY, 0, height);
      this.cymaticParticleX[index] = particleX;
      this.cymaticParticleY[index] = particleY;
      this.cymaticVelocityX[index] = velocityX;
      this.cymaticVelocityY[index] = velocityY;

      const b = smoothedBrightness;
      const displayBrightness = iosCymatic ? clamp01(b * 1.08 + 0.075) : b;
      const crest = smoothstep(0.18, 0.92, Math.abs(fieldValue));
      const imageInk = iosCymatic
        ? clamp01(0.24 + displayBrightness * 0.96 + crest * patternGate * 0.16)
        : clamp01(0.12 + b * 0.82 + crest * resonanceGate * 0.24);
      const density = iosCymatic
        ? clamp01(0.64 + imageInk * 0.36 + patternGate * crest * 0.12)
        : clamp01(0.34 + imageInk * 0.58 + resonanceGate * crest * 0.22);
      if (b < 0.05 && rms < 0.1) continue;
      if (iosCymatic && patternGate < 0.08 && displayBrightness < 0.16) continue;
      if (iosCymatic && !iosCymaticFrequencyActive && displayBrightness < 0.24) continue;
      if ((iosCymatic ? patternGate : resonanceGate) > 0.12 && hash01(index * 97.13) > density) continue;
      visible += 1;

      let baseSize = displayBrightness > 0.5 ? 2 : (iosCymatic ? 1.42 : 1.2);
      if (centroidHz > 2000) baseSize *= 0.8;
      else if (centroidHz < 500) baseSize *= 1.2;
      if (this.cymaticPattern === CYMATIC_PATTERN_TYPES.HIGH) baseSize *= lerp(1, 0.82 + bands.high * 0.24, patternGate);
      if (this.cymaticPattern === CYMATIC_PATTERN_TYPES.LOW) baseSize *= lerp(1, 1.08 + bands.bass * 0.28, patternGate);
      const size = clamp(baseSize + visibilityGate * 0.28 + patternGate * crest * 1.35 + this.cymaticShock * 1.4, 0.9, 4.2);
      const color = realColorMode
        ? {
            r: Math.floor(red * 255),
            g: Math.floor(green * 255),
            b: Math.floor(blue * 255),
          }
        : scan2ParticleColor(displayBrightness, bands, modeEnergy, this.cymaticPattern, iosCymatic ? patternGate : resonanceGate, fieldValue);
      const alpha = iosCymatic
        ? clamp(0.5 + displayBrightness * 0.56 + visibilityGate * 0.1 + crest * patternGate * 0.2, 0.38, 0.96)
        : clamp(0.28 + b * 0.58 + resonanceGate * 0.2 + crest * resonanceGate * 0.26, 0.18, 0.96);
      ctx.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
      ctx.fillRect(particleX, particleY, size, size);
    }

    this.visiblePointCount = visible;
    this.averageBrightness = brightnessTotal / Math.max(1, total);
  }

  updateCymaticResonance(audio, dt) {
    const peakHz = audio.peakHz || 0;
    const nearestMode = selectNearestCymaticMode(peakHz);
    const freqError = peakHz > 0 ? Math.abs(peakHz - nearestMode.freq) : Infinity;
    const relativeError = freqError / nearestMode.freq;
    const frequencyWindow = 0.25;
    const frequencyMatch = peakHz > 0 && relativeError < frequencyWindow
      ? 1 - relativeError / frequencyWindow
      : 0;
    const rms = getCymaticRms(audio);
    const { mode: excitedMode, energy: modeEnergy } = selectExcitedCymaticMode(
      audio.frequencyData,
      audio.sampleRate,
      CYMATIC_MODE_TABLE,
    );
    const iosAudio = audio.audioProfile === 'iosWebKit';
    const iosFrequencyActive = !iosAudio || peakHz >= IOS_CYMATIC_MIN_REACTIVE_HZ;
    const rmsGate = iosAudio ? smoothstep(0.0058, 0.027, rms) : smoothstep(0.01, 0.05, rms);
    const energyGate = iosAudio ? smoothstep(0.0028, 0.016, modeEnergy) : smoothstep(0.006, 0.035, modeEnergy);
    let targetResonance = iosFrequencyActive ? rmsGate * energyGate : 0;

    if (DEBUG_FORCE_RESONANCE) {
      this.selectedCymaticMode = CYMATIC_MODE_TABLE.find((mode) => mode.freq === 131) || CYMATIC_MODE_TABLE[2];
      this.resonanceStrength = 1;
      this.resonanceHoldMs = CYMATIC_RESONANCE_HOLD_MS;
    } else {
      this.selectedCymaticMode = excitedMode;
      this.resonanceHoldMs = targetResonance > 0.05
        ? Math.min(CYMATIC_RESONANCE_HOLD_MS, this.resonanceHoldMs + dt)
        : Math.max(0, this.resonanceHoldMs - dt * 1.4);
      const amount = targetResonance > this.resonanceStrength ? 0.12 : 0.035;
      this.resonanceStrength = lerp(this.resonanceStrength, targetResonance, amount);
    }

    this.cymaticDebug = {
      selectedFreq: this.selectedCymaticMode.freq,
      selectedN: this.selectedCymaticMode.n,
      selectedM: this.selectedCymaticMode.m,
      nearestFreq: nearestMode.freq,
      freqError,
      relativeError,
      excitedFreq: excitedMode.freq,
      modeEnergy: DEBUG_FORCE_RESONANCE ? 1 : modeEnergy,
      rmsGate: DEBUG_FORCE_RESONANCE ? 1 : rmsGate,
      energyGate: DEBUG_FORCE_RESONANCE ? 1 : energyGate,
      frequencyMatch,
      loudEnough: rmsGate,
      resonanceStrength: this.resonanceStrength,
      holdMs: this.resonanceHoldMs,
      forced: DEBUG_FORCE_RESONANCE,
    };

    return {
      mode: this.selectedCymaticMode,
      strength: this.resonanceStrength,
      frequencyMatch,
      loudEnough: rmsGate,
    };
  }

  getCymaticPoint(index, x, y, light, edge, motion, seed, time, dt, cymaticState, audio) {
    const layout = this.layout || this.getLayoutMetrics();
    const sampleAspect = this.sampleWidth / Math.max(1, this.sampleHeight);
    const u = this.sampleWidth > 1 ? x / (this.sampleWidth - 1) : 0.5;
    const v = this.sampleHeight > 1 ? y / (this.sampleHeight - 1) : 0.5;
    const resonance = cymaticState?.strength || 0;
    const mode = cymaticState?.mode || this.selectedCymaticMode;
    const volume = audio.smoothedVolume || audio.overallVolume || 0;
    const bass = audio.bassEnergy || 0;
    const high = audio.highEnergy || 0;
    const centroid = audio.spectralCentroid || 0;
    const flux = audio.spectralFlux || 0;
    const portrait = layout.bucket === 'portrait';
    const plateWidth = portrait ? MODES[3].spread * sampleAspect * 1.2 : layout.linePlaneWidth * 0.9;
    const plateHeight = portrait ? MODES[3].spread * 1.42 : layout.linePlaneHeight * 0.88;
    const t = time * 0.001;
    const step = clamp(dt / 16.7, 0.45, 2.4);
    const darkInk = smoothstep(0.1, 0.9, 1 - light);
    const edgeInk = smoothstep(0.025, 0.24, edge);
    const imageInk = clamp01(0.04 + darkInk * 0.74 + edgeInk * 0.5 + motion * 0.16);
    const density = clamp01(0.16 + imageInk * 0.86 + edgeInk * 0.18);
    const grain = hash01(seed * 977.1);
    const visibleGrain = grain < density;
    const driftA = Math.sin(t * 0.53 + seed * 19.1 + y * 0.09);
    const driftB = Math.cos(t * 0.47 + seed * 13.7 + x * 0.07);
    const diffuse = 1 - resonance;
    const jitterScale = (0.003 + (1 - imageInk) * 0.006 + flux * 0.006 + high * 0.003) * (0.62 + diffuse * 0.64);
    const baseU = clamp01(u + (driftA * 0.55 + grain - 0.5) * jitterScale);
    const baseV = clamp01(v + (driftB * 0.55 + hash01(seed * 317.6) - 0.5) * jitterScale);

    let particleU = this.cymaticParticleX?.[index] ?? u;
    let particleV = this.cymaticParticleY?.[index] ?? v;
    let velocityU = this.cymaticVelocityX?.[index] ?? 0;
    let velocityV = this.cymaticVelocityY?.[index] ?? 0;
    const phase = this.cymaticPhase || 0;
    const currentPattern = chladniPattern(mode, particleU, particleV, phase);
    const gradient = chladniGradient(mode, particleU, particleV, phase);
    const resPow = Math.pow(resonance, 1.5);
    const brightnessWeight = imageInk > 0.2 ? 1 : 0.42;
    const returnForce = 0.075 + diffuse * 0.035;
    const shake = (volume * 0.0024 + flux * 0.0028 + high * 0.0014) * step;
    const noiseA = hash01(seed * 31.7 + Math.floor(time * 0.05));
    const noiseB = hash01(seed * 59.3 + Math.floor(time * 0.043));
    let forceU = (baseU - particleU) * returnForce;
    let forceV = (baseV - particleV) * returnForce;
    forceU += (noiseA - 0.5) * shake;
    forceV += (noiseB - 0.5) * shake;
    if (resPow > 0.01) {
      const pullStrength = 0.00165 * resPow * brightnessWeight * (0.55 + imageInk * 0.72);
      forceU += -currentPattern * gradient.cx * pullStrength;
      forceV += -currentPattern * gradient.cy * pullStrength;
    }
    velocityU = (velocityU + forceU * step) * Math.pow(0.78, step);
    velocityV = (velocityV + forceV * step) * Math.pow(0.78, step);
    particleU = clamp01(particleU + velocityU * step);
    particleV = clamp01(particleV + velocityV * step);
    if (this.cymaticParticleX) {
      this.cymaticParticleX[index] = particleU;
      this.cymaticParticleY[index] = particleV;
      this.cymaticVelocityX[index] = velocityU;
      this.cymaticVelocityY[index] = velocityV;
    }

    const absPattern = Math.abs(chladniPattern(mode, particleU, particleV, phase));
    const nodeBias = 1 - smoothstep(0.025, 0.22, absPattern);

    const nodeInk = 1 - smoothstep(0.02, 0.19, absPattern);
    const baseInk = visibleGrain ? imageInk : imageInk * 0.08;
    const resonantInk = baseInk * (0.48 + nodeInk * 0.95) + nodeInk * resonance * 0.38;
    const ink = clamp01(lerp(baseInk, resonantInk, resonance) * (0.94 + volume * 0.42));
    const plateX = (particleU - 0.5) * plateWidth;
    const plateY = (0.5 - particleV) * plateHeight + (portrait ? 0 : layout.lineYOffset * 0.28);
    const lift = resonance * nodeInk * 0.08 + volume * 0.018 + (grain - 0.5) * 0.008 * diffuse;
    const heat = clamp01(imageInk * 0.68 + edgeInk * 0.2 + motion * 0.16 + resonance * nodeInk * 0.36 + high * 0.1);
    const color = thermalColor(heat, bass, high, centroid);

    return {
      x: plateX,
      y: plateY,
      z: -1.72 + lift,
      ink,
      resonance: clamp01(resonance * (nodeInk * 0.75 + nodeBias * 0.25) + edgeInk * 0.18),
      color,
    };
  }

  rebuildGeometry() {
    const total = this.sampleWidth * this.sampleHeight;
    const positions = new Float32Array(total * 3);
    const colors = new Float32Array(total * 3);
    const brightness = new Float32Array(total);
    const edges = new Float32Array(total);
    const seeds = new Float32Array(total);
    const trailPositions = new Float32Array(total * TRAIL_COUNT * 3);
    const trailColors = new Float32Array(total * TRAIL_COUNT * 3);
    const trailAges = new Float32Array(total * TRAIL_COUNT);
    const lineVertexCount = total * LINE_SEGMENTS_PER_SAMPLE * 2;
    const linePositions = new Float32Array(lineVertexCount * 3);
    const lineColors = new Float32Array(lineVertexCount * 3);

    const mode = MODES[this.modeIndex];
    const aspect = this.sampleWidth / this.sampleHeight;
    const layout = this.getLayoutMetrics();
    for (let index = 0; index < total; index += 1) {
      const x = index % this.sampleWidth;
      const y = Math.floor(index / this.sampleWidth);
      const baseOffset = index * 3;
      const nx = (x / (this.sampleWidth - 1) - 0.5) * mode.spread * aspect * layout.xBoost;
      const ny = (0.5 - y / (this.sampleHeight - 1)) * mode.spread * layout.yBoost;
      positions[baseOffset] = nx;
      positions[baseOffset + 1] = ny;
      positions[baseOffset + 2] = -1.2;
      colors[baseOffset] = 0;
      colors[baseOffset + 1] = 0;
      colors[baseOffset + 2] = 0;
      seeds[index] = hash01(index * 12.9898 + this.sampleWidth * 78.233);
    }

    for (let layer = 0; layer < TRAIL_COUNT; layer += 1) {
      const age = (layer + 1) / TRAIL_COUNT;
      for (let index = 0; index < total; index += 1) {
        const pointOffset = index * 3;
        const trailIndex = layer * total + index;
        const trailOffset = trailIndex * 3;
        trailPositions[trailOffset] = positions[pointOffset];
        trailPositions[trailOffset + 1] = positions[pointOffset + 1];
        trailPositions[trailOffset + 2] = -12;
        trailColors[trailOffset] = 0;
        trailColors[trailOffset + 1] = 0;
        trailColors[trailOffset + 2] = 0;
        trailAges[trailIndex] = age;
      }
    }

    this.lightHistory = new Float32Array(total);
    this.motionHistory = new Float32Array(total);
    this.cymaticParticleX = new Float32Array(total);
    this.cymaticParticleY = new Float32Array(total);
    this.cymaticVelocityX = new Float32Array(total);
    this.cymaticVelocityY = new Float32Array(total);
    for (let index = 0; index < total; index += 1) {
      const x = index % this.sampleWidth;
      const y = Math.floor(index / this.sampleWidth);
      this.cymaticParticleX[index] = this.sampleWidth > 1 ? x / (this.sampleWidth - 1) : 0.5;
      this.cymaticParticleY[index] = this.sampleHeight > 1 ? y / (this.sampleHeight - 1) : 0.5;
    }
    this.currentPositions = positions;
    this.currentColors = colors;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('baseBrightness', new THREE.BufferAttribute(brightness, 1));
    geometry.setAttribute('edgeStrength', new THREE.BufferAttribute(edges, 1));
    geometry.setAttribute('randomSeed', new THREE.BufferAttribute(seeds, 1));

    const trailGeometry = new THREE.BufferGeometry();
    trailGeometry.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
    trailGeometry.setAttribute('color', new THREE.BufferAttribute(trailColors, 3));
    trailGeometry.setAttribute('age', new THREE.BufferAttribute(trailAges, 1));

    const supportGeometry = new THREE.BufferGeometry();
    supportGeometry.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
    supportGeometry.setAttribute('color', new THREE.BufferAttribute(lineColors, 3));
    supportGeometry.setDrawRange(0, 0);

    if (this.points) {
      this.group.remove(this.points);
      this.points.geometry.dispose();
    }
    if (this.trails) {
      this.group.remove(this.trails);
      this.trails.geometry.dispose();
    }
    if (this.lineSupport) {
      this.group.remove(this.lineSupport);
      this.lineSupport.geometry.dispose();
    }

    this.points = new THREE.Points(geometry, this.material);
    this.trails = new THREE.Points(trailGeometry, this.trailMaterial);
    this.lineSupport = new THREE.LineSegments(supportGeometry, this.lineSupportMaterial);
    this.points.visible = this.modeIndex !== 2;
    this.trails.visible = this.modeIndex === 1;
    this.lineSupport.visible = this.modeIndex === 2;
    this.group.add(this.lineSupport);
    this.group.add(this.trails);
    this.group.add(this.points);
  }

  rebuildSpectrumLayer() {
    const total = SPECTRUM_BANDS * SPECTRUM_HISTORY;
    const horizontalSegments = SPECTRUM_HISTORY * (SPECTRUM_BANDS - 1);
    const depthBands = Math.floor((SPECTRUM_BANDS - 2) / SPECTRUM_LINE_STRIDE) + 1;
    const depthSegments = depthBands * (SPECTRUM_HISTORY - 1);
    const lineVertices = (horizontalSegments + depthSegments) * 2;
    const positions = new Float32Array(total * 3);
    const colors = new Float32Array(total * 3);
    const sizes = new Float32Array(total);
    const linePositions = new Float32Array(lineVertices * 3);
    const lineColors = new Float32Array(lineVertices * 3);

    for (let history = 0; history < SPECTRUM_HISTORY; history += 1) {
      for (let band = 0; band < SPECTRUM_BANDS; band += 1) {
        const index = history * SPECTRUM_BANDS + band;
        const offset = index * 3;
        positions[offset] = (band / (SPECTRUM_BANDS - 1) - 0.5) * 3.25;
        positions[offset + 1] = -1.55;
        positions[offset + 2] = -1.65 - history * 0.038;
        colors[offset] = 0.08;
        colors[offset + 1] = 0.18;
        colors[offset + 2] = 0.22;
        sizes[index] = 1;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    const lineGeometry = new THREE.BufferGeometry();
    lineGeometry.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
    lineGeometry.setAttribute('color', new THREE.BufferAttribute(lineColors, 3));

    if (this.spectrumPoints) {
      this.group.remove(this.spectrumPoints);
      this.spectrumPoints.geometry.dispose();
    }
    if (this.spectrumLines) {
      this.group.remove(this.spectrumLines);
      this.spectrumLines.geometry.dispose();
    }
    this.spectrumPoints = new THREE.Points(geometry, this.spectrumMaterial);
    this.spectrumLines = new THREE.LineSegments(lineGeometry, this.spectrumLineMaterial);
    this.spectrumPoints.visible = this.modeIndex === 1;
    this.spectrumLines.visible = this.modeIndex === 1;
    this.group.add(this.spectrumLines);
    this.group.add(this.spectrumPoints);
  }

  renderFrame(frame, audio, time) {
    if (!this.running || !frame || !this.points) return;
    this.hasCameraFrame = true;

    const mode = MODES[this.modeIndex];
    const dt = this.lastRenderTime ? time - this.lastRenderTime : 16.7;
    this.lastRenderTime = time;
    this.frameBudgetMs = lerp(this.frameBudgetMs, dt, 0.04);
    this.scanPhase = (this.scanPhase + dt * (0.035 + audio.highEnergy * 0.08)) % this.sampleHeight;

    const positions = this.points.geometry.attributes.position.array;
    const colors = this.points.geometry.attributes.color.array;
    const brightness = this.points.geometry.attributes.baseBrightness.array;
    const edges = this.points.geometry.attributes.edgeStrength.array;
    const supportPositions = this.lineSupport.geometry.attributes.position.array;
    const supportColors = this.lineSupport.geometry.attributes.color.array;
    const seeds = this.points.geometry.attributes.randomSeed.array;
    const total = this.sampleWidth * this.sampleHeight;
    const aspect = this.sampleWidth / this.sampleHeight;
    const layout = this.layout || this.getLayoutMetrics();
    const noAudioBreath = this.audioAvailable ? 0 : 0.08 + Math.sin(time * 0.0012) * 0.04;
    const bass = Math.max(audio.bassEnergy, noAudioBreath);
    const mid = Math.max(audio.midEnergy, noAudioBreath * 0.65);
    const high = Math.max(audio.highEnergy, noAudioBreath * 0.45);
    const volume = Math.max(audio.smoothedVolume, noAudioBreath);
    const centroid = audio.spectralCentroid || 0;
    const flux = audio.spectralFlux || 0;
    const realColorMode = this.isRealColorPalette;
    this.updateSpectrumLayer(audio, time, bass, mid, high, centroid, flux);
    const cymaticMode = this.modeIndex === 3;
    let cymaticState = null;
    if (cymaticMode) {
      try {
        cymaticState = this.updateCymaticResonance(audio, dt);
        this.cymaticPhase = (this.cymaticPhase || 0) + (centroid > 0.24 ? 0.05 : 0.02) * (1 + flux * 2.6) * clamp(dt / 16.7, 0.45, 2.4);
      } catch (error) {
        console.error('Cymatic Plate render error:', error);
        this.resonanceStrength = lerp(this.resonanceStrength || 0, 0, 0.08);
        cymaticState = {
          mode: this.selectedCymaticMode || CYMATIC_MODE_TABLE[0],
          strength: this.resonanceStrength,
          frequencyMatch: 0,
          loudEnough: 0,
        };
      }
    }
    if (cymaticMode) {
      this.renderCymaticCanvas(frame, audio, cymaticState, time, dt);
      this.updateShockwaves(time);
      return;
    }
    const bassPush = bass * (this.modeIndex === 1 ? 1.05 : 2.55) * this.intensity;
    const terrainWave = mid * (this.modeIndex === 1 ? 0.12 : 0.42) * this.intensity;
    const scanBandWidth = this.modeIndex === 1 ? 2.4 + flux * 2.8 + high * 1.2 : 3.2 + high * 6.0;
    const planMode = cymaticMode;
    const cameraTilt = this.modeIndex === 2 ? 0.02 : planMode ? 0 : -0.04;
    let visiblePointCount = 0;
    let brightnessTotal = 0;
    let lineOffset = 0;

    for (let index = 0; index < total; index += 1) {
      const x = index % this.sampleWidth;
      const y = Math.floor(index / this.sampleWidth);
      const pixelIndex = index * 4;
      const red = frame[pixelIndex] / 255;
      const green = frame[pixelIndex + 1] / 255;
      const blue = frame[pixelIndex + 2] / 255;
      const light = red * 0.2126 + green * 0.7152 + blue * 0.0722;
      brightnessTotal += light;
      const saturated = Math.max(red, green, blue) - Math.min(red, green, blue);
      const rawEdge = this.modeIndex >= 2
        ? sobelAt(frame, x, y, this.sampleWidth, this.sampleHeight)
        : simpleEdgeAt(frame, x, y, this.sampleWidth, this.sampleHeight, pixelIndex, light);
      const edge = this.modeIndex === 0 ? Math.min(rawEdge, 0.42) * 0.82 : rawEdge;
      const motion = Math.abs(light - this.lightHistory[index]);
      this.lightHistory[index] = lerp(this.lightHistory[index], light, 0.45);
      this.motionHistory[index] = lerp(this.motionHistory[index], motion, this.modeIndex === 0 ? 0.38 : 0.25);
      const motionSignal = this.modeIndex === 0 ? Math.min(this.motionHistory[index], 0.18) : this.motionHistory[index];

      const signal = light + saturated * 0.32 + edge * 0.28 + motionSignal * (this.modeIndex === 0 ? 0.32 : 0.5);
      const contour = contourAt(light + bass * 0.025 + audio.peakLevel * 0.02, 8.0 + audio.peakLevel * 8.0);
      const lineVector = this.modeIndex === 2 ? sobelVectorAt(frame, x, y, this.sampleWidth, this.sampleHeight) : null;
      const lineEdge = this.modeIndex === 2 ? clamp01(lineVector.mag * 1.15) : edge;
      const edgeInk = smoothstep(0.07, 0.3, lineEdge);
      const motionInk = smoothstep(0.012, 0.1, motionSignal);
      const contourInk = contour * smoothstep(0.04, 0.18, lineEdge + saturated * 0.14 + motionSignal * 0.3);
      const planGrid = this.modeIndex === 2 && layout.bucket !== 'portrait' && (x % 16 === 0 || y % 16 === 0)
        ? 0.045 * (0.55 + hash01(x * 41.1 + y * 13.7) * 0.45)
        : 0;
      const darkTrace = smoothstep(0.58, 0.12, light) * smoothstep(0.08, 0.28, saturated + lineEdge);
      const lineSignal = clamp01(edgeInk * 1.34 + contourInk * 0.08 + motionInk * 0.035 + darkTrace * 0.045 + planGrid + high * 0.006);
      const visible = this.modeIndex === 2
        ? lineSignal
        : planMode
          ? 1
        : clamp((this.modeIndex === 0 ? 0.22 : 0.16) + smoothstep(mode.darkGate, 0.72, signal) * (this.modeIndex === 0 ? 0.78 : 0.84), this.modeIndex === 0 ? 0.22 : 0.16, 1);
      const mapX = (x / (this.sampleWidth - 1) - 0.5);
      const mapY = (0.5 - y / (this.sampleHeight - 1));
      const nx = mapX * mode.spread * aspect * layout.xBoost;
      const ny = mapY * mode.spread * layout.yBoost;
      const scanDistance = Math.abs(y - this.scanPhase);
      const scan = smoothstep(scanBandWidth, 0, Math.min(scanDistance, this.sampleHeight - scanDistance));
      const seed = seeds[index];
      const fizz = (seed - 0.5) * high * 0.28 * this.intensity;
      const radial = Math.sqrt(nx * nx + ny * ny);
      const frequencyRing = this.modeIndex === 1
        ? smoothstep(0.045, 0.0, Math.abs((radial * (1.45 + centroid * 1.4) - time * (0.00036 + flux * 0.0007)) % 1 - 0.5))
        : 0;
      const terrain = this.modeIndex === 1
        ? (Math.sin(x * 0.18 + time * (0.0032 + flux * 0.006)) + Math.cos(y * 0.11 + time * 0.0022)) * terrainWave * 0.72
        : 0;
      const ghostPush = this.modeIndex === 1 ? audio.peakLevel * 0.16 + flux * 0.11 + frequencyRing * 0.06 : 0;
      const videoDepth = light * mode.depth + saturated * 1.15 + edge * mode.edgeDepth;
      const frequencyDepth = (
        light * mode.depth * 0.66 +
        saturated * 0.62 +
        edge * mode.edgeDepth * 0.72 +
        motionSignal * 0.72 +
        scan * high * 0.18 +
        frequencyRing * (flux + audio.peakLevel) * 0.12 +
        bassPush * 0.36 +
        terrain +
        ghostPush
      ) * visible;
      const depth = this.modeIndex === 1
        ? clamp(frequencyDepth, 0, 1.95 + light * 0.9 + edge * 0.5)
        : (
          videoDepth +
          motion * 2.4 +
          scan * high * 1.4 +
          frequencyRing * (flux + audio.peakLevel) * 1.25 +
          bassPush +
          terrain +
          ghostPush
        ) * visible;
      const pointDepth = this.modeIndex === 0
        ? (
          light * mode.depth +
          saturated * 1.0 +
          edge * 0.72 +
          motionSignal * 1.15 +
          scan * high * 1.05 +
          bassPush * 0.92
        ) * visible
        : depth;
      const baseOffset = index * 3;
      if (!planMode && visible > 0.2) visiblePointCount += 1;

      if (this.modeIndex === 2) {
        const linePoint = this.getLineScanPoint(x, y, lineEdge, contour, bass, mid, high, seed, time);
        positions[baseOffset] = linePoint.x;
        positions[baseOffset + 1] = linePoint.y;
        positions[baseOffset + 2] = linePoint.z;
        const ink = lineSignal > 0.022 ? clamp01(lineSignal * (0.58 + bass * 0.13 + audio.peakLevel * 0.2)) : 0;
        const observationDot = hash01(index * 17.13 + Math.floor(time * 0.001)) > 0.982 ? 0.16 + high * 0.2 : 0;
        if (realColorMode) {
          colors[baseOffset] = red;
          colors[baseOffset + 1] = green;
          colors[baseOffset + 2] = blue;
        } else {
          colors[baseOffset] = ink * 0.72 + observationDot * 0.55;
          colors[baseOffset + 1] = ink * 0.84 + observationDot;
          colors[baseOffset + 2] = ink * 0.8 + observationDot * 0.84;
        }
        brightness[index] = ink;
        edges[index] = ink;
        if (lineSignal > 0.12) {
          const directionRatio = 1.12;
          const horizontalStroke = !lineVector || Math.abs(lineVector.gy) >= Math.abs(lineVector.gx) * directionRatio;
          const verticalStroke = !lineVector || Math.abs(lineVector.gx) > Math.abs(lineVector.gy) * directionRatio;
          const strongStroke = lineSignal > 0.34;
          if (x < this.sampleWidth - 1 && (horizontalStroke || strongStroke)) {
            const nextEdge = sobelAt(frame, x + 1, y, this.sampleWidth, this.sampleHeight);
            const nextLight = lumaXY(frame, this.sampleWidth, this.sampleHeight, x + 1, y);
            const nextContour = contourAt(nextLight + bass * 0.025 + audio.peakLevel * 0.02, 8.0 + audio.peakLevel * 8.0);
            const nextPoint = this.getLineScanPoint(x + 1, y, nextEdge, nextContour, bass, mid, high, seed, time);
            const continuity = smoothstep(0.07, 0.28, Math.max(lineEdge, nextEdge));
            lineOffset = appendLineSegment(supportPositions, supportColors, lineOffset, linePoint, nextPoint, lineSignal * continuity * 1.36, 0, realColorMode ? { r: red, g: green, b: blue } : null);
          }
          if (y < this.sampleHeight - 1 && (verticalStroke || strongStroke)) {
            const nextEdge = sobelAt(frame, x, y + 1, this.sampleWidth, this.sampleHeight);
            const nextLight = lumaXY(frame, this.sampleWidth, this.sampleHeight, x, y + 1);
            const nextContour = contourAt(nextLight + bass * 0.025 + audio.peakLevel * 0.02, 8.0 + audio.peakLevel * 8.0);
            const nextPoint = this.getLineScanPoint(x, y + 1, nextEdge, nextContour, bass, mid, high, seed, time);
            const continuity = smoothstep(0.07, 0.28, Math.max(lineEdge, nextEdge));
            lineOffset = appendLineSegment(supportPositions, supportColors, lineOffset, linePoint, nextPoint, lineSignal * continuity * 1.28, 1, realColorMode ? { r: red, g: green, b: blue } : null);
          }
          if ((x + y) % 11 === 0 && x < this.sampleWidth - 1 && y < this.sampleHeight - 1 && lineSignal > 0.44) {
            const nextEdge = sobelAt(frame, x + 1, y + 1, this.sampleWidth, this.sampleHeight);
            const nextLight = lumaXY(frame, this.sampleWidth, this.sampleHeight, x + 1, y + 1);
            const nextContour = contourAt(nextLight + bass * 0.025 + audio.peakLevel * 0.02, 8.0 + audio.peakLevel * 8.0);
            const nextPoint = this.getLineScanPoint(x + 1, y + 1, nextEdge, nextContour, bass, mid, high, seed, time);
            lineOffset = appendLineSegment(supportPositions, supportColors, lineOffset, linePoint, nextPoint, lineSignal * 0.34, 2, realColorMode ? { r: red, g: green, b: blue } : null);
          }
        }
      } else if (planMode) {
        const cymaticPoint = this.getCymaticPoint(index, x, y, light, edge, motionSignal, seed, time, dt, cymaticState, audio);
        positions[baseOffset] = cymaticPoint.x;
        positions[baseOffset + 1] = cymaticPoint.y;
        positions[baseOffset + 2] = cymaticPoint.z;
        colors[baseOffset] = cymaticPoint.color.r;
        colors[baseOffset + 1] = cymaticPoint.color.g;
        colors[baseOffset + 2] = cymaticPoint.color.b;
        brightness[index] = cymaticPoint.ink;
        edges[index] = cymaticPoint.resonance;
        if (cymaticPoint.ink > 0.035) visiblePointCount += 1;
      } else {
        if (this.modeIndex === 1) {
          const reactiveDrift = clamp(volume * 0.026 + audio.peakLevel * 0.032 + flux * 0.022, 0, 0.052);
          const anchorDriftX = Math.sin(time * 0.0016 + y * 0.08 + seed * 7.0) * mid * 0.052 * this.intensity;
          const audioDriftX = Math.sin(radial * 6.4 + time * 0.0021 + seed * 3.1) * reactiveDrift;
          const audioDriftY = scan * high * 0.062 + Math.sin(radial * 10.0 - time * 0.004) * flux * 0.047;
          const audioLift = Math.cos(radial * 8.2 - time * 0.003 + seed * 2.4) * reactiveDrift * 0.55;
          const grainDrift = (seed - 0.5) * (0.018 + high * 0.035) * this.intensity;
          const maxAnchorDrift = 0.085 + audio.peakLevel * 0.04 + flux * 0.028;
          positions[baseOffset] = nx + clamp(anchorDriftX + audioDriftX + grainDrift, -maxAnchorDrift, maxAnchorDrift);
          positions[baseOffset + 1] = ny + clamp(audioDriftY + grainDrift * 0.7, -maxAnchorDrift, maxAnchorDrift);
          positions[baseOffset + 2] = -1.35 + pointDepth + clamp(fizz * 0.32 + frequencyRing * 0.045 + audioLift, -0.08, 0.14);
        } else {
          positions[baseOffset] = nx + Math.sin(time * 0.0016 + y * 0.08 + seed * 7.0) * mid * 0.08 * this.intensity;
          positions[baseOffset + 1] = ny + scan * high * 0.12 + fizz;
          positions[baseOffset + 2] = -1.35 + pointDepth + fizz;
        }
        const lowLightLift = (this.modeIndex === 0 ? 0.11 : 0.075) + volume * 0.065 + scan * high * 0.08;
        if (realColorMode) {
          colors[baseOffset] = red;
          colors[baseOffset + 1] = green;
          colors[baseOffset + 2] = blue;
        } else if (this.modeIndex === 1) {
          const bandGate = clamp01(scan * high + frequencyRing * (flux + audio.peakLevel) + edge * 0.16);
          const sourceGray = red * 0.2126 + green * 0.7152 + blue * 0.0722;
          const grayInk = clamp01(0.12 + sourceGray * 1.05 + lowLightLift * 0.9 + bandGate * 0.42 + edge * 0.1 + audio.peakLevel * 0.12);
          colors[baseOffset] = clamp01(grayInk * 1.08);
          colors[baseOffset + 1] = clamp01(grayInk * 1.06);
          colors[baseOffset + 2] = clamp01(grayInk * 1.02);
        } else {
          colors[baseOffset] = clamp01(red * (0.76 + visible * 0.66) + edge * 0.075 + lowLightLift * 0.42);
          colors[baseOffset + 1] = clamp01(green * (0.76 + visible * 0.68) + scan * 0.16 + lowLightLift * 0.7);
          colors[baseOffset + 2] = clamp01(blue * (0.84 + visible * 0.7) + saturated * 0.12 + edge * 0.1 + lowLightLift);
        }
        brightness[index] = visible;
        edges[index] = edge;
      }
    }

    this.visiblePointCount = visiblePointCount;
    this.averageBrightness = brightnessTotal / total;
    if (this.modeIndex === 2) {
      if (layout.bucket !== 'portrait') {
        lineOffset = appendSurveyGuides(supportPositions, supportColors, lineOffset, layout, time, bass, mid, high);
      }
      this.lineSupport.geometry.setDrawRange(0, Math.floor(lineOffset / 3));
    } else if (planMode) {
      this.lineSupport.geometry.setDrawRange(0, 0);
    } else {
      this.lineSupport.geometry.setDrawRange(0, 0);
    }

    const peakLevelGate = audio.peakLevelGate ?? 0.46;
    if (this.modeIndex === 1 && (audio.peakLevel > peakLevelGate || audio.spectralFlux > 0.72 || time - this.lastCaptureTime > 1800)) {
      this.captureTrail(time, audio.peakLevel);
      this.spawnShockwave(audio, time);
    } else {
      this.fadeTrails(0.985);
    }
    this.updateShockwaves(time);

    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
    this.points.geometry.attributes.baseBrightness.needsUpdate = true;
    this.points.geometry.attributes.edgeStrength.needsUpdate = true;
    if (this.modeIndex === 2 || planMode) {
      this.lineSupport.geometry.attributes.position.needsUpdate = true;
      this.lineSupport.geometry.attributes.color.needsUpdate = true;
    }

    setUniforms(this.material.uniforms, audio, time, this.intensity, this.modeIndex);
    setUniforms(this.trailMaterial.uniforms, audio, time, this.intensity, this.modeIndex);
    this.material.uniforms.uPointSize.value = this.modeIndex >= 2
      ? (planMode ? 1.25 + this.intensity * 0.22 + high * 0.28 + this.resonanceStrength * 0.34 : 0.78 + this.intensity * 0.24 + high * 0.16 + audio.peakLevel * 0.18)
      : this.modeIndex === 1
        ? 1.44 + this.intensity * 0.72 + high * 0.34 + flux * 0.22
        : 1.25 + this.intensity * 0.72 + high * 0.7;
    this.lineSupportMaterial.opacity = this.modeIndex === 2
      ? 0.9 + high * 0.04 + audio.peakLevel * 0.04
      : planMode
        ? 0.96
        : 0;

    const targetZ = mode.cameraZ - (planMode ? this.resonanceStrength * 0.18 : bass * 0.42 + audio.peakLevel * 0.28) + (this.modeIndex === 2 ? 0.05 : 0);
    this.camera.position.z = lerp(this.camera.position.z, targetZ, 0.08);
    this.pointCamera.position.z = lerp(this.pointCamera.position.z, targetZ, 0.08);
    const targetFov = this.modeIndex >= 2 ? (planMode ? 46 : 48) : 50;
    if (Math.abs(this.camera.fov - targetFov) > 0.01) {
      this.camera.fov = lerp(this.camera.fov, targetFov, 0.08);
      this.camera.updateProjectionMatrix();
    }
    const targetRotationY = this.modeIndex >= 2 ? 0 : Math.sin(time * 0.00022) * 0.1 + mid * 0.2 + (this.modeIndex === 1 ? flux * 0.12 : 0);
    this.group.rotation.y = lerp(this.group.rotation.y, targetRotationY, 0.08);
    this.group.rotation.x = lerp(this.group.rotation.x, cameraTilt + Math.sin(time * 0.00017) * 0.045 + bass * 0.035, 0.06);
    const baseScale = this.modeIndex >= 2 ? layout.lineScale : layout.modeScale;
    const frequencyScale = this.modeIndex === 1
      ? layout.bucket === 'portrait'
        ? 1.18
        : layout.bucket === 'desktop'
          ? 1.16
          : 1.14
      : 1;
    const liveCameraFillScale = this.modeIndex < 3 ? 1.14 : 1;
    this.group.scale.setScalar(baseScale * frequencyScale * liveCameraFillScale * (1 + (planMode ? this.resonanceStrength * 0.018 : volume * 0.035 + audio.peakLevel * 0.03)));
    this.renderer.render(this.scene, this.modeIndex < 2 ? this.pointCamera : this.camera);
  }

  updateSpectrumLayer(audio, time, bass, mid, high, centroid, flux) {
    if (!this.spectrumPoints) return;
    const incoming = audio.frequencyBands || new Float32Array(SPECTRUM_BANDS);
    this.spectrumHistory[this.spectrumCursor].set(incoming);
    this.spectrumCursor = (this.spectrumCursor + 1) % SPECTRUM_HISTORY;

    const positions = this.spectrumPoints.geometry.attributes.position.array;
    const colors = this.spectrumPoints.geometry.attributes.color.array;
    const linePositions = this.spectrumLines.geometry.attributes.position.array;
    const lineColors = this.spectrumLines.geometry.attributes.color.array;
    const layout = this.layout || this.getLayoutMetrics();
    const spectrumScale = this.modeIndex === 1 ? 0.72 : 1;
    const aspectSpread = layout.spectrumWidth * spectrumScale;
    const peakGlow = clamp01(audio.peakLevel * 1.2 + flux * 0.45);
    const layerBaseY = layout.bucket === 'desktop' ? -1.42 : layout.bucket === 'mobile-landscape' ? -1.36 : -1.28;
    const historyDepth = 2.25 + flux * 0.7;

    for (let history = 0; history < SPECTRUM_HISTORY; history += 1) {
      const age = history / (SPECTRUM_HISTORY - 1);
      const row = this.spectrumHistory[(this.spectrumCursor - 1 - history + SPECTRUM_HISTORY) % SPECTRUM_HISTORY];
      for (let band = 0; band < SPECTRUM_BANDS; band += 1) {
        const bandT = band / (SPECTRUM_BANDS - 1);
        const rawValue = row[band] || 0;
        const lowWeight = 1 - bandT;
        const highWeight = bandT;
        const midWeight = clamp01(1 - Math.abs(bandT - 0.5) * 2.2);
        const activityFloor = (0.01 + flux * 0.015 + high * highWeight * 0.015) * (1 - age * 0.62);
        const value = Math.max(rawValue, activityFloor);
        const index = history * SPECTRUM_BANDS + band;
        const offset = index * 3;
        const centered = bandT - 0.5;
        const bassMass = lowWeight * lowWeight * bass * 0.16 * spectrumScale;
        const midFiber = Math.sin(time * 0.0016 + bandT * Math.PI * 9 + history * 0.08) * midWeight * mid * 0.06 * spectrumScale;
        const highNeedle = Math.sin(time * 0.005 + band * 1.17 + history * 0.37) * highWeight * high * 0.075 * spectrumScale;
        const bandGap = Math.sin(band * 12.9898) * 0.012 * spectrumScale;
        positions[offset] = centered * aspectSpread + bandGap;
        positions[offset + 1] = layerBaseY + (value * (0.62 + lowWeight * 0.28 + midWeight * 0.18 + highWeight * 0.22) - age * 0.18) * spectrumScale + bassMass + midFiber + highNeedle;
        positions[offset + 2] = -1.35 - age * historyDepth + rawValue * (0.38 + lowWeight * 0.18) + highWeight * high * 0.05;
        const fade = 1 - age * 0.68;
        const bandInk = rawValue * (0.92 + peakGlow * 0.45) + activityFloor * 1.8;
        const grayBase = 0.18 + bandInk * 0.72 + peakGlow * 0.12;
        const lowWarmth = lowWeight * bass * 0.06;
        const highSheen = highWeight * high * 0.08 + centroid * 0.05;
        colors[offset] = (grayBase + lowWarmth + highSheen) * fade;
        colors[offset + 1] = (grayBase + midWeight * mid * 0.05 + highSheen * 0.35) * fade;
        colors[offset + 2] = (grayBase + highSheen * 0.55) * fade;
      }
    }

    let lineOffset = 0;
    for (let history = 0; history < SPECTRUM_HISTORY; history += 1) {
      for (let band = 0; band < SPECTRUM_BANDS - 1; band += 1) {
        lineOffset = copySpectrumSegment(positions, colors, linePositions, lineColors, history, band, history, band + 1, lineOffset);
      }
    }
    for (let band = 0; band < SPECTRUM_BANDS - 1; band += SPECTRUM_LINE_STRIDE) {
      for (let history = 0; history < SPECTRUM_HISTORY - 1; history += 1) {
        lineOffset = copySpectrumSegment(positions, colors, linePositions, lineColors, history, band, history + 1, band, lineOffset);
      }
    }

    this.spectrumMaterial.size = (0.022 + high * 0.03 + flux * 0.018 + peakGlow * 0.012) * spectrumScale;
    this.spectrumMaterial.opacity = this.modeIndex === 1 ? 0.96 : 0;
    this.spectrumLineMaterial.opacity = this.modeIndex === 1 ? 0.62 + peakGlow * 0.14 : 0;
    this.spectrumPoints.visible = this.modeIndex === 1;
    this.spectrumLines.visible = this.modeIndex === 1;
    this.spectrumPoints.geometry.attributes.position.needsUpdate = true;
    this.spectrumPoints.geometry.attributes.color.needsUpdate = true;
    this.spectrumLines.geometry.attributes.position.needsUpdate = true;
    this.spectrumLines.geometry.attributes.color.needsUpdate = true;
  }

  spawnShockwave(audio, time) {
    if (this.modeIndex !== 1) return;
    if (time - this.lastShockwaveTime < 650) return;
    if (audio.peakLevel < 0.34 && audio.spectralFlux < 0.56) return;
    this.lastShockwaveTime = time;
    if (this.shockwaves.length > 3) {
      const oldWave = this.shockwaves.shift();
      this.disposeShockwave(oldWave);
    }
    const geometry = new THREE.RingGeometry(0.16, 0.18 + audio.bassEnergy * 0.035, 64);
    const color = new THREE.Color().setRGB(
      0.32 + audio.spectralCentroid * 0.34,
      0.66,
      0.86 - audio.spectralCentroid * 0.12,
    );
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.12 + audio.peakLevel * 0.14,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const wave = new THREE.Mesh(geometry, material);
    wave.position.set(0, -0.05, -1.2);
    wave.rotation.x = 0;
    wave.userData = {
      born: time,
      speed: 0.00125 + audio.bassEnergy * 0.0017 + audio.spectralFlux * 0.0018,
      wobble: audio.midEnergy,
    };
    this.group.add(wave);
    this.shockwaves.push(wave);
  }

  updateShockwaves(time) {
    for (let index = this.shockwaves.length - 1; index >= 0; index -= 1) {
      const wave = this.shockwaves[index];
      const age = time - wave.userData.born;
      const progress = age * wave.userData.speed;
      wave.scale.setScalar(1 + progress * 3.15);
      wave.rotation.z += 0.001 + wave.userData.wobble * 0.003;
      wave.material.opacity = this.modeIndex === 1 ? Math.max(0, 0.22 * (1 - progress)) : 0;
      wave.visible = this.modeIndex === 1;
      if (progress >= 1) {
        this.disposeShockwave(wave);
        this.shockwaves.splice(index, 1);
      }
    }
  }

  clearShockwaves() {
    for (const wave of this.shockwaves) {
      this.disposeShockwave(wave);
    }
    this.shockwaves = [];
  }

  disposeShockwave(wave) {
    if (!wave) return;
    this.group.remove(wave);
    wave.geometry?.dispose();
    wave.material?.dispose();
  }

  captureTrail(time, peak) {
    if (time - this.lastCaptureTime < TRAIL_CAPTURE_INTERVAL) return;
    this.lastCaptureTime = time;
    const total = this.sampleWidth * this.sampleHeight;
    const trailPositions = this.trails.geometry.attributes.position.array;
    const trailColors = this.trails.geometry.attributes.color.array;

    for (let layer = TRAIL_COUNT - 1; layer > 0; layer -= 1) {
      const dst = layer * total * 3;
      const src = (layer - 1) * total * 3;
      trailPositions.copyWithin(dst, src, src + total * 3);
      trailColors.copyWithin(dst, src, src + total * 3);
    }

    for (let index = 0; index < total * 3; index += 1) {
      trailPositions[index] = this.currentPositions[index];
      trailColors[index] = this.currentColors[index] * (0.58 + peak * 0.55);
    }

    this.trails.geometry.attributes.position.needsUpdate = true;
    this.trails.geometry.attributes.color.needsUpdate = true;
  }

  fadeTrails(amount) {
    const trailColors = this.trails.geometry.attributes.color.array;
    for (let index = 0; index < trailColors.length; index += 1) {
      trailColors[index] *= amount;
    }
    this.trails.geometry.attributes.color.needsUpdate = true;
  }

  renderEdgePlanRaster(frame, audio, time, pointPositions, pointColors, pointBrightness, pointEdges, linePositions, lineColors) {
    const width = this.sampleWidth;
    const height = this.sampleHeight;
    const total = width * height;
    const buffers = this.ensureEdgePlanBuffers(total);
    const {
      gray,
      blur,
      wideBlur,
      cannySource,
      dog,
      grad,
      dir,
      thin,
      mask,
      visited,
      detailMask,
    } = buffers;

    for (let index = 0; index < total; index += 1) {
      gray[index] = lumaAt(frame, index * 4);
      mask[index] = 0;
      visited[index] = 0;
      detailMask[index] = 0;
    }

    blurGray(gray, blur, width, height);
    blurGray(blur, wideBlur, width, height);
    for (let index = 0; index < total; index += 1) {
      cannySource[index] = gray[index] * 0.46 + blur[index] * 0.54;
    }

    const detailBoost = clamp01(0.28 + audio.highEnergy * 0.34 + audio.spectralFlux * 0.3 + audio.peakLevel * 0.12);
    const structureBoost = clamp01(0.24 + audio.bassEnergy * 0.34 + audio.smoothedVolume * 0.16);
    const highThreshold = clamp(0.098 - detailBoost * 0.034 - structureBoost * 0.014, 0.045, 0.115);
    const lowThreshold = highThreshold * clamp(0.27 + audio.midEnergy * 0.08, 0.24, 0.4);
    computeCannyMap(cannySource, grad, dir, thin, mask, width, height, lowThreshold, highThreshold);
    computeDogDetailMap(gray, blur, wideBlur, dog, detailMask, width, height, clamp(0.032 - detailBoost * 0.014, 0.014, 0.034));

    const rasterThreshold = clamp(0.011 - detailBoost * 0.0035 - audio.highEnergy * 0.0025, 0.0048, 0.012);
    const rasterGain = clamp(2.9 + audio.smoothedVolume * 0.9 + audio.highEnergy * 1.1, 2.65, 4.65);
    let visible = applyXdogRasterPoints(
      pointPositions,
      pointColors,
      pointBrightness,
      pointEdges,
      dog,
      detailMask,
      mask,
      width,
      height,
      this,
      rasterThreshold,
      rasterGain,
      time,
    );

    const minLength = Math.max(2, Math.round(5 - detailBoost * 2));
    const opacity = clamp(0.38 + audio.bassEnergy * 0.18 + audio.smoothedVolume * 0.1, 0.34, 0.64);
    const maxOffset = linePositions.length - 6;
    let offset = 0;

    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const index = y * width + x;
        if (!mask[index] || visited[index]) continue;
        const trace = traceContour(mask, visited, grad, width, height, x, y);
        if (trace.length < minLength) continue;
        visible += Math.floor(trace.length * 0.2);
        offset = appendContourPolyline(
          linePositions,
          lineColors,
          offset,
          maxOffset,
          trace,
          grad,
          width,
          height,
          this,
          opacity,
          time,
          0,
        );
        if (offset >= maxOffset) break;
      }
      if (offset >= maxOffset) break;
    }

    this.visiblePointCount = visible;
    return offset;
  }

  ensureEdgePlanBuffers(total) {
    if (this.edgePlanBuffers?.total === total) return this.edgePlanBuffers;
    this.edgePlanBuffers = {
      total,
      gray: new Float32Array(total),
      blur: new Float32Array(total),
      wideBlur: new Float32Array(total),
      cannySource: new Float32Array(total),
      dog: new Float32Array(total),
      grad: new Float32Array(total),
      dir: new Uint8Array(total),
      thin: new Float32Array(total),
      mask: new Uint8Array(total),
      visited: new Uint8Array(total),
      detailMask: new Uint8Array(total),
    };
    return this.edgePlanBuffers;
  }

}

function sharedUniforms(intensity) {
  return {
    uTime: { value: 0 },
    uBass: { value: 0 },
    uMid: { value: 0 },
    uHigh: { value: 0 },
    uVolume: { value: 0 },
    uPeak: { value: 0 },
    uCentroid: { value: 0 },
    uFlux: { value: 0 },
    uIntensity: { value: intensity },
    uPointSize: { value: 2.4 },
    uMode: { value: 0 },
    uRealColor: { value: 1 },
  };
}

function setUniforms(uniforms, audio, time, intensity, modeIndex) {
  uniforms.uTime.value = time;
  uniforms.uBass.value = audio.bassEnergy;
  uniforms.uMid.value = audio.midEnergy;
  uniforms.uHigh.value = audio.highEnergy;
  uniforms.uVolume.value = audio.smoothedVolume;
  uniforms.uPeak.value = audio.peakLevel;
  uniforms.uCentroid.value = audio.spectralCentroid || 0;
  uniforms.uFlux.value = audio.spectralFlux || 0;
  uniforms.uIntensity.value = intensity;
  uniforms.uMode.value = modeIndex;
}

function getReactiveRms(audio) {
  if (audio.audioProfile === 'iosWebKit') {
    return Math.max(audio.rms || 0, audio.smoothedVolume || 0, audio.visualVolume || 0, audio.overallVolume || 0);
  }
  return audio.rms || audio.smoothedVolume || audio.overallVolume || 0;
}

function getCymaticRms(audio) {
  if (audio.audioProfile === 'iosWebKit') {
    return Math.max(audio.rms || 0, (audio.rawRMS || 0) * 3.4);
  }
  return getReactiveRms(audio);
}

function selectNearestCymaticMode(peakHz) {
  if (!peakHz || peakHz <= 0) return CYMATIC_MODE_TABLE[0];
  let nearest = CYMATIC_MODE_TABLE[0];
  let bestError = Math.abs(peakHz - nearest.freq);
  for (let index = 1; index < CYMATIC_MODE_TABLE.length; index += 1) {
    const mode = CYMATIC_MODE_TABLE[index];
    const error = Math.abs(peakHz - mode.freq);
    if (error < bestError) {
      nearest = mode;
      bestError = error;
    }
  }
  return nearest;
}

function selectExcitedCymaticMode(freqData, sampleRate, modeTable) {
  let best = modeTable[0];
  let bestEnergy = 0;
  if (!freqData?.length || !sampleRate) return { mode: best, energy: 0 };

  for (const mode of modeTable) {
    const energy = getCymaticBandEnergy(freqData, sampleRate, mode.freq);
    if (energy > bestEnergy) {
      best = mode;
      bestEnergy = energy;
    }
  }

  return { mode: best, energy: bestEnergy };
}

function getCymaticBandEnergy(freqData, sampleRate, centerHz) {
  const nyquist = sampleRate / 2;
  const hzPerBin = nyquist / freqData.length;
  const bandwidthHz = Math.max(12, centerHz * 0.08);
  const startHz = Math.max(0, centerHz - bandwidthHz);
  const endHz = centerHz + bandwidthHz;
  const startBin = Math.max(0, Math.floor(startHz / hzPerBin));
  const endBin = Math.min(freqData.length - 1, Math.ceil(endHz / hzPerBin));
  let sum = 0;
  let count = 0;

  for (let index = startBin; index <= endBin; index += 1) {
    const value = freqData[index] / 255;
    sum += value * value;
    count += 1;
  }

  return count > 0 ? sum / count : 0;
}

function selectCymaticPattern({ peakHz, centroid, bands }) {
  const bass = bands.bass || 0;
  const mid = bands.mid || 0;
  const high = bands.high || 0;
  if ((peakHz > 1800 && high > mid * 0.78) || centroid > 0.62 || high > Math.max(bass, mid) * 1.12) {
    return CYMATIC_PATTERN_TYPES.HIGH;
  }
  if ((peakHz > 420 && peakHz <= 1800) || mid > Math.max(bass, high) * 0.92) {
    return CYMATIC_PATTERN_TYPES.MID;
  }
  if ((peakHz > 130 && peakHz <= 420) || (bass + mid * 0.9 > high * 1.18 && mid > bass * 0.68)) {
    return CYMATIC_PATTERN_TYPES.LOW_MID;
  }
  return CYMATIC_PATTERN_TYPES.LOW;
}

function cymaticPatternField(type, u, v, options) {
  const cx = u - 0.5;
  const cy = v - 0.5;
  const radius = Math.sqrt(cx * cx + cy * cy);
  const safeRadius = Math.max(0.035, radius);
  const theta = Math.atan2(cy, cx);
  const phase = options.phase || 0;
  const peakHz = options.peakHz || 0;
  const centroid = options.centroid || 0;
  const bands = options.bands || {};

  if (type === CYMATIC_PATTERN_TYPES.LOW) {
    const ringCount = 7 + clamp(peakHz / 38, 0, 7);
    const angularDrift = Math.sin(theta * 3 + phase * 0.42) * 0.18;
    const ring = Math.sin((radius + angularDrift * 0.035) * ringCount * Math.PI - phase * (1.25 + (bands.bass || 0) * 1.1));
    const secondary = Math.sin(radius * (ringCount * 0.58) * Math.PI + phase * 0.68) * 0.34;
    const pressure = (ring + secondary) * (0.48 + (bands.bass || 0) * 0.52);
    const swirl = Math.cos(radius * ringCount * Math.PI - phase * 0.7) * 0.08;
    return {
      dx: (cx / safeRadius) * pressure + -Math.sin(theta) * swirl,
      dy: (cy / safeRadius) * pressure + Math.cos(theta) * swirl,
      value: clamp((ring + secondary) * 0.58, -1, 1),
    };
  }

  if (type === CYMATIC_PATTERN_TYPES.LOW_MID) {
    const sourceRadius = 0.28 + centroid * 0.12;
    const sourceCount = 3 + Math.round(clamp(peakHz / 180, 0, 3));
    let field = 0;
    let dx = 0;
    let dy = 0;
    for (let source = 0; source < sourceCount; source += 1) {
      const sourceAngle = source / sourceCount * Math.PI * 2 + phase * 0.08;
      const sx = Math.cos(sourceAngle) * sourceRadius;
      const sy = Math.sin(sourceAngle) * sourceRadius;
      const vx = cx - sx;
      const vy = cy - sy;
      const dist = Math.max(0.035, Math.sqrt(vx * vx + vy * vy));
      const waveNumber = 26 + clamp(peakHz / 18, 0, 18) + centroid * 14;
      const wave = Math.sin(dist * waveNumber - phase * (1.35 + (bands.mid || 0) * 1.4));
      const weight = 1 / (0.8 + dist * 2.4);
      field += wave * weight;
      const push = Math.cos(dist * waveNumber - phase) * weight;
      dx += (vx / dist) * push;
      dy += (vy / dist) * push;
    }
    const petalCount = 5 + Math.round(clamp(centroid * 7 + peakHz / 260, 0, 6));
    const rosette = Math.sin(theta * petalCount + phase * 0.62) * Math.sin(radius * (18 + petalCount * 1.4) - phase);
    field = field / sourceCount + rosette * 0.34;
    return {
      dx: dx / sourceCount * 0.36 + (cx / safeRadius) * rosette * 0.25,
      dy: dy / sourceCount * 0.36 + (cy / safeRadius) * rosette * 0.25,
      value: clamp(field, -1, 1),
    };
  }

  if (type === CYMATIC_PATTERN_TYPES.MID) {
    const lobes = Math.round(clamp(6 + centroid * 9 + peakHz / 480, 6, 16));
    const rings = 18 + centroid * 22 + (bands.mid || 0) * 8;
    const radial = Math.sin(radius * rings - phase * 1.18);
    const petals = Math.sin(theta * lobes + Math.sin(radius * 9 - phase * 0.5) * 0.8 + phase * 0.72);
    const lace = Math.sin(theta * (lobes * 2) - radius * 16 + phase * 0.38) * 0.24;
    const field = radial * (0.62 + petals * 0.38) + lace;
    const radialPush = field * 0.54;
    const tangentPush = (Math.cos(theta * lobes + phase * 0.72) * radial + lace) * 0.22;
    return {
      dx: (cx / safeRadius) * radialPush + -Math.sin(theta) * tangentPush,
      dy: (cy / safeRadius) * radialPush + Math.cos(theta) * tangentPush,
      value: clamp(field, -1, 1),
    };
  }

  const cellK = 28 + centroid * 42 + clamp(peakHz / 190, 0, 22);
  const a = Math.sin(cx * cellK + phase * 2.7);
  const b = Math.sin((cx * -0.5 + cy * 0.866) * cellK + phase * (2.2 + (bands.high || 0) * 2.4));
  const c = Math.sin((cx * -0.5 - cy * 0.866) * cellK - phase * 2.05);
  const honey = (a + b + c) / 3;
  const ringLace = Math.sin(radius * (44 + centroid * 34) - phase * 2.8 + Math.sin(theta * 9) * 0.7);
  const fine = honey * 0.68 + ringLace * 0.32;
  return {
    dx: (a - (b + c) * 0.5) * 0.11 + (cx / safeRadius) * ringLace * 0.12,
    dy: (b - c) * 0.095 + (cy / safeRadius) * ringLace * 0.12,
    value: clamp(fine, -1, 1),
  };
}

function chladniPattern(mode, u, v, phase = 0) {
  const x = Math.PI * u;
  const y = Math.PI * v;
  const n = mode.n;
  const m = mode.m;
  return Math.sin(n * x + phase) * Math.sin(m * y + phase)
    - Math.sin(m * x + phase) * Math.sin(n * y + phase);
}

function chladniGradient(mode, u, v, phase = 0) {
  const x = Math.PI * u;
  const y = Math.PI * v;
  const n = mode.n;
  const m = mode.m;
  const snx = Math.sin(n * x + phase);
  const cnx = Math.cos(n * x + phase);
  const smy = Math.sin(m * y + phase);
  const cmy = Math.cos(m * y + phase);
  const smx = Math.sin(m * x + phase);
  const cmx = Math.cos(m * x + phase);
  const sny = Math.sin(n * y + phase);
  const cny = Math.cos(n * y + phase);

  return {
    cx: Math.PI * (n * cnx * smy - m * cmx * sny),
    cy: Math.PI * (m * snx * cmy - n * smx * cny),
  };
}

function thermalColor(heat, bass, high, centroid) {
  const teal = { r: 0.03, g: 0.58, b: 0.46 };
  const cyan = { r: 0.08, g: 0.86, b: 0.66 };
  const yellow = { r: 0.86, g: 0.78, b: 0.28 };
  const orange = { r: 1.0, g: 0.34, b: 0.12 };
  const bassWeight = bass * 0.12;
  const highWeight = high * 0.18 + centroid * 0.12;

  if (heat < 0.42) {
    const t = smoothstep(0.02, 0.42, heat);
    return mixRgb(
      { r: 0.0 + bassWeight * 0.3, g: 0.12 + bassWeight, b: 0.11 + bassWeight * 0.7 },
      teal,
      t,
    );
  }

  if (heat < 0.76) {
    const t = smoothstep(0.42, 0.76, heat);
    return mixRgb(cyan, yellow, t * (0.72 + highWeight));
  }

  return mixRgb(yellow, orange, smoothstep(0.76, 1.0, heat));
}

function scan2ParticleColor(brightness, bands, modeEnergy, patternType = CYMATIC_PATTERN_TYPES.LOW, resonance = 0, fieldValue = 0) {
  let red = 0;
  let green = 0;
  let blue = 0;

  if (brightness < 0.3) {
    red = 0;
    green = brightness * 400 + bands.bass * 100;
    blue = brightness * 700 + 100 + bands.mid * 50;
  } else if (brightness < 0.6) {
    const normalized = (brightness - 0.3) / 0.3;
    red = normalized * 200;
    green = 150 + normalized * 100;
    blue = 200 - normalized * 150;
  } else {
    const normalized = (brightness - 0.6) / 0.4;
    red = 200 + normalized * 55;
    green = 250 - normalized * 150;
    blue = 50;
    red += modeEnergy * 100;
  }

  const tintAmount = clamp01(resonance * (0.12 + Math.abs(fieldValue) * 0.18));
  let tint = { r: red, g: green, b: blue };
  if (patternType === CYMATIC_PATTERN_TYPES.LOW) {
    tint = { r: red * 0.82 + 24, g: green * 0.84 + 24, b: blue * 0.95 + 42 };
  } else if (patternType === CYMATIC_PATTERN_TYPES.LOW_MID) {
    tint = { r: red * 0.96 + 32, g: green * 0.9 + 18, b: blue * 0.78 + 18 };
  } else if (patternType === CYMATIC_PATTERN_TYPES.MID) {
    tint = { r: red * 1.08 + 42, g: green * 0.9 + 20, b: blue * 0.72 + 8 };
  } else if (patternType === CYMATIC_PATTERN_TYPES.HIGH) {
    tint = { r: red * 1.05 + 36, g: green * 1.05 + 36, b: blue * 1.08 + 48 };
  }
  red = lerp(red, tint.r, tintAmount);
  green = lerp(green, tint.g, tintAmount);
  blue = lerp(blue, tint.b, tintAmount);

  return {
    r: Math.floor(clamp(red, 0, 255)),
    g: Math.floor(clamp(green, 0, 255)),
    b: Math.floor(clamp(blue, 0, 255)),
  };
}

function mixRgb(from, to, amount) {
  const t = clamp01(amount);
  return {
    r: lerp(from.r, to.r, t),
    g: lerp(from.g, to.g, t),
    b: lerp(from.b, to.b, t),
  };
}

function appendLineSegment(positions, colors, offset, from, to, strength, variant, realColor = null) {
  if (offset + 5 >= positions.length) return offset;
  const ink = clamp01(strength);
  if (ink <= 0.01) return offset;
  const jitter = variant === 2 ? 0.006 : 0;
  const shade = clamp(0.34 - Math.pow(ink, 0.72) * 0.32 + (variant === 2 ? 0.06 : 0), 0.012, 0.34);
  const startColor = realColor || { r: shade, g: shade, b: shade };
  const endColor = realColor
    ? {
        r: clamp01(realColor.r * 1.08),
        g: clamp01(realColor.g * 1.08),
        b: clamp01(realColor.b * 1.08),
      }
    : { r: shade * 1.08, g: shade * 1.08, b: shade * 1.08 };
  positions[offset] = from.x;
  positions[offset + 1] = from.y;
  positions[offset + 2] = from.z - 0.045 - jitter;
  colors[offset] = startColor.r;
  colors[offset + 1] = startColor.g;
  colors[offset + 2] = startColor.b;
  positions[offset + 3] = to.x;
  positions[offset + 4] = to.y;
  positions[offset + 5] = to.z - 0.045 - jitter;
  colors[offset + 3] = endColor.r;
  colors[offset + 4] = endColor.g;
  colors[offset + 5] = endColor.b;
  return offset + 6;
}

function blurGray(source, target, width, height) {
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      let weight = 0;
      for (let oy = -1; oy <= 1; oy += 1) {
        const yy = clamp(y + oy, 0, height - 1);
        const wy = oy === 0 ? 2 : 1;
        for (let ox = -1; ox <= 1; ox += 1) {
          const xx = clamp(x + ox, 0, width - 1);
          const wx = ox === 0 ? 2 : 1;
          const w = wx * wy;
          sum += source[yy * width + xx] * w;
          weight += w;
        }
      }
      target[y * width + x] = sum / weight;
    }
  }
}

function computeCannyMap(gray, grad, dir, thin, mask, width, height, lowThreshold, highThreshold) {
  grad.fill(0);
  thin.fill(0);
  dir.fill(0);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      const tl = gray[i - width - 1];
      const tc = gray[i - width];
      const tr = gray[i - width + 1];
      const ml = gray[i - 1];
      const mr = gray[i + 1];
      const bl = gray[i + width - 1];
      const bc = gray[i + width];
      const br = gray[i + width + 1];
      const gx = -tl - ml * 2 - bl + tr + mr * 2 + br;
      const gy = -tl - tc * 2 - tr + bl + bc * 2 + br;
      const magnitude = Math.sqrt(gx * gx + gy * gy);
      grad[i] = magnitude;
      dir[i] = quantizedDirection(Math.atan2(gy, gx));
    }
  }

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      const magnitude = grad[i];
      let a = 0;
      let b = 0;
      if (dir[i] === 0) {
        a = grad[i - 1];
        b = grad[i + 1];
      } else if (dir[i] === 1) {
        a = grad[i - width + 1];
        b = grad[i + width - 1];
      } else if (dir[i] === 2) {
        a = grad[i - width];
        b = grad[i + width];
      } else {
        a = grad[i - width - 1];
        b = grad[i + width + 1];
      }
      thin[i] = magnitude >= a && magnitude >= b ? magnitude : 0;
    }
  }

  const stack = [];
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      if (thin[i] >= highThreshold) {
        mask[i] = 1;
        stack.push(i);
      }
    }
  }

  while (stack.length) {
    const index = stack.pop();
    const x = index % width;
    const y = Math.floor(index / width);
    for (let oy = -1; oy <= 1; oy += 1) {
      for (let ox = -1; ox <= 1; ox += 1) {
        if (ox === 0 && oy === 0) continue;
        const nx = x + ox;
        const ny = y + oy;
        if (nx <= 0 || nx >= width - 1 || ny <= 0 || ny >= height - 1) continue;
        const next = ny * width + nx;
        if (!mask[next] && thin[next] >= lowThreshold) {
          mask[next] = 1;
          stack.push(next);
        }
      }
    }
  }
}

function computeDogDetailMap(gray, blur, wideBlur, dog, mask, width, height, threshold) {
  dog.fill(0);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const fine = Math.abs(gray[index] - blur[index]) * 0.72;
      const dogBand = blur[index] - wideBlur[index];
      const darkInk = Math.max(0, wideBlur[index] - blur[index]) * 0.92;
      const band = Math.abs(dogBand) * 0.52 + darkInk;
      const local = fine + band;
      const n = Math.max(
        Math.abs(gray[index - 1] - blur[index - 1]),
        Math.abs(gray[index + 1] - blur[index + 1]),
        Math.abs(gray[index - width] - blur[index - width]),
        Math.abs(gray[index + width] - blur[index + width]),
      );
      const sketch = local + n * 0.34;
      dog[index] = sketch;
    }
  }

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const value = dog[index];
      const horizontal = value >= dog[index - 1] || value >= dog[index + 1];
      const vertical = value >= dog[index - width] || value >= dog[index + width];
      const neighborInk = Math.max(dog[index - 1], dog[index + 1], dog[index - width], dog[index + width]);
      mask[index] = value > threshold && (horizontal || vertical || neighborInk > threshold * 1.2) ? 1 : 0;
    }
  }
}

function quantizedDirection(angle) {
  const degrees = ((angle * 180) / Math.PI + 180) % 180;
  if (degrees < 22.5 || degrees >= 157.5) return 0;
  if (degrees < 67.5) return 1;
  if (degrees < 112.5) return 2;
  return 3;
}

function traceContour(mask, visited, grad, width, height, startX, startY) {
  const points = [];
  let x = startX;
  let y = startY;
  let previous = -1;
  for (let guard = 0; guard < width * height; guard += 1) {
    const index = y * width + x;
    if (!mask[index] || visited[index]) break;
    visited[index] = 1;
    points.push({ x, y, strength: grad[index] });
    let best = -1;
    let bestScore = -1;
    for (let oy = -1; oy <= 1; oy += 1) {
      for (let ox = -1; ox <= 1; ox += 1) {
        if (ox === 0 && oy === 0) continue;
        const nx = x + ox;
        const ny = y + oy;
        if (nx <= 0 || nx >= width - 1 || ny <= 0 || ny >= height - 1) continue;
        const next = ny * width + nx;
        if (next === previous || !mask[next] || visited[next]) continue;
        const straightBonus = ox === 0 || oy === 0 ? 0.015 : 0;
        const score = grad[next] + straightBonus;
        if (score > bestScore) {
          best = next;
          bestScore = score;
        }
      }
    }
    if (best < 0) break;
    previous = index;
    x = best % width;
    y = Math.floor(best / width);
  }
  return points;
}

function appendContourPolyline(positions, colors, offset, maxOffset, points, grad, width, height, renderer, opacity, time, layer) {
  let previousPoint = null;
  let previousWorld = null;
  for (let i = 0; i < points.length; i += 1) {
    const point = points[i];
    const world = renderer.getEdgePlanPoint(point.x, point.y, point.strength, 1, 0.5, time);
    if (previousPoint && previousWorld) {
      const dx = point.x - previousPoint.x;
      const dy = point.y - previousPoint.y;
      if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) {
        const strength = clamp01((point.strength + previousPoint.strength) * 2.4);
        offset = appendGraphiteSegment(positions, colors, offset, maxOffset, previousWorld, world, strength, opacity, layer);
      }
    }
    if (offset >= maxOffset) break;
    previousPoint = point;
    previousWorld = world;
  }
  return offset;
}

function applyXdogRasterPoints(positions, colors, brightness, edges, dog, detailMask, skeletonMask, width, height, renderer, threshold, gain, time) {
  let visible = 0;
  const total = width * height;
  for (let index = 0; index < total; index += 1) {
    const baseOffset = index * 3;
    const x = index % width;
    const y = Math.floor(index / width);
    const value = dog[index];
    const skeleton = skeletonMask[index] ? 0.16 : 0;
    const detail = detailMask[index] ? 0.08 : 0;
    const paperNoise = (hash01(index * 13.73 + Math.floor(time * 0.0002)) - 0.5) * 0.035;
    const rasterInk = clamp01((value - threshold) * gain + skeleton + detail + paperNoise);
    if (rasterInk <= 0.018) {
      positions[baseOffset] = 0;
      positions[baseOffset + 1] = 0;
      positions[baseOffset + 2] = -18;
      colors[baseOffset] = 0;
      colors[baseOffset + 1] = 0;
      colors[baseOffset + 2] = 0;
      brightness[index] = 0;
      edges[index] = 0;
      continue;
    }

    const point = renderer.getEdgePlanPoint(x, y, value, 1, 0.5, time);
    const tone = clamp(0.72 - rasterInk * 0.48, 0.18, 0.66);
    positions[baseOffset] = point.x;
    positions[baseOffset + 1] = point.y;
    positions[baseOffset + 2] = point.z - 0.03;
    colors[baseOffset] = tone;
    colors[baseOffset + 1] = tone;
    colors[baseOffset + 2] = tone;
    brightness[index] = clamp(rasterInk * 0.9, 0, 1);
    edges[index] = clamp(rasterInk * 0.65, 0, 1);
    visible += 1;
  }
  return visible;
}

function appendGraphiteSegment(positions, colors, offset, maxOffset, from, to, strength, opacity, layer) {
  if (offset + 5 > maxOffset) return maxOffset;
  const ink = clamp01(strength * opacity);
  const baseTone = layer === 2 ? 0.58 : layer === 1 ? 0.48 : 0.32;
  const pull = layer === 2 ? 0.18 : layer === 1 ? 0.22 : 0.24;
  const minTone = layer === 2 ? 0.34 : layer === 1 ? 0.22 : 0.1;
  const maxTone = layer === 2 ? 0.62 : layer === 1 ? 0.52 : 0.38;
  const tone = clamp(baseTone - ink * pull, minTone, maxTone);
  positions[offset] = from.x;
  positions[offset + 1] = from.y;
  positions[offset + 2] = from.z - 0.04;
  colors[offset] = tone;
  colors[offset + 1] = tone;
  colors[offset + 2] = tone;
  positions[offset + 3] = to.x;
  positions[offset + 4] = to.y;
  positions[offset + 5] = to.z - 0.04;
  colors[offset + 3] = tone;
  colors[offset + 4] = tone;
  colors[offset + 5] = tone;
  return offset + 6;
}

function appendSurveyGuides(positions, colors, offset, layout, time, bass, mid, high) {
  const width = layout.linePlaneWidth * 0.92;
  const height = layout.linePlaneHeight * 0.9;
  const left = -width * 0.5;
  const right = width * 0.5;
  const bottom = layout.lineYOffset - height * 0.5;
  const top = layout.lineYOffset + height * 0.5;
  const z = -1.74;
  const pulse = 0.05 + high * 0.04 + bass * 0.03;

  for (let i = 0; i <= 8; i += 1) {
    const t = i / 8;
    const x = lerp(left, right, t);
    const strength = (i % 2 === 0 ? 0.09 : 0.045) + pulse;
    offset = appendLineSegment(positions, colors, offset, { x, y: bottom, z }, { x, y: top, z }, strength, 1);
  }

  for (let i = 0; i <= 6; i += 1) {
    const t = i / 6;
    const y = lerp(bottom, top, t);
    const strength = (i % 2 === 0 ? 0.075 : 0.038) + pulse;
    offset = appendLineSegment(positions, colors, offset, { x: left, y, z }, { x: right, y, z }, strength, 0);
  }

  const scanY = lerp(bottom, top, (Math.sin(time * 0.0009) + 1) * 0.5);
  offset = appendLineSegment(positions, colors, offset, { x: left, y: scanY, z: z + 0.02 }, { x: right, y: scanY, z: z + 0.02 }, 0.18 + high * 0.16, 1);
  return offset;
}

function lumaAt(frame, index) {
  return frame[index] / 255 * 0.2126 + frame[index + 1] / 255 * 0.7152 + frame[index + 2] / 255 * 0.0722;
}

function simpleEdgeAt(frame, x, y, width, height, pixelIndex, light) {
  const rightLight = x < width - 1 ? lumaAt(frame, pixelIndex + 4) : light;
  const downLight = y < height - 1 ? lumaAt(frame, pixelIndex + width * 4) : light;
  return clamp01((Math.abs(light - rightLight) + Math.abs(light - downLight)) * 3.2);
}

function sobelAt(frame, x, y, width, height) {
  return clamp01(sobelVectorAt(frame, x, y, width, height).mag * 1.15);
}

function sobelVectorAt(frame, x, y, width, height) {
  const tl = lumaXY(frame, width, height, x - 1, y - 1);
  const tc = lumaXY(frame, width, height, x, y - 1);
  const tr = lumaXY(frame, width, height, x + 1, y - 1);
  const ml = lumaXY(frame, width, height, x - 1, y);
  const mr = lumaXY(frame, width, height, x + 1, y);
  const bl = lumaXY(frame, width, height, x - 1, y + 1);
  const bc = lumaXY(frame, width, height, x, y + 1);
  const br = lumaXY(frame, width, height, x + 1, y + 1);
  const gx = -tl - ml * 2 - bl + tr + mr * 2 + br;
  const gy = -tl - tc * 2 - tr + bl + bc * 2 + br;
  return {
    gx,
    gy,
    mag: Math.sqrt(gx * gx + gy * gy),
  };
}

function copySpectrumSegment(pointPositions, pointColors, linePositions, lineColors, fromHistory, fromBand, toHistory, toBand, lineOffset) {
  const fromIndex = (fromHistory * SPECTRUM_BANDS + fromBand) * 3;
  const toIndex = (toHistory * SPECTRUM_BANDS + toBand) * 3;
  linePositions[lineOffset] = pointPositions[fromIndex];
  linePositions[lineOffset + 1] = pointPositions[fromIndex + 1];
  linePositions[lineOffset + 2] = pointPositions[fromIndex + 2];
  lineColors[lineOffset] = pointColors[fromIndex] * 0.78;
  lineColors[lineOffset + 1] = pointColors[fromIndex + 1] * 0.78;
  lineColors[lineOffset + 2] = pointColors[fromIndex + 2] * 0.78;
  linePositions[lineOffset + 3] = pointPositions[toIndex];
  linePositions[lineOffset + 4] = pointPositions[toIndex + 1];
  linePositions[lineOffset + 5] = pointPositions[toIndex + 2];
  lineColors[lineOffset + 3] = pointColors[toIndex] * 0.78;
  lineColors[lineOffset + 4] = pointColors[toIndex + 1] * 0.78;
  lineColors[lineOffset + 5] = pointColors[toIndex + 2] * 0.78;
  return lineOffset + 6;
}

function lumaXY(frame, width, height, x, y) {
  const safeX = clamp(Math.round(x), 0, width - 1);
  const safeY = clamp(Math.round(y), 0, height - 1);
  return lumaAt(frame, (safeY * width + safeX) * 4);
}

function contourAt(light, density) {
  const wave = Math.abs((light * density) % 1 - 0.5);
  return smoothstep(0.075, 0.0, wave);
}

function hash01(value) {
  const raw = Math.sin(value) * 43758.5453123;
  return raw - Math.floor(raw);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function clamp01(value) {
  return clamp(value, 0, 1);
}

function lerp(from, to, amount) {
  return from + (to - from) * amount;
}

function smoothstep(edge0, edge1, value) {
  const x = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return x * x * (3 - 2 * x);
}

function isCoarsePointer() {
  return window.matchMedia?.('(pointer: coarse)').matches ?? false;
}
