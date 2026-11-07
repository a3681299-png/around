// The public build imports only the approved Mirdo files from the external asset checkout.
// Tests without that checkout use the generated mannequin and its poses.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { MANNEQUIN_POSES, mannequinPoseVrma, mannequinVrm } from '../../tests/helpers/mannequin';
import { inspectAsset } from '../../src/assets/inspect';
import { inspectVrma } from '../../src/assets/vrma';
import { parseDesign } from '../../src/design/schema';
import { defaultModelSettings } from '../../src/models/types';
import { CHARACTER_HOME } from '../../src/characters/home';
import { assignBehaviours, classifyMotion } from '../../src/characters/auto-motions';
import type { CharacterMotion } from '../../src/characters/settings';
import mirdoAssets from './mirdo-assets.json';

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

function readApproved(root: string, file: string, hash: string): Uint8Array {
  const bytes = readFileSync(join(root, 'mirdo', file));
  if (sha(bytes) !== hash)
    throw new Error(
      `Playground asset differs from the approved version: ${file}. Check the asset checkout and Git LFS.`,
    );
  return bytes;
}

/** A small PNG: a light green room-like gradient with a lighter band, drawn pixel by pixel. */
function backgroundPng(width: number, height: number): Buffer {
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 4);
    for (let x = 0; x < width; x++) {
      const t = y / height,
        band = Math.max(0, 1 - Math.abs(t - 0.62) * 9),
        glow = Math.max(0, 1 - Math.hypot(x / width - 0.5, t - 0.4) * 1.6);
      const at = 1 + x * 4;
      // Light: the site's own dark text must stay readable (artwork has no text colour field).
      row[at] = Math.round(196 + 30 * glow + 20 * band);
      row[at + 1] = Math.round(222 + 20 * glow + 12 * band);
      row[at + 2] = Math.round(214 + 22 * glow + 16 * band);
      row[at + 3] = 255;
    }
    rows.push(row);
  }
  const chunk = (kind: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(kind), data]);
    let crc = 0xffffffff;
    for (const b of body) {
      crc ^= b;
      for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const head = Buffer.alloc(4),
      tail = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([head, body, tail]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export function writeContent(root: string, out: string, mirdoRoot?: string): { models: string[] } {
  mkdirSync(out, { recursive: true });
  const assets: Record<string, { file: string; name: string }> = {};
  const add = (bytes: Uint8Array, ext: string, name: string) => {
    const id = `asset-${sha(bytes)}`,
      file = `${id}.${ext}`;
    writeFileSync(join(out, file), bytes);
    assets[id] = { file, name };
    return id;
  };
  const vrm = mirdoRoot
    ? readApproved(mirdoRoot, 'work/mirdo-1024.vrm', mirdoAssets.vrm)
    : new Uint8Array(mannequinVrm());
  const motionFiles = mirdoRoot
    ? Object.entries(mirdoAssets.motions).map(([name, hash]) => ({
        name,
        bytes: readApproved(mirdoRoot, `motions-pass/${name}.vrma`, hash),
      }))
    : (['sit', 'stand'] as const).map((name) => ({
        name,
        bytes: new Uint8Array(mannequinPoseVrma(name, MANNEQUIN_POSES[name])),
      }));
  const vrmId = add(vrm, 'vrm', mirdoRoot ? 'ミルド.vrm' : 'WW mannequin.vrm');
  const motions = motionFiles.map(({ name, bytes }): CharacterMotion => {
    const source = inspectVrma(bytes).info;
    const guess = mirdoRoot
      ? classifyMotion(name, source)
      : ({ role: name === 'sit' ? 'sit' : 'idle', loop: true } as const);
    return {
      id: name.toLowerCase().replaceAll('_', '-'),
      assetId: add(bytes, 'vrma', `${name}.vrma`),
      role: guess.role,
      origin: 'character',
      loop: guess.loop,
      source,
    };
  });
  const background = new Uint8Array(backgroundPng(480, 270));
  const backgroundId = add(background, 'png', 'room.png');
  // Videos are the site's own media, not engine assets.
  for (const [from, to] of [
    ['long.webm', 'video-a.webm'],
    ['alpha1080.webm', 'video-b.webm'],
  ] as const)
    writeFileSync(join(out, to), readFileSync(join(root, 'tests/fixtures/motion', from)));
  const model = inspectAsset(vrm).model!;
  const design = parseDesign({
    schemaVersion: 16,
    id: 'playground-custom',
    siteId: 'playground',
    baseThemeId: null,
    rules: [
      { kind: 'surface-style', target: 'page', style: { backgroundColor: '#d4e8e1' } },
      {
        kind: 'surface-style',
        target: 'video-card',
        style: { backgroundColor: '#f4fbf8', border: { color: '#3f8f7d', widthPx: 1 }, borderRadiusPx: 10 },
      },
      { kind: 'surface-style', target: 'primary-heading', style: { backgroundColor: '#f4fbf8', borderRadiusPx: 6 } },
    ],
    decorations: [
      {
        kind: 'image',
        id: 'room',
        assetId: backgroundId,
        name: '部屋（仮）',
        placement: { anchor: { kind: 'viewport' }, x: 0.5, y: 0.5, widthPx: 1600, heightPx: 900, rotationDeg: 0 },
        opacity: 1,
        zIndex: 0,
        visible: true,
        locked: false,
        renderMode: 'atmosphere',
      },
      {
        kind: 'model3d',
        id: 'resident',
        assetId: vrmId,
        name: mirdoRoot ? 'ミルド' : '試験用のマネキン',
        // Home is the player's bottom-right corner, over the fullscreen button's place (Shota's
        // decision, chunk 3). The anchor is the player (a part kind, the same ID on YouTube), so
        // it follows theater mode, fullscreen and any window size there as here.
        // The Playground's own controls are just below the box.
        placement: CHARACTER_HOME,
        opacity: 1,
        zIndex: 2,
        visible: true,
        locked: false,
        source: model,
        model: { ...defaultModelSettings(model), clip: mirdoRoot ? null : 0, playing: true, loop: true },
        character: {
          standardMotions: 'auto',
          // The autonomy on, with a middling personality (v15).
          autonomy: true,
          personality: { shyness: 0.6, curiosity: 0.6, sleepiness: 0.5 },
          motions,
          ...(mirdoRoot ? { behaviourMotions: assignBehaviours(motions, undefined) } : {}),
        },
      },
    ],
  });
  writeFileSync(join(out, 'design.json'), JSON.stringify(design, null, 2));
  writeFileSync(join(out, 'manifest.json'), JSON.stringify({ design: 'design.json', assets }, null, 2));
  return { models: [assets[vrmId]!.file, ...motions.map((motion) => assets[motion.assetId]!.file)] };
}
