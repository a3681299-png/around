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
  let dragging = false;
  seek.addEventListener('pointerdown', () => {
    dragging = true;
  });
  for (const event of ['pointerup', 'pointercancel'])
    doc.addEventListener(event, () => {
      dragging = false;
    });
  play.addEventListener('click', () => {
    if (video.paused) void video.play().catch(() => undefined);
    else video.pause();
  });
  video.addEventListener('play', label);
  video.addEventListener('pause', label);
  video.addEventListener('timeupdate', () => {
    if (!dragging && Number.isFinite(video.duration) && video.duration > 0)
      seek.value = String(Math.round((video.currentTime / video.duration) * 1000));
  });
  seek.addEventListener('input', () => {
    if (Number.isFinite(video.duration) && video.duration > 0)
      video.currentTime = (Number(seek.value) / 1000) * video.duration;
  });
  volume.addEventListener('input', () => {
    video.volume = Number(volume.value) / 100;
  });
  const links = [...doc.querySelectorAll<HTMLAnchorElement>('[data-ww-list] a[data-video]')];
  const search = doc.querySelector<HTMLInputElement>('#search')!;
  search.addEventListener('input', () => {
    const query = search.value.trim().toLocaleLowerCase();
    for (const link of links) link.hidden = !(link.dataset.title ?? '').toLocaleLowerCase().includes(query);
  });
  for (const link of links) {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      video.src = link.dataset.video!;
      title.textContent = link.dataset.title ?? '';
      void video.play().catch(() => undefined);
    });
  }
  label();
}
