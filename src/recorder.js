const RECORDING_FPS = 30;
const FRAME_DURATION = 1 / RECORDING_FPS;
const MAX_PENDING_FRAMES = 4;
const MIME_CANDIDATES = [
  'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
  'video/mp4;codecs="avc1.4D401E,mp4a.40.2"',
  'video/mp4;codecs="avc1.64001F,mp4a.40.2"',
  'video/mp4;codecs=h264,aac',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];
const RECORDER_OPTIONS = {
  videoBitsPerSecond: 8_000_000,
  audioBitsPerSecond: 128_000,
};
let mediabunnyModulePromise = null;

export class VisualRecorder {
  constructor({ button, status, getSourceCanvas, getAudioStream, drawOverlay }) {
    this.button = button;
    this.status = status;
    this.getSourceCanvas = getSourceCanvas;
    this.getAudioStream = getAudioStream;
    this.drawOverlay = drawOverlay;
    this.canvas = document.createElement('canvas');
    this.context = this.canvas.getContext('2d', { alpha: false });
    this.mediaRecorder = null;
    this.stream = null;
    this.chunks = [];
    this.recording = false;
    this.starting = false;
    this.startedAt = 0;
    this.captureStartedAt = null;
    this.lastCaptureAt = 0;
    this.lastDurationLabel = '';
    this.mimeType = '';
    this.messageUntil = 0;
    this.backend = '';
    this.compatibleOutput = null;
    this.compatibleTarget = null;
    this.compatibleVideoSource = null;
    this.compatibleAudioSource = null;
    this.compatibleFramePromises = new Set();
    this.compatibleError = null;
    this.nextFrameIndex = 0;
    this.targetFrameIndex = 0;

    this.supported = Boolean(
      window.VideoEncoder
      || (window.MediaRecorder && this.canvas.captureStream),
    );
    this.updateButton();
    this.button?.addEventListener('click', () => {
      this.toggle().catch((error) => {
        console.error('Recording failed', error);
        this.setMessage(getRecorderErrorMessage(error));
        this.stopTracks();
        this.cancelCompatibleRecording();
        this.recording = false;
        this.updateButton();
      });
    });
  }

  get isRecording() {
    return this.recording;
  }

  get hasStatusMessage() {
    return this.recording || performance.now() < this.messageUntil;
  }

  async toggle() {
    if (this.starting) return;
    if (this.recording) {
      this.stop();
      return;
    }
    await this.start();
  }

  async start() {
    if (!this.supported) {
      this.setMessage('このブラウザではアプリ内録画を利用できません。iPhoneの画面収録を使ってください。');
      return;
    }

    const source = this.getSourceCanvas?.();
    if (!source) {
      this.setMessage('録画できる映像をまだ取得できていません。');
      return;
    }

    this.starting = true;
    this.updateButton();
    try {
      this.resizeCanvas(source);
      this.drawSource(source);
      this.chunks = [];
      const audioStream = this.getAudioStream?.();
      let usingCompatibleRecorder = false;
      try {
        usingCompatibleRecorder = await this.startCompatibleRecording(audioStream);
      } catch (error) {
        console.warn('Compatible MP4 capability check failed; using MediaRecorder fallback.', error);
        await this.cancelCompatibleRecording();
      }
      if (!usingCompatibleRecorder) this.startMediaRecorder(audioStream);

      this.recording = true;
      this.startedAt = performance.now();
      this.captureStartedAt = null;
      this.lastCaptureAt = 0;
      this.lastDurationLabel = '';
      this.setMessage('録画中 00:00');
    } finally {
      this.starting = false;
      this.updateButton();
    }
  }

