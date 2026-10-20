import { modelFixture } from './model-fixture';

/** Original VRM test box/rig. No third-party avatar or texture is included. */
export function vrmFixture(mutate?: (json: Record<string, any>) => void): Buffer {
  return modelFixture((j) => {
    const humanBones: Record<string, { node: number }> = { hips: { node: 2 }, head: { node: 3 } };
    const bone = (name: string, parent: number, translation: number[]) => {
      const node = j.nodes.length;
      j.nodes.push({ name, translation, children: [] });
      (j.nodes[parent].children ??= []).push(node);
      humanBones[name] = { node };
      return node;
    };
    j.nodes[2].children = [];
    const spine = bone('spine', 2, [0, 0.1, 0]);
    j.nodes[spine].children.push(3);
    for (const [side, x] of [
      ['left', 0.15],
      ['right', -0.15],
    ] as const) {
      const upperArm = bone(`${side}UpperArm`, spine, [x, 0.1, 0]),
        lowerArm = bone(`${side}LowerArm`, upperArm, [x, 0, 0]);
      bone(`${side}Hand`, lowerArm, [x, 0, 0]);
      const upperLeg = bone(`${side}UpperLeg`, 2, [x, -0.1, 0]),
        lowerLeg = bone(`${side}LowerLeg`, upperLeg, [0, -0.15, 0]);
      bone(`${side}Foot`, lowerLeg, [0, -0.1, 0.05]);
      bone(`${side}Eye`, 3, [x * 0.3, 0.03, 0.05]);
    }
    const tip = j.nodes.length;
    j.nodes.push({ name: 'Antenna', translation: [0, 0.15, 0] });
    (j.nodes[3].children ??= []).push(tip);
    j.nodes.push({ name: 'AntennaTip', translation: [0, 0.1, 0] });
    j.nodes[tip].children = [tip + 1];
    j.meshes[0].primitives[0].targets = [{ POSITION: 0 }];
    j.extensionsUsed.push('VRMC_vrm', 'VRMC_springBone', 'VRMC_materials_mtoon');
    j.materials[0].extensions.VRMC_materials_mtoon = {
      specVersion: '1.0',
      shadeColorFactor: [0.5, 0.5, 0.5],
      shadingToonyFactor: 0.9,
      outlineWidthMode: 'none',
    };
    const range = { inputMaxValue: 90, outputScale: 10 };
    j.extensions = {
      VRMC_vrm: {
        specVersion: '1.0',
        meta: {
          name: 'WW original test rig',
          version: '1',
          authors: ['Web World Themes tests'],
          licenseUrl: 'https://vrm.dev/licenses/1.0/',
        },
        humanoid: { humanBones },
        lookAt: {
          type: 'bone',
          rangeMapHorizontalInner: range,
          rangeMapHorizontalOuter: range,
          rangeMapVerticalUp: range,
          rangeMapVerticalDown: range,
        },
        expressions: {
          preset: {
            happy: { morphTargetBinds: [{ node: 1, index: 0, weight: 0.4 }] },
            blink: { morphTargetBinds: [{ node: 1, index: 0, weight: 0.1 }] },
          },
        },
      },
      VRMC_springBone: {
        specVersion: '1.0',
        springs: [
          {
            name: 'Antenna',
            joints: [
              { node: tip, stiffness: 1, gravityPower: 0.2, gravityDir: [1, 0, 0], dragForce: 0.4 },
              { node: tip + 1 },
            ],
          },
        ],
      },
    };
    mutate?.(j);
  });
}
