import {
  Color,
  DirectionalLight,
  ExternalTexture,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  VideoTexture,
  WebGLRenderer,
  WebGLRenderTarget,
  MathUtils,
} from 'three';
import { CSS3DObject, CSS3DRenderer } from 'three/addons/renderers/CSS3DRenderer.js';
import { attachDrawable } from '../browser/html-in-canvas';
import type { AssetPort } from '../assets/port';
import { glassMaterial, interfaceMaterial } from './glass';
import { loadResident, type ResidentAssets } from './resident';
import { mountRoom } from './room';

declare const __WW_PLAYGROUND_TEST__: boolean;

type Spatial = { exit: (immediate?: boolean) => void; cancelExit: () => void };

function flatHandoff(page: HTMLElement, video: HTMLVideoElement) {
  // The drawable DOM is hidden before its first paint record exists. Keep that gap visual only.
  const cover = page.cloneNode(true) as HTMLElement;
  const frame = document.createElement('canvas');
  frame.width = video.videoWidth || 1;
  frame.height = video.videoHeight || 1;
  if (video.readyState >= 2) frame.getContext('2d')?.drawImage(video, 0, 0);
  cover.querySelector('video')!.replaceWith(frame);
  for (const element of [cover, ...cover.querySelectorAll('*')]) {
    element.removeAttribute('id');
    for (const name of element.getAttributeNames()) if (name.startsWith('data-ww-')) element.removeAttribute(name);
  }
  cover.className = 'playground-handoff';
  cover.inert = true;
  return cover;
}