  stop() {
    if (this.backend === 'compatible') {
      if (!this.recording) return;
      this.recording = false;
      this.updateButton();
      this.setMessage('互換MP4を保存しています...');
      this.compatibleAudioSource?.close();
      this.finishCompatibleRecording().catch((error) => {
        console.error('Unable to save compatible recording', error);
        this.setMessage('録画は終了しましたが互換MP4の保存に失敗しました。');
        this.cancelCompatibleRecording();
      });
      return;
    }

    if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') return;
    this.mediaRecorder.stop();
    this.recording = false;
    this.updateButton();
    this.setMessage('録画を保存しています...');
  }

  captureFrame(time = performance.now()) {
    if (!this.recording) return;
    const frameInterval = 1000 / RECORDING_FPS;
    if (time - this.lastCaptureAt < frameInterval) return;

    const source = this.getSourceCanvas?.();
    if (!source) return;
    this.resizeCanvas(source);
    this.drawSource(source);
    if (this.backend === 'compatible') {
      this.captureCompatibleFrames(time);
    } else {
      this.requestVideoFrame();
    }
    this.lastCaptureAt = time;

    const durationLabel = formatDuration(performance.now() - this.startedAt);
    if (durationLabel !== this.lastDurationLabel) {
      this.lastDurationLabel = durationLabel;
      this.setMessage(`録画中 ${durationLabel}`);
    }
  }

  async startCompatibleRecording(audioStream) {
    if (!window.VideoEncoder) return false;

    const {
      BufferTarget,
      CanvasSource,
      MediaStreamAudioTrackSource,
      Mp4OutputFormat,
      Output,
      canEncodeAudio,
      canEncodeVideo,
    } = await loadMediabunny();
    const audioTrack = getLiveAudioTrack(audioStream);
    const videoSupported = await canEncodeVideo('avc', {
      width: this.canvas.width,
      height: this.canvas.height,
      bitrate: RECORDER_OPTIONS.videoBitsPerSecond,
      framerate: RECORDING_FPS,
      latencyMode: 'quality',
    });
    if (!videoSupported) return false;

    if (audioTrack) {
      const settings = audioTrack.getSettings?.() || {};
      const audioSupported = await canEncodeAudio('aac', {
        numberOfChannels: settings.channelCount || 1,
        sampleRate: settings.sampleRate || 48000,
        bitrate: RECORDER_OPTIONS.audioBitsPerSecond,
      });
      if (!audioSupported) return false;
    }

    try {
      this.compatibleError = null;
      this.compatibleTarget = new BufferTarget();
      this.compatibleOutput = new Output({
        format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
        target: this.compatibleTarget,
      });
      this.compatibleVideoSource = new CanvasSource(this.canvas, {
        codec: 'avc',
        bitrate: RECORDER_OPTIONS.videoBitsPerSecond,
        bitrateMode: 'variable',
        latencyMode: 'quality',
        keyFrameInterval: 2,
        alpha: 'discard',
      });
      this.compatibleOutput.addVideoTrack(this.compatibleVideoSource);

      if (audioTrack) {
        this.compatibleAudioSource = new MediaStreamAudioTrackSource(audioTrack, {
          codec: 'aac',
          bitrate: RECORDER_OPTIONS.audioBitsPerSecond,
          bitrateMode: 'variable',
        });
        this.compatibleAudioSource.errorPromise.catch((error) => {
          this.compatibleError ||= error;
        });
        this.compatibleOutput.addAudioTrack(this.compatibleAudioSource);
      }

      await this.compatibleOutput.start();
      this.backend = 'compatible';
      this.nextFrameIndex = 0;
      this.targetFrameIndex = 0;
      this.addCompatibleFrame();
      return true;
    } catch (error) {
      console.warn('Compatible MP4 recorder unavailable; using MediaRecorder fallback.', error);
      await this.cancelCompatibleRecording();
      return false;
    }
  }

