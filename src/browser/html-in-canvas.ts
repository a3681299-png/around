type DrawableCanvas = HTMLCanvasElement & {
  requestPaint?: () => void;
  getElementImageDefaultSize?: (element: HTMLElement) => { width: number; height: number };
  updateElementGeometry?: (element: HTMLElement, geometry: { canvasTransform: DOMMatrix }) => void;
  getElementTransform?: (element: HTMLElement, transform: DOMMatrix) => DOMMatrix;
};

type DrawableGL = WebGL2RenderingContext & {
  texElementSubImage2D?: (target: number, level: number, x: number, y: number, element: HTMLElement) => void;
  texElementImage2D?: (target: number, format: number, element: HTMLElement) => void;
};

export function drawableMode(canvas: DrawableCanvas, gl: DrawableGL) {
  if (gl.texElementSubImage2D && canvas.updateElementGeometry && canvas.getElementImageDefaultSize) return 'modern';
  if (gl.texElementImage2D && canvas.getElementTransform) return 'legacy';
  return null;
}

export function attachDrawable(canvas: DrawableCanvas, gl: DrawableGL, element: HTMLElement, repaint: () => void) {
  const mode = drawableMode(canvas, gl);
  if (!mode) return null;
  const modern = mode === 'modern';
  if (modern) {
    canvas.setAttribute('content', 'drawable');
    element.setAttribute('drawable', '');
  } else {
    canvas.setAttribute('layoutsubtree', '');
  }
  canvas.append(element);
  canvas.addEventListener('paint', repaint);
  let width = 0;
  let height = 0;
  return {
    requestPaint: () => canvas.requestPaint?.(),
    upload() {
      if (modern) {
        const size = canvas.getElementImageDefaultSize!(element);
        const w = Math.ceil(size.width);
        const h = Math.ceil(size.height);
        if (!w || !h) return false;
        if (w !== width || h !== height) {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
          width = w;
          height = h;
        }
        gl.texElementSubImage2D!(gl.TEXTURE_2D, 0, 0, 0, element);
      } else {
        gl.texElementImage2D!(gl.TEXTURE_2D, gl.RGBA8, element);
      }
      return true;
    },
    sync(transform: DOMMatrix) {
      if (modern) {
        canvas.updateElementGeometry!(element, { canvasTransform: transform });
      } else {
        // The old API accepts a grid-to-grid transform. The new API takes CSS pixels.
        const sx = canvas.width / canvas.clientWidth;
        const sy = canvas.height / canvas.clientHeight;
        const grid = new DOMMatrix()
          .scale(sx, sy)
          .multiply(transform)
          .scale(1 / sx, 1 / sy);
        const css = canvas.getElementTransform!(element, grid).toString();
        if (element.style.transform !== css) element.style.transform = css;
      }
    },
    dispose() {
      canvas.removeEventListener('paint', repaint);
      canvas.removeAttribute('content');
      canvas.removeAttribute('layoutsubtree');
      element.removeAttribute('drawable');
      element.style.removeProperty('transform');
    },
  };
}
