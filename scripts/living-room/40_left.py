# The left wall and the middle of the room: bookshelf, beanbag corner with its arc lamp, side
# table, plants, rug. Needs lib.py, 20_desk.py, 30_bed.py.
C = wipe('left')
rnd = random.Random(41)
BOOK_COLS = ['#f0a6c8', '#a79bdc', '#9fe0cf', '#f6d98a', '#f6efe2', '#7d74c9', '#f28f7c', '#6fb7e8', '#3d3a6b', '#e9e4f2', '#c9a0e8', '#ffd0a8']
M_BOOKS = [mat(f'book_{i}', h, 0.7) for i, h in enumerate(BOOK_COLS)]
M_PAGES = mat('pages', '#f7f1e3', 0.9)
M_WOOD2 = mat('shelf_wood', '#d9b991', 0.5)
M_LEAF = mat('leaf', '#4fae8a', 0.6)
M_LEAF2 = mat('leaf_dark', '#2f8a72', 0.6)
M_POT = mat('pot_terra', '#e59a7a', 0.7)
M_POT2 = mat('pot_white', '#f1eef7', 0.4)
M_SOIL = mat('soil', '#3a2c2c', 1.0)
M_BEAN = mat('beanbag', '#e58fb8', 0.95)
M_RUG = mat('rug_cream', '#efe6da', 1.0)
M_RUG2 = mat('rug_lilac', '#b9a8e6', 1.0)
M_RUG3 = mat('rug_pink', '#f2b6cf', 1.0)


def books(bm, start, length, base_z, along='y', spine=1, depth=0.2, hmin=0.17, hmax=0.25, back=0.0, r=rnd, lean_end=True):
    """A row of books standing on a shelf. `along` is the row's axis; `spine` the side they face."""
    p = 0.0
    while p < length - 0.02:
        t = r.uniform(0.014, 0.04)
        h = r.uniform(hmin, hmax)
        d = depth * r.uniform(0.8, 1.0)
        if p + t > length:
            break
        lean = 0.0
        if lean_end and p + t + 0.06 > length:
            lean = math.radians(r.uniform(8, 16))
        mi = 1 + r.randrange(len(M_BOOKS))
        off = back + (depth - d) / 2 * -spine  # pushed to the back a little unevenly
        c0 = start + p + t / 2 + (math.sin(lean) * h / 2 if lean else 0)
        if along == 'y':
            loc = (off, c0, base_z + h / 2 * math.cos(lean))
            bm_box(bm, (d, t, h), loc, rot=(-lean, 0, 0), mi=mi)
            bm_box(bm, (d - 0.006, t - 0.005, h - 0.008), (off - spine * 0.004, c0, base_z + h / 2 * math.cos(lean)), rot=(-lean, 0, 0), mi=0)
        else:
            loc = (c0, off, base_z + h / 2 * math.cos(lean))
            bm_box(bm, (t, d, h), loc, rot=(0, lean, 0), mi=mi)
        p += t + (0.001 if not lean else h * math.sin(lean))
        if r.random() < 0.06:
            p += r.uniform(0.02, 0.06)


def stack(bm, x, y, z, n, r=rnd, w=0.16, d=0.22):
    for i in range(n):
        t = r.uniform(0.018, 0.035)
        bm_box(bm, (w * r.uniform(0.85, 1), d * r.uniform(0.85, 1), t), (x + r.uniform(-0.01, 0.01), y + r.uniform(-0.01, 0.01), z + t / 2), rot=(0, 0, r.uniform(-0.25, 0.25)), mi=1 + r.randrange(len(M_BOOKS)))
        z += t
    return z


def leaf_mesh(bm, length, width, bend, fold, mi=0, split=False):
    nu, nv = 10, 6
    grid = []
    for i in range(nu + 1):
        u = i / nu
        prof = (math.sin(math.pi * min(1, u * 1.08)) ** 0.7) * (1 - 0.35 * u) if not split else (math.sin(math.pi * u) ** 0.5)
        row = []
        for j in range(nv + 1):
            v = j / nv * 2 - 1
            x = v * width / 2 * prof
            y = u * length
            z = -bend * u * u * length + fold * abs(v) * width * 0.5 * prof
            row.append(bm.verts.new((x, y * math.cos(bend * u * 0.8), z)))
        grid.append(row)
    fs = []
    for i in range(nu):
        for j in range(nv):
            f = bm.faces.new((grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j]))
            f.material_index = mi
            fs.append(f)
    return [v for row in grid for v in row]


