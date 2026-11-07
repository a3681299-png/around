#!/usr/bin/env node
// Plays every .vrma in a folder on one VRM with three-vrm, off screen, and measures what breaks
// (docs/characters/mirdo.md, "試す"): a hand or forearm inside the body, a foot floating above or
// sinking into the floor, a planted foot sliding. Every number is relative to the model's height,
// so the same lines judge any character. Writes <out>/report.json and a 5-frame sheet per clip
// (<out>/<clip>.png) to compare the automatic verdict with the eye.
//
//   node scripts/characters/check-motions.mjs --vrm <model.vrm> --dir <motions> --out <dir> [--only A,B]
//
// A clip's .json (scripts/characters/retarget_vrma.py) gives the speed an in-place walk is meant
// to be moved at; a planted foot should then go backwards at that speed, not stand still.
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The lines (fractions of the model's height, per second for speeds). */
export const LINES = Object.freeze({
  // A hand inside the body: at least this many arm vertices in a frame, in more than this share.
  insideVertices: 3,
  insideFrames: 0.1,
  // Floating: the lower sole above the floor by this, in more than this share (not for jumps).
  float: 0.03,
  floatFrames: 0.1,
  // Sinking: the lower sole under the floor by this, in more than this share.
  sink: 0.02,
  sinkFrames: 0.05,
  // A planted foot (within this of the floor) sliding faster than this from where it should go;
  // for a motion that travels, faster than this share of its speed instead.
  planted: 0.015,
  slide: 0.08,
  slideShare: 0.15,
  // A clip whose hips rise this much above their lowest is a jump: floating is its point.
  jump: 0.12,
});

const root = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));

