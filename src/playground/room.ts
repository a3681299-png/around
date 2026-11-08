import {
  AmbientLight,
  BoxGeometry,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PointLight,
  type Scene,
} from 'three';

/** Geometry and practical lights can be swapped for the room asset at this boundary. */
export function mountRoom(scene: Scene) {
  const room = new Group();
  scene.add(room);
  scene.background = new Color(0x101728);
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, color: number, luminous = false) => {
    const material = luminous ? new MeshBasicMaterial({ color }) : new MeshStandardMaterial({ color, roughness: 0.86 });
    const mesh = new Mesh(new BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    room.add(mesh);
    return mesh;
  };

  box(2420, 1460, 40, 0, 205, -970, 0x263952);
  box(2500, 35, 2900, 0, -526, 350, 0x544035);
  box(45, 1460, 2680, -1125, 205, 380, 0x263b53);
  box(45, 1460, 2680, 1125, 205, 380, 0x393249);
  for (let x = -1100; x <= 1100; x += 140) box(2, 1, 2600, x, -508, 350, 0x171c27);
  box(1600, 10, 1100, 0, -505, 220, 0x304f63);
  box(1560, 11, 1060, 0, -504, 220, 0x26364b);

  // A tall window, a low sideboard, and a lamp give the camera foreground and background cues.
  box(715, 490, 36, -610, 340, -930, 0x101d31);
  box(680, 451, 8, -610, 340, -908, 0x326285, true);
  box(672, 88, 9, -610, 174, -901, 0x698baa, true);
  box(20, 451, 20, -610, 340, -892, 0x182c42);
  box(690, 15, 20, -610, 340, -892, 0x182c42);
  box(730, 16, 73, -610, 98, -887, 0x41536a);
  box(382, 164, 250, 930, -408, -655, 0x82563c);
  box(404, 20, 265, 930, -322, -655, 0xa7744a);
  for (const x of [805, 930, 1055]) box(55, 7, 6, x, -380, -526, 0xf7b76a);
  box(130, 16, 104, 1010, -303, -655, 0x1c2433);
  box(11, 230, 11, 1010, -184, -655, 0xbb794d);
  box(160, 83, 140, 1010, -61, -655, 0xffbf78, true);
  box(170, 9, 148, 1010, -106, -655, 0xffe0a3, true);
  box(80, 100, 75, 780, -266, -666, 0x385b56);
  box(52, 62, 49, 854, -283, -633, 0x853b3e);
  box(190, 115, 152, -945, -450, -270, 0x735342);
  box(205, 18, 167, -945, -385, -270, 0x9b7557);
  const leaves = [
    [-990, -310, -290, -0.43],
    [-908, -292, -264, 0.39],
    [-952, -252, -273, -0.12],
  ];
  for (const [x, y, z, angle] of leaves as [number, number, number, number][]) {
    box(38, 162, 35, x, y, z, 0x285d57).rotation.z = angle;
  }

  const practical = new PointLight(0xffaf66, 1380000, 1800);
  practical.position.set(1010, -103, -555);
  const window = new PointLight(0x8dc4ff, 1260000, 1900);
  window.position.set(-630, 380, -620);
  const videoLight = new PointLight(0x90c6ff, 0, 1650);
  scene.add(videoLight);
  const lights = new Group();
  lights.add(new AmbientLight(0xc3d7ff, 0.76), practical, window);
  scene.add(lights);
  return { videoLight, lights };
}