def plant(name, loc, pot_r, pot_h, pot_m, leaves, stem_h, leaf_len, leaf_w, seed, droop=0.5, upright=False, c=None):
    c = c or C
    r = random.Random(seed)
    g = group(name + '_root', loc, c=c)
    par(g, lathe('static_' + name + '_pot', [(0, 0), (pot_r * 0.72, 0), (pot_r * 0.78, 0.01), (pot_r, pot_h * 0.92), (pot_r * 1.06, pot_h * 0.94), (pot_r * 1.06, pot_h), (pot_r * 0.92, pot_h), (pot_r * 0.9, pot_h * 0.9), (0, pot_h * 0.9)], (0, 0, 0), c, pot_m, steps=32, bevel=0.003))
    par(g, cyl('static_' + name + '_soil', pot_r * 0.9, 0.01, (0, 0, pot_h * 0.9), c, M_SOIL, bevel=0, verts=24))
    bm = bmesh.new()
    stems = []
    for k in range(leaves):
        a = 2 * math.pi * k / leaves + r.uniform(-0.4, 0.4)
        h = stem_h * r.uniform(0.55, 1.0)
        out = (0.12 + 0.5 * (1 - h / stem_h)) * stem_h * (0.25 if upright else 1)
        tip = Vector((math.cos(a) * out, math.sin(a) * out, pot_h + h))
        L = leaf_len * r.uniform(0.75, 1.1)
        vs = leaf_mesh(bm, L, leaf_w * r.uniform(0.8, 1.1) * (L / leaf_len), 0.0 if upright else droop * r.uniform(0.6, 1.3), r.uniform(0.1, 0.35), mi=k % 2)
        tilt = math.radians(r.uniform(5, 15)) if upright else math.radians(r.uniform(25, 65))
        rotm = Matrix.Translation(tip) @ Matrix.Rotation(a - math.pi / 2, 4, 'Z') @ Matrix.Rotation(math.pi / 2 - tilt, 4, 'X')
        if upright:
            rotm = Matrix.Translation((math.cos(a) * pot_r * 0.4, math.sin(a) * pot_r * 0.4, pot_h * 0.9)) @ Matrix.Rotation(a - math.pi / 2, 4, 'Z') @ Matrix.Rotation(math.pi / 2 - tilt, 4, 'X')
        bmesh.ops.transform(bm, matrix=rotm, verts=vs)
        if not upright:
            stems.append([(math.cos(a) * pot_r * 0.2, math.sin(a) * pot_r * 0.2, pot_h * 0.9), tuple(tip * 0.5 + Vector((0, 0, pot_h + h * 0.55)) * 0.5), tuple(tip)])
    o = bm_object('static_' + name + '_leaves', bm, [M_LEAF, M_LEAF2], c)
    s = o.modifiers.new('solid', 'SOLIDIFY')
    s.thickness = 0.004
    s.offset = 0
    ss = o.modifiers.new('sub', 'SUBSURF')
    ss.levels = ss.render_levels = 1
    par(g, o)
    for st in stems:
        par(g, tube('static_' + name + '_stem', st, 0.006 if leaf_len > 0.15 else 0.003, c, M_LEAF2, res=6, bevel_res=2))
    return g

# --- bookshelf on the left wall ---
SH_W, SH_D, SH_H = 1.15, 0.32, 1.96
SX, SY = -HALF + SH_D / 2 + 0.02, 0.35
S = group('shelf_root', (SX, SY, 0), c=C)
bm = bmesh.new()
for sy in (-1, 1):
    bm_box(bm, (SH_D, 0.03, SH_H), (0, sy * (SH_W / 2 - 0.015), SH_H / 2))
levels_z = [0.06, 0.44, 0.82, 1.2, 1.58, SH_H - 0.015]
for z in levels_z:
    bm_box(bm, (SH_D - 0.01, SH_W - 0.06, 0.03), (0, 0, z))