const viewer = `
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { VRMAnimationLoaderPlugin, createVRMAnimationClip } from '@pixiv/three-vrm-animation';
const TORSO = ['hips', 'spine', 'chest', 'upperChest', 'leftUpperLeg', 'rightUpperLeg'];
const ARM = /^(left|right)(LowerArm|Hand|Thumb|Index|Middle|Ring|Little)/;
const FOOT = /^(left|right)(Foot|Toes)$/;
const SPINE = ['hips', 'spine', 'chest', 'upperChest', 'neck', 'head'];
window.setup = async (size) => {
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
  scene.add(new THREE.GridHelper(4, 40, 0x888888, 0xcccccc));
  const loader = new GLTFLoader();
  loader.register((p) => new VRMLoaderPlugin(p));
  loader.register((p) => new VRMAnimationLoaderPlugin(p));
  const vrm = (await loader.loadAsync('http://vrm.local/model.vrm')).userData.vrm;
  VRMUtils.rotateVRM0(vrm);
  scene.add(vrm.scene);
  vrm.update(0);
  vrm.scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(vrm.scene);
  const height = box.max.y - box.min.y;
  // Each skinned vertex's heaviest humanoid bone.
  const rawToHuman = new Map();
  for (const name of Object.keys(vrm.humanoid.humanBones)) {
    const node = vrm.humanoid.getRawBoneNode(name);
    if (node) rawToHuman.set(node, name);
  }
  const groups = [];
  vrm.scene.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    const index = o.geometry.getAttribute('skinIndex'), weight = o.geometry.getAttribute('skinWeight');
    const torso = [], arms = { left: [], right: [] }, feet = { left: [], right: [] };
    for (let v = 0; v < index.count; v++) {
      let best = 0, bone = -1;
      for (let c = 0; c < 4; c++) if (weight.getComponent(v, c) > best) { best = weight.getComponent(v, c); bone = index.getComponent(v, c); }
      const human = rawToHuman.get(o.skeleton.bones[bone]);
      if (!human) continue;
      if (TORSO.includes(human)) torso.push(v);
      const arm = ARM.exec(human);
      if (arm) arms[arm[1]].push(v);
      const foot = FOOT.exec(human);
      if (foot) feet[foot[1]].push(v);
    }
    groups.push({ mesh: o, torso, arms, feet });
  });
  const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 50);
  // The floor: where the soles are in the rest pose (a model's soles are rarely at exactly 0).
  let restSole = Infinity;
  const q0 = new THREE.Vector3();
  for (const g of groups)
    for (const v of [...g.feet.left, ...g.feet.right])
      restSole = Math.min(restSole, g.mesh.getVertexPosition(v, q0).applyMatrix4(g.mesh.matrixWorld).y);
  window.ctx = { THREE, renderer, scene, camera, vrm, loader, height, groups, createVRMAnimationClip, restSole };
  return { height, restSole, vertices: groups.map((g) => ({ torso: g.torso.length, left: g.arms.left.length, right: g.arms.right.length, feet: g.feet.left.length + g.feet.right.length })) };
};
window.measureClip = async (name, frames, sheetFrames, view) => {
  const { THREE, renderer, scene, camera, vrm, loader, height, groups, createVRMAnimationClip, restSole } = window.ctx;
  const anim = await loader.loadAsync('http://vrm.local/clip/' + encodeURIComponent(name));
  const clip = createVRMAnimationClip(anim.userData.vrmAnimations[0], vrm);
  const mixer = new THREE.AnimationMixer(vrm.scene);
  mixer.clipAction(clip).play();
  const p = new THREE.Vector3();
  const world = (g, v) => g.mesh.getVertexPosition(v, p.clone()).applyMatrix4(g.mesh.matrixWorld);
  const spinePoints = () => SPINE.map((b) => vrm.humanoid.getNormalizedBoneNode(b)).filter(Boolean).map((n) => n.getWorldPosition(new THREE.Vector3()));
  const toAxis = (q, axis) => {
    let best = Infinity;
    for (let i = 0; i + 1 < axis.length; i++) {
      const a = axis[i], b = axis[i + 1], ab = b.clone().sub(a);
      const t = Math.max(0, Math.min(1, q.clone().sub(a).dot(ab) / Math.max(1e-9, ab.lengthSq())));
      best = Math.min(best, q.distanceTo(a.clone().addScaledVector(ab, t)));
    }
    return best;
  };
  const n = frames, rows = [], shots = [];
  const duration = clip.duration || 0;
  const dt = duration && n > 1 ? duration / (n - 1) : 0;
  const shotAt = new Set(Array.from({ length: sheetFrames }, (_, i) => Math.round((i * (n - 1)) / Math.max(1, sheetFrames - 1))));
  const hipsNode = vrm.humanoid.getNormalizedBoneNode('hips');
  for (let i = 0; i < n; i++) {
    mixer.setTime(i * dt);
    vrm.update(0);
    vrm.scene.updateMatrixWorld(true);
    const axis = spinePoints();
    let inside = { left: 0, right: 0 };
    const sole = { left: Infinity, right: Infinity }, ankle = {}, foot = { left: [], right: [] };
    for (const g of groups) {
      // The torso's reach around the spine, per height band: the arm is inside when it is nearer
      // the spine than the torso's own surface at that height (minus a margin of 1% of the height).
      const bands = new Map();
      for (const v of g.torso) {
        const q = world(g, v);
        const key = Math.round(q.y / (height * 0.04));
        bands.set(key, Math.max(bands.get(key) ?? 0, toAxis(q, axis)));
      }
      for (const side of ['left', 'right']) {
        for (const v of g.arms[side]) {
          const q = world(g, v);
          const reach = bands.get(Math.round(q.y / (height * 0.04)));
          if (reach !== undefined && toAxis(q, axis) < reach * 0.8 - height * 0.01) inside[side]++;
        }
        for (const v of g.feet[side]) {
          const q = world(g, v);
          sole[side] = Math.min(sole[side], q.y - restSole);
          // Every sole vertex, in a fixed order, so a planted one can be followed frame to frame.
          foot[side].push([+q.x.toFixed(5), +(q.y - restSole).toFixed(5), +q.z.toFixed(5)]);
        }
      }
    }
    for (const side of ['left', 'right']) {
      const f = vrm.humanoid.getNormalizedBoneNode(side + 'Foot').getWorldPosition(new THREE.Vector3());
      ankle[side] = [f.x, f.z];
    }
    rows.push({ t: i * dt, inside, sole, ankle, foot, hips: hipsNode.getWorldPosition(new THREE.Vector3()).y });
    if (shotAt.has(i)) {
      const angle = { front: 0, 'three-quarter': Math.PI / 4, side: Math.PI / 2 }[view] ?? Math.PI / 4;
      const distance = (height * 1.25) / (2 * Math.tan((15 * Math.PI) / 180));
      camera.position.set(Math.sin(angle) * distance, height * 0.55, Math.cos(angle) * distance);
      camera.lookAt(new THREE.Vector3(0, height * 0.5, 0));
      renderer.render(scene, camera);
      shots.push(renderer.domElement.toDataURL('image/png'));
    }
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(vrm.scene);
  return { duration, rows, shots, height };
};
`;

