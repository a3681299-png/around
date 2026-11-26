import styles from './page-marks.css';

export type PageMarkKind = 'mark' | 'unsupported';

export interface PageMark {
  /** Frames `rect` (the part's box). A new `key` or kind draws the frame in again, in 4 frames;
   * the same key only moves it, so a mark that stays never animates. */
  show(rect: DOMRectReadOnly, key: unknown, kind?: PageMarkKind, tag?: string): void;
  hide(): void;
}

const OVERSHOOT = 4,
  TAG = 4 + 20;

/** The editor's marks on the real page, all inside one shadow root that takes no input. The host
 * exists only while a mark has been shown in this editing session; `clear` removes it. */
export function createPageMarks(doc: Document) {
  let host: HTMLElement | undefined, shadow: ShadowRoot | undefined;
  let suspended = false;
  const resets = new Set<() => void>();
  const ensure = () => {
    if (shadow) return shadow;
    host = doc.createElement('div');
    host.id = 'around-page-marks';
    host.setAttribute('aria-hidden', 'true');
    host.toggleAttribute('hidden', suspended);
    shadow = host.attachShadow({ mode: 'open' });
    const style = doc.createElement('style');
    style.textContent = styles;
    shadow.append(style);
    (doc.body ?? doc.documentElement).append(host);
    return shadow;
  };
  return {
    mark(id?: string): PageMark {
      let group: HTMLDivElement | undefined,
        shownKey: unknown,
        shownKind: PageMarkKind | undefined,
        shownTag: string | undefined;
      resets.add(() => {
        group = undefined;
        shownKey = shownKind = shownTag = undefined;
      });
      return {
        show(rect, key, kind = 'mark', tag) {
          if (!group) {
            group = doc.createElement('div');
            group.className = 'mark';
            if (id) group.id = id;
            ensure().append(group);
          }
          if (key !== shownKey || kind !== shownKind || tag !== shownTag || group.hidden) {
            // Fresh nodes restart the draw-in; nothing animates while the mark stays.
            const frame = doc.createElement('div');
            frame.className = kind === 'mark' ? 'around-mark' : 'around-unsupported';
            const label = tag === undefined ? undefined : doc.createElement('span');
            if (label) {
              label.className = kind === 'mark' ? 'around-tag' : 'around-tag around-tag--off';
              label.textContent = tag!;
            }
            group.replaceChildren(...(label ? [frame, label] : [frame]));
            shownKey = key;
            shownKind = kind;
            shownTag = tag;
            group.hidden = false;
          }
          const style = group.style;
          style.transform = `translate(${rect.left - OVERSHOOT}px, ${rect.top - OVERSHOOT}px)`;
          style.width = `${rect.width + OVERSHOOT * 2}px`;
          style.height = `${rect.height + OVERSHOOT * 2}px`;
          group.toggleAttribute(
            'data-tag-above',
            rect.bottom + OVERSHOOT + TAG > doc.defaultView!.innerHeight && rect.top > TAG + OVERSHOOT,
          );
        },
        hide() {
          if (group) group.hidden = true;
        },
      };
    },
    /** Emergency OFF hides every mark at once; the editor itself stays as it was. */
    setSuspended(value: boolean) {
      suspended = value;
      host?.toggleAttribute('hidden', value);
    },
    clear() {
      host?.remove();
      host = shadow = undefined;
      resets.forEach((reset) => reset());
    },
  };
}
export type PageMarks = ReturnType<typeof createPageMarks>;
