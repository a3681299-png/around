/** Build an offline-only visual review fixture using the real extension modules.
 * The preview stubs Chrome Storage and bypasses only the YouTube host gate.
 * It is not a replacement for the real MV3 tests in extension.spec.ts.
 */
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const output = path.resolve(root, process.argv[2] ?? '.work/qa/preview.html');
const result = await build({
  absWorkingDir: root,
  stdin: {
    resolveDir: root,
    sourcefile: 'preview-entry.ts',
    loader: 'ts',
    contents: `
import './src/content/index';
import { themes, DEFAULT_THEME } from './src/themes';
import { SETTINGS_MARKUP } from './src/settings/markup';
import { bindSettingsForm } from './src/settings/form';
const host = document.createElement('section');
host.id = 'preview-settings';
host.dataset.wwUi = DEFAULT_THEME;
host.hidden = true;
host.setAttribute('aria-label', 'Offline preview settings');
const shadow = host.attachShadow({mode: 'open'});
const style = document.createElement('style');
style.textContent = themes[DEFAULT_THEME].editorStylesheets.join('\\n') + \`
:host { position:fixed; right:18px; top:128px; z-index:100; width:340px; max-height:calc(100vh - 155px); overflow:auto; box-shadow:0 8px 30px #0005; }
:host([hidden]) { display:none; }
\`;
const editor = document.createElement('div');
editor.className = 'ww-editor';
editor.innerHTML = SETTINGS_MARKUP;
shadow.append(style, editor);
document.body.append(host);
const unbind = bindSettingsForm(shadow);
editor.querySelector('.close').addEventListener('click', () => {host.hidden = true;});
const toolbar = document.createElement('aside');
toolbar.id = 'preview-toolbar';
toolbar.innerHTML = '<strong>OFFLINE LAYOUT PREVIEW</strong><span>Generated fixture · mock storage · not live YouTube</span><button type="button" data-preview-settings>Theme settings</button><button type="button" data-preview-mode>Light / dark</button>';
document.body.append(toolbar);
toolbar.querySelector('[data-preview-settings]').addEventListener('click', () => {host.hidden = !host.hidden;});
toolbar.querySelector('[data-preview-mode]').addEventListener('click', () => {document.documentElement.toggleAttribute('dark');});
document.addEventListener('click', event => {
  const link = event.target instanceof Element ? event.target.closest('#web-world-themes-window-chrome a') : null;
  if (link) {event.preventDefault(); globalThis.navigate(link.getAttribute('href'));}
});
window.addEventListener('pagehide', () => unbind(), {once:true});
`,
  },
  plugins: [
    {
      name: 'offline-preview-host-only',
      setup(build) {
        build.onLoad({ filter: /src[\\/]sites[\\/]index\.ts$/ }, async ({ path: filename }) => ({
          contents: (await readFile(filename, 'utf8')).replace('supportsYouTube(new URL(view.location.href))', 'true'),
          loader: 'ts',
        }));
        build.onLoad({ filter: /src[\\/]sites[\\/]youtube-chrome\.ts$/ }, async ({ path: filename }) => ({
          contents: (await readFile(filename, 'utf8')).replace(
            "doc.location.pathname === '/watch'",
            "doc.location.hash.startsWith('#/watch')",
          ),
          loader: 'ts',
        }));
      },
    },
  ],
  bundle: true,
  target: 'chrome120',
  format: 'iife',
  loader: { '.css': 'text' },
  write: false,
  charset: 'utf8',
  legalComments: 'none',
});
const previewFont = (await readFile(path.join(root, 'assets/fonts/PixelMplus12-Regular.woff2'))).toString('base64');
const storageShim = `
// Only this offline preview supplies these browser API stubs. The extension does not.
const previewValues = {'webWorldThemes.enabled':true,'webWorldThemes.strength':100,'webWorldThemes.features.window-chrome':true};
const previewListeners = new Set();
globalThis.chrome = {runtime: {getURL: () => "data:font/woff2;base64,${previewFont}"}, storage:{
  local: {
    get: async keys => Object.fromEntries(keys.filter(key => Object.hasOwn(previewValues,key)).map(key => [key,previewValues[key]])),
    set: async values => {
      const changes = Object.fromEntries(Object.entries(values).map(([key,newValue])=>[key,{oldValue:previewValues[key],newValue}]));
      Object.assign(previewValues,values);
      previewListeners.forEach(listener => listener(changes,'local'));
    }
  },
  onChanged: {addListener: listener => previewListeners.add(listener), removeListener: listener => previewListeners.delete(listener)}
}};
`;
let html = await readFile(path.join(root, 'tests/fixtures/youtube.html'), 'utf8');
html = html.replace('YouTube adapter fixture', 'Web World Themes · offline silver-blue preview');
html = html.replace(
  'const videos = [',
  "let fixturePathname = location.hash.startsWith('#/') ? new URL(location.hash.slice(1), 'https://www.youtube.com').pathname : '/';\n      const videos = [",
);
html = html.replaceAll('location.pathname ===', 'fixturePathname ===');
html = html.replace(
  "history.pushState({}, '', url);",
  "fixturePathname = new URL(url, 'https://www.youtube.com').pathname;\n        history.pushState({ fixturePathname }, '', '#' + url);",
);
html = html.replace(
  "window.addEventListener('popstate', () => { renderPage();",
  "window.addEventListener('popstate', () => { fixturePathname = location.hash.startsWith('#/') ? new URL(location.hash.slice(1), 'https://www.youtube.com').pathname : '/'; renderPage();",
);
html = html.replace(
  '</style>',
  `
      #preview-toolbar { position:fixed; bottom:26px; left:0; z-index:90; display:flex; align-items:center; gap:10px; padding:9px 12px; background:#0d2134; color:#eaf8ff; font:11px Arial,sans-serif; border-top:1px solid #5a869f; }
      #preview-toolbar strong { font:10px monospace; letter-spacing:.08em; color:#99d7f2; }
      #preview-toolbar button { padding:5px 8px; background:#d9eafa; color:#16374d; border:1px solid #789aae; border-radius:2px; }
      @media(max-width:750px) { #preview-toolbar span { display:none; } }
    </style>`,
);
html = html.replace(
  '</body>',
  `<script>${storageShim.replaceAll('</script', '<\\/script')}</script>\n<script>${result.outputFiles[0].text.replaceAll('</script', '<\\/script')}</script>\n</body>`,
);
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, html);
console.log(`Offline fixture preview: ${output}`);
console.log(
  'Uses real theme, adapter, settings, and feature modules; mock storage and explicit host-gate bypass for local review only.',
);
