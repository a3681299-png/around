import { test, expect } from '@playwright/test';
import { inspectAsset } from '../src/assets/inspect';
import { inspectVrma } from '../src/assets/vrma';
import { classifyBody } from '../src/characters/humanoid';
import { MANNEQUIN_POSES, mannequinPoseVrma, mannequinVrm } from './helpers/mannequin';

const bytes = (buffer: Buffer) => new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);

test('the mannequin passes asset validation and measures as a normal-proportioned humanoid', () => {
  const info = inspectAsset(bytes(mannequinVrm()), 'model/gltf-binary');
  const vrm = info.model?.vrm;
  expect(info.model?.format).toBe('vrm');
  expect(vrm?.body).toBeDefined();
  const body = vrm!.body!;
  expect(body.height).toBeGreaterThan(1.2);
  expect(body.height).toBeLessThan(1.4);
  expect(body.headsTall).toBeGreaterThan(4);
  expect(body.headsTall).toBeLessThan(5);
  expect(classifyBody(body)).toBeDefined();
  expect(vrm?.expressions).toContain('blink');
});

test('its one-frame poses pass .vrma validation and keep the skeleton the mannequin uses', () => {
  for (const [name, pose] of Object.entries(MANNEQUIN_POSES)) {
    const { info } = inspectVrma(bytes(mannequinPoseVrma(name, pose)));
    expect(info.duration).toBe(0);
    expect(info.bones).toContain('hips');
    expect(info.restHipsHeight).toBeCloseTo(0.6, 3);
  }
  expect(inspectVrma(bytes(mannequinPoseVrma('sit', MANNEQUIN_POSES.sit))).info.bones).toEqual(
    expect.arrayContaining(['leftUpperLeg', 'leftLowerLeg', 'rightUpperLeg', 'rightLowerLeg', 'spine']),
  );
});
