const BARS = 10;
const MONITOR_BARS = 6;

export function createHud({ root, modeLabel, audioMeter, bandMeter, perfLabel, modeFlash, frequencyMonitor, modeButtons }) {
  let hideTimer = 0;
  let flashTimer = 0;
  let hiddenByUser = false;

  function show() {
    if (hiddenByUser) return;
    root.classList.remove('is-hidden');
    root.classList.remove('is-dimmed');
    window.clearTimeout(hideTimer);
  }

  function update({ modeName, volume, audio, intensity, densityLabel, performanceLabel, visibleLabel, modeIndex }) {
    modeLabel.textContent = `MODE: ${modeName} / ${densityLabel} / ${Math.round(intensity * 100)}%`;
    setSelectedMode(modeName, modeIndex);
    const active = Math.round(volume * BARS);
    if (audioMeter) audioMeter.textContent = `${'█'.repeat(active)}${'░'.repeat(BARS - active)}`;
    if (bandMeter) bandMeter.textContent = `B ${miniBar(audio.bassEnergy)}  M ${miniBar(audio.midEnergy)}  H ${miniBar(audio.highEnergy)}`;
    if (perfLabel) perfLabel.textContent = `${performanceLabel} / ${visibleLabel}`;
    updateFrequencyMonitor(frequencyMonitor, audio, modeIndex);
  }

  function setSelectedMode(modeName, modeIndex) {
    modeButtons.forEach((button) => {
      const selected = Number(button.dataset.mode) === modeIndex;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    modeLabel.textContent = `MODE: ${modeName}`;
  }

  return {
    show,
    update,
    setSelectedMode,
    announceMode(modeName) {
      modeFlash.textContent = modeName;
      modeFlash.classList.remove('is-hidden');
      window.clearTimeout(flashTimer);
      flashTimer = window.setTimeout(() => {
        modeFlash.classList.add('is-hidden');
      }, 1250);
    },
    toggleVisibility() {
      hiddenByUser = !hiddenByUser;
      window.clearTimeout(hideTimer);
      root.classList.toggle('is-hidden', hiddenByUser);
      if (!hiddenByUser) show();
    },
    reset() {
      hiddenByUser = false;
      window.clearTimeout(hideTimer);
      root.classList.add('is-hidden');
      root.classList.remove('is-dimmed');
      frequencyMonitor?.root?.classList.remove('is-active');
    },
  };
}

function miniBar(value) {
  const active = Math.round(Math.max(0, Math.min(1, value)) * 4);
  return `${'▮'.repeat(active)}${'·'.repeat(4 - active)}`;
}

function updateFrequencyMonitor(monitor, audio, modeIndex) {
  if (!monitor?.root) return;
  monitor.root.classList.toggle('is-active', modeIndex === 1);
  if (modeIndex !== 1) return;

  monitor.peak.textContent = formatFrequency(audio.peakHz);
  monitor.centroid.textContent = formatFrequency(audio.spectralCentroidHz);
  monitor.flux.textContent = `${Math.round(clamp(audio.spectralFluxPercent, 0, 100))}%`;
  monitor.bass.textContent = blockGauge(audio.bandGauges?.bass || 0);
  monitor.mid.textContent = blockGauge(audio.bandGauges?.mid || 0);
  monitor.high.textContent = blockGauge(audio.bandGauges?.high || 0);
  monitor.status.textContent = audio.inputStatus || '';
  monitor.status.classList.toggle('is-visible', Boolean(audio.inputStatus));
}

function formatFrequency(value) {
  if (!value || value < 1) return '-- Hz';
  if (value < 1000) return `${Math.round(value)} Hz`;
  return `${(value / 1000).toFixed(value < 10000 ? 1 : 0)} kHz`;
}

function blockGauge(value) {
  const active = Math.round(clamp(value, 0, 1) * MONITOR_BARS);
  return `${'█'.repeat(active)}${'░'.repeat(MONITOR_BARS - active)}`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
