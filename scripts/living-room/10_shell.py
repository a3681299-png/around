# The room's shell: floor slab and planks, three walls with wainscot, the window with its night
# view, curtains, and the fixed camera. Needs lib.py.
C = wipe('shell')
rnd = random.Random(7)

M_SLAB = mat('slab', '#2b2740', 0.8)
M_WALL = mat('wall_upper', '#5a5a96', 0.85)
M_WALL_B = mat('wall_back', '#4a4a86', 0.85)
M_WAIN = mat('wainscot', '#b9b4d8', 0.7)
M_TRIM = mat('trim', '#e9e4f2', 0.55)
M_CAP = mat('wall_cap', '#8f8cc0', 0.7)
WOODS = [mat(f'floor_wood_{i}', h, 0.5) for i, h in enumerate(['#a9795a', '#b58463', '#9c6e52', '#c08f6c', '#a37355'])]

# --- floor ---
box('static_slab', (HALF * 2 + 0.24, HALF * 2 + 0.12, 0.2), (0, -0.06 + 0.06, -0.112), C, M_SLAB, bevel=0.02, segs=3)['lm'] = 1
bm = bmesh.new()
PW = 0.16
x = -HALF
row = 0
while x < HALF - 1e-6:
    w = min(PW, HALF - x)
    y = -HALF - rnd.uniform(0, 0.9)
    while y < HALF:
        ln = rnd.uniform(0.9, 1.7)
        y0, y1 = max(y, -HALF), min(y + ln, HALF)
        if y1 - y0 > 0.02:
            bm_box(bm, (w - 0.003, y1 - y0 - 0.003, 0.012), (x + w / 2, (y0 + y1) / 2, -0.006), mi=rnd.randrange(len(WOODS)))
        y += ln
    x += w
    row += 1
o = bm_object('static_floor_planks', bm, WOODS, C, bevel=0.0015, segs=1)
o['lm'] = 1

# --- walls (one mesh each, the back one with the window's hole) ---
T = 0.14
WIN = (0.55, 1.95, 1.0, 2.2)  # x0, x1, z0, z1


def wall_grid(xs, zs, hole=None):
    bm = bmesh.new()
    vs = [[bm.verts.new((x, 0, z)) for z in zs] for x in xs]
    for i in range(len(xs) - 1):
        for j in range(len(zs) - 1):
            if hole and (i, j) in hole:
                continue
            f = bm.faces.new((vs[i][j], vs[i + 1][j], vs[i + 1][j + 1], vs[i][j + 1]))
            f.material_index = 0 if zs[j] >= 0.95 - 1e-6 else 1
    return bm


