import type { PlaybackSignal, PlaybackSource } from '../signals/types';

/** Main player only: hover previews elsewhere must not drive the artwork. */
export function youtubePlaybackSource(doc: Document): PlaybackSource {
  return {
    connect(emit) {
      let video: HTMLVideoElement | null = null;
      let previous: boolean | undefined;
      const events = ['play', 'playing', 'pause', 'ended', 'emptied'] as const;
      const publish = (event?: Event) => {
        const playing = Boolean(video?.isConnected && !video.paused && !video.ended);
        const occurrence: PlaybackSignal['event'] =
          event?.type === 'play'
            ? 'video.play'
            : event?.type === 'pause'
              ? 'video.pause'
              : event?.type === 'ended'
                ? 'video.ended'
                : undefined;
        if (previous === playing && !occurrence) return;
        previous = playing;
        emit({ playing, ...(occurrence ? { event: occurrence } : {}) });
      };
      const detach = () => events.forEach((type) => video?.removeEventListener(type, publish));
      const refresh = () => {
        const next =
          doc.querySelector<HTMLVideoElement>('#movie_player video.html5-main-video') ??
          doc.querySelector<HTMLVideoElement>('#movie_player video');
        if (next !== video) {
          detach();
          video = next;
          events.forEach((type) => video?.addEventListener(type, publish));
        }
        publish();
      };
      refresh();
      return {
        refresh,
        destroy() {
          detach();
          video = null;
        },
      };
    },
  };
}
