# Contributing

## Development

Requirements:

- Node.js 20.19 or newer
- pnpm 10

Install dependencies and run the app:

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Before submitting a change:

```bash
pnpm build
pnpm audit --audit-level high
```

## Recording Changes

Recording behavior depends on browser media APIs and must be tested on a real device.

For changes to `src/recorder.js`, verify:

- iPhone Safari recording with and without microphone audio
- portrait and landscape orientation
- Photos import, edit, and save
- upload to at least one strict social platform
- H.264 video and AAC-LC audio in a non-fragmented MP4
- 30 fps video timestamps without decode or DTS errors

Keep original test recordings, repaired media, personal photos, and device exports out of Git.

## Pull Requests

- Keep changes focused and explain user-visible behavior.
- Include the devices and browser versions used for media testing.
- Do not commit credentials, personal media, generated recordings, or build output.
