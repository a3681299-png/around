export function mountDesktopShell(video: HTMLVideoElement) {
  const bar = document.querySelector<HTMLElement>('#desktop-bar')!;
  const wallpaper = document.querySelector<HTMLElement>('.desktop-lite')!;
  const canvas = wallpaper.querySelector('canvas')!;
  let ctx: CanvasRenderingContext2D | null | undefined;
  let frame: number | undefined;
  let mode: 'spatial' | 'basic' | undefined;

  function paint() {
    if (mode !== 'basic' || video.readyState < 2) return;
    ctx ??= canvas.getContext('2d', { alpha: false });
    if (!ctx) return;
    const fit = Math.min(canvas.width / video.videoWidth, canvas.height / video.videoHeight);
    const width = fit * video.videoWidth;
    const height = fit * video.videoHeight;
    ctx.fillStyle = '#07111b';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(video, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
  }
  function waitForVideo() {
    frame = video.requestVideoFrameCallback?.(() => {
      frame = undefined;
      if (mode !== 'basic') return;
      paint();
      waitForVideo();
    });
  }
  for (const event of ['loadeddata', 'seeked']) video.addEventListener(event, paint);
  // Older browsers can still show the same player; timeupdate supplies their monitor frames.
  if (!video.requestVideoFrameCallback) video.addEventListener('timeupdate', paint);

  return {
    show(next: typeof mode) {
      if (mode === next) return;
      mode = next;
      bar.hidden = mode === undefined;
      wallpaper.hidden = mode !== 'basic';
      if (mode) document.body.dataset.desktop = mode;
      else delete document.body.dataset.desktop;
      if (mode === 'basic') {
        paint();
        waitForVideo();
      } else if (frame !== undefined) {
        video.cancelVideoFrameCallback(frame);
        frame = undefined;
      }
    },
  };
}
