# Sound Scanner 全面リファクタリング実装計画

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 挙動を一切変えずに、renderer.js の神ファイル解体・重複コード統合・テスト基盤整備を段階的に行い、保守可能なコードベースにする。

**Architecture:** 「安全網を先に張る → 純粋関数から抽出 → モードをストラテジー化」の順で、常にビルド可能・常にデモ確認可能な状態を保ちながら小さくコミットを積む。描画結果はピクセル単位の自動検証が難しいため、純粋関数（数学・画像処理・音声解析）は特性テスト（characterization test = 現在の挙動をそのまま固定するテスト）で守り、描画はビルド＋手動デモで確認する。

**Tech Stack:** Vite 8 / Three.js / Vanilla JS (ESM) / pnpm。追加: Vitest（テスト）, ESLint + Prettier（静的検査・整形）。

---

## 現状分析（2026-07-16 時点の事実）

| 問題 | 証拠 | 影響 |
|------|------|------|
| 神ファイル | `src/renderer.js` 2,485行。`SoundScannerRenderer` クラス（〜1780行）＋モジュール関数約35個（Canny/DoG/Sobel などの画像処理、Chladni 数理、色計算、数学ユーティリティ）が同居 | 変更影響範囲が読めない。1モード直すと他モードが壊れるリスク |
| 重複ユーティリティ | `lerp`/`clamp`/`clamp01` が `audio.js:334-342`, `entrance-grain.js:132-140`, `renderer.js:2466-2478`, `ui.js:94` に重複定義。`smoothstep` も `audio.js:518` と `renderer.js:2478` に重複 | 片方だけ修正するバグの温床 |
| モード分岐の散在 | `renderFrame()`（`renderer.js:1186-`）内に `this.modeIndex === 0/1/2/3` の三項演算子が20箇所以上。`main.js:258` にも `modeIndex !== 3` のマジックナンバー | モード追加・削除が事実上不可能 |
| マジックナンバー | `bass * (this.modeIndex === 1 ? 1.05 : 2.55)` のようなモード別係数がループ内にハードコード（`renderer.js:1237-1241` ほか多数） | チューニング値の出所が不明 |
| テスト・Lint 皆無 | `package.json` に test/lint スクリプトなし。CI（`.github/workflows/ci.yml`）はビルドと audit のみ | リファクタリングの安全網がない |
| CSS の無駄な間接参照 | `src/style.css` は `@import '../styles/style.css';` の1行のみ | ファイルが1枚多いだけで意味がない |
| main.js の責務混在 | `src/main.js` 507行にアプリ起動制御＋デバッグパネル3種＋録画オーバーレイ Canvas 描画＋日本語ステータス文言が同居 | UI 文言変更で起動ロジックを触る羽目になる |

**リファクタリングしないもの（YAGNI）:** TypeScript への全面移行（Phase 5 で JSDoc + 型チェックのみ）、フレームワーク導入、ビルド構成変更、機能追加・見た目の変更。

## 進め方のルール（全 Phase 共通）

1. **挙動を変えない。** 各コミットは「移動」「改名」「置換」のどれか1種類だけ。
2. **コミットは小さく頻繁に。** 1タスク = 1〜2コミット。
3. **各 Phase の最後に必ずローカルデモ確認。** `pnpm build && pnpm preview` → ブラウザで4モード全部を目視確認（カメラ・マイク許可が要るため自動化不可）。**push はユーザーの OK が出てから**（グローバル Git ルール準拠）。
4. **検証コマンド:** `pnpm lint && pnpm test && pnpm build` が全 Phase 共通のゲート。

### デモ確認チェックリスト（各 Phase 末に実施）

```
pnpm build && pnpm preview   # http://localhost:4173 を開く
```
- [ ] スタート画面の粒子アニメーションが動く
- [ ] START でカメラ・マイクが起動し点群が出る
- [ ] 4モード（POINT CLOUD / FREQUENCY SCAN / LINE SCAN / CYMATIC PLATE）を切替、それぞれ描画される
- [ ] 音に反応する（声を出して点群が動く）
- [ ] COLOR ボタンでパレット切替
- [ ] REC → STOP で動画が保存される
- [ ] `d` キーでデバッグパネル表示

