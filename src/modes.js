export const MODES = [
  {
    id: 0,
    name: 'POINT CLOUD',
    depth: 3.9,
    edgeDepth: 1.15,
    darkGate: 0.015,
    spread: 2.3,
    cameraZ: 5.8,
    persistence: 0,
  },
  {
    id: 1,
    name: 'FREQUENCY SCAN',
    depth: 4.55,
    edgeDepth: 0.9,
    darkGate: 0.01,
    spread: 2.2,
    cameraZ: 5.95,
    persistence: 0,
  },
  {
    id: 2,
    name: 'LINE SCAN',
    depth: 2.9,
    edgeDepth: 2.2,
    darkGate: 0.012,
    spread: 2.35,
    cameraZ: 6.15,
    persistence: 0,
  },
  {
    id: 3,
    name: 'CYMATIC PLATE',
    depth: 0.46,
    edgeDepth: 0.18,
    darkGate: 0.006,
    spread: 2.5,
    cameraZ: 6.4,
    persistence: 0,
  },
];

export const SAMPLE_PRESETS = [
  { label: 'LOW', width: 64, height: 96 },
  { label: 'MID', width: 96, height: 128 },
  { label: 'HIGH', width: 112, height: 160 },
];
