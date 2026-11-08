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
        float bevel = smoothstep(-0.035, -0.004, distanceToEdge);
        vec2 screen = gl_FragCoord.xy / resolution;
        vec2 bend = -normalize(local + vec2(0.00001)) * bevel * 0.028;
        vec2 blur = vec2(0.0025, 0.004) * (1.0 + bevel);
        vec2 center = screen + bend;
        vec3 behind = texture2D(room, center).rgb * 4.0;
        behind += (texture2D(room, center + vec2(blur.x, 0.0)).rgb +
                   texture2D(room, center - vec2(blur.x, 0.0)).rgb +
                   texture2D(room, center + vec2(0.0, blur.y)).rgb +
                   texture2D(room, center - vec2(0.0, blur.y)).rgb) * 2.0;
        behind += texture2D(room, center + blur).rgb +
                  texture2D(room, center - blur).rgb +
                  texture2D(room, center + vec2(blur.x, -blur.y)).rgb +
                  texture2D(room, center + vec2(-blur.x, blur.y)).rgb;
        vec3 frost = vec3(0.57, 0.73, 0.87);
        vec3 glass = mix(behind / 16.0, frost, 0.16 + 0.16 * bevel);
        float rim = smoothstep(-0.0045, -0.001, distanceToEdge);
        float highlight = 0.30 + panel.y * 0.45 + panel.x * 0.18;
        glass = mix(glass, mix(vec3(1.0), tint, 0.48), rim * highlight);
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
