/** Numeric labels dispatch the same form inputs; Core owns the single Undo transaction. */
export function mountNumberScrub(
  doc: Document,
  host: HTMLElement,
  main: HTMLElement,
  begin: () => void,
  end: (cancel?: boolean) => void,
) {
  let gesture:
    | { label: HTMLLabelElement; input: HTMLInputElement; x: number; value: number; pointer: number; active: boolean }
    | undefined;
  main.querySelectorAll<HTMLLabelElement>('label').forEach((label) => {
    const input = label.querySelector<HTMLInputElement>('input[type="number"]');
    if (!input) return;
    label.dataset.scrub = '';
    label.title ||= '左右にドラッグして調整 / Shiftで細かく調整';
    label.addEventListener('pointerdown', (event) => {
      if (
        event.button !== 0 ||
        event.target === input ||
        input.matches(':disabled') ||
        !Number.isFinite(input.valueAsNumber)
      )
        return;
      gesture = { label, input, x: event.clientX, value: input.valueAsNumber, pointer: event.pointerId, active: false };
      label.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
  });
  const finish = (cancel = false) => {
    const current = gesture;
    gesture = undefined;
    host.removeAttribute('data-ww-scrubbing');
    if (!current) return;
    if (current.label.hasPointerCapture(current.pointer)) current.label.releasePointerCapture(current.pointer);
    if (current.active) end(cancel);
    else current.input.focus({ preventScroll: true });
  };
  const move = (event: PointerEvent) => {
    if (!gesture || event.pointerId !== gesture.pointer) return;
    if (gesture.input.matches(':disabled')) {
      finish(true);
      return;
    }
    const delta = event.clientX - gesture.x;
    if (!gesture.active && Math.abs(delta) < 3) return;
    if (!gesture.active) {
      gesture.active = true;
      host.setAttribute('data-ww-scrubbing', '');
      begin();
    }
    const input = gesture.input,
      step = Number(input.step) || 1;
    const scale = ['x', 'y'].includes(input.dataset.imageProp ?? '')
      ? 0.1
      : input.dataset.playback === 'speed'
        ? 0.05
        : 1;
    const value = gesture.value + delta * scale * (event.shiftKey ? 0.1 : 1);
    const lower = input.min === '' ? -Infinity : Number(input.min),
      upper = input.max === '' ? Infinity : Number(input.max);
    input.value = String(Math.max(lower, Math.min(upper, Math.round(value / step) * step)).toFixed(4));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    event.preventDefault();
  };
  const up = (event: PointerEvent) => {
    if (gesture?.pointer === event.pointerId) finish(event.type !== 'pointerup');
  };
  const keys = (event: KeyboardEvent) => {
    if (gesture?.active && event.key === 'Escape') {
      finish(true);
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  main.addEventListener('pointermove', move);
  main.addEventListener('pointerup', up);
  main.addEventListener('pointercancel', up);
  main.addEventListener('lostpointercapture', up);
  doc.addEventListener('keydown', keys, true);
  return () => {
    finish(true);
    main.removeEventListener('pointermove', move);
    main.removeEventListener('pointerup', up);
    main.removeEventListener('pointercancel', up);
    main.removeEventListener('lostpointercapture', up);
    doc.removeEventListener('keydown', keys, true);
  };
}
