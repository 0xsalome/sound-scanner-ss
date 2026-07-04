import './style.css';
import { CameraSampler } from './camera.js';
import { AudioScanner } from './audio.js';
import { SoundScannerRenderer } from './renderer.js';
import { createInputController } from './input.js';
import { createHud } from './ui.js';
import { EntranceGrainField } from './entrance-grain.js';
import { VisualRecorder } from './recorder.js';

const canvas = document.querySelector('#webgl-canvas');
const entranceCanvas = document.querySelector('#entrance-grain');
const startScreen = document.querySelector('#start-screen');
const startButton = document.querySelector('#start-button');
const statusEl = document.querySelector('#status');
const debugPanel = document.querySelector('#debug-panel');
const paletteButton = document.querySelector('#palette-button');
const recordButton = document.querySelector('#record-button');
const stopButton = document.querySelector('#stop-button');
const cymaticDebug = {
  root: document.querySelector('#cymatic-debug'),
  peak: document.querySelector('#cym-peak'),
  mode: document.querySelector('#cym-mode'),
  resonance: document.querySelector('#cym-resonance'),
};
const modeButtons = [...document.querySelectorAll('[data-mode]')];
const secureContext = window.isSecureContext || ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
const debugAudioVisible = new URLSearchParams(window.location.search).get('debugAudio') === '1';
const audioDebugPanel = debugAudioVisible ? createAudioDebugPanel() : null;

const camera = new CameraSampler();
const audio = new AudioScanner();
const renderer = new SoundScannerRenderer(canvas);
const entranceGrain = new EntranceGrainField(entranceCanvas);
entranceGrain.start();
const recorder = new VisualRecorder({
  button: recordButton,
  status: statusEl,
  getSourceCanvas: () => renderer.getRecordingSourceCanvas(),
  getAudioStream: () => audio.stream,
  drawOverlay: drawRecordingOverlay,
});
const hud = createHud({
  root: document.querySelector('#hud'),
  modeLabel: document.querySelector('#mode-label'),
  audioMeter: document.querySelector('#audio-meter'),
  bandMeter: document.querySelector('#band-meter'),
  perfLabel: document.querySelector('#perf-label'),
  modeFlash: document.querySelector('#mode-flash'),
  frequencyMonitor: {
    root: document.querySelector('#frequency-monitor'),
    peak: document.querySelector('#freq-peak'),
    centroid: document.querySelector('#freq-centroid'),
    flux: document.querySelector('#freq-flux'),
    bass: document.querySelector('#freq-bass'),
    mid: document.querySelector('#freq-mid'),
    high: document.querySelector('#freq-high'),
    status: document.querySelector('#freq-status'),
  },
  modeButtons,
});
updateDocumentMode();

let running = false;
let lastHudUpdate = 0;
let rafId = 0;
let lastSampleTime = 0;
let lastFrame = null;
let latestAudioState = null;
let debugVisible = false;
let cornerTapCount = 0;
let cornerTapTimer = 0;

const input = createInputController(canvas, {
  onLongPress: () => hud.show(),
  onSwipeVertical: (direction) => {
    renderer.adjustIntensity(direction === 'up' ? 0.12 : -0.12);
    hud.show();
  },
  onSwipeHorizontal: (direction) => {
    renderer.adjustDensity(direction === 'right' ? 1 : -1);
    hud.show();
  },
});

modeButtons.forEach((button) => {
  button.addEventListener('click', () => {
    selectMode(Number(button.dataset.mode));
  });
});

paletteButton?.addEventListener('click', () => {
  const label = renderer.nextColorPalette();
  paletteButton.textContent = `COLOR: ${label}`;
  hud.show();
});

stopButton?.addEventListener('click', () => {
  stopApp();
});

startButton.addEventListener('click', async () => {
  await startApp();
});

startScreen.addEventListener('click', async (event) => {
  if (event.target === startButton) return;
  if (event.target.closest('.project-links')) return;
  await startApp();
});

async function startApp() {
  if (running) return;
  startButton.disabled = true;
  statusEl.textContent = 'カメラとマイクを準備しています...';

  try {
    assertStartupSupport();
    await camera.start();
    const audioReady = await audio.start();
    const preferredSample = renderer.pickSampleSize(renderer.densityIndex);
    renderer.setSampleSize(preferredSample.width, preferredSample.height);
    lastFrame = await waitForFirstCameraFrame();
    if (!lastFrame) {
      const error = new Error('Camera permission succeeded, but no pixel data was received.');
      error.code = 'NO_CAMERA_FRAME';
      throw error;
    }
    renderer.setAudioAvailable(audioReady);
    renderer.start();
    input.enable();
    running = true;
    startScreen.classList.add('is-dismissed');
    entranceGrain.stop();
    updateDocumentMode();
    hud.show();
    statusEl.textContent = audioReady ? '' : '音声入力なしで起動中です。マイク許可を確認してください。';
    rafId = requestAnimationFrame(tick);
  } catch (error) {
    console.error(error);
    startButton.disabled = false;
    statusEl.textContent = getStartupMessage(error);
  }
}

