import {
  BoxGeometry,
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
import { attachDrawable, drawableMode } from '../browser/html-in-canvas';
import type { AssetPort } from '../assets/port';
import { glassMaterial, interfaceMaterial } from './glass';
import { boardSeat, loadResident, type ResidentAssets } from './resident';
import { mountRoom } from './room';
import type { DesktopLayout } from './desktop-layout';

declare const __WW_PLAYGROUND_TEST__: boolean;

export type Spatial = {
  exit: (immediate?: boolean) => void;
  cancelExit: () => void;
};
export type PreparedSpatial = {
  mode: 'canvas' | 'css';
  ready: Promise<void>;
  activate: (snap: boolean) => Spatial | null;
  dispose: () => void;
};
const FLAT_DISTANCE = 3250;

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

export function prepareSpatial(
  page: HTMLElement,
  video: HTMLVideoElement,
  assets: AssetPort,
  residentAssets: ResidentAssets,
  layout: DesktopLayout,
  closed: (reason?: 'graphics' | 'resize') => void,
  preferCanvas = true,
): PreparedSpatial | null {
  const width = window.innerWidth;
  const height = window.innerHeight;
  if (
    width < 960 ||
    height < 650 ||
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
  const controlsBottom = page.querySelector('.controls')!.getBoundingClientRect().bottom - pageRect.top;
  const lowerHeadroom = height - controlsBottom - 12;
  const parent = page.parentNode!;
  let focus: HTMLElement | null = null;
  const stage = document.createElement('div');
  stage.className = 'playground-stage';
  const texture = gl.createTexture();
  let alive = true;
  let active = false;
  let frame: number | undefined;
  let videoFrame: number | undefined;
  function wake() {
    if (alive && active && frame === undefined) frame = requestAnimationFrame(tick);
  }
  let dirty = true;
  const canvasMode = preferCanvas && Boolean(drawableMode(glCanvas, gl));
  const mode = canvasMode ? 'canvas' : 'css';
  let drawable: ReturnType<typeof attachDrawable> = null;
  let cover: HTMLElement | null = null;
  let pageStyles: string | null = null;
  stage.append(glCanvas);
  stage.dataset.mode = mode;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');

  const pixelRatio = canvasMode ? window.devicePixelRatio : 1;
  const maxBuffer = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array;
  renderer.setPixelRatio(Math.min(pixelRatio, maxBuffer[0]! / width, maxBuffer[1]! / height));
  renderer.setSize(width, height, false);
  renderer.autoClear = false;
  const room = new Scene();
  const mountedRoom = mountRoom(room, layout, assets, renderer);
  const { videoLight, lights } = mountedRoom;
  const fill = new DirectionalLight(0xf9e6db, 2);
  fill.position.set(200, 350, 500);
  const browserScene = new Scene();
  browserScene.add(lights.clone(), fill);
  const camera = new PerspectiveCamera(40, width / height, 10, 6000);
  const board = new Group();
  browserScene.add(board);
  const ledgeGeometry = new BoxGeometry(104, 6, 44);
  const ledgeMaterial = new MeshBasicMaterial({ color: 0x9db0c4 });
  for (const edge of ['lower', 'upper'] as const) {
    const ledge = new Mesh(ledgeGeometry, ledgeMaterial);
    ledge.position.copy(boardSeat(edge, width, height));
    ledge.position.y -= 3;
    ledge.position.z -= 17;
    board.add(ledge);
  }
  const glassTarget = new WebGLRenderTarget(Math.ceil(width / 3), Math.ceil(height / 3));
  const glass = glassMaterial(glassTarget.texture);
  const boardGeometry = new PlaneGeometry(width, height);
  const slab = new Mesh(boardGeometry, glass);
  slab.position.z = -0.3;
  renderer.getDrawingBufferSize(glass.uniforms.resolution!.value);
  glass.uniforms.aspect!.value = width / height;
  board.add(slab);
  const ui = new ExternalTexture(texture);
  ui.colorSpace = SRGBColorSpace;
  const uiMaterial = interfaceMaterial(ui, width / height);
  const uiMesh = new Mesh(boardGeometry, uiMaterial);
  uiMesh.renderOrder = 1;
  uiMesh.visible = false;
  if (canvasMode) board.add(uiMesh);
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
  if (canvasMode) board.add(playerBacking, screen);
  const sample = document.createElement('canvas');
  sample.width = sample.height = 4;
  const sampler = sample.getContext('2d', { willReadFrequently: true });
  const light = new Color(0x8cc7ff);
  const aim = new Vector2();
  const look = new Vector2();
  const still = new Vector2();
  const pointer = new Vector2(Infinity, Infinity);
  const lowerSeat = new Vector3();
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
  let resident: Awaited<ReturnType<typeof loadResident>> | undefined;
  let lastDraw = 0;
  let lastSample = -Infinity;
  let residentTime = 0;
  let lightStrength = 0;
  let progress = 0;
  let target = 1;
  let fade: Animation | undefined;
  let activatedAt = 0;
  let firstVisible = false;
  let firstResident = false;
  let snap = false;
  let videoChanged = true;
  let sampleChanged = true;
  let lastGeometry = '';
  function bindUITexture() {
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }
  function updateVideoTexture() {
    const { videoWidth, videoHeight } = video;
    const size = `${videoWidth}x${videoHeight}`;
    if (videoSize !== size) {
      videoSize = size;
      videoTexture?.dispose();
      videoTexture = new VideoTexture(video);
      videoTexture.colorSpace = SRGBColorSpace;
      videoMaterial.map = videoTexture;
      videoMaterial.needsUpdate = true;
      if (videoWidth && videoHeight) {
        // Match the native video's aspect ratio, including the black bars and transparent pixels.
        const fit = Math.min(playerRect.width / videoWidth, playerRect.height / videoHeight);
        screen.scale.set(videoWidth * fit, videoHeight * fit, 1);
      }
    }
    if (video.readyState >= 2) videoTexture!.needsUpdate = true;
  }
  const residentReady = loadResident(assets, residentAssets)
    .then((result) => {
      if (!alive) {
        result.dispose();
        return;
      }
      resident = result;
      board.add(result.root);
    })
    .catch((error: unknown) => console.warn('[WWT Playground] Resident', error));

  // Use both targets from the reveal. The onscreen sRGB and offscreen linear programs differ.
  // A small viewport warms the visible programs without capturing or moving the native page.
  const ready = Promise.all([residentReady, mountedRoom.ready])
    .then(async () => {
      if (!alive) return;
      if (resident)
        resident.updateBoard(0, 0, width, height, lowerHeadroom, {
          flee: false,
          show: true,
          reduced: true,
        });
      camera.position.z = FLAT_DISTANCE;
      camera.updateMatrixWorld();
      if (canvasMode) {
        updateVideoTexture();
        bindUITexture();
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        renderer.resetState();
        uiMesh.visible = true;
        screen.visible = video.readyState >= 2;
      }
      await renderer.compileAsync(room, camera);
      if (!alive) return;
      await renderer.compileAsync(browserScene, camera);
      if (!alive) return;
      renderer.setViewport(0, 0, 16, 16);
      try {
        renderer.setRenderTarget(glassTarget);
        renderer.clear();
        renderer.render(room, camera);
        renderer.setRenderTarget(null);
        renderer.clear();
        renderer.render(room, camera);
        renderer.clearDepth();
        renderer.render(browserScene, camera);
      } finally {
        renderer.setRenderTarget(null);
        renderer.setViewport(0, 0, width, height);
        uiMesh.visible = false;
      }
    })
    .catch((error: unknown) => {
      console.warn('[WWT Playground] Graphics preparation', error);
      restore('graphics');
    });

  function restore(reason?: 'graphics' | 'resize') {
    if (!alive) return;
    alive = false;
    listeners.abort();
    if (frame !== undefined) cancelAnimationFrame(frame);
    if (videoFrame !== undefined) video.cancelVideoFrameCallback(videoFrame);
    fade?.cancel();
    if (active) {
      drawable?.dispose();
      parent.insertBefore(page, stage);
      stage.remove();
      page.inert = false;
      delete page.dataset.spatial;
      if (pageStyles === null) page.removeAttribute('style');
      else page.setAttribute('style', pageStyles);
    }
    for (const object of [
      boardGeometry,
      ledgeGeometry,
      ledgeMaterial,
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
    mountedRoom.dispose();
    resident?.dispose();
    gl.deleteTexture(texture);
    renderer.dispose();
    renderer.forceContextLoss();
    if (active) {
      if (document.activeElement === document.body) focus?.focus({ preventScroll: true });
      closed(reason);
    }
  }
  function tick(now: number) {
    frame = undefined;
    if (progress === target && !dirty && now - lastDraw < 30) {
      wake();
      return;
    }
    const elapsed = lastDraw ? (now - lastDraw) / 1000 : 0;
    const delta = Math.min(elapsed, 0.075);
    lastDraw = now;
    const step = snap || reduce.matches ? 1 : delta / 0.74;
    if (!target) progress = Math.max(0, progress - step);
    if (!target && progress === 0) {
      restore();
      return;
    }
    if (drawable && dirty) {
      dirty = false;
      try {
        bindUITexture();
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        if (!drawable.upload()) throw new Error('Drawable has no size yet.');
        uiMesh.visible = true;
      } catch {
        if (uiMesh.visible) {
          restore('graphics');
          return;
        }
        dirty = now - activatedAt < 500;
      } finally {
        if (alive) {
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
          renderer.resetState();
        }
      }
    }
    if (drawable && !uiMesh.visible) {
      // Older Chromium has no cached record until the first paint. It cannot sync before then.
      if (now - activatedAt >= 500) {
        restore('graphics');
        return;
      }
    } else if (target) {
      progress = Math.min(1, progress + step);
    }
    const reveal = MathUtils.smootherstep(progress, 0, 1);
    look.lerp(reduce.matches ? still : aim, 1 - Math.exp(-delta * 6));
    const distance = MathUtils.lerp(FLAT_DISTANCE, 1560, reveal);
    // Shrink the window early enough to keep the first posed frame inside the viewport.
    const windowReveal = MathUtils.smoothstep(progress, 0, 0.7);
    const focal = MathUtils.lerp(1, 1175 / 1560, windowReveal) * distance;
    camera.position.set(look.x * 110 * reveal, look.y * 56 * reveal, distance);
    camera.fov = MathUtils.radToDeg(2 * Math.atan(height / (2 * focal)));
    camera.updateProjectionMatrix();
    camera.projectionMatrix.elements[8] = (-70 * look.x * reveal * focal) / (distance * width);
    camera.projectionMatrix.elements[9] =
      (-28 * look.y * reveal * focal) / (distance * height) - 0.075 * Math.sin(Math.PI * progress);
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    camera.updateMatrixWorld();
    board.rotation.set(-0.105 * reveal, -0.24 * reveal, 0.018 * reveal);
    board.updateMatrixWorld(true);
    const videoReady = video.readyState >= 2;
    screen.visible = Boolean(drawable && videoReady);
    if (screen.visible && videoChanged) {
      updateVideoTexture();
      videoChanged = false;
    }
    if (sampler && videoReady && sampleChanged && now - lastSample >= 360) {
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
    glass.uniforms.reveal!.value = reveal;
    glass.uniforms.tint!.value.copy(videoLight.color);
    if (resident) {
      const animateResident = progress === 1 && !reduce.matches && target === 1;
      if (animateResident) residentTime += delta;
      boardSeat('lower', width, height, lowerSeat).y += 39;
      lowerSeat.applyMatrix4(board.matrixWorld).project(camera);
      const near =
        Math.hypot(pointer.x - ((lowerSeat.x + 1) * width) / 2, pointer.y - ((1 - lowerSeat.y) * height) / 2) < 85;
      resident.updateBoard(residentTime, animateResident ? delta : 0, width, height, lowerHeadroom, {
        flee: animateResident && near,
        show: progress >= 0.25,
        reduced: reduce.matches,
      });
    }

    renderer.setRenderTarget(glassTarget);
    renderer.clear();
    renderer.render(room, camera);
    renderer.setRenderTarget(null);
    renderer.clear();
    renderer.render(room, camera);
    // The room sits below the native controls.
    renderer.clearDepth();
    renderer.render(browserScene, camera);
    if (!drawable || uiMesh.visible) {
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
          const projection = new DOMMatrix(normalized.elements);
          if (drawable) drawable.sync(projection);
          else page.style.transform = projection.toString();
        } catch {
          restore('graphics');
          return;
        }
      }
      cover?.remove();
      if (!firstVisible) {
        firstVisible = true;
        performance.mark('playground:spatial-frame', { detail: mode });
      }
      if (!firstResident && resident?.root.visible) {
        firstResident = true;
        performance.mark('playground:resident-frame');
      }
    }
    if (progress === 1 && target === 1 && page.inert) {
      page.inert = false;
      delete stage.dataset.transition;
      snap = false;
      if (document.activeElement === document.body) focus?.focus({ preventScroll: true });
    }
    wake();
  }
  window.addEventListener(
    'pointermove',
    (event) => {
      if (!active) return;
      pointer.set(event.clientX, event.clientY);
      if (progress !== 1 || !target) return;
      // Keep geometry fixed while a control owns a pointer gesture, including range dragging.
      if (!event.buttons && !page.contains(event.target as Node))
        aim.set((event.clientX / width) * 2 - 1, 1 - (event.clientY / height) * 2);
      else aim.copy(look);
    },
    options,
  );
  stage.addEventListener('pointerleave', () => pointer.set(Infinity, Infinity), options);
  window.addEventListener('pointerdown', () => aim.copy(look), options);
  glCanvas.addEventListener('webglcontextlost', () => restore('graphics'), options);
  function waitForVideo() {
    videoFrame = video.requestVideoFrameCallback?.(() => {
      sampleChanged = true;
      if (drawable) videoChanged = true;
      waitForVideo();
    });
  }
  const spatial: Spatial = {
    exit(immediate) {
      if (immediate) restore();
      else {
        target = 0;
        page.inert = true;
        stage.dataset.transition = '';
        wake();
      }
    },
    cancelExit() {
      target = 1;
      wake();
    },
  };
  return {
    mode,
    ready,
    activate(instant) {
      if (!alive || window.scrollY !== 0 || (window.visualViewport?.scale ?? 1) !== 1) {
        restore();
        return null;
      }
      active = true;
      activatedAt = performance.now();
      snap = instant;
      stage.dataset.transition = '';
      focus =
        document.activeElement instanceof HTMLElement && page.contains(document.activeElement)
          ? document.activeElement
          : null;
      pageStyles = page.getAttribute('style');
      if (canvasMode) {
        cover = flatHandoff(page, video);
        stage.append(cover);
        drawable = attachDrawable(glCanvas, gl, page, () => {
          dirty = true;
          wake();
        });
      } else {
        const css = document.createElement('div');
        css.className = 'playground-css3d';
        css.append(page);
        stage.append(css);
      }
      page.dataset.spatial = mode;
      page.style.width = `${width}px`;
      page.style.height = `${height}px`;
      page.inert = true;
      parent.appendChild(stage);
      if (reduce.matches) fade = stage.animate({ opacity: [0.65, 1] }, { duration: 190, easing: 'ease-out' });
      window.addEventListener('resize', () => restore('resize'), options);
      for (const event of ['loadeddata', 'seeked', 'resize', 'emptied'])
        video.addEventListener(
          event,
          () => {
            videoChanged = sampleChanged = true;
            lastSample = -Infinity;
            wake();
          },
          options,
        );
      drawable?.requestPaint();
      waitForVideo();
      wake();
      return spatial;
    },
    dispose: () => restore(),
  };
}