---

## Phase 0: 安全網の構築（テスト・Lint 基盤）

**why:** リファクタリング＝挙動を変えない変更。挙動が変わっていないことを機械的に確認する手段が現状ゼロなので、コードを触る前にまずこれを作る。

### Task 0.1: Vitest 導入と最初のスモークテスト

**Files:**
- Modify: `package.json`
- Create: `tests/smoke.test.js`

**Step 1: Vitest をインストール**（外部パッケージ追加のためユーザーに事前確認済みであること）

```bash
pnpm add -D vitest
```

**Step 2: package.json の scripts に追加**

```json
"scripts": {
  "dev": "vite --host 0.0.0.0",
  "build": "vite build",
  "preview": "vite preview --host 0.0.0.0",
  "test": "vitest run",
  "test:watch": "vitest"
}
```

**Step 3: 失敗するスモークテストを書く**

```js
// tests/smoke.test.js
import { describe, it, expect } from 'vitest';
import { MODES, SAMPLE_PRESETS } from '../src/modes.js';

describe('modes config', () => {
  it('has 4 modes with required fields', () => {
    expect(MODES).toHaveLength(4);
    for (const mode of MODES) {
      expect(mode).toMatchObject({
        id: expect.any(Number),
        name: expect.any(String),
        depth: expect.any(Number),
        spread: expect.any(Number),
        cameraZ: expect.any(Number),
      });
    }
  });

  it('has 3 sample presets', () => {
    expect(SAMPLE_PRESETS.map((p) => p.label)).toEqual(['LOW', 'MID', 'HIGH']);
  });
});
```

**Step 4: テスト実行**

Run: `pnpm test`
Expected: PASS (2 tests) — modes.js は副作用がない純粋データなのでそのまま通る。通らなければ import パスを確認。

**Step 5: コミット**

```bash
git add package.json pnpm-lock.yaml tests/smoke.test.js
git commit -m "test: add vitest and smoke test for modes config"
```

### Task 0.2: ESLint + Prettier 導入

**Files:**
- Create: `eslint.config.js`, `.prettierrc.json`
- Modify: `package.json`

**Step 1: インストール**

```bash
pnpm add -D eslint @eslint/js prettier eslint-config-prettier
```

**Step 2: 設定ファイル作成**

```js
// eslint.config.js
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';

export default [
  js.configs.recommended,
  prettier,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        window: 'readonly', document: 'readonly', navigator: 'readonly',
        performance: 'readonly', requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly', getComputedStyle: 'readonly',
        console: 'readonly', URLSearchParams: 'readonly', setTimeout: 'readonly',
        clearTimeout: 'readonly', AudioContext: 'readonly', MediaRecorder: 'readonly',
        Blob: 'readonly', URL: 'readonly', ImageData: 'readonly',
        OffscreenCanvas: 'readonly', VideoFrame: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
];
```

```json
// .prettierrc.json
{
  "singleQuote": true,
  "printWidth": 110
}
```

**Step 3: scripts 追加**

```json
"lint": "eslint src tests",
"format": "prettier --write src tests styles"
```

**Step 4: lint 実行して現状のエラーを確認**

Run: `pnpm lint`
Expected: 既存コードで warning/error が出る可能性がある。**このタスクではルールを緩めて全ファイルが通る状態にする**（例: 実際に未使用の変数が見つかれば Phase 1 の削除リストに記録し、ここでは直さない）。

**Step 5: コミット**

```bash
git add eslint.config.js .prettierrc.json package.json pnpm-lock.yaml
git commit -m "chore: add eslint and prettier"
```

**注意:** `pnpm format` の一括実行は diff が巨大になり過去履歴が追いにくくなるため**このフェーズではやらない**。整形は各ファイルを触るタスクの中で個別に行う。

### Task 0.3: CI に lint と test を追加

**Files:**
- Modify: `.github/workflows/ci.yml`