bm_box(bm, (SH_D, SH_W - 0.06, 0.05), (0.0, 0, 0.025))
o = bm_object('static_bookshelf', bm, M_WHITE, C, bevel=0.006, segs=2)
o['lm'] = 1
par(S, o)
par(S, box('static_bookshelf_back', (0.01, SH_W - 0.04, SH_H - 0.06), (-SH_D / 2 + 0.008, 0, SH_H / 2), C, M_WOOD2, bevel=0))
bm = bmesh.new()
y0 = -SH_W / 2 + 0.035
inner = SH_W - 0.07
# level by level: books, stacks and gaps for objects
books(bm, y0, 0.62, levels_z[0] + 0.015, depth=0.22, hmin=0.2, hmax=0.3)
books(bm, y0 + 0.3, inner - 0.3, levels_z[1] + 0.015, depth=0.2)
stack(bm, 0, y0 + 0.13, levels_z[1] + 0.015, 5)
books(bm, y0, 0.48, levels_z[2] + 0.015, depth=0.2)
books(bm, y0 + 0.74, inner - 0.74, levels_z[2] + 0.015, depth=0.2, hmin=0.15, hmax=0.2)
books(bm, y0 + 0.42, inner - 0.42, levels_z[3] + 0.015, depth=0.2)
books(bm, y0, 0.34, levels_z[4] + 0.015, depth=0.2, hmin=0.14, hmax=0.2)
stack(bm, 0, y0 + 0.88, levels_z[4] + 0.015, 4)
par(S, bm_object('static_shelf_books', bm, [M_PAGES] + M_BOOKS, C, bevel=0.0025, segs=1))
# objects in the gaps
par(S, soft_box('static_shelf_basket', (0.24, 0.36, 0.2), (0.0, y0 + 0.86, levels_z[0] + 0.115), C, mat('basket', '#e0c79a', 0.95), puff=0.1, cuts=4, levels=1))
M_GLOBE = mat('globe_lamp', '#ffe9c9', 0.6, emit='#ffc98a', strength=4.5)
par(S, sphere('dyn_shelf_globe', 0.075, (0.0, y0 + 0.2, levels_z[3] + 0.105), C, M_GLOBE))
par(S, cyl('static_globe_base', 0.045, 0.03, (0.0, y0 + 0.2, levels_z[3] + 0.03), C, M_WOOD2, bevel=0.006))
par(S, box('static_shelf_frame', (0.015, 0.16, 0.2), (0.02, y0 + 0.6, levels_z[2] + 0.115), C, M_WOOD2, rot=(0, math.radians(-10), 0), bevel=0.004))
par(S, box('static_shelf_frame_pic', (0.004, 0.13, 0.17), (0.03, y0 + 0.6, levels_z[2] + 0.115), C, mat('pic_pink', '#f6b7d3', 0.8), rot=(0, math.radians(-10), 0), bevel=0))
par(S, lathe('static_shelf_vase', [(0, 0), (0.03, 0), (0.05, 0.03), (0.055, 0.08), (0.03, 0.15), (0.02, 0.19), (0.027, 0.21), (0.02, 0.21), (0, 0.2)], (0.0, y0 + 0.62, levels_z[4] + 0.015), C, mat('vase_blue', '#7fb3ee', 0.25), subsurf=1))
plant('shelfplant', (SX + 0.02, SY + 0.36, levels_z[5] + 0.015), 0.07, 0.11, M_POT2, 9, 0.12, 0.2, 0.09, 12, droop=1.4)
plant('shelfplant2', (SX + 0.0, SY - 0.3, levels_z[5] + 0.015), 0.055, 0.09, M_POT, 7, 0.16, 0.16, 0.035, 15, upright=True)
bm = bmesh.new()
stack(bm, 0, 0, 0, 3, w=0.2, d=0.15)
par(S, bm_object('static_shelf_topbooks', bm, [M_PAGES] + M_BOOKS, C, bevel=0.003, segs=1, loc=(0.0, 0.02, levels_z[5] + 0.015)))

# --- beanbag corner ---
def beanbag(name, loc, r=0.46, m=M_BEAN, yaw=0):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=40, v_segments=24, radius=1)
    r2 = random.Random(2)
    for v in bm.verts:
        x, y, z = v.co
        # a sack: wide and flat at the bottom, a dent where one sits, a raised back
        zz = z * 0.62 + 0.62
        if z < -0.3:
            zz = max(0.0, zz - (abs(z) - 0.3) * 0.25)
        k = 1 + 0.22 * (1 - (z + 1) / 2)
        dent = math.exp(-((x) ** 2 + (y + 0.25) ** 2) * 3.5) * 0.33 if z > 0 else 0
        back = math.exp(-((x) ** 2 + (y - 0.6) ** 2) * 2.5) * 0.3 if z > -0.2 else 0
        wr = 0.02 * math.sin(x * 9 + y * 4) * math.sin(z * 7 + 1)
        v.co = Vector((x * k, y * k, zz - dent + back + wr)) * r
    o = bm_object(name, bm, m, C, loc=loc, rot=(0, 0, math.radians(yaw)))
    s = o.modifiers.new('sub', 'SUBSURF')
    s.levels = s.render_levels = 1
    return o
beanbag('static_beanbag', (-1.5, -1.2, 0), yaw=-125)
par(None) if False else None
soft_box('static_bean_cushion', (0.36, 0.36, 0.12), (-1.72, -1.02, 0.5), C, M_MINT, rot=(math.radians(50), math.radians(10), math.radians(-40)), puff=0.7, pinch=0.7, noise=0.03, seed=3)
# round side table with a mug and a book
T = group('sidetable_root', (-0.92, -1.72, 0), c=C)
par(T, cyl('static_sidetable_top', 0.24, 0.025, (0, 0, 0.44), C, M_WOOD2, bevel=0.008, segs=3, verts=48))
for i in range(3):
    a = math.radians(i * 120 + 30)
    par(T, cyl('static_sidetable_leg', 0.012, 0.45, (0.15 * math.cos(a), 0.15 * math.sin(a), 0.215), C, M_WHITE, rot=(math.radians(8) * math.sin(a), -math.radians(8) * math.cos(a), 0), bevel=0.003, r2=0.016))
