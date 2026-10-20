import { Mesh, Texture, type Camera, type Material, type Scene, type WebGLRenderer } from 'three';

export type AssetWarmup = 'none' | 'textures' | 'compile' | 'both';
/** API wall times and optional GPU command elapsed time, never physical VRAM bytes. */
export async function prepareAssetGpu(renderer: WebGLRenderer, scene: Scene, camera: Camera, mode: AssetWarmup) {
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const parallel = Boolean(gl.getExtension('KHR_parallel_shader_compile'));
  let textureInitCpuMs = 0, textureGpuElapsedMs: number | null = null, compileAsyncMs = 0;
  if (mode === 'textures' || mode === 'both') {
    const textures = new Set<Texture>();
    scene.traverse((n) => { if (!(n instanceof Mesh)) return; for (const m of Array.isArray(n.material) ? n.material : [n.material]) {
      for (const v of Object.values(m)) if (v instanceof Texture) textures.add(v);
      for (const v of Object.values((m as Material & { uniforms?: Record<string, { value?: unknown }> }).uniforms ?? {})) if (v.value instanceof Texture) textures.add(v.value);
    } });
    const extension = gl.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
    const query = extension && gl.createQuery(); if (query) gl.beginQuery(extension!.TIME_ELAPSED_EXT, query);
    const start = performance.now(); for (const t of textures) renderer.initTexture(t); textureInitCpuMs = performance.now() - start;
    if (query) {
      gl.endQuery(extension!.TIME_ELAPSED_EXT); gl.flush();
      try { for (let n = 0; n < 200 && !gl.isContextLost(); n++) {
        if (gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) { if (!gl.getParameter(extension!.GPU_DISJOINT_EXT)) textureGpuElapsedMs = Number(gl.getQueryParameter(query, gl.QUERY_RESULT)) / 1e6; break; }
        await new Promise((r) => setTimeout(r, 10));
      } } finally { gl.deleteQuery(query); }
    }
  }
  if (mode === 'compile' || mode === 'both') { const start = performance.now(); await renderer.compileAsync(scene, camera); compileAsyncMs = performance.now() - start; }
  return { mode, parallelShaderCompile: parallel, textureInitCpuMs, textureGpuElapsedMs, compileAsyncMs };
}