def wall(name, bm, loc, rot, mats):
    r = bmesh.ops.extrude_face_region(bm, geom=bm.faces[:])
    vs = [e for e in r['geom'] if isinstance(e, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, vec=(0, T, 0), verts=vs)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    # the top faces get the lighter cap colour (the cut of the diorama)
    top = max(v.co.z for v in bm.verts)
    for f in bm.faces:
        if f.normal.z > 0.9 and f.calc_center_median().z > top - 0.01:
            f.material_index = 2
    o = bm_object(name, bm, mats, C, bevel=0.006, segs=2, loc=loc, rot=rot)
    o['lm'] = 1
    return o


zs = [0, 0.95, WIN[2], WIN[3], WALL_H]
wall('static_wall_back', wall_grid([-HALF - T, WIN[0], WIN[1], HALF + T], zs, hole={(1, 2)}), (0, HALF, 0), (0, 0, 0), [M_WALL_B, M_WAIN, M_CAP])
wall('static_wall_left', wall_grid([-HALF, HALF], [0, 0.95, WALL_H]), (-HALF, 0, 0), (0, 0, math.radians(90)), [M_WALL, M_WAIN, M_CAP])
# the right wall is a low half wall: the camera looks in over it (the diorama's open corner)
wall('static_wall_right', wall_grid([-HALF, HALF], [0, 0.95]),(HALF + T, 0, 0), (0, 0, math.radians(90)), [M_WALL, M_WAIN, M_CAP])

# --- baseboard, chair rail and wainscot panels ---
def run(name, size_z, depth, z, m, bevel=0.004):
    # along back, left and right walls (inside faces)
    box(name + '_b', (HALF * 2, depth, size_z), (0, HALF - depth / 2, z), C, m, bevel=bevel)['lm'] = 1
    box(name + '_l', (depth, HALF * 2 - depth, size_z), (-HALF + depth / 2, -depth / 2, z), C, m, bevel=bevel)['lm'] = 1
    box(name + '_r', (depth, HALF * 2 - depth, size_z), (HALF - depth / 2, -depth / 2, z), C, m, bevel=bevel)['lm'] = 1


run('static_baseboard', 0.1, 0.018, 0.05, M_TRIM)
run('static_rail', 0.035, 0.028, 0.95, M_TRIM, bevel=0.008)
# raised panels on the wainscot: thin frames
bm = bmesh.new()
def panel(cx, cz, w, h, axis):
    t, d = 0.022, 0.008
    for dx, dz, sw, sh in ((0, h / 2 - t / 2, w, t), (0, -h / 2 + t / 2, w, t), (-w / 2 + t / 2, 0, t, h - 2 * t), (w / 2 - t / 2, 0, t, h - 2 * t)):
        if axis == 'b':
            bm_box(bm, (sw, d, sh), (cx + dx, HALF - d / 2, cz + dz))
        else:
            sgn = -1 if axis == 'l' else 1
            bm_box(bm, (d, sw, sh), (sgn * (HALF - d / 2), cx + dx, cz + dz))
n = 6
for i in range(n):
    cx = -HALF + (i + 0.5) * (HALF * 2 / n)
    panel(cx, 0.52, HALF * 2 / n - 0.14, 0.62, 'b')
    panel(cx, 0.52, HALF * 2 / n - 0.14, 0.62, 'l')
    panel(cx, 0.52, HALF * 2 / n - 0.14, 0.62, 'r')
bm_object('static_wainscot_panels', bm, M_WAIN, C, bevel=0.003, segs=1)['lm'] = 1

# --- window ---
M_FRAME = mat('window_frame', '#efeaf6', 0.45)
x0, x1, z0, z1 = WIN
cx, cz, ww, wh = (x0 + x1) / 2, (z0 + z1) / 2, x1 - x0, z1 - z0
bm = bmesh.new()
fw, fd = 0.07, T + 0.05
ycen = HALF + T / 2 - 0.012
for dx, dz, sw, sh in ((0, wh / 2 + fw / 2, ww + 2 * fw, fw), (-ww / 2 - fw / 2, 0, fw, wh), (ww / 2 + fw / 2, 0, fw, wh)):
    bm_box(bm, (sw, fd, sh), (cx + dx, ycen, cz + dz))
# inner sash and muntins
sd = 0.04
for dx, dz, sw, sh in ((0, wh / 2 - 0.02, ww, 0.04), (0, -wh / 2 + 0.02, ww, 0.04), (-ww / 2 + 0.02, 0, 0.04, wh), (ww / 2 - 0.02, 0, 0.04, wh),
                       (0, 0, 0.045, wh), (0, 0.18, ww, 0.025), (-ww / 4, 0, 0.022, wh), (ww / 4, 0, 0.022, wh)):
    bm_box(bm, (sw, sd, sh), (cx + dx, HALF + 0.07, cz + dz))
bm_object('static_window_frame', bm, M_FRAME, C, bevel=0.006, segs=2)
box('static_window_sill', (ww + 0.26, 0.26, 0.04), (cx, HALF - 0.05, z0 - 0.02), C, M_FRAME, bevel=0.012, segs=3)
box('static_window_apron', (ww + 0.14, 0.02, 0.07), (cx, HALF - 0.01, z0 - 0.075), C, M_FRAME, bevel=0.006)

# the night outside: a sky gradient (vertex colours), a moon, a skyline with lit windows
M_SKY = mat('sky', '#ffffff', 1, emit='#ffffff', strength=1.0, vcol=True)
bm = bmesh.new()
lay = bm.loops.layers.color.new('Color')
# kept below the wall's top and close behind it, so the camera never sees it over the wall
sw, sh, sy = 5.0, 2.9, HALF + 1.0
rows = 10
grad = [srgb(h) for h in ('#1b1f5e', '#262a78', '#3a3496', '#5a3fa6', '#8a4fb0', '#c067b0')]
def sky_col(t):
    t = max(0, min(0.999, t)) * (len(grad) - 1)
    i = int(t)
    f = t - i
    return tuple(grad[i][k] * (1 - f) + grad[i + 1][k] * f for k in range(3)) + (1,)
vs = [[bm.verts.new(((cx - 2.3, cx, HALF + T - 0.02)[i], sy, cz + 0.9 - j * sh / rows)) for i in range(3)] for j in range(rows + 1)]
for j in range(rows):
    for i in range(2):
        f = bm.faces.new((vs[j][i], vs[j + 1][i], vs[j + 1][i + 1], vs[j][i + 1]))
        for l in f.loops:
            t = (cz + 0.9 - l.vert.co.z) / sh
            c4 = sky_col(t ** 1.25)
            l[lay] = tuple(v * 0.5 for v in c4[:3]) + (1,)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
o = bm_object('dyn_window_sky', bm, M_SKY, C, smooth=False)
for f in o.data.polygons:
    f.flip() if f.normal.y > 0 else None
M_MOON = mat('moon', '#fff6d8', 1, emit='#fff1c9', strength=3)
cyl('dyn_moon', 0.17, 0.01, (cx + 0.38, sy - 0.05, cz + 0.36), C, M_MOON, rot=(math.radians(90), 0, 0), bevel=0, verts=40)
M_CITY = mat('city', '#0b0a22', 1)
M_CITYWIN = mat('city_window', '#ffd9a0', 1, emit='#ffcf8a', strength=1.6)
M_CITYWIN2 = mat('city_window_cool', '#bfe2ff', 1, emit='#a8d8ff', strength=1.3)
bm = bmesh.new()
bx = cx - 2.3
while bx < HALF - 0.5:
    bw = rnd.uniform(0.28, 0.6)
    bh = rnd.uniform(0.5, 1.5)
    by = HALF + rnd.uniform(0.5, 0.8)
    bm_box(bm, (bw, 0.3, bh), (bx + bw / 2, by, z0 - 0.75 + bh / 2), mi=0)
    nx, nz = int(bw / 0.085), int(bh / 0.11)
    for i in range(nx):
        for j in range(nz):
            if rnd.random() < 0.3:
                bm_box(bm, (0.04, 0.01, 0.05), (bx + 0.05 + i * 0.085, by - 0.155, z0 - 0.75 + 0.08 + j * 0.11), mi=1 if rnd.random() < 0.7 else 2)
    bx += bw + rnd.uniform(0.0, 0.08)
bm_object('dyn_city', bm, [M_CITY, M_CITYWIN, M_CITYWIN2], C, smooth=False)

# --- curtains: folded cloth to just below the sill, a rod with rings ---
M_CURT = mat('curtain', '#8a7fc9', 0.9)
M_ROD = mat('brass', '#c9a063', 0.35, metal=0.9)
def curtain(name, xa, xb, seed):
    r2 = random.Random(seed)
    bm = bmesh.new()
    nx, nz = 64, 14
    ztop, zbot = 2.36, 0.72
    waves = 6.5
    grid = []
    for j in range(nz + 1):
        t = j / nz
        z = ztop + (zbot - ztop) * t
        rowv = []
        for i in range(nx + 1):
            u = i / nx
            # gathered toward the outer side as it falls; deeper folds lower
            xx = xa + (xb - xa) * u
            amp = 0.022 + 0.03 * t
            yy = HALF - 0.085 - amp * math.sin(u * waves * 2 * math.pi + 0.6 * math.sin(t * 3 + seed)) - 0.012 * math.sin(u * 23 + t * 5)
            xx += 0.012 * math.sin(t * 6 + u * 9)
            rowv.append(bm.verts.new((xx, yy, z + (0.012 * math.sin(u * waves * 2 * math.pi) if j == nz else 0))))
        grid.append(rowv)
    for j in range(nz):
        for i in range(nx):
            bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    o = bm_object(name, bm, M_CURT, C)
    s = o.modifiers.new('solid', 'SOLIDIFY')
    s.thickness = 0.008
    s.offset = 0
    return o
curtain('static_curtain_l', x0 - 0.2, x0 + 0.3, 1)
curtain('static_curtain_r', x1 - 0.3, x1 + 0.2, 2)
cyl('static_curtain_rod', 0.012, ww + 0.7, (cx, HALF - 0.085, 2.4), C, M_ROD, rot=(0, math.radians(90), 0), bevel=0.002)
for sx in (-1, 1):
    sphere('static_rod_finial', 0.028, (cx + sx * (ww / 2 + 0.36), HALF - 0.085, 2.4), C, M_ROD)
    box('static_rod_bracket', (0.02, 0.085, 0.02), (cx + sx * (ww / 2 + 0.28), HALF - 0.045, 2.4), C, M_ROD, bevel=0.004)

# --- camera and world ---
cam = bpy.data.objects.get('camera_main')
if not cam:
    cam = bpy.data.objects.new('camera_main', bpy.data.cameras.new('camera_main'))
    coll('meta').objects.link(cam)
cam.location = (2.2, -8.6, 4.1)
look = Vector((-0.05, 0.35, 0.85))
cam.rotation_euler = (look - cam.location).to_track_quat('-Z', 'Y').to_euler()
cam.data.lens = 46
cam.data.sensor_width = 36
cam.data.clip_start = 0.1
cam.data.clip_end = 60
sc = bpy.context.scene
sc.camera = cam
sc.render.resolution_x, sc.render.resolution_y = 1600, 900
w = sc.world or bpy.data.worlds.new('World')
sc.world = w
w.use_nodes = True
bg = w.node_tree.nodes.get('Background')
bg.inputs['Color'].default_value = srgb('#191a4a')
bg.inputs['Strength'].default_value = 0.5
print('shell done', len(C.objects))