  startMediaRecorder(audioStream) {
    if (!window.MediaRecorder || !this.canvas.captureStream) {
      throw new DOMException('No supported recording backend.', 'NotSupportedError');
    }

    this.backend = 'mediaRecorder';
    this.mimeType = pickMimeType();
    this.stream = this.canvas.captureStream(RECORDING_FPS);
    audioStream?.getAudioTracks?.().forEach((track) => {
      if (track.readyState === 'live') this.stream.addTrack(track);
    });

    const options = this.mimeType ? { ...RECORDER_OPTIONS, mimeType: this.mimeType } : RECORDER_OPTIONS;
    this.mediaRecorder = new MediaRecorder(this.stream, options);
    this.mimeType = this.mediaRecorder.mimeType || this.mimeType;
    this.mediaRecorder.addEventListener('dataavailable', (event) => {
      if (event.data?.size) this.chunks.push(event.data);
    });
    this.mediaRecorder.addEventListener('stop', () => {
      this.finishMediaRecorder().catch((error) => {
        console.error('Unable to save recording', error);
        this.setMessage('録画は終了しましたが保存に失敗しました。');
      });
    }, { once: true });
    this.mediaRecorder.start();
  }

  captureCompatibleFrames(time) {
    if (!this.compatibleVideoSource || this.compatibleError) return;

    this.captureStartedAt ??= time;
    const targetFrameIndex = Math.floor((time - this.captureStartedAt) / (1000 / RECORDING_FPS));
    this.targetFrameIndex = Math.max(this.targetFrameIndex, targetFrameIndex);
    while (
      this.nextFrameIndex <= this.targetFrameIndex
      && this.compatibleFramePromises.size < MAX_PENDING_FRAMES
    ) {
      this.addCompatibleFrame();
    }
  }

  addCompatibleFrame() {
    const frameIndex = this.nextFrameIndex;
    this.nextFrameIndex += 1;
    const promise = this.compatibleVideoSource
      .add(
        frameIndex * FRAME_DURATION,
        FRAME_DURATION,
        { keyFrame: frameIndex % (RECORDING_FPS * 2) === 0 },
      )
      .catch((error) => {
        this.compatibleError ||= error;
      })
      .finally(() => {
        this.compatibleFramePromises.delete(promise);
      });
    this.compatibleFramePromises.add(promise);
  }

  async drainCompatibleFrames() {
    while (this.compatibleFramePromises.size || this.nextFrameIndex <= this.targetFrameIndex) {
      await Promise.all([...this.compatibleFramePromises]);
      if (this.compatibleError) return;
      while (
        this.nextFrameIndex <= this.targetFrameIndex
        && this.compatibleFramePromises.size < MAX_PENDING_FRAMES
      ) {
        this.addCompatibleFrame();
      }
    }
  }

  async finishCompatibleRecording() {
    await this.drainCompatibleFrames();
    if (this.compatibleError) throw this.compatibleError;

    const output = this.compatibleOutput;
    const target = this.compatibleTarget;
    if (!output || !target) throw new Error('Compatible recorder is not initialized.');

    await output.finalize();
    if (!target.buffer?.byteLength) throw new Error('Compatible MP4 output is empty.');

    const blob = new Blob([target.buffer], { type: 'video/mp4' });
    this.resetCompatibleRecording();
    await this.saveBlob(blob, 'mp4', 'video/mp4');
  }

  async finishMediaRecorder() {
    this.stopTracks();
    const extension = getExtensionForMimeType(this.mimeType);
    const type = getBaseMimeType(this.mimeType, extension);
    const blob = new Blob(this.chunks, { type });
    this.chunks = [];

    if (!blob.size) {
      this.setMessage('録画データが空でした。もう一度試してください。');
      return;
    }

    await this.saveBlob(blob, extension, type);
  }

