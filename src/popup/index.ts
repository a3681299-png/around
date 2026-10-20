import { mountPixelFont } from '../ui/pixel-font';
import { bindSettingsForm } from '../settings/form';
import { SETTINGS_MARKUP } from '../settings/markup';
import { DEFAULT_THEME, themes } from '../themes';
import { mountCreatorLauncher } from '../editor/launcher';

const unmountFont = mountPixelFont(document);
const editor = document.querySelector<HTMLElement>('.popup')!;
document.documentElement.dataset.wwUi = DEFAULT_THEME;
const style = document.createElement('style');
style.textContent = themes[DEFAULT_THEME].editorStylesheets.join('\n');
document.head.append(style);
editor.innerHTML = SETTINGS_MARKUP;
const unbind = bindSettingsForm(editor);
const unmountCreator = mountCreatorLauncher(editor);
const onClose = () => window.close();
const closeButton = editor.querySelector<HTMLButtonElement>('.close')!;
closeButton.addEventListener('click', onClose);
window.addEventListener(
  'unload',
  () => {
    unbind();
    unmountCreator();
    unmountFont();
    closeButton.removeEventListener('click', onClose);
  },
  { once: true },
);
