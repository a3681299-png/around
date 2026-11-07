import { Color, ShaderMaterial, Vector2, type Texture } from 'three';

export function glassMaterial(room: Texture) {
  return new ShaderMaterial({
    uniforms: {
      room: { value: room },
      resolution: { value: new Vector2() },
      aspect: { value: 1 },
      reveal: { value: 0 },
      tint: { value: new Color(0x91c7ff) },
    },
    vertexShader: `
      varying vec2 panel;
      void main() {
        panel = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D room;
      uniform vec2 resolution;
      uniform float aspect;
      uniform float reveal;
      uniform vec3 tint;
      varying vec2 panel;
      void main() {
        vec2 local = (panel - 0.5) * vec2(aspect, 1.0);
        vec2 corner = abs(local) - (vec2(aspect, 1.0) * 0.5 - 0.026);
        float distanceToEdge = length(max(corner, 0.0)) + min(max(corner.x, corner.y), 0.0) - 0.026;
        if (reveal > 0.1 && distanceToEdge > 0.0) discard;
        float bevel = smoothstep(-0.032, -0.002, distanceToEdge);
        vec2 screen = gl_FragCoord.xy / resolution;
        vec2 bend = -normalize(local + vec2(0.00001)) * bevel * 0.024;
        vec2 blur = vec2(0.005, 0.008);
        vec3 behind = texture2D(room, screen + bend).rgb * 0.28;
        behind += texture2D(room, screen + bend + blur).rgb * 0.18;
        behind += texture2D(room, screen + bend - blur).rgb * 0.18;
        behind += texture2D(room, screen + bend + vec2(blur.x, -blur.y)).rgb * 0.18;
        behind += texture2D(room, screen + bend + vec2(-blur.x, blur.y)).rgb * 0.18;
        vec3 paper = vec3(0.86, 0.89, 0.93);
        vec3 glass = mix(behind, paper, mix(0.77, 0.26, bevel));
        float rim = smoothstep(-0.006, -0.001, distanceToEdge);
        float highlight = clamp(0.32 + panel.y * 0.40 + panel.x * 0.15, 0.0, 1.0);
        glass = mix(glass, mix(vec3(1.0), tint, 0.56), rim * highlight);
        gl_FragColor = vec4(mix(vec3(0.896, 0.880, 0.839), glass, reveal), 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
}

/** Native snapshots arrive in display space. Avoid applying a second sRGB conversion to text. */
export function interfaceMaterial(texture: Texture, aspect: number) {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { image: { value: texture }, aspect: { value: aspect }, reveal: { value: 0 } },
    vertexShader: `
      varying vec2 panel;
      void main() {
        panel = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D image;
      uniform float aspect;
      uniform float reveal;
      varying vec2 panel;
      void main() {
        vec2 corner = abs(panel - 0.5) * vec2(aspect, 1.0) - (vec2(aspect, 1.0) * 0.5 - 0.026);
        if (reveal > 0.1 && length(max(corner, 0.0)) > 0.026) discard;
        gl_FragColor = texture2D(image, panel);
      }
    `,
  });
}