function stopApp() {
  if (!running) return;
  running = false;
  window.cancelAnimationFrame(rafId);
  input.disable();
  renderer.pause();
  if (recorder.isRecording) recorder.stop();
  camera.stop();
  audio.stop();
  lastFrame = null;
  lastSampleTime = 0;
  lastHudUpdate = 0;
  startButton.disabled = false;
  startScreen.classList.remove('is-dismissed');
  entranceGrain.start();
  hud.reset();
  statusEl.textContent = '';
  debugPanel.classList.add('is-hidden');
  if (audioDebugPanel) audioDebugPanel.textContent = '';
  debugVisible = false;
  cymaticDebug.root?.classList.remove('is-active');
}

window.addEventListener('resize', () => renderer.resize(), { passive: true });
window.addEventListener('orientationchange', () => {
  setTimeout(() => renderer.resize(), 250);
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    renderer.pause();
    window.cancelAnimationFrame(rafId);
  } else if (running) {
    audio.resume();
    renderer.start();
    rafId = requestAnimationFrame(tick);
  }
});
window.addEventListener('keydown', (event) => {
  const key = event.key.toLowerCase();
  if (key === 'd') toggleDebug();
  if (event.key === 'ArrowUp') {
    renderer.adjustIntensity(0.12);
    hud.show();
  }
  if (event.key === 'ArrowDown') {
    renderer.adjustIntensity(-0.12);
    hud.show();
  }
  if (event.key === 'ArrowLeft') {
    renderer.adjustDensity(-1);
    hud.show();
  }
  if (event.key === 'ArrowRight') {
    renderer.adjustDensity(1);
    hud.show();
  }
});
canvas.addEventListener('pointerdown', (event) => {
  if (event.clientX > 72 || event.clientY > 72) return;
  cornerTapCount += 1;
  window.clearTimeout(cornerTapTimer);
  cornerTapTimer = window.setTimeout(() => {
    cornerTapCount = 0;
  }, 650);
  if (cornerTapCount >= 4) {
    cornerTapCount = 0;
    toggleDebug();
  }
}, { passive: true });

function tick(time) {
  if (!running) return;

  if (!lastFrame || time - lastSampleTime >= renderer.sampleIntervalMs) {
    lastFrame = camera.readFrame(renderer.sampleWidth, renderer.sampleHeight) || lastFrame;
    lastSampleTime = time;
  }
  const audioState = audio.update();
  latestAudioState = audioState;
  renderer.renderFrame(lastFrame, audioState, time);
  recorder.captureFrame(time);

  if (time - lastHudUpdate > 110) {
    hud.update({
      modeName: renderer.modeName,
      volume: audioState.smoothedVolume,
      audio: audioState,
      intensity: renderer.intensity,
      densityLabel: renderer.densityLabel,
      performanceLabel: renderer.performanceLabel,
      visibleLabel: `${renderer.visiblePointCount} pts`,
      modeIndex: renderer.modeIndex,
    });
    updateRuntimeStatus(audioState);
    updateDebug(audioState);
    updateAudioDebug(audioState);
    updateCymaticDebug(audioState);
    lastHudUpdate = time;
  }

  rafId = requestAnimationFrame(tick);
}

function selectMode(modeIndex) {
  renderer.setMode(modeIndex);
  updateDocumentMode();
  ensureAudioForCurrentMode();
  hud.setSelectedMode(renderer.modeName, renderer.modeIndex);
  hud.announceMode(renderer.modeName);
  hud.show();
}

async function ensureAudioForCurrentMode() {
  if (renderer.modeIndex !== 3) return;
  try {
    await audio.resume();
    if (!audio.available) {
      const audioReady = await audio.start();
      renderer.setAudioAvailable(audioReady);
    }
  } catch (error) {
    console.warn('Unable to enable cymatic audio input', error);
  }
}

function updateDocumentMode() {
  document.body.dataset.scanMode = String(renderer.modeIndex);
  document.body.classList.toggle('ui-light', renderer.modeIndex === 2);
  document.body.classList.toggle('ui-paper', false);
  document.body.classList.toggle('ui-cymatic', renderer.modeIndex === 3);
}

function assertStartupSupport() {
  if (!secureContext) {
    const error = new Error('Sound Scanner needs HTTPS for camera and microphone access.');
    error.code = 'INSECURE_CONTEXT';
    throw error;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    const error = new Error('MediaDevices.getUserMedia is not available.');
    error.code = 'MEDIA_UNSUPPORTED';
    throw error;
  }
}