**Step 1: Build ステップの前に追加**

```yaml
      - name: Lint
        run: pnpm lint

      - name: Test
        run: pnpm test
```

**Step 2: ローカルで全ゲートを通す**

Run: `pnpm lint && pnpm test && pnpm build`
Expected: すべて成功。

**Step 3: コミット**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: run lint and tests before build"
```

### Phase 0 完了条件
- `pnpm lint && pnpm test && pnpm build` が通る
- デモ確認チェックリスト実施 → ユーザーに確認依頼

---

## Phase 1: 重複ユーティリティ統合と低リスク掃除

**why:** 最もリスクが低く、後続 Phase の土台になる。数学関数は入出力が明確なので TDD の練習台としても最適。

### Task 1.1: `src/utils/math.js` を TDD で作成

**Files:**
- Create: `src/utils/math.js`
- Test: `tests/utils/math.test.js`

**Step 1: 失敗するテストを書く**

現在の実装（`renderer.js:2466-2482`）の挙動をそのまま固定する。**勝手に「改善」しない**（例: clamp の引数順や NaN の扱いを変えない）。

```js
// tests/utils/math.test.js
import { describe, it, expect } from 'vitest';
import { clamp, clamp01, lerp, smoothstep } from '../../src/utils/math.js';

describe('clamp', () => {
  it('clamps within range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });
});

describe('clamp01', () => {
  it('clamps to [0,1]', () => {
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(-0.2)).toBe(0);
    expect(clamp01(1.3)).toBe(1);
  });
});

describe('lerp', () => {
  it('interpolates linearly', () => {
    expect(lerp(0, 10, 0.5)).toBe(5);
    expect(lerp(2, 4, 0)).toBe(2);
    expect(lerp(2, 4, 1)).toBe(4);
  });
});

describe('smoothstep', () => {
  it('matches renderer.js implementation', () => {
    expect(smoothstep(0, 1, 0.5)).toBe(0.5);
    expect(smoothstep(0, 1, 0)).toBe(0);
    expect(smoothstep(0, 1, 1)).toBe(1);
    // edge0 > edge1 の逆転ケース（renderer.js は逆転を許す実装）も現挙動を固定する
    expect(smoothstep(1, 0, 0.25)).toBeCloseTo(smoothstep(0, 1, 0.75), 10);
  });
});
```

**Step 2: テスト失敗を確認**

Run: `pnpm test`
Expected: FAIL — `Cannot find module '../../src/utils/math.js'`

**Step 3: 実装（renderer.js の実装を正としてコピー）**

```js
// src/utils/math.js
export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function clamp01(value) {
  return clamp(value, 0, 1);
}

export function lerp(from, to, amount) {
  return from + (to - from) * amount;
}

