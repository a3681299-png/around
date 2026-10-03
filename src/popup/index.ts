import { bindSettingsForm } from '../settings/form';
import formStyles from '../settings/form.css';

const style = document.createElement('style');
style.textContent = formStyles;
document.head.append(style);
const unbind = bindSettingsForm(document);
window.addEventListener('unload', unbind, { once: true });
