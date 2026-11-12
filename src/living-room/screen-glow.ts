// Light that changes at run time on the baked room (docs/living-life.md, docs/living-desktop.md).
// The room is drawn unlit: its light was baked in Blender, so a lamp added at run time would not
// reach it. Two things are added to the room's own materials:
//
// 1. Baked layers. Some lamps were baked on their own (scripts/living-room/80_bake.py), white:
//    `ui`, the glow of the virtual desktop coming in through the open front of the room, and
//    `screen`, the desk monitor's light. Each layer is a second lightmap for the big surfaces and
//    a per-vertex attribute for the rest, with real shadows and bounces in it; here it is tinted
//    with the colour of what is shown and added to the room.
//
// 2. Small screens. Up to two points (the resident's phone) that shine mostly the way they face,
//    fall off with distance and are caught by surfaces that face them. No shadows: they are small
//    and close to what they light.
//
// Not data from a work: the shader code is this page's own, and only numbers and the room's own
// textures change at run time.
import { Color, Vector3, type Material, type MeshBasicMaterial, type Texture } from 'three';

/** The resident's phone, and up to four things of the desktop (its windows, the ball). */
export const GLOW_SLOTS = 5;
export type GlowLayer = 'ui' | 'screen';
/**
 * How a material carries its baked light, and so its layers: `lightmap` in textures on its UV,
 * `vertex` in vertex attributes (colour baked in), `textured` in vertex attributes times its own
 * colour texture, `plain` not at all (light sources, glass).
 */
export type GlowKind = 'lightmap' | 'vertex' | 'textured' | 'plain';

export interface ScreenGlow {
  /** Sets a slot: where the screen is, which way it faces, its colour and brightness (0 off). */
  set(slot: number, at: Vector3, facing: Vector3, color: Color, power: number): void;
  off(slot: number): void;
  /** Tints a baked layer: linear RGB times `power` (0 is dark). */
  layer(name: GlowLayer, r: number, g: number, b: number, power: number): void;
  /** Turns the room's own baked light down (1 as baked, 0 dark): the house lights at a live. */
  dim(amount: number): void;
  /** Whether any slot shines (the page draws while it does). */
  readonly lit: boolean;
}

export function screenGlow(
  materials: Iterable<readonly [MeshBasicMaterial, GlowKind]>,
  layers: Partial<Record<GlowLayer, Texture>>,
  lightScale: number,
): ScreenGlow {
  const positions = Array.from({ length: GLOW_SLOTS }, () => new Vector3());
  const facings = Array.from({ length: GLOW_SLOTS }, () => new Vector3(0, 0, 1));
  const colors = Array.from({ length: GLOW_SLOTS }, () => new Vector3());
  const tints = { ui: new Vector3(), screen: new Vector3() };
  const uniforms = {
    glowAt: { value: positions },
    glowFacing: { value: facings },
    glowColor: { value: colors },
    layerUi: { value: tints.ui },
    layerScreen: { value: tints.screen },
    layerUiMap: { value: layers.ui ?? null },
    layerScreenMap: { value: layers.screen ?? null },
    roomDim: { value: 1 },
  };
  const layered = Boolean(layers.ui && layers.screen);
  for (const [material, kind] of materials) patch(material, layered ? kind : 'plain', uniforms);
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
    layer(name, r, g, b, power) {
      // (The layers are stored divided by the room's light scale, like its own light.)
      tints[name].set(r, g, b).multiplyScalar(Math.max(0, power) * lightScale);
    },
    dim(amount) {
      uniforms.roomDim.value = Math.min(1, Math.max(0, amount));
    },
    get lit() {
      return lit;
    },
  };
}

function patch(material: Material, kind: GlowKind, uniforms: Record<string, { value: unknown }>) {
  const perVertex = kind === 'vertex' || kind === 'textured';
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vGlowWorld;
varying vec3 vGlowNormal;
${perVertex ? 'attribute vec3 _ui;\nattribute vec3 _screen;\nvarying vec3 vLayerUi;\nvarying vec3 vLayerScreen;' : ''}`,
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
vGlowWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
vGlowNormal = normalize(mat3(modelMatrix) * normal);
${perVertex ? 'vLayerUi = _ui;\nvLayerScreen = _screen;' : ''}`,
      );
    const layerTerm =
      kind === 'lightmap'
        ? 'outgoingLight += texture2D(layerUiMap, vMapUv).rgb * layerUi + texture2D(layerScreenMap, vMapUv).rgb * layerScreen;'
        : kind === 'vertex'
          ? 'outgoingLight += vLayerUi * layerUi + vLayerScreen * layerScreen;'
          : kind === 'textured'
            ? 'outgoingLight += (vLayerUi * layerUi + vLayerScreen * layerScreen) * texture2D(map, vMapUv).rgb;'
            : '';
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec3 glowAt[${GLOW_SLOTS}];
uniform vec3 glowFacing[${GLOW_SLOTS}];
uniform vec3 glowColor[${GLOW_SLOTS}];
uniform vec3 layerUi;
uniform vec3 layerScreen;
uniform float roomDim;
${kind === 'lightmap' ? 'uniform sampler2D layerUiMap;\nuniform sampler2D layerScreenMap;' : ''}
${perVertex ? 'varying vec3 vLayerUi;\nvarying vec3 vLayerScreen;' : ''}
varying vec3 vGlowWorld;
varying vec3 vGlowNormal;`,
      )
      .replace(
        '#include <opaque_fragment>',
        `{
  // The house lights: the room's own baked light, turned down at a live. (Things that shine by
  // themselves, lamps and screens, are turned down less.)
  outgoingLight *= ${kind === 'plain' ? 'mix(0.45, 1.0, roomDim)' : 'roomDim'};
  ${layerTerm}
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
  // One program for every patched material of the same kind (the rest are uniforms).
  material.customProgramCacheKey = () => `screen-glow:${kind}`;
  material.needsUpdate = true;
}