export function smoothstep(edge0, edge1, value) {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}
```

**重要:** 実装をコピーする前に `renderer.js` / `audio.js` / `entrance-grain.js` / `ui.js` の各定義を diff で見比べること。もし実装差があれば（例: clamp の丸め方が違う）、**統合せずその関数はスキップして差異をユーザーに報告する。**

**Step 4: テスト成功を確認**

Run: `pnpm test`
Expected: PASS

**Step 5: コミット**

```bash
git add src/utils/math.js tests/utils/math.test.js
git commit -m "refactor: add shared math utilities module"
```

### Task 1.2: 各ファイルの重複定義を utils/math.js の import に置換

**Files:**
- Modify: `src/audio.js`（`lerp`:334, `clamp01`:338, `clamp`:342, `smoothstep`:518 を削除して import）
- Modify: `src/renderer.js`（2466-2482 の `clamp`/`clamp01`/`lerp`/`smoothstep` を削除して import）
- Modify: `src/entrance-grain.js`（132-140 の `lerp`/`clamp`/`clamp01` を削除して import）
- Modify: `src/ui.js`（94 の `clamp` を削除して import）

**Step 1: 1ファイルずつ置換。** ファイル先頭に `import { clamp, clamp01, lerp, smoothstep } from './utils/math.js';`（使う関数のみ）を追加し、ローカル定義を削除。

**Step 2: 各ファイル置換のたびに検証**

Run: `pnpm lint && pnpm test && pnpm build`
Expected: すべて成功。lint の `no-undef` が置換漏れを検出してくれる。

**Step 3: 4ファイル分まとめて 1 コミット**

```bash
git add src/audio.js src/renderer.js src/entrance-grain.js src/ui.js
git commit -m "refactor: use shared math utilities, remove duplicated helpers"
```

**Step 4: デモ確認**（数学関数は全モードの描画に効くため必須）

### Task 1.3: CSS の間接参照を解消

**Files:**
- Delete: `src/style.css`（`@import` 1行のみのファイル）
- Modify: `src/main.js:1` → `import '../styles/style.css';`

**Step 1: main.js の import を書き換え、src/style.css を削除**

**Step 2: 検証**

Run: `pnpm build`
Expected: 成功。`dist/` の CSS に styles/style.css の内容が含まれることを `grep -l "start-screen" dist/assets/*.css` などで確認。

**Step 3: コミット**

```bash
git add -A src/style.css src/main.js
git commit -m "refactor: remove css indirection, import styles directly"
```

### Task 1.4: 死んだコード・ゴミの掃除

**Files:**
- Modify: `.gitignore`（`.DS_Store` が無ければ追加）
- Modify: Task 0.2 の lint で見つかった未使用変数・未使用関数を削除

**Step 1: lint 出力から未使用コードのリストを作り、1件ずつ「本当に未使用か」を grep で裏取りして削除。** 動的参照（`this[name]` のような呼び方）がないことを確認する。

**Step 2: 検証** → `pnpm lint && pnpm test && pnpm build`

**Step 3: コミット** → `git commit -m "chore: remove dead code and ignore .DS_Store"`

### Phase 1 完了条件
- 重複ユーティリティが 0 件（`grep -rn "function lerp" src/` で utils/math.js のみヒット）
- デモ確認チェックリスト実施 → ユーザーに確認依頼

---

## Phase 2: renderer.js から純粋関数を抽出（神ファイル解体・前半）

**why:** renderer.js の下半分（1780行目以降）は Three.js に依存しない純粋関数群。純粋関数は特性テストで完全に守れるため、リスクの低い順＝「純粋関数から先に」抽出する。

**共通手順（このPhaseの全タスクで同じ）:**
1. 対象関数の特性テストを書く（現在の入出力をそのまま assert）
2. renderer.js 内の関数に対してテストを通す（`export` を一時付与）
3. 関数を新ファイルへ**そのまま移動**（1文字も変えない）、renderer.js に import を追加
4. `pnpm lint && pnpm test && pnpm build` → コミット

### Task 2.1: `src/render/image-processing.js` の抽出

**Files:**
- Create: `src/render/image-processing.js`
- Test: `tests/render/image-processing.test.js`
- Modify: `src/renderer.js`

**移動対象（renderer.js 内の現在位置）:** `blurGray`:2113, `computeCannyMap`:2134, `computeDogDetailMap`:2211, `quantizedDirection`:2244, `traceContour`:2252, `lumaAt`:2400, `simpleEdgeAt`:2404, `sobelAt`:2410, および同ブロックの `sobelVectorAt` / `lumaXY` / `contourAt` / `hash01`（2400行以降を Read して正確な一覧を確定すること）

**特性テストの書き方（例: sobelAt）:**

```js
// tests/render/image-processing.test.js
import { describe, it, expect } from 'vitest';
import { sobelAt, lumaAt } from '../../src/render/image-processing.js';

function makeFrame(width, height, fill) {
  // RGBA フレームを合成: fill(x, y) => [r, g, b]（0-255）
  const frame = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = fill(x, y);
      const i = (y * width + x) * 4;
      frame[i] = r; frame[i + 1] = g; frame[i + 2] = b; frame[i + 3] = 255;
    }
  }
  return frame;
}

describe('sobelAt', () => {
  it('returns 0 on a flat image', () => {
    const frame = makeFrame(8, 8, () => [128, 128, 128]);
    expect(sobelAt(frame, 4, 4, 8, 8)).toBe(0);
  });

  it('detects a vertical edge', () => {
    const frame = makeFrame(8, 8, (x) => (x < 4 ? [0, 0, 0] : [255, 255, 255]));
    expect(sobelAt(frame, 4, 4, 8, 8)).toBeGreaterThan(0.5);
  });

  it('is snapshot-stable on a gradient', () => {
    const frame = makeFrame(8, 8, (x, y) => [x * 30, y * 30, 128]);
    expect(sobelAt(frame, 3, 3, 8, 8)).toMatchInlineSnapshot();
  });
});
```

`toMatchInlineSnapshot()` は初回実行で現在値がテストファイルに書き込まれる（＝現挙動の固定）。Canny / DoG のような多出力関数は、小さな合成画像を入れて出力配列全体をスナップショットする。

**Step 群:** 共通手順どおり。移動時に renderer.js 側は:

```js
import {
  blurGray, computeCannyMap, computeDogDetailMap, quantizedDirection,
  traceContour, lumaAt, simpleEdgeAt, sobelAt, sobelVectorAt, lumaXY, contourAt, hash01,
} from './render/image-processing.js';
```

**コミット:** `refactor: extract image processing functions from renderer`

### Task 2.2: `src/render/cymatic-patterns.js` の抽出

**Files:**
- Create: `src/render/cymatic-patterns.js`
- Test: `tests/render/cymatic-patterns.test.js`
- Modify: `src/renderer.js`

**移動対象:** `CYMATIC_PATTERN_TYPES`:15, `CYMATIC_MODE_TABLE`:30, `selectNearestCymaticMode`:1824, `selectExcitedCymaticMode`:1839, `getCymaticBandEnergy`:1855, `selectCymaticPattern`:1875, `cymaticPatternField`:1891, `chladniPattern`:1977, `chladniGradient`:1986

**特性テスト例:** `chladniPattern` は (n, m, u, v) → 値 の純粋数式なので、代表点数点をスナップショット。`selectNearestCymaticMode(440)` が返すモードを固定、境界値（表の最小/最大周波数の外側）も固定。

**コミット:** `refactor: extract cymatic pattern math from renderer`

### Task 2.3: `src/render/color.js` の抽出

**Files:**
- Create: `src/render/color.js`
- Test: `tests/render/color.test.js`
- Modify: `src/renderer.js`

**移動対象:** `COLOR_PALETTES`:22, `thermalColor`:2006, `scan2ParticleColor`:2031, `mixRgb`:2075

**特性テスト例:** `mixRgb({r:0,g:0,b:0}, {r:1,g:1,b:1}, 0.5)` → `{r:0.5,...}`。`thermalColor` は代表入力のスナップショット。

**コミット:** `refactor: extract color utilities from renderer`

### Task 2.4: `src/audio-analysis.js` の抽出（audio.js の関数群）

**why:** `audio.js:280-560` の約25個のモジュール関数（`rms`, `calculateSpectralCentroid`, `calculatePeakHz`, `compressFrequencyBands` など）も純粋関数。`AudioScanner` クラス（Web Audio 依存）と分離すればテスト可能になる。

**Files:**
- Create: `src/audio-analysis.js`
- Test: `tests/audio-analysis.test.js`
- Modify: `src/audio.js`

**特性テスト例:** `rms(new Float32Array([0.5, -0.5]))` → 0.5。`binToHz(10, 48000, 2048)` → 234.375。`calculatePeakHz` は合成スペクトル（1箇所だけ山がある Uint8Array）で山の位置を検出できることを固定。

**コミット:** `refactor: extract pure audio analysis functions from audio.js`

### Phase 2 完了条件
- `renderer.js` が約 1,800 行以下、`audio.js` が約 280 行以下になっている
- 抽出した全関数に特性テストがある（`pnpm test` で 30 件以上）
- デモ確認チェックリスト実施 → ユーザーに確認依頼

---

## Phase 3: モードのストラテジー化（神ファイル解体・後半）

**why:** ここが本丸。`renderFrame()` 内の `modeIndex === N` 分岐をモード別モジュールに分ける。Phase 2 までの特性テスト＋各ステップのデモ確認が安全網。**このフェーズは1タスクごとに必ずデモ確認する**（描画ループ本体を触るため）。

### Task 3.1: モード係数を modes.js に集約

**Files:**
- Modify: `src/modes.js`, `src/renderer.js`, `src/main.js`

**Step 1:** `renderFrame` 内のモード条件付き係数を洗い出して modes.js の各モード定義に移す。例:

```js
// modes.js（追加フィールドの例）
{
  id: 1,
  name: 'FREQUENCY SCAN',
  // ...既存フィールド...
  bassPushGain: 1.05,      // 他モードは 2.55
  terrainWaveGain: 0.12,   // 他モードは 0.42
  requiresMic: false,
}
```

renderer.js 側は `bass * mode.bassPushGain * this.intensity` に置換。

**Step 2:** マジックナンバー `modeIndex === 3` を capability フラグに置換:
- `modes.js` の CYMATIC PLATE に `requiresMic: true, rendersTo2dCanvas: true, uiTheme: 'cymatic'` を追加
- `main.js:258` の `renderer.modeIndex !== 3` → `!renderer.currentMode.requiresMic`
- `main.js:272-274` の `modeIndex === 2` / `=== 3` → `mode.uiTheme` 参照に置換
- renderer.js に `get currentMode() { return MODES[this.modeIndex]; }` を追加

**Step 3: スモークテスト拡張** — 新フィールドが4モード全部に定義されていることを assert。

**Step 4:** `pnpm lint && pnpm test && pnpm build` → **デモ確認（4モード切替・係数の見た目が変わっていないか注視）** → コミット

```bash
git commit -m "refactor: move per-mode coefficients and capabilities into modes config"
```

### Task 3.2: モード別レンダラーの分離

**Files:**
- Create: `src/render/mode-point-cloud.js`（モード0）
- Create: `src/render/mode-frequency-scan.js`（モード1）
- Create: `src/render/mode-line-scan.js`（モード2、`getLineScanPoint` と LINE SCAN 分岐を移す）
- Create: `src/render/mode-cymatic.js`（モード3、`renderCymaticCanvas`:698, `updateCymaticResonance`:885, `getCymaticPoint`:945, `resizeCymaticCanvas`:659, `rebuildCymaticCanvasParticles`:670 を移す）
- Modify: `src/renderer.js`

**設計:** 各モードモジュールは同じ形のオブジェクトを export する（ストラテジーパターン = 差し替え可能な部品として切り出す設計）。

```js
// 各モードモジュールの共通インターフェース
export const pointCloudMode = {
  // ピクセルごとの点計算。renderFrame のループ内から呼ばれる
  computePoint(ctx) { /* ctx = { x, y, light, edge, ..., renderer } */ },
  // フレーム全体の前処理・後処理（不要なら省略可）
  beforeFrame(renderer, audio, time, dt) {},
  afterFrame(renderer, audio, time) {},
};
```

**手順（1モードずつ、計4コミット）:**
1. モード3（CYMATIC）から着手 — すでに `renderCymaticCanvas` として分離済みの塊なので機械的に移動できる
2. モード2（LINE SCAN）— `getLineScanPoint` と `renderFrame` 内の `modeIndex === 2` ブロックを移動
3. モード1（FREQUENCY SCAN）、モード0（POINT CLOUD）の順
4. 最後に `renderFrame` は「共通のピクセル前処理 → `this.currentModeRenderer.computePoint(ctx)` → 共通の後処理」だけになる

**各モード移動後:** `pnpm lint && pnpm test && pnpm build` → **必ずデモで該当モードと隣接モードを目視** → コミット

```bash
git commit -m "refactor: extract cymatic mode renderer into module"   # 以下モードごと
```

**注意:** ループ内で共有される状態（`lightHistory`, `motionHistory`, `scanPhase`, trail バッファ）は renderer 本体に残す。モードモジュールには ctx 経由で渡す。パフォーマンスに効くホットループなので、**オブジェクト割り当てを増やさない**（ctx は毎フレーム使い回す）。デモで FPS 表示（HUD の PERF ラベル）が悪化していないことを確認する。

### Task 3.3: スペクトラム層・トレイル・ショックウェーブの分離

**Files:**
- Create: `src/render/spectrum-layer.js`（`rebuildSpectrumLayer`:1135, `updateSpectrumLayer`:1499）
- Create: `src/render/effects.js`（`spawnShockwave`:1571, `updateShockwaves`:1606, `clearShockwaves`:1622, `disposeShockwave`:1629, `captureTrail`:1636, `fadeTrails`:1659）
- Modify: `src/renderer.js`

Three.js オブジェクトを持つため純粋関数にはできない。renderer から状態ごと委譲するクラス（`SpectrumLayer`, `EffectsManager`）として切り出し、renderer はコンストラクタで生成して呼び出すだけにする。

**検証:** ビルド＋デモ（FREQUENCY SCAN の背景スペクトラム、音量ピークでのショックウェーブを目視）→ コミット

```bash
git commit -m "refactor: extract spectrum layer and effects into modules"
```

### Phase 3 完了条件
- `renderer.js` が約 600 行以下（シーン管理・リサイズ・モード切替・共通ループのみ）
- `grep -c "modeIndex ===" src/renderer.js` が 5 以下
- デモ確認チェックリスト実施（**特に入念に**）→ ユーザーに確認依頼

---

## Phase 4: main.js と UI 周辺の整理

**why:** main.js の責務混在を解消。Phase 3 と独立しているが、renderer の API が固まった後の方が手戻りが少ないのでこの順。

### Task 4.1: デバッグパネルの抽出

**Files:**
- Create: `src/debug.js`
- Modify: `src/main.js`

**移動対象（main.js 内）:** `toggleDebug`:329, `updateDebug`:334, `createAudioDebugPanel`:356, `updateAudioDebug`:364, `formatAudioDebugNumber`:383, `formatAudioDebugTime`:387, `formatAudioSettings`:392, `updateCymaticDebug`:401, `getCymaticDebugRows`:472, `formatHz`:482, 隠しコマンド（コーナー4タップ）:202-213

`createDebugPanels({ renderer, camera, cymaticDebugElements, debugPanel })` を export し、main.js からは `debug.update(audioState)` を呼ぶだけにする。

**検証:** ビルド → デモで `d` キーとコーナー4タップと `?debugAudio=1` を確認 → コミット

### Task 4.2: 録画オーバーレイの抽出

**Files:**
- Create: `src/recording-overlay.js`
- Modify: `src/main.js`

**移動対象:** `drawRecordingOverlay`:413, `drawCymaticDebugRecordingOverlay`:418（Canvas 2D 描画 60 行）

**検証:** ビルド → デモで CYMATIC PLATE 中に REC し、保存動画にデバッグパネルが焼き込まれることを確認 → コミット

### Task 4.3: ステータス文言の集約

**Files:**
- Create: `src/messages.js`
- Modify: `src/main.js`

**移動対象:** `getStartupMessage`:291-317 の日本語文言と `updateRuntimeStatus`:487-507 内の文言を定数オブジェクトとして messages.js へ。将来の多言語化の下地にもなる（が、i18n 機構は入れない = YAGNI）。

**検証:** ビルド → デモでマイク拒否時のメッセージを確認 → コミット

### Phase 4 完了条件
- `main.js` が約 250 行以下（起動・停止・イベント配線・メインループのみ）
- デモ確認チェックリスト実施 → ユーザーに確認依頼

---

## Phase 5: 型チェックと仕上げ

### Task 5.1: JSDoc + TypeScript チェックの導入（コード変更なしの型付け）

**why:** `renderFrame(frame, audio, time)` の `audio` の中身（20フィールド超）が現状ドキュメント化されていない。JSDoc の型注釈＋ `tsc --checkJs` なら .js のまま型検査でき、移行コスト最小。

**Files:**
- Create: `jsconfig.json`
- Modify: 主要な公開関数に JSDoc を追加（`src/audio.js` の AudioState, `src/modes.js` の Mode, 各モードモジュールの ctx）

**Step 1:**

```json
// jsconfig.json
{
  "compilerOptions": {
    "target": "es2022",
    "module": "es2022",
    "moduleResolution": "bundler",
    "checkJs": true,
    "noEmit": true,
    "strict": false
  },
  "include": ["src"]
}
```

**Step 2:** `pnpm add -D typescript` → scripts に `"typecheck": "tsc -p jsconfig.json"` 追加 → CI にも追加

**Step 3:** AudioState の typedef を audio.js に書く（`emptyAudioState`:280 が実質のスキーマ定義なのでそこから起こす）。エラーが大量に出る場合は `strict: false` のまま、明らかなバグ（typo フィールドなど）だけ拾って報告する。

**コミット:** `chore: add jsdoc types and typescript checking`

### Task 5.2: アーキテクチャ文書

**Files:**
- Create: `docs/ARCHITECTURE.md`

モジュール構成図（main → camera/audio/renderer/recorder、renderer → render/*）、データフロー（カメラフレーム＋音声解析 → renderFrame → 点群）、「モードを追加する方法」の手順書を書く。

**コミット:** `docs: add architecture overview`

### Task 5.3: 最終検証

1. `pnpm lint && pnpm test && pnpm typecheck && pnpm build` 全成功
2. デモ確認チェックリスト全項目
3. iPhone Safari 実機確認（このアプリの主要ターゲット。`pnpm dev --host` で LAN 経由）
4. 完了サマリーをユーザーに提示 → **OK が出てから push**

---

## 最終的なファイル構成（完了時の姿）

```
src/
  main.js               # 起動・停止・イベント配線・メインループ（〜250行）
  camera.js             # 変更なし
  audio.js              # AudioScanner クラスのみ（〜280行）
  audio-analysis.js     # 音声解析の純粋関数
  modes.js              # モード定義（係数・capability を含む唯一の場所）
  input.js              # 変更なし
  ui.js                 # HUD
  debug.js              # デバッグパネル3種
  messages.js           # 日本語ステータス文言
  recording-overlay.js  # 録画オーバーレイ描画
  recorder.js           # 変更なし
  entrance-grain.js     # 変更なし
  renderer.js           # シーン管理・共通ループ（〜600行）
  render/
    image-processing.js # Sobel/Canny/DoG/輪郭追跡
    cymatic-patterns.js # Chladni 数理・モード表
    color.js            # パレット・色計算
    spectrum-layer.js   # 背景スペクトラム
    effects.js          # ショックウェーブ・トレイル
    mode-point-cloud.js
    mode-frequency-scan.js
    mode-line-scan.js
    mode-cymatic.js
  utils/
    math.js             # clamp/lerp/smoothstep
tests/                  # 上記の特性テスト群
docs/
  ARCHITECTURE.md
  plans/2026-07-16-full-refactoring.md（本書）
```

## リスクと対策

| リスク | 対策 |
|--------|------|
| 描画の見た目が微妙に変わっても自動テストでは検出できない | 純粋関数は特性テストで固定。描画は Phase/タスクごとのデモ確認を必須化。怪しければ `git bisect` できるようコミットを最小化 |
| ホットループ（毎フレーム×全ピクセル）の分割でFPS低下 | ctx オブジェクトの使い回し、モジュール分割後に HUD の FPS 表示で before/after 比較 |
| iPhone Safari 固有の挙動（音声プロファイル、録画フォールバック）を壊す | `isIOSLikeWebKitRuntime` 関連コードは移動のみで変更しない。Task 5.3 で実機確認 |
| 重複ヘルパーに実は実装差がある | Task 1.1 で統合前に必ず diff 確認。差があれば統合を保留して報告 |

## 進捗管理

各タスク完了時に本書の該当タスク見出しに `✅ YYYY-MM-DD` を追記する。中断しても次のセッションで「✅ が付いていない最初のタスク」から再開できる。
