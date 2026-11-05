import type { SettingsEntry } from '../sites/types';
import { bindSettingsForm } from './form';
import panelStyles from './panel.css';
import settingsStyles from './settings.css';
import tokens from '../editor/studio-tokens.css';
import { glyphButton } from '../editor/icons';
import { SETTINGS_MARKUP } from './markup';
import { initialSettingsPosition, SETTINGS_POSITION_KEY, type SettingsRect } from './position';
import { readStoredPosition, saveStoredPosition } from '../browser/settings-store';

export interface SettingsPanel extends SettingsEntry {
  open(): void;
  /** Shows a message in the panel's editor area, opening the panel. */
  report(message: string): void;
  destroy(): void;
}
export interface SettingsEditorEntry {
  /** The side panel (S) or the editor's own window (W). */
  open(surface: 'sidepanel' | 'window'): void;
  /** 制作モード: the in-video icon opens the editor itself instead of these settings. */
  creatorMode(): boolean;
}

/** Site-independent editor; Shadow DOM isolates its UI from the host site's CSS. */
export function createSettingsPanel(doc: Document, editor?: SettingsEditorEntry): SettingsPanel {
  const button = doc.createElement('button');
  button.type = 'button';
  button.dataset.wwSettingsButton = '';
  button.title = 'Web World Themes の設定';
  button.setAttribute('aria-label', button.title);
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', 'web-world-themes-panel');
  button.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;color:#fff;';
  // Temporary sliders icon, independent of a theme's eventual visual identity.
  button.innerHTML =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M3 12h18M3 18h18"/><path d="M8 3v6M16 9v6M10 15v6" stroke-width="4"/></g></svg>';

  const panel = doc.createElement('div');
  panel.id = 'web-world-themes-panel';
  panel.hidden = true;
  panel.lang = 'ja';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Web World Themes の設定');
  const shadow = panel.attachShadow({ mode: 'open' });
  const style = doc.createElement('style');
  style.textContent = tokens + settingsStyles + panelStyles;
  shadow.append(style);
  const main = doc.createElement('div');
  main.className = 'settings ww-editor';
  main.innerHTML = SETTINGS_MARKUP;
  shadow.append(main);
  const closeButton = main.querySelector<HTMLButtonElement>('.close')!;
  glyphButton(closeButton, 'close', '設定を閉じる');
  const direct = main.querySelector<HTMLButtonElement>('#creator-editor-direct')!,
    separate = main.querySelector<HTMLButtonElement>('#creator-editor-window')!,
    launchStatus = main.querySelector<HTMLElement>('#creator-launch-status')!;
  direct.disabled = separate.disabled = !editor;
  const onEditor = (event: Event) => {
    close();
    editor?.open(event.currentTarget === separate ? 'window' : 'sidepanel');
  };
  direct.addEventListener('click', onEditor);
  separate.addEventListener('click', onEditor);
  const titlebar = main.querySelector<HTMLElement>('.ww-titlebar')!,
    view = doc.defaultView!;
  let avoidRect: (() => SettingsRect | undefined) | undefined;
  let saved: { x: number; y: number } | undefined,
    positionTouched = false,
    alive = true;
  let gesture: { x: number; y: number; left: number; top: number } | undefined;
  const place = (x: number, y: number, maxHeight: number) => {
    panel.style.setProperty('--ww-settings-x', x + 'px');
    panel.style.setProperty('--ww-settings-y', y + 'px');
    panel.style.setProperty('--ww-settings-height', Math.max(80, maxHeight) + 'px');
  };
  const clampSaved = () => {
    if (!saved) return;
    const x = Math.max(0, Math.min(saved.x, view.innerWidth - panel.getBoundingClientRect().width)),
      y = Math.max(0, Math.min(saved.y, view.innerHeight - 100));
    place(x, y, view.innerHeight - y - 12);
  };
  const reposition = () => {
    if (panel.hidden) return;
    if (saved) {
      clampSaved();
      return;
    }
    const width = panel.getBoundingClientRect().width;
    const obstacle = doc.fullscreenElement ? undefined : avoidRect?.();
    let position = initialSettingsPosition(view.innerWidth, view.innerHeight, width, obstacle);
    if (!position.hasRoom && obstacle) {
      // A narrow page may have no side gutter. Reveal free page space below the video.
      view.scrollBy(0, Math.max(1, Math.ceil(obstacle.top + obstacle.height - (view.innerHeight - 204)) + 1));
      position = initialSettingsPosition(view.innerWidth, view.innerHeight, width, avoidRect?.());
    }
    place(position.x, position.y, position.maxHeight);
  };
  void readStoredPosition(SETTINGS_POSITION_KEY)
    .then((value) => {
      if (
        !alive ||
        positionTouched ||
        !value ||
        typeof value.x !== 'number' ||
        typeof value.y !== 'number' ||
        !Number.isFinite(value.x) ||
        !Number.isFinite(value.y)
      )
        return;
      saved = { x: value.x, y: value.y };
      reposition();
    })
    .catch(() => undefined);
  const startDrag = (event: PointerEvent) => {
    if (event.button !== 0 || (event.target as Element).closest('button')) return;
    positionTouched = true;
    const rect = panel.getBoundingClientRect();
    gesture = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
    titlebar.setPointerCapture(event.pointerId);
    event.preventDefault();
  };
  const moveDrag = (event: PointerEvent) => {
    if (!gesture) return;
    saved = { x: gesture.left + event.clientX - gesture.x, y: gesture.top + event.clientY - gesture.y };
    clampSaved();
    const rect = panel.getBoundingClientRect();
    saved = { x: rect.left, y: rect.top };
  };
  const finishDrag = () => {
    if (!gesture) return;
    gesture = undefined;
    if (saved)
      void saveStoredPosition(SETTINGS_POSITION_KEY, saved).catch(() => {
        main.querySelector('#save-status')!.textContent = '設定ウィンドウの位置を保存できませんでした。';
      });
  };
  titlebar.addEventListener('pointerdown', startDrag);
  titlebar.addEventListener('pointermove', moveDrag);
  titlebar.addEventListener('pointerup', finishDrag);
  titlebar.addEventListener('pointercancel', finishDrag);
  titlebar.addEventListener('lostpointercapture', finishDrag);
  view.addEventListener('resize', reposition);
  let unbind: (() => void) | undefined;

  const close = (restoreFocus = false) => {
    if (panel.hidden) return;
    panel.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    unbind?.();
    unbind = undefined;
    doc.removeEventListener('pointerdown', onOutsidePointer, true);
    if (restoreFocus && button.isConnected) button.focus();
  };
  const onOutsidePointer = (event: Event) => {
    const path = event.composedPath();
    if (!path.includes(panel) && !path.includes(button)) close();
  };
  const open = () => {
    if (!panel.hidden) return;
    panel.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    unbind = bindSettingsForm(shadow);
    doc.addEventListener('pointerdown', onOutsidePointer, true);
    reposition();
    closeButton.focus({ preventScroll: true });
  };
  const onClick = () => {
    if (!panel.hidden) close(true);
    // 制作モード: the icon opens the editor within this click, so Chrome sees the person's gesture.
    else if (editor?.creatorMode()) editor.open('sidepanel');
    else open();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    // The player must not seek or toggle playback while the user edits a slider.
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
    }
  };
  const stopPropagation = (event: Event) => event.stopPropagation();
  const onButtonKey = (event: KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
  };
  const onClose = () => close(true);
  button.addEventListener('click', onClick);
  button.addEventListener('click', stopPropagation);
  button.addEventListener('keydown', onButtonKey);
  button.addEventListener('keyup', onButtonKey);
  closeButton.addEventListener('click', onClose);
  panel.addEventListener('keydown', onKeyDown);
  panel.addEventListener('keyup', stopPropagation);
  panel.addEventListener('click', stopPropagation);

  return {
    button,
    panel,
    close,
    open,
    report(message) {
      open();
      launchStatus.textContent = message;
    },
    reposition,
    setAvoidRect(get) {
      avoidRect = get;
    },
    destroy() {
      alive = false;
      close();
      button.removeEventListener('click', onClick);
      button.removeEventListener('click', stopPropagation);
      button.removeEventListener('keydown', onButtonKey);
      button.removeEventListener('keyup', onButtonKey);
      closeButton.removeEventListener('click', onClose);
      direct.removeEventListener('click', onEditor);
      separate.removeEventListener('click', onEditor);
      titlebar.removeEventListener('pointerdown', startDrag);
      titlebar.removeEventListener('pointermove', moveDrag);
      titlebar.removeEventListener('pointerup', finishDrag);
      titlebar.removeEventListener('pointercancel', finishDrag);
      titlebar.removeEventListener('lostpointercapture', finishDrag);
      view.removeEventListener('resize', reposition);
      panel.removeEventListener('keydown', onKeyDown);
      panel.removeEventListener('keyup', stopPropagation);
      panel.removeEventListener('click', stopPropagation);
      button.remove();
      panel.remove();
    },
  };
}
