import {
  BoxGeometry,
  CatmullRomCurve3,
  CircleGeometry,
  Color,
  DirectionalLight,
  ExternalTexture,
  Group,
  LineCurve3,
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
  type Curve,
} from 'three';
import { attachDrawable } from '../browser/html-in-canvas';
import type { AssetPort } from '../assets/port';
import { glassMaterial, interfaceMaterial } from './glass';
import { boardSeat, loadResident, type ResidentAssets } from './resident';
import { createRoomCache, mountRoom, positionMonitor } from './room';
import type { DesktopLayout } from './desktop-layout';

declare const __AROUND_PLAYGROUND_TEST__: boolean;

type Spatial = { exit: (immediate?: boolean) => void; cancelExit: () => void; setDesktop: (active: boolean) => void };

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
    for (const name of element.getAttributeNames()) if (name.startsWith('data-around-')) element.removeAttribute(name);
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
  layout: DesktopLayout,
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
    failIfMajorPerformanceCaveat: !__AROUND_PLAYGROUND_TEST__,
  });
  if (!context) return null;
  if (!__AROUND_PLAYGROUND_TEST__) {
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
  const focus =
    document.activeElement instanceof HTMLElement && page.contains(document.activeElement)
      ? document.activeElement
      : null;
  const stage = document.createElement('div');
  stage.className = 'playground-stage';
  const texture = gl.createTexture();
  let alive = true;
  let frame: number | undefined;
  let videoFrame: number | undefined;
  function wake() {
    if (alive && frame === undefined) frame = requestAnimationFrame(tick);
  }
  let dirty = true;
  const drawable = preferCanvas
    ? attachDrawable(glCanvas, gl, page, () => {
        dirty = true;
        wake();
      })
    : null;
  const cover = drawable ? flatHandoff(page, video) : null;
  const mode = drawable ? 'canvas' : 'css';
  const css = drawable ? null : document.createElement('div');
  const pageStyles = page.getAttribute('style');
  if (css) {
    css.className = 'playground-css3d';
    css.append(page);
    stage.append(glCanvas, css);
  } else {
    stage.append(glCanvas);
    stage.append(cover!);
  }
  parent.appendChild(stage);
  stage.dataset.mode = mode;
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
  const desktopButton = page.querySelector<HTMLButtonElement>('#open-desktop')!;
  desktopButton.disabled = Boolean(layout.room);
  let roomCached = false;
  let roomCache: ReturnType<typeof createRoomCache> | undefined;
  const mountedRoom = mountRoom(room, layout, assets, renderer, () => {
    desktopButton.disabled = false;
    roomCached = false;
    wake();
  });
  const { videoLight, lights } = mountedRoom;
  const scene = new Scene();
  scene.add(lights.clone());
  const fill = new DirectionalLight(0xf9e6db, 2);
  fill.position.set(200, 350, 500);
  scene.add(fill);
  const browserScene = new Scene();
  browserScene.add(lights.clone(), fill.clone());
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
  const monitor = new Group();
  positionMonitor(monitor, layout.monitor);
  monitor.visible = false;
  scene.add(monitor);
  const [monitorWidth, monitorHeight] = layout.monitor.size;
  const monitorBackingMaterial = new MeshBasicMaterial({ color: drawable ? 0xc7d5dd : 0x07111b });
  const monitorBacking = new Mesh(videoGeometry, monitorBackingMaterial);
  monitorBacking.scale.set(monitorWidth, monitorHeight, 1);
  const monitorContent = new Group();
  monitor.add(monitorBacking, monitorContent);
  const monitorVideo = new Mesh(videoGeometry, videoMaterial);
  monitorVideo.visible = false;
  monitorContent.add(monitorVideo);
  const monitorUI = new Mesh(boardGeometry, uiMaterial);
  if (drawable) {
    // The two views sample the same HTML texture and the same video. Only the browser window
    // owns drawable geometry, so clicks never get routed to the copy inside the room.
    const fit = Math.min(monitorWidth / width, monitorHeight / height);
    monitorContent.scale.set(fit, fit, 1);
    const bars = playerBacking.clone();
    bars.position.z = 0.1;
    monitorContent.add(bars);
    monitorVideo.position.copy(screen.position);
    monitorVideo.position.z = 0.2;
    monitorUI.position.z = 0.3;
    monitorUI.renderOrder = 1;
    monitorContent.add(monitorUI);
  } else {
    monitorVideo.position.z = 0.1;
  }
  const shadowGeometry = new CircleGeometry(31, 32);
  const shadowMaterial = new MeshBasicMaterial({
    color: 0x111b22,
    opacity: 0.25,
    transparent: true,
    depthWrite: false,
  });
  const shadow = new Mesh(shadowGeometry, shadowMaterial);
  shadow.rotation.x = -Math.PI / 2;
  shadow.visible = false;
  scene.add(shadow);
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
  let desktopProgress = 0;
  let desktopTarget = false;
  let roomTime = 0;
  let roomWalking = false;
  let roomPath: Curve<Vector3> | undefined;
  let fade: Animation | undefined;
  const launchPoint = new Vector3();
  const landing = new Vector3();
  const viewer = new Vector3(layout.viewer[0], layout.floorY, layout.viewer[1]);
  const waypoints = layout.via.map(([x, z]) => new Vector3(x, layout.floorY, z));
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
      wake();
    })
    .catch((error: unknown) => console.warn('[Around Playground] Resident', error));

  function restore(reason?: 'graphics' | 'resize') {
    if (!alive) return;
    alive = false;
    listeners.abort();
    if (frame !== undefined) cancelAnimationFrame(frame);
    if (videoFrame !== undefined) video.cancelVideoFrameCallback(videoFrame);
    fade?.cancel();
    drawable?.dispose();
    parent.insertBefore(page, stage);
    stage.remove();
    page.inert = false;
    desktopButton.disabled = false;
    delete page.dataset.spatial;
    if (pageStyles === null) page.removeAttribute('style');
    else page.setAttribute('style', pageStyles);
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
      monitorBackingMaterial,
      shadowGeometry,
      shadowMaterial,
    ])
      object?.dispose();
    roomCache?.dispose();
    mountedRoom.dispose();
    resident?.dispose();
    gl.deleteTexture(texture);
    renderer.dispose();
    renderer.forceContextLoss();
    focus?.focus({ preventScroll: true });
    closed(reason);
  }
  function tick(now: number) {
    frame = undefined;
    const desktopEnd = Number(desktopTarget);
    const transitioning = progress !== target || desktopProgress !== desktopEnd;
    if (!transitioning && !dirty && now - lastDraw < 30 && (desktopProgress !== 1 || (roomWalking && !videoChanged))) {
      wake();
      return;
    }
    const elapsed = lastDraw ? (now - lastDraw) / 1000 : 0;
    const delta = Math.min(elapsed, 0.075);
    lastDraw = now;
    const step = reduce.matches ? 1 : delta / 0.56;
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
    if (progress === 1) {
      const step = reduce.matches ? 1 : delta / 1.15;
      desktopProgress = desktopTarget ? Math.min(1, desktopProgress + step) : Math.max(0, desktopProgress - step);
    }
    const showTaskbar = desktopTarget && desktopProgress >= 0.58;
    if (stage.hasAttribute('data-taskbar-ready') !== showTaskbar)
      stage.toggleAttribute('data-taskbar-ready', showTaskbar);
    const settledDesktop = progress === 1 && target === 1 && desktopProgress === 1 && desktopTarget;
    const reveal = MathUtils.smootherstep(progress, 0, 1);
    look.lerp(reduce.matches ? still : aim, 1 - Math.exp(-delta * 6));
    const dolly = MathUtils.smootherstep(desktopProgress, 0, 1);
    const dock = MathUtils.smootherstep(desktopProgress, 0.25, 1);
    const drift = reveal * (1 - dolly);
    const framing = MathUtils.lerp(1, MathUtils.clamp(width / 1280, 0.75, 1.15), dock);
    const browserDistance = 940 + 620 * reveal;
    const distance = browserDistance + 790 * dolly;
    // Dolly and focal length move together first. Docking the window is a separate part of the move.
    const focal = ((940 + 235 * reveal) * distance * framing) / browserDistance;
    const truck = layout.camera.truckX * dock;
    camera.position.set(look.x * 110 * drift + truck, look.y * 56 * drift, distance);
    camera.fov = MathUtils.radToDeg(2 * Math.atan(height / (2 * focal)));
    camera.updateProjectionMatrix();
    camera.projectionMatrix.elements[8] = ((-70 * look.x * drift - 2 * truck) * focal) / (distance * width);
    camera.projectionMatrix.elements[9] =
      (-28 * look.y * drift * focal) / (distance * height) + layout.camera.lensY * dolly;
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    camera.updateMatrixWorld();
    board.position.set((-width * 0.26 * dock) / framing, height * 0.025 * dock, 0);
    board.rotation.set(-0.105 * reveal * (1 - 0.7 * dock), -0.24 * reveal * (1 - 0.4 * dock), 0.018 * reveal);
    board.scale.setScalar((1 - 0.34 * dock) / framing);
    board.updateMatrixWorld(true);
    const videoReady = video.readyState >= 2;
    monitor.visible = desktopProgress > 0.08;
    monitorUI.visible = uiMesh.visible;
    screen.visible = Boolean(drawable && videoReady);
    monitorVideo.visible = videoReady;
    if ((screen.visible || (monitor.visible && videoReady)) && videoChanged) {
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
        const monitorFit = Math.min(monitorWidth / videoWidth, monitorHeight / videoHeight);
        if (drawable) monitorVideo.scale.copy(screen.scale);
        else monitorVideo.scale.set(videoWidth * monitorFit, videoHeight * monitorFit, 1);
      }
      videoTexture!.needsUpdate = true;
      videoChanged = false;
    }
    if (
      !settledDesktop &&
      !reduce.matches &&
      sampler &&
      videoReady &&
      (sampleChanged || !video.paused) &&
      now - lastSample >= 360
    ) {
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
    if (!settledDesktop) {
      screen.getWorldPosition(videoCenter);
      videoLight.position.set(videoCenter.x, videoCenter.y, videoCenter.z - 215);
      videoLight.color.lerp(light, 1 - Math.exp(-delta * 3));
      videoLight.intensity =
        (1 - dolly) * reveal * MathUtils.damp(videoLight.intensity, lightStrength * 5200000, 3, delta);
    } else {
      videoLight.intensity = 0;
    }
    uiMaterial.uniforms.reveal!.value = reveal;
    glass.uniforms.reveal!.value = reveal;
    glass.uniforms.tint!.value.copy(videoLight.color);
    if (resident && settledDesktop) {
      if (resident.root.parent === board) {
        boardSeat('lower', width, height, launchPoint).applyMatrix4(board.matrixWorld);
        landing.set(launchPoint.x + 24, layout.floorY, launchPoint.z + 94);
        roomPath = waypoints.length
          ? new CatmullRomCurve3([landing, ...waypoints, viewer])
          : new LineCurve3(landing, viewer);
        scene.add(resident.root);
        roomTime = 0;
        roomWalking = true;
      }
      if (roomWalking) {
        roomTime += delta;
        roomWalking = resident.updateRoom(
          roomTime,
          delta,
          launchPoint,
          roomPath!,
          board.scale.x,
          viewer,
          monitor.position,
          reduce.matches,
        );
        shadow.position.set(resident.root.position.x, layout.floorY + 6, resident.root.position.z);
        shadow.visible = resident.root.position.y <= layout.floorY + 10;
      }
    } else if (resident) {
      if (resident.root.parent !== board) board.add(resident.root);
      shadow.visible = false;
      const active = progress === 1 && !reduce.matches && desktopProgress === 0 && !desktopTarget;
      const leaving = desktopTarget && desktopProgress > 0;
      if (active || leaving) residentTime += delta;
      boardSeat('lower', width, height, lowerSeat).y += 39;
      lowerSeat.applyMatrix4(board.matrixWorld).project(camera);
      const near =
        Math.hypot(pointer.x - ((lowerSeat.x + 1) * width) / 2, pointer.y - ((1 - lowerSeat.y) * height) / 2) < 85;
      resident.updateBoard(residentTime, active || leaving ? delta : 0, width, height, lowerHeadroom, {
        flee: active && near,
        show: reveal > 0.8,
        reduced: reduce.matches,
        leaving,
      });
    }

    if (!settledDesktop || !roomCached) {
      renderer.setRenderTarget(glassTarget);
      renderer.clear();
      renderer.render(room, camera);
      renderer.setRenderTarget(null);
    }
    if (settledDesktop && !roomCached) {
      roomCache ??= createRoomCache(renderer);
      roomCache.capture(room, camera);
      roomCached = true;
    } else if (!settledDesktop) {
      roomCached = false;
    }
    renderer.clear();
    if (settledDesktop) roomCache!.draw();
    else renderer.render(room, camera);
    renderer.render(scene, camera);
    // Author-supplied furniture, the monitor and the room's resident stay below the usable window.
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
    }
    if (progress === 1 && target === 1 && desktopProgress === desktopEnd && page.inert) {
      page.inert = false;
      delete stage.dataset.transition;
      if (document.activeElement === document.body) {
        const target = desktopTarget ? document.querySelector<HTMLElement>('#close-desktop') : focus;
        target?.focus({ preventScroll: true });
      }
    }
    if (!settledDesktop || roomWalking) wake();
  }
  window.addEventListener(
    'pointermove',
    (event) => {
      pointer.set(event.clientX, event.clientY);
      if (progress !== 1 || !target || desktopTarget || desktopProgress !== 0) return;
      // Keep geometry fixed while a control owns a pointer gesture, including range dragging.
      if (!event.buttons && !page.contains(event.target as Node))
        aim.set((event.clientX / width) * 2 - 1, 1 - (event.clientY / height) * 2);
      else aim.copy(look);
    },
    options,
  );
  stage.addEventListener('pointerleave', () => pointer.set(Infinity, Infinity), options);
  window.addEventListener('pointerdown', () => aim.copy(look), options);
  window.addEventListener('resize', () => restore('resize'), options);
  for (const event of ['loadeddata', 'seeked', 'resize', 'emptied'])
    video.addEventListener(
      event,
      () => {
        videoChanged = sampleChanged = true;
        wake();
      },
      options,
    );
  glCanvas.addEventListener('webglcontextlost', () => restore('graphics'), options);
  stage.dataset.transition = '';
  drawable?.requestPaint();
  function waitForVideo() {
    videoFrame = video.requestVideoFrameCallback?.(() => {
      if (desktopProgress > 0 || drawable) {
        videoChanged = true;
        if (desktopTarget) wake();
      }
      waitForVideo();
    });
  }
  waitForVideo();
  wake();
  return {
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
    setDesktop(active) {
      if (desktopTarget === active) return;
      desktopTarget = active;
      stage.dataset.view = active ? 'desktop' : 'browser';
      stage.dataset.transition = '';
      page.inert = true;
      fade?.cancel();
      if (reduce.matches && progress === 1)
        fade = stage.animate({ opacity: [0.64, 1] }, { duration: 190, easing: 'ease-out' });
      wake();
    },
  };
}