/** The verdict from the rows (exported for the unit test). */
export function judge(rows, height, speedMps = 0, lines = LINES) {
  const n = rows.length;
  const lowest = rows.map((r) => Math.min(r.sole.left, r.sole.right));
  // The floor is where the model's soles rest in its own rest pose: y = 0 for a VRM on the floor.
  const hipsRange = Math.max(...rows.map((r) => r.hips)) - Math.min(...rows.map((r) => r.hips));
  const jump = hipsRange > lines.jump * height;
  const insideFrames = rows.filter(
    (r) => r.inside.left >= lines.insideVertices || r.inside.right >= lines.insideVertices,
  ).length;
  const floatFrames = lowest.filter((y) => y > lines.float * height).length;
  const sinkFrames = lowest.filter((y) => y < -lines.sink * height).length;
  // Sliding: a sole vertex touching the floor in two neighbouring frames should stay put while the
  // body goes over it (a foot rolling from heel to toe touches with other vertices, which is not a
  // slide). For an in-place walk (speedMps > 0) the engine moves the body, so a touching vertex goes
  // backwards (-z) at one steady speed: the speed this body's legs keep, measured here as the median
  // (its legs are not the source's legs scaled, so the hips' scaled travel is only a first guess).
  // The slide is the touching vertices' mean straying from that speed; for a clip that stands, from rest.
  const touching = [];
  for (let i = 1; i < n; i++) {
    const a = rows[i - 1],
      b = rows[i],
      dt = b.t - a.t;
    if (!(dt > 0)) continue;
    const frame = [];
    for (const side of ['left', 'right'])
      a.foot[side].forEach((p, v) => {
        const q = b.foot[side][v];
        if (q && p[1] < lines.planted * height && q[1] < lines.planted * height)
          frame.push([(q[0] - p[0]) / dt, (q[2] - p[2]) / dt]);
      });
    // One velocity per frame (the frame's median contact), so a large sole does not outvote time.
    if (frame.length) {
      frame.sort((x, y) => Math.hypot(...x) - Math.hypot(...y));
      touching.push(frame[Math.floor(frame.length / 2)]);
    }
  }
  const median = (values) => {
    const s = [...values].sort((x, y) => x - y);
    return s.length ? s[Math.floor(s.length / 2)] : 0;
  };
  const keep = speedMps > 0 ? Math.max(0, -median(touching.map(([, vz]) => vz))) : 0;
  const slips = touching.map(([vx, vz]) => Math.hypot(vx, vz + keep));
  const slide = slips.length ? slips.reduce((a, b) => a + b, 0) / slips.length : 0;
  const reasons = [];
  // A run or a jump leaves the floor on purpose: it floats only if it never comes down.
  const airborne = jump || speedMps > 0;
  if (insideFrames > lines.insideFrames * n) reasons.push('hand-in-body');
  if (airborne ? Math.min(...lowest) > lines.float * height : floatFrames > lines.floatFrames * n)
    reasons.push('floating');
  if (sinkFrames > lines.sinkFrames * n) reasons.push('sinking');
  if (keep > 0 ? slide > lines.slideShare * keep : slide > lines.slide * height) reasons.push('sliding');
  return {
    pass: reasons.length === 0,
    reasons,
    jump,
    frames: n,
    insideShare: +(insideFrames / n).toFixed(3),
    maxInside: Math.max(...rows.map((r) => Math.max(r.inside.left, r.inside.right))),
    floatShare: +(floatFrames / n).toFixed(3),
    sinkShare: +(sinkFrames / n).toFixed(3),
    lowestSole: { min: +(Math.min(...lowest) / height).toFixed(4), max: +(Math.max(...lowest) / height).toFixed(4) },
    slidePerHeight: +(slide / height).toFixed(4),
    // The speed to move this body at so its planted feet keep still (m/s; 0 for a clip in place).
    feetSpeedMps: +keep.toFixed(3),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i < 0 ? fallback : args[i + 1];
  };
  const vrm = opt('vrm'),
    dir = opt('dir'),
    out = opt('out');
  if (!vrm || !dir || !out) {
    console.error('Usage: check-motions.mjs --vrm <model.vrm> --dir <motions> --out <dir> [--only A,B] [--rows]');
    process.exit(2);
  }
  const only = new Set((opt('only', '') || '').split(',').filter(Boolean));
  await mkdir(out, { recursive: true });
  const names = (await readdir(dir)).filter((f) => f.endsWith('.vrma') && (!only.size || only.has(f.slice(0, -5))));
  const bundle = await build({
    stdin: { contents: viewer, resolveDir: root, loader: 'js' },
    bundle: true,
    write: false,
    format: 'iife',
    logLevel: 'silent',
  });
  const browser = await chromium.launch({ channel: 'chromium', headless: true, args: ['--use-angle=swiftshader'] });
  const report = { model: path.basename(vrm), lines: LINES, clips: {} };
  try {
    const page = await browser.newPage({ viewport: { width: 400, height: 400 } });
    const model = await readFile(vrm);
    await page.route('http://vrm.local/**', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/model.vrm') return route.fulfill({ body: model, contentType: 'model/gltf-binary' });
      const clip = decodeURIComponent(url.pathname.replace(/^\/clip\//, ''));
      return route.fulfill({ body: await readFile(path.join(dir, clip)), contentType: 'model/gltf-binary' });
    });
    await page.route('http://viewer.local/', (route) =>
      route.fulfill({ body: '<!doctype html><body style="margin:0"></body>', contentType: 'text/html' }),
    );
    await page.goto('http://viewer.local/');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    report.setup = await page.evaluate((size) => window.setup(size), 240);
    for (const name of names) {
      const base = name.slice(0, -5);
      let info = {};
      try {
        info = JSON.parse(await readFile(path.join(dir, base + '.json'), 'utf8'));
      } catch {}
      const frames = Math.max(12, Math.min(180, Math.round((info.seconds ?? 2) * 30) + 1));
      const result = await page.evaluate(([n, f]) => window.measureClip(n, f, 5, 'three-quarter'), [name, frames]);
      const verdict = judge(result.rows, result.height, info.speedMps ?? 0);
      report.clips[base] = {
        seconds: +result.duration.toFixed(3),
        loop: info.loop ?? null,
        speedMps: info.speedMps ?? 0,
        ...verdict,
      };
      // --rows: the per-frame measurements too, to study a verdict.
      if (args.includes('--rows'))
        await writeFile(
          path.join(out, base + '.rows.json'),
          JSON.stringify({ height: result.height, rows: result.rows }),
        );
      const sheet = await page.evaluate(async (shots) => {
        const size = 240,
          canvas = document.createElement('canvas');
        canvas.width = size * shots.length;
        canvas.height = size;
        const c = canvas.getContext('2d');
        for (const [i, src] of shots.entries()) {
          const img = new Image();
          img.src = src;
          await img.decode();
          c.drawImage(img, i * size, 0);
        }
        return canvas.toDataURL('image/png');
      }, result.shots);
      await writeFile(path.join(out, base + '.png'), Buffer.from(sheet.split(',')[1], 'base64'));
      console.log(`${verdict.pass ? 'PASS' : 'FAIL'} ${base} ${verdict.reasons.join(',')}`);
    }
  } finally {
    await browser.close();
  }
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 1));
  console.log('CHECK_MOTIONS ' + path.join(out, 'report.json'));
}
