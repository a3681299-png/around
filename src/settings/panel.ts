import { mountPixelFont } from '../ui/pixel-font';
import type { SettingsEntry } from '../sites/types';
import { bindSettingsForm } from './form';
import panelStyles from './panel.css';
import { DEFAULT_THEME, themes } from '../themes';
import { SETTINGS_MARKUP } from './markup';

export interface SettingsPanel extends SettingsEntry {
  destroy(): void;
}

/** Site-independent editor; Shadow DOM isolates its UI from the host site's CSS. */
export function createSettingsPanel(doc: Document): SettingsPanel {
  const unmountFont = mountPixelFont(doc);
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
  panel.dataset.wwUi = DEFAULT_THEME;
  panel.hidden = true;
  panel.lang = 'ja';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Web World Themes の設定');
  const shadow = panel.attachShadow({ mode: 'open' });
  const style = doc.createElement('style');
  style.textContent = [...themes[DEFAULT_THEME].editorStylesheets, panelStyles].join('\n');
  shadow.append(style);
  const main = doc.createElement('div');
  main.className = 'settings ww-editor';
  main.innerHTML = SETTINGS_MARKUP;
  shadow.append(main);
  const closeButton = main.querySelector<HTMLButtonElement>('.close')!;
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
  const onClick = () => {
    if (!panel.hidden) {
      close(true);
      return;
    }
    panel.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    unbind = bindSettingsForm(shadow);
    doc.addEventListener('pointerdown', onOutsidePointer, true);
    closeButton.focus();
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
    destroy() {
      close();
      unmountFont();
      button.removeEventListener('click', onClick);
      button.removeEventListener('click', stopPropagation);
      button.removeEventListener('keydown', onButtonKey);
      button.removeEventListener('keyup', onButtonKey);
      closeButton.removeEventListener('click', onClose);
      panel.removeEventListener('keydown', onKeyDown);
      panel.removeEventListener('keyup', stopPropagation);
      panel.removeEventListener('click', stopPropagation);
      button.remove();
      panel.remove();
    },
  };
}
