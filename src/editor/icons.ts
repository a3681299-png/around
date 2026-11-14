/** Local, decorative UI icons. No asset or network dependency. An icon button: the glyph is
 * decoration, the label stays the accessible name. */
export function buttonIcon(
  button: HTMLButtonElement,
  name: string,
  label = button.getAttribute('aria-label') ?? button.textContent!.trim(),
  shortcut = '',
  text = '',
) {
  button.setAttribute('aria-label', label);
  button.title = `${label}${shortcut ? ` (${shortcut})` : ''}`;
  button.classList.add('icon-button');
  button.innerHTML = glyph(name);
  if (text) {
    const span = button.ownerDocument.createElement('span');
    span.textContent = text;
    span.setAttribute('aria-hidden', 'true');
    button.append(span);
  }
}

/* The Around Studio icon set. Every glyph is ruled on one construction in a 16px box: the 14px square (1–15), its
   circumscribed circle (r 7, so 45° points at 3.05 / 12.95), the circle r 7/φ (4.33: 3.67 / 12.33)
   and the φ split lines (9.65, and 6.35 from the other side). 1.5px ruler stroke, round caps and
   joins, currentColor. No fills, no G-pen: the pen is for marks, not glyphs. */
const GLYPHS: Record<string, string> = {
  select: '<path d="M3.67 1.5v11.83l3.05-2.98 2.27 4.65 1.98-.97-2.3-4.68h4.66Z"/>',
  browse:
    '<path d="M6.35 8V3.05a1.1 1.1 0 0 1 2.2 0V8M8.55 7.2V2.2a1.1 1.1 0 0 1 2.2 0v5M10.75 7.6V4.5a1.1 1.1 0 0 1 2.2 0v5.15c0 3.05-1.9 5.35-4.95 5.35-2 0-3.2-.95-4.3-2.6L2.2 9.9c-.65-.95.6-2 1.45-1.15l2.7 2.6"/>',
  card: '<path d="M1 3.67h14v8.66H1ZM1 9.65h14M6.35 5.3v2.7l2.3-1.35Z"/>',
  skin: '<path d="M6.35 1.5 2 4.3l1.65 3.05 1.4-.85V14.5h5.9V6.5l1.4.85L14 4.3 9.65 1.5a1.65 1.65 0 0 1-3.3 0Z"/>',
  image: '<path d="M1.5 2.5h13v11h-13ZM1.5 11.5l4.17-4.17 3 3 1.98-1.98 3.85 3.85"/><circle cx="11" cy="5.5" r="1"/>',
  animation: '<path d="M1.5 2.5h13v11h-13ZM6.35 5.3v5.4L10.7 8Z"/>',
  model3d: '<path d="M8 1l6.06 3.5v7L8 15l-6.06-3.5v-7ZM8 8l6.06-3.5M8 8 1.94 4.5M8 8v7"/>',
  group: '<path d="M1.5 3.67h4.83l1.67 1.65h6.5v8.18h-13Z"/>',
  undo: '<path d="M5 3.67 1.94 6.35 5 9.03M1.94 6.35h8.17a3.67 3.67 0 0 1 0 7.33H6.35"/>',
  redo: '<path d="m11 3.67 3.06 2.68L11 9.03m3.06-2.68H5.89a3.67 3.67 0 0 0 0 7.33h3.76"/>',
  dock: '<path d="M1 2.5h14v11H1ZM9.65 2.5v11M2.94 8h4.4M4.6 6.35 2.94 8 4.6 9.65"/>',
  settings:
    '<path d="M1 4.5h7M11.3 4.5H15M1 11.5h3.7M8 11.5h7"/><circle cx="9.65" cy="4.5" r="1.65"/><circle cx="6.35" cy="11.5" r="1.65"/>',
  collapse: '<path d="M3.67 8h8.66"/>',
  expand: '<path d="M3.67 8h8.66M8 3.67v8.66"/>',
  close: '<path d="m3.05 3.05 9.9 9.9m0-9.9-9.9 9.9"/>',
  visible:
    '<path d="M1.5 8s2.5-4.33 6.5-4.33S14.5 8 14.5 8 12 12.33 8 12.33 1.5 8 1.5 8Z"/><circle cx="8" cy="8" r="2"/>',
  hidden:
    '<path d="m3.05 3.05 9.9 9.9M6.35 3.9A6.4 6.4 0 0 1 8 3.67C12 3.67 14.5 8 14.5 8a12 12 0 0 1-1.6 2.1M10.6 11.9a6 6 0 0 1-2.6.43C4 12.33 1.5 8 1.5 8a12 12 0 0 1 2.4-2.9"/>',
  lock: '<path d="M3.67 7h8.66v7.33H3.67ZM5.5 7V5a2.5 2.5 0 0 1 5 0v2"/>',
  unlock: '<path d="M3.67 7h8.66v7.33H3.67ZM5.5 7V5a2.5 2.5 0 0 1 4.85-.85"/>',
  grip: '<path d="M6.35 3.67h0m3.3 0h0M6.35 8h0m3.3 0h0m-3.3 4.33h0m3.3 0h0" stroke-width="2"/>',
  more: '<path d="M3.67 8h0M8 8h0m4.33 0h0" stroke-width="2"/>',
  retry: '<path d="M12.95 3.05V6.35H9.65"/><path d="M12.6 6.2A5.2 5.2 0 1 0 13.2 9.65"/>',
  // UI0-d: the Studio workbench's commands, on the same construction.
  save: '<path d="M1.5 1.5h9.83l3.17 3.17V14.5h-13ZM4.5 1.5v4.85h6V1.5M4.5 14.5V9.65h7v4.85"/>',
  discard: '<path d="M3.05 3.05V6.35h3.3"/><path d="M3.4 6.2A5.2 5.2 0 1 1 2.8 9.65"/>',
  duplicate: '<path d="M6.35 6.35h8.15v8.15H6.35ZM9.65 6.35V1.5H1.5v8.15h4.85"/>',
  delete: '<path d="M1.5 3.67h13M6.35 3.67V1.5h3.3v2.17M3.05 3.67l.85 10.83h8.2l.85-10.83M6.35 6.35v5.3m3.3-5.3v5.3"/>',
  ungroup: '<path d="M1.5 1.5h4.85v4.85H1.5Zm8.15 8.15h4.85v4.85H9.65ZM9.65 1.5h4.85v4.85M1.5 9.65v4.85h4.85"/>',
  mask: '<circle cx="8" cy="8" r="4.33"/><path d="M8 1v1.5M8 13.5V15M1 8h1.5m11 0H15M3.05 3.05l1.06 1.06m7.78 7.78 1.06 1.06M3.05 12.95l1.06-1.06m7.78-7.78 1.06-1.06"/>',
  help: '<circle cx="8" cy="8" r="7"/><path d="M6.35 6.35a1.65 1.65 0 1 1 2.6 1.35c-.65.45-.95.9-.95 1.65M8 11.95h0"/>',
  add: '<path d="M3.67 8h8.66M8 3.67v8.66"/>',
  refresh: '<path d="M12.95 3.05V6.35H9.65"/><path d="M12.6 6.2A5.2 5.2 0 1 0 13.2 9.65"/>',
  connect:
    '<path d="m6.35 9.65 3.3-3.3M5.3 11.3l-.8.8a2.33 2.33 0 0 1-3.3-3.3l2.6-2.6a2.33 2.33 0 0 1 3.3 0m3.6-1.5.8-.8a2.33 2.33 0 0 1 3.3 3.3l-2.6 2.6a2.33 2.33 0 0 1-3.3 0"/>',
  unlink:
    '<path d="m3.05 3.05 9.9 9.9M5.3 11.3l-.8.8a2.33 2.33 0 0 1-3.3-3.3l2.3-2.3m6.2-1.8.8-.8a2.33 2.33 0 0 1 3.3 3.3l-2.3 2.3"/>',
  // A ring with its centre: a plain circle would read as a save state.
  record: '<circle cx="8" cy="8" r="4.33"/><path d="M8 8h0" stroke-width="2.5"/>',
  play: '<path d="M4.5 2.5v11L13 8Z"/>',
  stop: '<path d="M3.67 3.67h8.66v8.66H3.67Z"/>',
  live: '<path d="M1 8h2.94L6 3.05l3.3 9.9L11.35 8H15"/>',
  external: '<path d="M9.65 1.5h4.85v4.85M14.5 1.5l-7 7M6.35 2.5H1.5v12h12V9.65"/>',
  workspace: '<path d="M1 2.5h14v11H1ZM1 5.3h14M11 5.3v8.2M3.05 3.9h0m1.95 0h0"/>',
  window: '<path d="M4.5 4.5h10v10h-10ZM4.5 7.3h10M11.5 4.5v-3h-10v10h3"/>',
};

/** One glyph of the icon set, as an inline 16px SVG. */
export function glyph(name: string): string {
  return `<svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${GLYPHS[name] ?? GLYPHS.image}</svg>`;
}

/** An icon button in the icon set; the label stays the accessible name. */
export function glyphButton(button: HTMLButtonElement, name: string, label: string, shortcut = '', title = '') {
  buttonIcon(button, name, label, shortcut);
  if (title) button.title = title;
}
