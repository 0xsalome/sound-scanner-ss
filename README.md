# Sound Scanner

[English](README.md) | [日本語](README.ja.md)

[Live Demo](https://sound-scanner-nine.vercel.app/)

Sound Scanner is an experimental field visualizer for the mobile web. It uses a smartphone's live camera and microphone to render changes in surrounding light, form, and sound as point clouds, scan lines, contours, trails, noise, and ripple-like patterns.

It is not a tool for measuring space or sound as exact values. Its purpose is to treat environmental activity as something that can be observed again — natural soundscapes, outdoor agricultural environments, satoyama landscapes, fields, woods, wind, water, insects, birds, work sounds, and machinery that would normally recede into the background — by visualizing the relationships between sound, light, form, and movement in real time, as cues for experimental field recording and environmental observation.

## How It Works

Microphone input passes through the Web Audio API's `AnalyserNode` and is analyzed as frequency data derived from an FFT (Fast Fourier Transform): volume, frequency-band energy, peak frequency, spectral centroid, and spectral flux. From the camera feed, the app extracts brightness, color saturation, local edge contrast, and frame-to-frame motion.

These signals combine into a pseudo-depth field and drive point-cloud depth and movement, point size and brightness, scan speed, noise and contour response, trails, shockwaves, and particle motion: bass pushes the field forward, mids add movement, highs introduce fine noise, peaks trigger shockwaves, spectral centroid shifts color, and spectral flux adds instability.

Sounds with dispersed frequency components and rapid variation make point clouds and lines fluctuate unpredictably, appearing as noise and turbulence. By contrast, sounds with regular periodicity or stable frequency bands appear as waves, repetition, nodal structures, and coherent particle motion. Rather than measuring order and disorder in sound as direct numerical values, Sound Scanner makes them observable through visual behavior.

## Not a Measuring Instrument

Sound Scanner is not a real LiDAR, sonar, calibrated frequency meter, or environmental measuring instrument. It does not use iPhone LiDAR, ARKit, WebXR Depth Sensing, or a cloud vision service. Its depth, frequency displays, and ripple-like patterns are pseudo-visualizations based on video and audio processed entirely on the device.

## Features

- iPhone Safari-first static web app
- Rear camera capture with `MediaDevices.getUserMedia`
- Microphone analysis with Web Audio API `AnalyserNode`
- Volume, frequency-band energy, peak frequency, spectral centroid, and spectral flux derived from FFT analysis
- Three.js `BufferGeometry` point cloud rendering
- Four modes: Point Cloud, Frequency Scan, Line Scan, Cymatic Plate
- Touch swipe controls for effect intensity and point density
- In-app visual recording with optional microphone audio on supported browsers
- No server processing, login, database, or media upload

The grain field on the entrance screen is generated in real time on a canvas by `src/entrance-grain.js`; it is not a static image. The only static image committed to this repository is the project-owned `assets/icons/favicon.png`.

## Modes

### Point Cloud

The default mode. This keeps the live camera RGB as the primary visual source and turns each sampled pixel into a point in 3D space. Brightness, saturation, edge contrast, frame motion, and bass energy create a pseudo-depth field.

### Frequency Scan

<p align="center">
  <img src="assets/readme/IMG_9305.jpg" alt="Frequency Scan mode" width="480">
</p>

An audio-forward scan mode for music environments. It still uses the camera point cloud, but sound analysis becomes more visible:

- bass pushes the point field forward and creates heavy pulses
- mid energy bends the cloud sideways and adds wave interference
- high energy sharpens scan lines, point size, and jitter
- peak/onset events create restrained shockwave-like bands and ghost trails
- spectral centroid warms or cools the scan tint
- spectral flux speeds up scanning and adds instability when the sound changes quickly
- compressed frequency bands feed a spectrum ribbon in the scene
- recent frequency history is rendered as a lightweight waterfall / spectrogram layer
- stronger peak events can trigger small, fading frequency shockwaves in this mode only
- desktop and landscape screens spread the spectrum layer wider so low, mid, and high bands read across the field

The goal is not a bar-graph spectrum. The spectrum is embedded into the scanned space as waves, pulses, and layers.

Frequency Scan also shows a small Frequency Monitor on the left side. It is a visual aid for sensing that the microphone frequency analysis is active:

- `ピーク` (peak): the currently strongest frequency bin, converted from FFT bin index to Hz
- `重心` (centroid): spectral centroid, calculated as the weighted average of bin frequency and bin energy
- `変動` (flux): spectral flux-like change amount, calculated from the difference between the current and previous frequency frames
- `低域` (low): 20-250 Hz energy
- `中域` (mid): 250-4000 Hz energy
- `高域` (high): 4000-12000 Hz energy

The peak value is not a claim that the sound source is exactly that frequency. For example, `ピーク 86 Hz` means the phone microphone currently sees stronger energy around the FFT bin near 86 Hz than in the other monitored bins. Phone microphones, automatic gain behavior, venue reflections, wind, distance from the source, and clipping can make the values move. Treat the monitor as an observation log and visual guide, not as a precision measurement instrument.

### Line Scan

A contour-observation mode. The app computes luminance and a lightweight Sobel-style edge map from the sampled camera frame, then renders the result as dark lines on a pale field. It also adds contour-line structure from posterized luminance.

- bass thickens and pushes the line field
- mid gently warps the drawing
- high adds fine line noise and extra detail
- desktop and landscape screens use a wider, flatter layout so the mode reads more like a drawing plane or observation map
- peaks temporarily darken and multiply contour detail

This mode is meant to feel closer to a sketch, map, or field diagram than a camera filter.

### Cymatic Plate

<p align="center">
  <img src="assets/readme/IMG_9302.jpg" alt="Cymatic Plate mode particle pattern" width="720">
  <img src="assets/readme/IMG_9303.jpg" alt="Cymatic Plate mode ripple pattern" width="720">
</p>

A particle-field mode inspired by cymatics and Chladni figures. FFT-derived frequency energy selects and excites mathematical nodal patterns, while bass, mids, highs, peaks, and spectral centroid influence particle motion and pattern transitions.

This is an expressive real-time model rather than a physical simulation of a vibrating plate. It does not model material properties, boundary conditions, transducer placement, or calibrated resonance frequencies. Changes detected through audio analysis are translated into visual patterns resembling nodal lines, ripples, rings, fluctuations, and particle motion.

## Controls

- Mode selector: tap/click `POINT`, `FREQ`, `LINE`, or `CYMATIC`
- Touch swipe up/down: increase or decrease effect intensity
- Touch swipe left/right: lower or raise point density
- Debug panel: press `D` on a keyboard, or tap the top-left corner four times quickly

Keyboard controls on desktop:

- Arrow up/down: effect intensity
- Arrow left/right: point density / quality

Point density presets:

- Mobile portrait: 64 x 96 / 96 x 128 / 112 x 160
- Mobile landscape: 96 x 64 / 128 x 96 / 160 x 112
- Desktop landscape: 128 x 96 / 160 x 120 / 192 x 144

MID is the recommended starting point for iPhone Safari; the default MID preset renders 12,288 camera-derived points.

## Recording

Use `REC` in the HUD to record the live visual output. Tap `STOP REC` to finish.

- The app records the rendered visual canvas, not the raw camera feed.
- If microphone permission is active, the microphone track is attached to the recording.
- When H.264/AAC WebCodecs support is available, the app creates a non-fragmented MP4 with explicit 30 fps timestamps for compatibility with photo editors and social platforms.
- Browsers without the required WebCodecs encoders fall back to `MediaRecorder`; those files may require conversion before some editors or platforms accept them.
- On iPhone, supported browsers should offer the share sheet for saving the video.
- On desktop, the browser downloads the recorded file.
- If in-app recording is unavailable or unstable on a specific iPhone/iOS version, use iPhone's built-in Screen Recording from Control Center.
- Recording is processed locally. Camera, microphone, and recorded video data are not uploaded by this project.

## Setup

Requires Node.js 20.19 or newer and pnpm 10.

```bash
pnpm install
pnpm dev       # start the dev server, then open the local URL shown by Vite
pnpm build     # build the static app
pnpm preview   # preview the production build
```

Dependency policy: this project uses `pnpm`, and new package releases are held back for 3 days before installation (`minimumReleaseAge: 4320` in `pnpm-workspace.yaml`).

The [live demo](https://sound-scanner-nine.vercel.app/) is deployed separately; this public source repository is not connected to the production Vercel project.

## iPhone Device Testing

Camera and microphone permissions require a secure context (HTTPS).

Recommended options:

1. Serve the app over HTTPS from a preview deployment.
2. Use a local HTTPS tunnel from your Mac to the Vite dev server.
3. For same-network testing, expose the Vite server with `pnpm dev` and open the Mac LAN address from the iPhone. Browser permission behavior can vary when not using HTTPS, so HTTPS is the recommended route.

On iPhone:

1. Open the app in Safari.
2. Tap `Start`.
3. Allow camera access.
4. Allow microphone access.
5. Point the rear camera at lights, people, or scenery and play sound nearby.

If permissions fail:

- Make sure the page is HTTPS.
- In Safari, check website settings for camera and microphone permission.
- Reload the page after changing permission.
- If another app is using the camera or microphone, close it and try again.
- If microphone permission is unavailable, the app can still show the camera point cloud with a subtle fallback motion.

## Known Constraints

- The point cloud is generated from low-resolution camera sampling, brightness, color, and audio data — not from LiDAR, WebXR Depth Sensing, or any depth sensor.
- iOS Safari requires user interaction before camera, microphone, and AudioContext startup.
- On desktop, `facingMode: environment` may not exist; the app falls back to the default webcam.
- Higher point density can increase heat and battery use on older iPhones.
- In-app recording uses WebCodecs when compatible H.264/AAC encoders are available and falls back to `MediaRecorder`, so support and long-recording stability can vary by iOS/Safari version.
- Compatible MP4 recording uses an in-memory output buffer, so very long recordings can use substantial memory on mobile devices.
- There is no cloud storage, SNS posting, MIDI, NDI, or TouchDesigner integration.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development and device-testing requirements.

Security issues should be reported through the process in [SECURITY.md](SECURITY.md).

Runtime dependency notices are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## License

Sound Scanner is licensed under the [MIT License](LICENSE).

Third-party libraries remain under their respective licenses. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