  async saveBlob(blob, extension, type) {
    const fileName = `sound-scanner-${timestampForFile()}.${extension}`;
    if (navigator.share && navigator.canShare && window.File) {
      const file = new File([blob], fileName, { type });
      if (navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: 'Sound Scanner recording' });
          this.setMessage('録画を共有しました。');
          return;
        } catch (error) {
          if (error?.name === 'AbortError') {
            this.setMessage('録画の共有をキャンセルしました。');
            return;
          }
        }
      }
    }

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.rel = 'noopener';
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    this.setMessage(`録画を保存しました: ${fileName}`);
  }

  async cancelCompatibleRecording() {
    const output = this.compatibleOutput;
    this.resetCompatibleRecording();
    if (output && output.state !== 'canceled' && output.state !== 'finalized') {
      try {
        await output.cancel();
      } catch (error) {
        console.warn('Unable to cancel compatible recorder.', error);
      }
    }
  }

  resetCompatibleRecording() {
    this.compatibleOutput = null;
    this.compatibleTarget = null;
    this.compatibleVideoSource = null;
    this.compatibleAudioSource = null;
    this.compatibleFramePromises.clear();
    this.compatibleError = null;
    this.nextFrameIndex = 0;
    this.targetFrameIndex = 0;
    this.captureStartedAt = null;
    this.backend = '';
  }

  resizeCanvas(source) {
    const width = makeEven(source.width || source.clientWidth || window.innerWidth || 2);
    const height = makeEven(source.height || source.clientHeight || window.innerHeight || 2);
    if (this.canvas.width === width && this.canvas.height === height) return;
    this.canvas.width = width;
    this.canvas.height = height;
  }

  drawSource(source) {
    if (!this.context) return;
    this.context.fillStyle = '#020407';
    this.context.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.context.filter = getComputedStyle(source).filter || 'none';
    this.context.drawImage(source, 0, 0, this.canvas.width, this.canvas.height);
    this.context.filter = 'none';
    this.drawOverlay?.(this.context, this.canvas, source);
  }

  requestVideoFrame() {
    const [videoTrack] = this.stream?.getVideoTracks?.() || [];
    videoTrack?.requestFrame?.();
  }

  stopTracks() {
    this.stream?.getTracks().forEach((track) => {
      if (track.kind === 'video') track.stop();
    });
    this.stream = null;
    this.mediaRecorder = null;
    this.backend = '';
  }

  updateButton() {
    if (!this.button) return;
    this.button.disabled = !this.supported || this.starting;
    this.button.classList.toggle('is-recording', this.recording);
    this.button.setAttribute('aria-pressed', String(this.recording));
    this.button.textContent = this.recording ? 'STOP REC' : 'REC';
  }

  setMessage(message) {
    if (!this.status) return;
    this.status.textContent = message;
    this.messageUntil = this.recording ? Number.POSITIVE_INFINITY : performance.now() + 4200;
  }
}

function makeEven(value) {
  const size = Math.max(2, Math.floor(value));
  return size - (size % 2);
}

function getLiveAudioTrack(stream) {
  return stream?.getAudioTracks?.().find((track) => track.readyState === 'live') || null;
}

function loadMediabunny() {
  mediabunnyModulePromise ||= import('mediabunny');
  return mediabunnyModulePromise;
}

function pickMimeType() {
  if (!window.MediaRecorder?.isTypeSupported) return '';
  return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type)) || '';
}

function getBaseMimeType(mimeType, extension) {
  return mimeType.split(';')[0].trim() || `video/${extension}`;
}

function getExtensionForMimeType(mimeType) {
  const baseType = getBaseMimeType(mimeType, 'mp4').toLowerCase();
  if (baseType.includes('webm')) return 'webm';
  return 'mp4';
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function timestampForFile() {
  const now = new Date();
  const parts = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ];
  return `${parts[0]}${parts[1]}${parts[2]}-${parts[3]}${parts[4]}${parts[5]}`;
}

function getRecorderErrorMessage(error) {
  if (error?.name === 'NotSupportedError') {
    return 'このブラウザの録画形式に対応できませんでした。iPhoneの画面収録を使ってください。';
  }
  if (error?.name === 'SecurityError') {
    return '録画を開始できません。HTTPS とブラウザ権限を確認してください。';
  }
  return '録画を開始できませんでした。短い録画でもう一度試してください。';
}
