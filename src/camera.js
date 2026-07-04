const DEFAULT_WIDTH = 96;
const DEFAULT_HEIGHT = 128;

export class CameraSampler {
  constructor() {
    this.width = DEFAULT_WIDTH;
    this.height = DEFAULT_HEIGHT;
    this.video = document.createElement('video');
    this.video.playsInline = true;
    this.video.muted = true;
    this.video.autoplay = true;
    this.canvas = document.createElement('canvas');
    this.context = this.canvas.getContext('2d', {
      willReadFrequently: true,
      alpha: false,
    });
    this.lastFrame = null;
    this.ready = false;
  }

  async start() {
    const stream = await requestCameraStream();

    this.video.srcObject = stream;
    await this.video.play();
    await waitForVideo(this.video);
    this.resizeSampler(DEFAULT_WIDTH, DEFAULT_HEIGHT);
    this.ready = true;
  }

  stop() {
    this.video.pause();
    this.video.srcObject?.getTracks().forEach((track) => track.stop());
    this.video.srcObject = null;
    this.lastFrame = null;
    this.ready = false;
  }

  resizeSampler(width, height) {
    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;
  }

  readFrame(width = this.width, height = this.height) {
    if (width !== this.width || height !== this.height) {
      this.resizeSampler(width, height);
    }

    if (!this.video.videoWidth || !this.video.videoHeight) {
      return null;
    }

    const source = getCoverSourceRect(this.video.videoWidth, this.video.videoHeight, width, height);
    this.context.drawImage(
      this.video,
      source.x,
      source.y,
      source.width,
      source.height,
      0,
      0,
      width,
      height,
    );

    try {
      this.lastFrame = this.context.getImageData(0, 0, width, height).data;
    } catch (error) {
      console.warn('Camera frame read failed', error);
    }
    return this.lastFrame;
  }
}

function waitForVideo(video) {
  if (video.readyState >= 2) return Promise.resolve();
  return new Promise((resolve) => {
    video.addEventListener('loadeddata', resolve, { once: true });
  });
}

async function requestCameraStream() {
  const baseVideo = {
    width: { ideal: 1280 },
    height: { ideal: 720 },
  };

  try {
    return await navigator.mediaDevices.getUserMedia({
      video: {
        ...baseVideo,
        facingMode: { ideal: 'environment' },
      },
      audio: false,
    });
  } catch (error) {
    if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
      throw error;
    }
    return navigator.mediaDevices.getUserMedia({
      video: baseVideo,
      audio: false,
    });
  }
}

function getCoverSourceRect(videoWidth, videoHeight, targetWidth, targetHeight) {
  const videoRatio = videoWidth / videoHeight;
  const targetRatio = targetWidth / targetHeight;

  if (videoRatio > targetRatio) {
    const width = videoHeight * targetRatio;
    return {
      x: (videoWidth - width) * 0.5,
      y: 0,
      width,
      height: videoHeight,
    };
  }

  const height = videoWidth / targetRatio;
  return {
    x: 0,
    y: (videoHeight - height) * 0.5,
    width: videoWidth,
    height,
  };
}