function getStartupMessage(error) {
  if (error?.code === 'INSECURE_CONTEXT') {
    return 'HTTPS で開いてください。iPhone Safari ではカメラとマイクに HTTPS が必要です。';
  }

  if (error?.code === 'MEDIA_UNSUPPORTED') {
    return 'このブラウザではカメラ/マイク入力を利用できません。iPhone Safari または Chrome で試してください。';
  }

  if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
    return 'カメラまたはマイクの許可が拒否されました。Safari のサイト設定から許可を確認してください。';
  }

  if (error?.name === 'NotFoundError' || error?.name === 'DevicesNotFoundError') {
    return 'カメラまたはマイクが見つかりません。別のブラウザか端末で試してください。';
  }

  if (error?.code === 'NO_CAMERA_FRAME') {
    return 'カメラ許可は成功しましたが映像データを読み取れません。Safari のカメラ許可を確認して再読み込みしてください。';
  }

  if (error?.name === 'NotReadableError') {
    return 'カメラまたはマイクを開始できません。他のアプリが使用中でないか確認してください。';
  }

  return 'カメラまたはマイクを開始できませんでした。HTTPS とブラウザ許可を確認してください。';
}

async function waitForFirstCameraFrame() {
  const startedAt = performance.now();
  while (performance.now() - startedAt < 2200) {
    const frame = camera.readFrame(renderer.sampleWidth, renderer.sampleHeight);
    if (frame?.length) return frame;
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
  return null;
}

function toggleDebug() {
  debugVisible = !debugVisible;
  debugPanel.classList.toggle('is-hidden', !debugVisible);
}

function updateDebug(audioState) {
  if (!debugVisible) return;
  debugPanel.textContent = [
    `camera ready: ${camera.ready && Boolean(lastFrame)}`,
    `audio ready: ${audioState.hasInput}`,
    `point count: ${renderer.pointCount}`,
    `visible: ${renderer.visibleStatsLabel}`,
    `sample resolution: ${renderer.sampleResolutionLabel}`,
    `fps: ${renderer.performanceLabel.replace('FPS ', '')}`,
    `bass: ${audioState.bassEnergy.toFixed(3)}`,
    `mid: ${audioState.midEnergy.toFixed(3)}`,
    `high: ${audioState.highEnergy.toFixed(3)}`,
    `volume: ${audioState.overallVolume.toFixed(3)}`,
    `centroid: ${audioState.spectralCentroid.toFixed(3)}`,
    `centroid hz: ${audioState.spectralCentroidHz.toFixed(1)}`,
    `peak hz: ${audioState.peakHz.toFixed(1)}`,
    `flux: ${audioState.spectralFlux.toFixed(3)}`,
    `flux percent: ${audioState.spectralFluxPercent.toFixed(1)}`,
    `mode: ${renderer.modeName}`,
  ].join('\n');
}

function createAudioDebugPanel() {
  const panel = document.createElement('pre');
  panel.className = 'audio-debug-panel';
  panel.setAttribute('aria-live', 'polite');
  document.body.append(panel);
  return panel;
}

function updateAudioDebug(audioState) {
  if (!audioDebugPanel) return;
  const debug = audioState.debug || {};
  const status = debug.trackMuted
    ? 'muted'
    : audioState.overallVolume < 0.01 && audioState.rawRMS < 0.003
      ? 'silent'
      : 'active';

  audioDebugPanel.textContent = [
    `MIC: ${status} / ${audioState.audioProfile}`,
    `track: ${debug.trackReadyState || 'none'} enabled:${debug.trackEnabled ? 'yes' : 'no'} muted:${debug.trackMuted ? 'yes' : 'no'} stream:${debug.streamActive ? 'active' : 'inactive'}`,
    `rawRMS: ${formatAudioDebugNumber(audioState.rawRMS)} rawVol: ${formatAudioDebugNumber(audioState.rawVolume)} effective: ${formatAudioDebugNumber(audioState.effectiveVolume)}`,
    `noise: ${formatAudioDebugNumber(audioState.noiseFloor)} norm: ${formatAudioDebugNumber(audioState.normalizedVolume)} visual: ${formatAudioDebugNumber(audioState.visualVolume)} peak: ${formatAudioDebugNumber(audioState.peakLevel)}`,
    `muteAt: ${formatAudioDebugTime(debug.lastMuteAt)} unmuteAt: ${formatAudioDebugTime(debug.lastUnmuteAt)}`,
    `settings: ${formatAudioSettings(debug.trackSettings)}`,
  ].join('\n');
}

function formatAudioDebugNumber(value) {
  return Number.isFinite(value) ? value.toFixed(4) : '0.0000';
}

function formatAudioDebugTime(value) {
  if (!value) return '-';
  return `${((performance.now() - value) / 1000).toFixed(1)}s ago`;
}

function formatAudioSettings(settings = {}) {
  const keys = ['sampleRate', 'sampleSize', 'channelCount', 'echoCancellation', 'noiseSuppression', 'autoGainControl', 'latency', 'volume'];
  const summary = {};
  keys.forEach((key) => {
    if (settings[key] !== undefined) summary[key] = settings[key];
  });
  return JSON.stringify(summary);
}

function updateCymaticDebug(audioState) {
  if (!cymaticDebug.root) return;
  const active = renderer.modeIndex === 3;
  cymaticDebug.root.classList.toggle('is-active', active);
  if (!active) return;

  const rows = getCymaticDebugRows(audioState);
  cymaticDebug.peak.textContent = rows.peak;
  cymaticDebug.mode.textContent = rows.mode;
  cymaticDebug.resonance.textContent = rows.resonance;
}

function drawRecordingOverlay(ctx, recordingCanvas) {
  if (renderer.modeIndex !== 3) return;
  drawCymaticDebugRecordingOverlay(ctx, recordingCanvas, latestAudioState);
}

function drawCymaticDebugRecordingOverlay(ctx, recordingCanvas, audioState) {
  const root = cymaticDebug.root;
  if (!root) return;
  const rect = root.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;

  const width = recordingCanvas.width;
  const height = recordingCanvas.height;
  const scaleX = width / Math.max(1, window.innerWidth);
  const scaleY = height / Math.max(1, window.innerHeight);
  const left = rect.left * scaleX;
  const top = rect.top * scaleY;
  const panelWidth = rect.width * scaleX;
  const panelHeight = rect.height * scaleY;
  const style = getComputedStyle(root);
  const debugRows = getCymaticDebugRows(audioState);
  const rows = [
    ['cymatics mode', ''],
    ['peak', debugRows.peak],
    ['mode', debugRows.mode],
    ['resonance', debugRows.resonance],
  ];
  const fontSize = Math.max(10, Number.parseFloat(style.fontSize || '10') * scaleY);
  const lineHeight = Number.parseFloat(style.lineHeight || '') * scaleY || fontSize * 1.28;
  const paddingTop = Number.parseFloat(style.paddingTop || '10') * scaleY;
  const paddingLeft = Number.parseFloat(style.paddingLeft || '12') * scaleX;
  const paddingRight = Number.parseFloat(style.paddingRight || '12') * scaleX;
  const rowGap = Number.parseFloat(style.gap || '3') * scaleY;
  const contentLeft = left + paddingLeft;
  const valueX = left + panelWidth - paddingRight;

  ctx.save();
  ctx.globalAlpha = 0.92;
  ctx.fillStyle = style.backgroundColor || 'rgba(248, 244, 236, 0.74)';
  ctx.fillRect(left, top, panelWidth, panelHeight);
  ctx.fillStyle = style.borderLeftColor || 'rgba(44, 46, 42, 0.26)';
  ctx.fillRect(left, top, Math.max(1, Number.parseFloat(style.borderLeftWidth || '1') * scaleX), panelHeight);
  ctx.font = `${fontSize}px ${style.fontFamily || 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'}`;
  ctx.textBaseline = 'top';
  ctx.fillStyle = style.color || 'rgba(28, 30, 27, 0.72)';

  rows.forEach(([label, value], index) => {
    const y = top + paddingTop + index * (lineHeight + rowGap);
    ctx.textAlign = 'left';
    ctx.fillText(label, contentLeft, y);
    if (value) {
      ctx.textAlign = 'right';
      ctx.fillText(value, valueX, y);
    }
  });

  ctx.restore();
}

function getCymaticDebugRows(audioState = {}) {
  audioState = audioState || {};
  const state = renderer.cymaticDebug || {};
  return {
    peak: formatHz(audioState.peakHz),
    mode: `${formatHz(state.selectedFreq)} / n${state.selectedN || '-'} m${state.selectedM || '-'}`,
    resonance: (state.resonanceStrength || 0).toFixed(3),
  };
}

function formatHz(value) {
  if (!value || value < 1) return '-- Hz';
  return `${Math.round(value)} Hz`;
}

function updateRuntimeStatus(audioState) {
  if (!running) return;
  if (recorder.hasStatusMessage) return;

  if (!camera.ready || !lastFrame) {
    statusEl.textContent = 'カメラ映像を待っています...';
    return;
  }

  if (renderer.averageBrightness < 0.012) {
    statusEl.textContent = 'カメラ映像が非常に暗いです。明るい光や輪郭に向けると点群が浮かびます。';
    return;
  }

  if (!audioState.hasInput) {
    statusEl.textContent = '音声入力なしで表示中です。マイク許可を確認してください。';
    return;
  }

  statusEl.textContent = '';
}
