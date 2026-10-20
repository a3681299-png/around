/** Local, decorative UI icons. No asset or network dependency. */
export function icon(name: string): string {
  const paths: Record<string, string> = {
    image:
      '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1"/><path d="m3 17 6-6 4 4 3-3 5 5"/>',
    animation: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="m10 8 6 4-6 4Z"/>',
    model3d: '<path d="m12 2 9 5v10l-9 5-9-5V7Zm0 10 9-5M12 12 3 7m9 5v10"/>',
    group: '<path d="M3 7V5h7l2 2h9v13H3Z"/>',
    visible: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    hidden: '<path d="m3 3 18 18M9 5c7-2 13 7 13 7l-3 4M6 6l-4 6s4 7 10 7l3-1"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    unlock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0"/>',
    grip: '<path d="M9 5h0m6 0h0M9 12h0m6 0h0M9 19h0m6 0h0" stroke-width="3"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    undo: '<path d="m8 4-5 5 5 5M3 9h11a7 7 0 0 1 0 14"/>',
    redo: '<path d="m16 4 5 5-5 5m5-5H10a7 7 0 0 0 0 14"/>',
    save: '<path d="M4 3h13l4 4v14H3V3Z"/><path d="M7 3v7h10V3M7 21v-7h10v7"/>',
    discard: '<path d="m5 4-3 5 6 1M2 9a10 10 0 1 1 2 9"/>',
    duplicate: '<rect x="8" y="8" width="13" height="13" rx="1"/><path d="M16 8V3H3v13h5"/>',
    delete: '<path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/>',
    ungroup: '<path d="M3 3h7v7H3Zm11 11h7v7h-7ZM14 3h7v7M3 14v7h7"/>',
    select: '<path d="m5 3 14 10-7 1-3 7Z"/>',
    browse:
      '<path d="M8 12V5a2 2 0 0 1 4 0v7-8a2 2 0 0 1 4 0v8-6a2 2 0 0 1 4 0v8c0 5-2 7-7 7-4 0-5-2-8-6l-2-3c-1-2 2-4 4-1l1 1Z"/>',
    card: '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 14h18m-14 3h5m-1-10 5 3-5 3Z"/>',
    mask: '<circle cx="12" cy="12" r="7"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1"/>',
    help: '<circle cx="12" cy="12" r="10"/><path d="M9 8a3 3 0 1 1 5 2c-2 1-2 2-2 3m0 4h0"/>',
    close: '<path d="m5 5 14 14M5 19 19 5"/>',
    collapse: '<path d="M4 12h16"/>',
    dock: '<path d="M3 4h18v16H3ZM8 4v16m8-11 3 3-3 3m-4-3h7"/>',
    add: '<path d="M12 4v16M4 12h16"/>',
    refresh: '<path d="M20 8A9 9 0 1 0 21 15M20 3v5h-5"/>',
    connect: '<path d="m9 15 6-6M8 17l-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m4 0 1-1a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0"/>',
    unlink: '<path d="m3 3 18 18M8 17l-1 1a4 4 0 0 1-6-6l5-5m12-1 1-1a4 4 0 0 1 6 6l-5 5M9 15l6-6"/>',
    record: '<circle cx="12" cy="12" r="7" fill="currentColor" stroke="none"/>',
    play: '<path d="m7 4 13 8-13 8Z"/>',
    stop: '<rect x="5" y="5" width="14" height="14"/>',
    live: '<path d="M4 12h4l3-8 3 16 3-8h3"/>',
    external: '<path d="M14 3h7v7m0-7L10 14m0-10H3v17h17v-8"/>',
    workspace: '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 8h18m-5 0v12M6 6h.01M9 6h.01"/>',
    window: '<rect x="7" y="7" width="14" height="14" rx="1"/><path d="M7 11h14M17 7V3H3v14h4"/>',
  };
  return `<svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${paths[name] ?? paths.image}</svg>`;
}

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
  button.innerHTML = icon(name);
  if (text) {
    const span = button.ownerDocument.createElement('span');
    span.textContent = text;
    span.setAttribute('aria-hidden', 'true');
    button.append(span);
  }
}