par(T, lathe('static_mug', [(0, 0), (0.032, 0), (0.036, 0.006), (0.038, 0.085), (0.034, 0.085), (0.032, 0.012), (0, 0.012)], (0.07, 0.04, 0.4525), C, M_PINK, steps=28))
par(T, torus('static_mug_handle', 0.022, 0.006, (0.112, 0.04, 0.4525 + 0.045), C, M_PINK, rot=(math.radians(90), 0, 0), arc=180, seg=24, rseg=8))
bpy.data.objects['static_mug_handle'].rotation_euler = (math.radians(90), math.radians(-90), 0)
bm = bmesh.new()
stack(bm, 0, 0, 0, 2, w=0.14, d=0.19)
par(T, bm_object('static_sidetable_books', bm, [M_PAGES] + M_BOOKS, C, bevel=0.003, segs=1, loc=(-0.08, -0.03, 0.4525)))
# arc floor lamp reaching over the beanbag
L = group('floorlamp_root', (-2.08, -1.95, 0), c=C)
par(L, cyl('static_floorlamp_base', 0.16, 0.03, (0, 0, 0.015), C, M_WHITE, bevel=0.01, segs=3, verts=40))
par(L, tube('static_floorlamp_pole', [(0, 0, 0.03), (0, 0, 1.2), (0.06, 0.08, 1.62), (0.28, 0.36, 1.8), (0.5, 0.62, 1.7)], 0.011, C, M_BRASS, res=16))
M_LSHADE = mat('floor_shade', '#f4eefc', 0.6)
M_BULB = mat('bulb_warm', '#fff0d0', 0.5, emit='#ffc184', strength=7)
par(L, lathe('static_floorlamp_shade', [(0.02, 0.1), (0.07, 0.085), (0.13, 0.03), (0.15, -0.03), (0.146, -0.034), (0.125, 0.02), (0.065, 0.075), (0.02, 0.09)], (0.52, 0.645, 1.64), C, M_LSHADE, steps=40, rot=(math.radians(-18), math.radians(14), 0)))
par(L, sphere('dyn_floorlamp_bulb', 0.04, (0.525, 0.652, 1.64), C, M_BULB))

# --- plants ---
plant('monstera', (0.45, BACK - 0.35, 0), 0.17, 0.3, M_POT2, 12, 0.85, 0.36, 0.3, 4, droop=0.9)
plant('snake', (-2.7, -0.5, 0), 0.12, 0.22, M_POT, 11, 0.5, 0.62, 0.075, 7, upright=True)

# --- rug: cream with a lilac band and a pink inner line ---
RX, RY = 0.15, -0.55
outline('static_rug', rounded_rect(2.5, 1.75, 0.22, 10), 0.014, (RX, RY, 0), C, M_RUG, bevel=0.006, segs=2)['lm'] = 1
def ring(name, w, h, r, t, m, z):
    outer = rounded_rect(w, h, r, 10)
    inner = rounded_rect(w - 2 * t, h - 2 * t, max(0.01, r - t), 10)
    bm = bmesh.new()
    vo = [bm.verts.new((x, y, 0)) for x, y in outer]
    vi = [bm.verts.new((x, y, 0)) for x, y in inner]
    n = len(vo)
    for i in range(n):
        bm.faces.new((vo[i], vo[(i + 1) % n], vi[(i + 1) % n], vi[i]))
    r_ = bmesh.ops.extrude_face_region(bm, geom=bm.faces[:])
    bmesh.ops.translate(bm, vec=(0, 0, 0.004), verts=[e for e in r_['geom'] if isinstance(e, bmesh.types.BMVert)])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    o = bm_object(name, bm, m, C, bevel=0.0015, segs=1, loc=(RX, RY, z))
    o['lm'] = 1
    return o
ring('static_rug_band', 2.26, 1.51, 0.16, 0.13, M_RUG2, 0.0125)
ring('static_rug_line', 1.84, 1.09, 0.1, 0.03, M_RUG3, 0.0125)
# a floor cushion and a few things left on the rug
cyl_c = soft_box('static_floor_cushion', (0.52, 0.52, 0.12), (0.75, -0.95, 0.075), C, M_RUG2, rot=(0, 0, math.radians(20)), puff=0.5, pinch=0.55, levels=2)
bm = bmesh.new()
stack(bm, 0, 0, 0, 4, w=0.13, d=0.18)
bm_object('static_rug_books', bm, [M_PAGES] + M_BOOKS, C, bevel=0.003, segs=1, loc=(-0.35, -0.2, 0.018))
print('left done', len(C.objects))