export function openSpatial(
  page: HTMLElement,
  video: HTMLVideoElement,
  assets: AssetPort,
  residentAssets: ResidentAssets,
  closed: (reason?: 'graphics' | 'resize') => void,
  preferCanvas = true,
): Spatial | null {
  const width = window.innerWidth;
  const height = window.innerHeight;
  if (
    width < 960 ||
    height < 720 ||
    width > 2400 ||
    height > 1600 ||
    page.scrollHeight > height ||
    window.scrollY !== 0 ||
    !CSS.supports('transform-style', 'preserve-3d') ||
    (window.visualViewport?.scale ?? 1) !== 1
  )
    return null;

  const glCanvas = document.createElement('canvas');
  const context = glCanvas.getContext('webgl2', {
    alpha: false,
    antialias: true,
    powerPreference: 'low-power',
    // Software rendering stays available to browser tests. In the demo it can stall native input.
    failIfMajorPerformanceCaveat: !__WW_PLAYGROUND_TEST__,
  });
  if (!context) return null;
  if (!__WW_PLAYGROUND_TEST__) {
    const info = context.getExtension('WEBGL_debug_renderer_info');
    const rendererName = info ? String(context.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
    if (/swiftshader|llvmpipe|softpipe|software rasterizer|microsoft basic render/i.test(rendererName)) {
      context.getExtension('WEBGL_lose_context')?.loseContext();
      return null;
    }
  }
  const gl = context;
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas: glCanvas, context: gl });
  } catch {
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return null;
  }
  const player = video.parentElement!;
  const playerRect = player.getBoundingClientRect();
  const pageRect = page.getBoundingClientRect();
  const parent = page.parentNode!;
  const focus =
    document.activeElement instanceof HTMLElement && page.contains(document.activeElement)
      ? document.activeElement
      : null;
  const stage = document.createElement('div');
  stage.className = 'playground-stage';
  const texture = gl.createTexture();
  let dirty = true;
  const drawable = preferCanvas
    ? attachDrawable(glCanvas, gl, page, () => {
        dirty = true;
      })
    : null;
  const cover = drawable ? flatHandoff(page, video) : null;
  const mode = drawable ? 'canvas' : 'css';
  const css = drawable ? null : new CSS3DRenderer();
  if (css) {
    css.domElement.className = 'playground-css3d';
    css.setSize(width, height);
    stage.append(glCanvas, css.domElement);
  } else {
    stage.append(glCanvas);
    stage.append(cover!);
  }
  parent.appendChild(stage);
  stage.dataset.mode = mode;
  const pageStyles = page.getAttribute('style');
  page.dataset.spatial = mode;
  page.style.width = `${width}px`;
  page.style.height = `${height}px`;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  page.inert = true;

  const pixelRatio = drawable ? window.devicePixelRatio : 1;
  const maxBuffer = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array;
  renderer.setPixelRatio(Math.min(pixelRatio, maxBuffer[0]! / width, maxBuffer[1]! / height));
  renderer.setSize(width, height, false);
  renderer.autoClear = false;
  const room = new Scene();
  const { videoLight, lights } = mountRoom(room);
  const scene = new Scene();
  scene.add(lights.clone());
  const fill = new DirectionalLight(0xf9e6db, 2);
  fill.position.set(200, 350, 500);
  scene.add(fill);
  const camera = new PerspectiveCamera(40, width / height, 10, 6000);
  const board = new Group();
  scene.add(board);
  const cssBoard = css ? new CSS3DObject(page) : null;
  if (cssBoard) board.add(cssBoard);
  const glassTarget = drawable ? new WebGLRenderTarget(Math.ceil(width / 3), Math.ceil(height / 3)) : null;
  const glass = glassTarget ? glassMaterial(glassTarget.texture) : null;
  const boardGeometry = new PlaneGeometry(width, height);
  if (glass) {
    const slab = new Mesh(boardGeometry, glass);
    slab.position.z = -0.3;
    renderer.getDrawingBufferSize(glass.uniforms.resolution!.value);
    glass.uniforms.aspect!.value = width / height;
    board.add(slab);
  }
  const ui = new ExternalTexture(texture);
  ui.colorSpace = SRGBColorSpace;
  const uiMaterial = interfaceMaterial(ui, width / height);
  const uiMesh = new Mesh(boardGeometry, uiMaterial);
  uiMesh.renderOrder = 1;
  uiMesh.visible = false;
  if (drawable) board.add(uiMesh);
  let videoTexture: VideoTexture | undefined;
  let videoSize = '';
  const videoGeometry = new PlaneGeometry(1, 1);
  const videoMaterial = new MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false });
  const black = new MeshBasicMaterial({ color: 0x000000 });
  const screen = new Mesh(videoGeometry, videoMaterial);
  const playerBacking = new Mesh(videoGeometry, black);
  playerBacking.scale.set(playerRect.width, playerRect.height, 1);
  playerBacking.position.set(
    playerRect.left - pageRect.left + playerRect.width / 2 - width / 2,
    height / 2 - (playerRect.top - pageRect.top) - playerRect.height / 2,
    -0.17,
  );
  screen.position.copy(playerBacking.position);
  screen.position.z = -0.12;
  screen.visible = false;
  if (drawable) board.add(playerBacking, screen);
  const sample = document.createElement('canvas');
  sample.width = sample.height = 4;
  const sampler = sample.getContext('2d', { willReadFrequently: true });
  const light = new Color(0x8cc7ff);
  const aim = new Vector2();
  const look = new Vector2();
  const still = new Vector2();
  const clipToPixels = new Matrix4().set(
    width / 2,
    0,
    0,
    width / 2,
    0,
    -height / 2,
    0,
    height / 2,
    0,
    0,
    1,
    0,
    0,
    0,
    0,
    1,
  );
  const pixelsToBoard = new Matrix4().set(1, 0, 0, -width / 2, 0, -1, 0, height / 2, 0, 0, 1, 0, 0, 0, 0, 1);
  const transform = new Matrix4();
  const videoCenter = new Vector3();
  const listeners = new AbortController();
  const options = { signal: listeners.signal };
  let alive = true;
  let resident: Awaited<ReturnType<typeof loadResident>> | undefined;
  let frame = 0;
  let lastDraw = 0;
  let lastSample = -Infinity;
  let residentTime = 0;
  let lightStrength = 0;
  let progress = 0;
  let target = 1;
  const firstPaintAt = performance.now();
  let videoChanged = true;
  let sampleChanged = true;
  let lastGeometry = '';
  void loadResident(assets, residentAssets)
    .then((result) => {
      if (!alive) {
        result.dispose();
        return;
      }
      resident = result;
      board.add(result.root);
    })
    .catch((error: unknown) => console.warn('[WWT Playground] Resident', error));

  function restore(reason?: 'graphics' | 'resize') {
    if (!alive) return;
    alive = false;
    listeners.abort();
    cancelAnimationFrame(frame);
    drawable?.dispose();
    parent.insertBefore(page, stage);
    stage.remove();
    page.inert = false;
    delete page.dataset.spatial;
    if (pageStyles === null) page.removeAttribute('style');
    else page.setAttribute('style', pageStyles);
    for (const object of [
      boardGeometry,
      uiMaterial,
      ui,
      videoGeometry,
      videoMaterial,
      videoTexture,
      black,
      glass,
      glassTarget,
    ])
      object?.dispose();
    room.traverse((object) => {
      if (object instanceof Mesh) {
        object.geometry.dispose();
        object.material.dispose();
      }
    });
    resident?.dispose();
    gl.deleteTexture(texture);
    renderer.dispose();
    renderer.forceContextLoss();
    focus?.focus({ preventScroll: true });
    closed(reason);
  }
  function tick(now: number) {
    const transitioning = progress !== target;
    if (!transitioning && !dirty && now - lastDraw < 30) {
      frame = requestAnimationFrame(tick);
      return;
    }
    const elapsed = lastDraw ? (now - lastDraw) / 1000 : 0;
    const delta = Math.min(elapsed, 0.075);
    lastDraw = now;
    const step = reduce.matches ? 1 : elapsed / 0.56;
    if (!target) progress = Math.max(0, progress - step);
    if (!target && progress === 0) {
      restore();
      return;
    }
    if (drawable && dirty) {
      dirty = false;
      try {
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        if (!drawable.upload()) throw new Error('Drawable has no size yet.');
        uiMesh.visible = true;
      } catch {
        if (uiMesh.visible) {
          restore('graphics');
          return;
        }
        dirty = now - firstPaintAt < 500;
      } finally {
        if (alive) {
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
          renderer.resetState();
        }
      }
    }
    if (drawable && !uiMesh.visible) {
      // Older Chromium has no cached record until the first paint. It cannot sync before then.
      if (now - firstPaintAt >= 500) {
        restore('graphics');
        return;
      }
    } else if (target) {
      progress = Math.min(1, progress + step);
    }
    const reveal = MathUtils.smootherstep(progress, 0, 1);
    if (css && transitioning) page.style.setProperty('--room-reveal', `${reveal * 100}%`);
    look.lerp(reduce.matches ? still : aim, 1 - Math.exp(-delta * 6));
    const distance = 940 + 620 * reveal;
    const focal = (height * 0.5) / (940 + 235 * reveal);
    camera.position.set(look.x * 110 * reveal, look.y * 56 * reveal, distance);
    camera.lookAt(look.x * 75 * reveal, look.y * 42 * reveal, 0);
    camera.fov = MathUtils.radToDeg(2 * Math.atan(focal));
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    board.rotation.set(-0.105 * reveal, -0.24 * reveal, 0.018 * reveal);
    board.updateMatrixWorld(true);
    const videoReady = video.readyState >= 2;
    screen.visible = Boolean(drawable && videoReady);
    if (screen.visible && videoChanged) {
      const { videoWidth, videoHeight } = video;
      const size = `${videoWidth}x${videoHeight}`;
      if (videoSize !== size) {
        videoSize = size;
        videoTexture?.dispose();
        videoTexture = new VideoTexture(video);
        videoTexture.colorSpace = SRGBColorSpace;
        videoMaterial.map = videoTexture;
        videoMaterial.needsUpdate = true;
        // Match the native video's aspect ratio, including the black bars and transparent pixels.
        const fit = Math.min(playerRect.width / videoWidth, playerRect.height / videoHeight);
        screen.scale.set(videoWidth * fit, videoHeight * fit, 1);
      }
      videoTexture!.needsUpdate = true;
      videoChanged = false;
    }
    if (!reduce.matches && sampler && videoReady && (sampleChanged || !video.paused) && now - lastSample >= 360) {
      lastSample = now;
      sampleChanged = false;
      sampler.drawImage(video, 0, 0, 4, 4);
      const bytes = sampler.getImageData(0, 0, 4, 4).data;
      let r = 0,
        g = 0,
        b = 0;
      for (let i = 0; i < bytes.length; i += 4) {
        const alpha = bytes[i + 3]! / 255;
        r += bytes[i]! * alpha;
        g += bytes[i + 1]! * alpha;
        b += bytes[i + 2]! * alpha;
      }
      const strongest = Math.max(r, g, b, 1);
      light.setRGB(
        0.18 + (0.82 * r) / strongest,
        0.18 + (0.82 * g) / strongest,
        0.18 + (0.82 * b) / strongest,
        SRGBColorSpace,
      );
      lightStrength = Math.max(0.07, Math.sqrt((r + g + b) / 12240));
    }
    screen.getWorldPosition(videoCenter);
    videoLight.position.set(videoCenter.x, videoCenter.y, videoCenter.z - 215);
    videoLight.color.lerp(light, 1 - Math.exp(-delta * 3));
    videoLight.intensity = reveal * MathUtils.damp(videoLight.intensity, lightStrength * 5200000, 3, delta);
    uiMaterial.uniforms.reveal!.value = reveal;
    if (glass) {
      glass.uniforms.reveal!.value = reveal;
      glass.uniforms.tint!.value.copy(videoLight.color);
    }
    if (resident && progress === 1 && !reduce.matches) residentTime += delta;
    resident?.update(residentTime, reduce.matches ? 0 : delta, width, height, reduce.matches);
    if (resident) resident.root.visible = reveal > 0.8;

    if (glassTarget) {
      renderer.setRenderTarget(glassTarget);
      renderer.clear();
      renderer.render(room, camera);
      renderer.setRenderTarget(null);
    }
    renderer.clear();
    renderer.render(room, camera);
    renderer.render(scene, camera);
    css?.render(scene, camera);
    if (drawable && uiMesh.visible) {
      transform
        .copy(clipToPixels)
        .multiply(camera.projectionMatrix)
        .multiply(camera.matrixWorldInverse)
        .multiply(board.matrixWorld)
        .multiply(pixelsToBoard);
      const normalized = transform.multiplyScalar(1 / transform.elements[15]!);
      const geometry = normalized.elements.join(',');
      if (geometry !== lastGeometry) {
        lastGeometry = geometry;
        try {
          drawable.sync(new DOMMatrix(normalized.elements));
        } catch {
          restore('graphics');
          return;
        }
      }
      cover?.remove();
    }
    if (progress === 1 && page.inert) {
      page.inert = false;
      delete stage.dataset.transition;
      focus?.focus({ preventScroll: true });
    }
    frame = requestAnimationFrame(tick);
  }
  window.addEventListener(
    'pointermove',
    (event) => {
      if (progress !== 1 || !target) return;
      // Keep geometry fixed while a control owns a pointer gesture, including range dragging.
      if (!event.buttons && !page.contains(event.target as Node))
        aim.set((event.clientX / width) * 2 - 1, 1 - (event.clientY / height) * 2);
      else aim.copy(look);
    },
    options,
  );
  window.addEventListener('pointerdown', () => aim.copy(look), options);
  window.addEventListener('resize', () => restore('resize'), options);
  for (const event of ['loadeddata', 'seeked', 'resize'])
    video.addEventListener(
      event,
      () => {
        videoChanged = sampleChanged = true;
      },
      options,
    );
  glCanvas.addEventListener('webglcontextlost', () => restore('graphics'), options);
  stage.dataset.transition = '';
  drawable?.requestPaint();
  frame = requestAnimationFrame(tick);
  return {
    exit(immediate) {
      if (immediate) restore();
      else {
        target = 0;
        page.inert = true;
        stage.dataset.transition = '';
      }
    },
    cancelExit() {
      target = 1;
    },
  };
}
