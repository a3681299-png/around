#!/usr/bin/env node
// Renders a VRM with three-vrm in headless Chromium into one contact sheet: the model from several
// sides (to compare with the original look), or one VRM Animation at several moments (to see a
// motion break: an arm inside the body, a floating foot, a foot sliding on the floor grid).
//
//   node scripts/characters/render-vrm.mjs --vrm <model.vrm> --out <sheet.png>
//        [--views front,three-quarter,side,back] [--size 384]
//        [--vrma <clip.vrma> --frames 5 [--view three-quarter]] [--expression happy]
//
// Prints a JSON line "RENDER_VRM {...}" with what it measured: the model's height, the lowest
// foot height per frame (above 0 = floating) and how far the feet moved on the floor while planted.
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? fallback : args[i + 1];
};
const vrm = opt('vrm');
const out = opt('out');
if (!vrm || !out) {
  console.error('Usage: render-vrm.mjs --vrm <model.vrm> --out <sheet.png> [--vrma <clip.vrma> --frames 5]');
  process.exit(2);
}
const vrma = opt('vrma');
const config = {
  size: Number(opt('size', '384')),
  views: opt('views', vrma ? opt('view', 'three-quarter') : 'front,three-quarter,side,back').split(','),
  frames: Number(opt('frames', '5')),
  animated: Boolean(vrma),
  expression: opt('expression', ''),
};

const viewer = `
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { VRMAnimationLoaderPlugin, createVRMAnimationClip } from '@pixiv/three-vrm-animation';
window.renderSheet = async (config) => {
  const size = config.size;
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(size, size);
  renderer.setPixelRatio(1);
  renderer.setClearColor(0xf2f2f2, 1);
  document.body.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(1, 2, 2);
  scene.add(sun);
  const loader = new GLTFLoader();
  loader.register((p) => new VRMLoaderPlugin(p));
  loader.register((p) => new VRMAnimationLoaderPlugin(p));
  const gltf = await loader.loadAsync('http://vrm.local/model.vrm');
  const vrm = gltf.userData.vrm;
  VRMUtils.rotateVRM0(vrm);
  scene.add(vrm.scene);
  if (config.expression) vrm.expressionManager?.setValue(config.expression, 1);
  vrm.update(0);
  const box = new THREE.Box3().setFromObject(vrm.scene);
  const height = box.max.y - box.min.y;
  const grid = new THREE.GridHelper(4, 40, 0x888888, 0xcccccc);
  scene.add(grid);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 50);
  const aim = (name) => {
    const angle = { front: 0, 'three-quarter': Math.PI / 4, side: Math.PI / 2, back: Math.PI }[name] ?? 0;
    const distance = (height * 1.25) / (2 * Math.tan((15 * Math.PI) / 180));
    const centre = new THREE.Vector3(0, height * 0.5, 0);
    camera.position.set(Math.sin(angle) * distance, height * 0.55, Math.cos(angle) * distance);
    camera.lookAt(centre);
  };
  const shots = [];
  const measures = [];
  const feet = ['leftFoot', 'rightFoot'].map((b) => vrm.humanoid.getNormalizedBoneNode(b));
  const footAt = () => feet.map((f) => f.getWorldPosition(new THREE.Vector3()));
  const shoot = () => {
    renderer.render(scene, camera);
    shots.push(renderer.domElement.toDataURL('image/png'));
  };
  if (config.animated) {
    const anim = await loader.loadAsync('http://vrm.local/clip.vrma');
    const clip = createVRMAnimationClip(anim.userData.vrmAnimations[0], vrm);
    const mixer = new THREE.AnimationMixer(vrm.scene);
    mixer.clipAction(clip).play();
    aim(config.views[0]);
    const n = config.frames;
    for (let i = 0; i < n; i++) {
      const t = (clip.duration * i) / Math.max(1, n - 1 + (n > 1 ? 1 : 0));
      mixer.setTime(t);
      vrm.update(1 / 60);
      const f = footAt();
      measures.push({ t: Math.round(t * 1000) / 1000, lowestFoot: Math.min(f[0].y, f[1].y), feet: f.map((v) => [v.x, v.z]) });
      shoot();
    }
    return { shots, height, duration: clip.duration, measures, tracks: clip.tracks.length };
  }
  for (const v of config.views) {
    aim(v);
    shoot();
  }
  return { shots, height, measures };
};
`;

const bundle = await build({
  stdin: { contents: viewer, resolveDir: root, loader: 'js' },
  bundle: true,
  write: false,
  format: 'iife',
  logLevel: 'silent',
});
const browser = await chromium.launch({ channel: 'chromium', headless: true, args: ['--use-angle=swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 800 } });
  const files = { 'model.vrm': await readFile(vrm), ...(vrma ? { 'clip.vrma': await readFile(vrma) } : {}) };
  await page.route('http://vrm.local/**', (route) => {
    const name = new URL(route.request().url()).pathname.slice(1);
    return files[name] ? route.fulfill({ body: files[name], contentType: 'model/gltf-binary' }) : route.abort();
  });
  await page.route('http://viewer.local/', (route) =>
    route.fulfill({ body: '<!doctype html><body style="margin:0"></body>', contentType: 'text/html' }),
  );
  await page.goto('http://viewer.local/');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const result = await page.evaluate((c) => window.renderSheet(c), config);
  // One row: the views or the frames side by side.
  const sheet = await page.evaluate(
    async ({ shots, size }) => {
      const canvas = document.createElement('canvas');
      canvas.width = size * shots.length;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      for (const [i, src] of shots.entries()) {
        const img = new Image();
        img.src = src;
        await img.decode();
        ctx.drawImage(img, i * size, 0);
      }
      return canvas.toDataURL('image/png');
    },
    { shots: result.shots, size: config.size },
  );
  await writeFile(out, Buffer.from(sheet.split(',')[1], 'base64'));
  delete result.shots;
  console.log('RENDER_VRM ' + JSON.stringify(result));
} finally {
  await browser.close();
}
