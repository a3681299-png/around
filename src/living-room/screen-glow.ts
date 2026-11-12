// Light from small screens on the baked room (docs/living-life.md). The room is drawn unlit: its
// light was baked in Blender, so a lamp added at run time would not reach it. This adds, to the
// room's own materials, the light of up to two screens: each a point that shines mostly the way
// its face points, falls off with distance, and is caught by surfaces that face it. The colour it
// gives a surface is the screen's colour times the surface's own hue (the baked colour, brought to
// a middle brightness): a pillow glows pale where a dark desk glows faintly.
//
// Two slots: the phone now, and the large UI panel later (the bright, main light of the scene
// once it opens; the phone's small light gives way to it). Not data from a work: the shader code
// is this page's own, and only numbers (positions, colours) change at run time.
import { Color, Vector3, type Material, type MeshBasicMaterial } from 'three';

export const GLOW_SLOTS = 2;

export interface ScreenGlow {
  /** Sets a slot: where the screen is, which way it faces, its colour and brightness (0 off). */
  set(slot: number, at: Vector3, facing: Vector3, color: Color, power: number): void;
  off(slot: number): void;
  /** Whether any slot shines (the page draws while it does). */
  readonly lit: boolean;
}

export function screenGlow(materials: Iterable<MeshBasicMaterial>): ScreenGlow {
  const positions = Array.from({ length: GLOW_SLOTS }, () => new Vector3());
  const facings = Array.from({ length: GLOW_SLOTS }, () => new Vector3(0, 0, 1));
  const colors = Array.from({ length: GLOW_SLOTS }, () => new Vector3());
  const uniforms = {
    glowAt: { value: positions },
    glowFacing: { value: facings },
    glowColor: { value: colors },
  };
  for (const material of materials) patch(material, uniforms);
  let lit = false;
  return {
    set(slot, at, facing, color, power) {
      positions[slot]!.copy(at);
      facings[slot]!.copy(facing).normalize();
      colors[slot]!.set(color.r, color.g, color.b).multiplyScalar(Math.max(0, power));
      lit = colors.some((c) => c.x + c.y + c.z > 0);
    },
    off(slot) {
      colors[slot]!.set(0, 0, 0);
      lit = colors.some((c) => c.x + c.y + c.z > 0);
    },
    get lit() {
      return lit;
    },
  };
}

function patch(material: Material, uniforms: Record<string, { value: unknown }>) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vGlowWorld;
varying vec3 vGlowNormal;`,
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
vGlowWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
vGlowNormal = normalize(mat3(modelMatrix) * normal);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec3 glowAt[${GLOW_SLOTS}];
uniform vec3 glowFacing[${GLOW_SLOTS}];
uniform vec3 glowColor[${GLOW_SLOTS}];
varying vec3 vGlowWorld;
varying vec3 vGlowNormal;`,
      )
      .replace(
        '#include <opaque_fragment>',
        `{
  // The surface's hue at a middle brightness: what a small light shows of it.
  vec3 base = diffuseColor.rgb;
  float top = max(max(base.r, base.g), base.b);
  vec3 albedo = base / max(top, 0.03) * mix(0.22, 0.75, smoothstep(0.0, 0.6, top));
  vec3 n = normalize(vGlowNormal);
  for (int i = 0; i < ${GLOW_SLOTS}; i++) {
    if (glowColor[i].r + glowColor[i].g + glowColor[i].b <= 0.0) continue;
    vec3 toLight = glowAt[i] - vGlowWorld;
    float d2 = dot(toLight, toLight);
    vec3 l = toLight * inversesqrt(max(d2, 1e-6));
    // A screen shines ahead of it, a little to the sides, hardly behind.
    float ahead = max(dot(-l, glowFacing[i]), 0.0);
    float cone = 0.08 + 0.92 * ahead * ahead;
    // Two-sided: thin cloth and paper catch it from either face.
    float catchLight = abs(dot(n, l)) * 0.85 + 0.15;
    outgoingLight += glowColor[i] * albedo * cone * catchLight / (d2 + 0.015);
  }
}
#include <opaque_fragment>`,
      );
  };
  // One program for every patched material of the same kind (the slots are uniforms).
  material.customProgramCacheKey = () => 'screen-glow';
  material.needsUpdate = true;
}
