import { bindSettingsForm } from '../settings/form';
import { SETTINGS_MARKUP } from '../settings/markup';
import settingsStyles from '../settings/settings.css';
import tokens from '../editor/studio-tokens.css';
import { glyphButton } from '../editor/icons';
import { mountCreatorLauncher } from '../browser/editor-launcher';

// The popup wears the same 表示設定 as the in-video panel; here the page itself is the token host.
const style = document.createElement('style');
style.textContent = tokens.replaceAll(':host', ':root') + settingsStyles;
document.head.append(style);
const editor = document.querySelector<HTMLElement>('.popup')!;
editor.innerHTML = SETTINGS_MARKUP;
const closeButton = editor.querySelector<HTMLButtonElement>('.close')!;
glyphButton(closeButton, 'close', '設定を閉じる');
const unbind = bindSettingsForm(editor);
const unmountCreator = mountCreatorLauncher(editor);
const onClose = () => window.close();
closeButton.addEventListener('click', onClose);
window.addEventListener(
  'unload',
  () => {
    unbind();
    unmountCreator();
    closeButton.removeEventListener('click', onClose);
  },
  { once: true },
);
