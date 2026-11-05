/** The site's own player and list (not the engine): play, seek, volume and switching videos. */
export function mountPlayer(doc: Document): void {
  const video = doc.querySelector<HTMLVideoElement>('video[data-ww-video]')!,
    play = doc.querySelector<HTMLButtonElement>('#play')!,
    seek = doc.querySelector<HTMLInputElement>('#seek')!,
    volume = doc.querySelector<HTMLInputElement>('#volume')!,
    title = doc.querySelector<HTMLElement>('#video-title')!;
  const label = () => {
    play.textContent = video.paused ? '再生' : '一時停止';
    play.setAttribute('aria-pressed', String(!video.paused));
  };
  play.addEventListener('click', () => {
    if (video.paused) void video.play().catch(() => undefined);
    else video.pause();
  });
  video.addEventListener('play', label);
  video.addEventListener('pause', label);
  video.addEventListener('timeupdate', () => {
    if (video.duration > 0) seek.value = String(Math.round((video.currentTime / video.duration) * 1000));
  });
  seek.addEventListener('input', () => {
    if (video.duration > 0) video.currentTime = (Number(seek.value) / 1000) * video.duration;
  });
  volume.addEventListener('input', () => {
    video.volume = Number(volume.value) / 100;
  });
  for (const link of doc.querySelectorAll<HTMLAnchorElement>('[data-ww-list] a[data-video]')) {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      video.src = link.dataset.video!;
      title.textContent = link.dataset.title ?? '';
      void video.play().catch(() => undefined);
    });
  }
  label();
}
