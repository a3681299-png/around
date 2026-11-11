# Wall decoration and small things: shelves over the desk, framed art, neon, string lights, cork
# board, air conditioner, desk and sill items, cables, slippers. Needs the earlier scripts.
C = wipe('decor')
rnd = random.Random(51)
_art = {}


def acol(h):
    if h not in _art:
        _art[h] = mat('art_' + h.lstrip('#'), h, 0.8)
    return _art[h]


def art(name, w, h, loc, yaw, frame, layers, mount=None, fw=0.025, lm=False):
    """A framed picture built from flat shapes (local X right, Z up, facing local -Y)."""
    g = group(name + '_root', loc, yaw=yaw, c=C)
    bm = bmesh.new()
    for dx, dz, sw, sh in ((0, h / 2 + fw / 2, w + 2 * fw, fw), (0, -h / 2 - fw / 2, w + 2 * fw, fw), (-w / 2 - fw / 2, 0, fw, h), (w / 2 + fw / 2, 0, fw, h)):
        bm_box(bm, (sw, 0.022, sh), (dx, -0.011, dz))
    par(g, bm_object('static_' + name + '_frame', bm, frame, C, bevel=0.004, segs=2))
    mats, bm = [], bmesh.new()
    def mi(hx):
        m = acol(hx)
        if m not in mats:
            mats.append(m)
        return mats.index(m)
    y = -0.004
    for L in layers:
        y -= 0.0012
        kind = L[0]
        if kind == 'rect':
            _, x, z, sw, sh, hx = L
            pts = [(x - sw / 2, z - sh / 2), (x + sw / 2, z - sh / 2), (x + sw / 2, z + sh / 2), (x - sw / 2, z + sh / 2)]
        elif kind == 'disc':
            _, x, z, r, hx = L[:5]
            sy = L[5] if len(L) > 5 else 1
            pts = [(x + r * math.cos(2 * math.pi * i / 40), z + r * sy * math.sin(2 * math.pi * i / 40)) for i in range(40)]
        else:
            _, pts, hx = L
        pts = [(max(-w / 2, min(w / 2, px)), max(-h / 2, min(h / 2, pz))) for px, pz in pts]
        f = bm.faces.new([bm.verts.new((px, y, pz)) for px, pz in pts])
        f.material_index = mi(hx)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    o = bm_object('static_' + name + '_art', bm, mats, C, smooth=False)
    for p in o.data.polygons:
        if p.normal.y > 0:
            p.flip()
    par(g, o)
    return g


def hills(w, h, base, amp, n, phase, hx):
    pts = [(-w / 2, -h / 2)]
    pts += [(w / 2, -h / 2)]
    for i in range(n, -1, -1):
        x = -w / 2 + w * i / n
        pts.append((x, base + amp * math.sin(i / n * math.pi * 1.6 + phase)))
    return ('poly', pts, hx)


FR_W = bpy.data.materials['white_paint']
FR_WOOD = bpy.data.materials['shelf_wood']
FR_DARK = bpy.data.materials['dark_plastic']
BY = HALF - 0.001  # back wall face
LX = -HALF + 0.001

# --- floating shelves over the desk, with an LED wash under the lower one ---
M_LED = mat('led_violet', '#d9a8ff', 0.4, emit='#b46bff', strength=16)
M_LEDP = mat('led_pink', '#ffb0de', 0.4, emit='#ff6fc0', strength=12)
def wshelf(name, x0, x1, z, depth=0.2):
    o = box(name, (x1 - x0, depth, 0.03), ((x0 + x1) / 2, HALF - depth / 2, z), C, FR_WOOD, bevel=0.008, segs=3)
    o['lm'] = 1
    for x in (x0 + 0.12, x1 - 0.12):
        box(name + '_bracket', (0.02, depth * 0.8, 0.02), (x, HALF - depth * 0.4, z - 0.025), C, FR_W, bevel=0.004)
        box(name + '_bracket2', (0.02, 0.02, 0.12), (x, HALF - 0.012, z - 0.07), C, FR_W, bevel=0.004)
    return o
wshelf('static_wshelf_lo', -2.0, -0.62, 1.47)
wshelf('static_wshelf_hi', -1.5, -0.25, 1.93)
box('dyn_led_shelf', (1.3, 0.008, 0.006), (-1.31, HALF - 0.03, 1.452), C, M_LED, bevel=0)
box('dyn_led_desk', (1.6, 0.008, 0.006), (-1.15, HALF - 0.02, 0.73), C, M_LEDP, bevel=0)
# things on the shelves
bm = bmesh.new()
books(bm, -1.95, 0.4, 1.485, along='x', depth=0.15, hmin=0.15, hmax=0.21)
books(bm, -0.78, 0.48, 1.945, along='x', depth=0.15, hmin=0.14, hmax=0.2)
o = bm_object('static_wshelf_books', bm, [M_PAGES] + M_BOOKS, C, bevel=0.0025, segs=1, loc=(0, HALF - 0.1, 0))
plant('pothos', (-0.72, HALF - 0.1, 1.485), 0.06, 0.09, M_POT2, 10, 0.07, 0.11, 0.075, 22, droop=2.2, c=C)
plant('cactus', (-1.42, HALF - 0.1, 1.945), 0.045, 0.07, M_POT, 6, 0.1, 0.11, 0.03, 23, upright=True, c=C)
# a little robot figure and a camera
R = group('robot_root', (-1.25, HALF - 0.1, 1.485), yaw=12, c=C)
par(R, box('static_robot_body', (0.07, 0.05, 0.07), (0, 0, 0.045), C, M_MINT, bevel=0.012, segs=3))
par(R, box('static_robot_head', (0.09, 0.07, 0.065), (0, 0, 0.118), C, M_CREAM, bevel=0.016, segs=3))
for sx in (-1, 1):
    par(R, sphere('dyn_robot_eye', 0.009, (sx * 0.02, -0.036, 0.12), C, EM['cyan']))
    par(R, cyl('static_robot_leg', 0.011, 0.02, (sx * 0.02, 0, 0.01), C, M_GREY, bevel=0.002))
    par(R, cyl('static_robot_arm', 0.008, 0.05, (sx * 0.046, 0, 0.045), C, M_GREY, bevel=0.002))
par(R, cyl('static_robot_ant', 0.003, 0.03, (0, 0, 0.165), C, M_GREY, bevel=0))
par(R, sphere('dyn_robot_ant_tip', 0.008, (0, 0, 0.183), C, EM['pink']))
K2 = group('camera_prop_root', (-1.02, HALF - 0.1, 1.485), yaw=-18, c=C)
par(K2, box('static_cam_body', (0.11, 0.045, 0.07), (0, 0, 0.035), C, M_DARK, bevel=0.008, segs=3))
par(K2, cyl('static_cam_lens', 0.027, 0.04, (0.01, -0.04, 0.035), C, M_GREY, rot=(math.radians(90), 0, 0), bevel=0.004))
par(K2, box('static_cam_top', (0.04, 0.03, 0.012), (-0.02, 0, 0.076), C, M_GREY, bevel=0.003))
par(None) if False else None
sphere('dyn_shelf_orb', 0.05, (-0.42, HALF - 0.1, 1.995), C, mat('orb_pink', '#ffd5ea', 0.5, emit='#ff9fd0', strength=5))
cyl('static_orb_base', 0.03, 0.02, (-0.42, HALF - 0.1, 1.955), C, FR_W, bevel=0.004)
box('static_photo_frame', (0.1, 0.012, 0.13), (-1.15, HALF - 0.06, 2.01), C, FR_W, rot=(math.radians(-8), 0, 0), bevel=0.004)
box('static_photo_pic', (0.08, 0.004, 0.11), (-1.15, HALF - 0.068, 2.01), C, acol('#8fd3ff'), rot=(math.radians(-8), 0, 0), bevel=0)

# --- framed art on the back wall, between the shelves and the window ---
art('poster_moon', 0.46, 0.64, (0.02, BY, 1.72), 0, FR_W, [
    ('rect', 0, 0, 0.46, 0.64, '#2a2a72'), ('disc', 0.06, 0.12, 0.11, '#ffe9b0'), ('disc', 0.1, 0.15, 0.09, '#2a2a72'),
    hills(0.46, 0.64, -0.12, 0.05, 16, 0.4, '#5a4fb0'), hills(0.46, 0.64, -0.2, 0.04, 16, 2.0, '#8a6fd0'), hills(0.46, 0.64, -0.26, 0.03, 16, 3.4, '#f0a6c8'),
    ('disc', -0.14, 0.22, 0.008, '#ffffff'), ('disc', -0.05, 0.27, 0.006, '#ffffff'), ('disc', 0.17, 0.26, 0.007, '#ffffff'), ('disc', -0.17, 0.08, 0.005, '#ffffff')])
art('poster_cat', 0.3, 0.3, (-0.42, BY, 1.36), 0, FR_WOOD, [
    ('rect', 0, 0, 0.3, 0.3, '#f6d98a'), ('disc', 0, -0.05, 0.09, '#f6efe2', 0.9), ('disc', 0, 0.045, 0.065, '#f6efe2'),
    ('poly', [(-0.06, 0.07), (-0.02, 0.09), (-0.055, 0.13)], '#f6efe2'), ('poly', [(0.06, 0.07), (0.055, 0.13), (0.02, 0.09)], '#f6efe2'),
    ('disc', -0.022, 0.05, 0.007, '#23233a'), ('disc', 0.022, 0.05, 0.007, '#23233a'), ('disc', 0, 0.03, 0.006, '#f0a6c8')])
art('poster_wave', 0.34, 0.24, (0.02, BY, 1.2), 0, FR_DARK, [
    ('rect', 0, 0, 0.34, 0.24, '#9fe0cf'), ('disc', 0.08, 0.04, 0.045, '#f28f7c'),
    hills(0.34, 0.24, -0.02, 0.025, 14, 0.0, '#6fb7e8'), hills(0.34, 0.24, -0.06, 0.02, 14, 1.6, '#4a7fd0'), hills(0.34, 0.24, -0.09, 0.015, 14, 3.0, '#f6efe2')])
# --- left wall, over the beanbag: a triptych and a neon moon ---
art('tri_a', 0.34, 0.5, (LX, -2.05, 1.55), 90, FR_WOOD, [('rect', 0, 0, 0.34, 0.5, '#f6efe2'), ('disc', 0, 0.08, 0.1, '#f28f7c'), hills(0.34, 0.5, -0.1, 0.04, 12, 0.5, '#a79bdc'), hills(0.34, 0.5, -0.17, 0.03, 12, 2.5, '#7d74c9')])
art('tri_b', 0.34, 0.5, (LX, -1.6, 1.55), 90, FR_WOOD, [('rect', 0, 0, 0.34, 0.5, '#3d3a6b'), ('disc', 0.03, 0.02, 0.12, '#f6d98a'), ('disc', -0.06, -0.08, 0.07, '#f0a6c8'), ('disc', 0.08, -0.14, 0.04, '#9fe0cf'), ('rect', 0, -0.21, 0.34, 0.03, '#f6efe2')])
art('tri_c', 0.34, 0.5, (LX, -1.15, 1.55), 90, FR_WOOD, [('rect', 0, 0, 0.34, 0.5, '#9fe0cf'), ('poly', [(-0.1, -0.25), (0.0, 0.1), (0.1, -0.25)], '#2f8a72'), ('poly', [(-0.17, -0.25), (-0.09, 0.0), (0.0, -0.25)], '#4fae8a'), ('poly', [(0.02, -0.25), (0.11, 0.03), (0.17, -0.25)], '#4fae8a'), ('disc', -0.08, 0.16, 0.035, '#f6efe2')])
M_NEON = mat('neon_pink', '#ffc0e6', 0.4, emit='#ff58bd', strength=11)
M_NEON2 = mat('neon_cyan', '#c9f3ff', 0.4, emit='#62d8ff', strength=10)
def moon_pts(r, off, n=18):
    pts = []
    a0, a1 = math.radians(50), math.radians(310)
    for i in range(n + 1):
        a = a0 + (a1 - a0) * i / n
        pts.append((r * math.cos(a), r * math.sin(a)))
    c2, r2 = off, math.hypot(r * math.cos(a0) - off, r * math.sin(a0))
    b0 = math.atan2(r * math.sin(a1), r * math.cos(a1) - c2)
    b1 = math.atan2(r * math.sin(a0), r * math.cos(a0) - c2)
    if b0 < b1:
        b0 += 2 * math.pi
    for i in range(1, n):
        b = b0 + (b1 - b0) * i / n
        pts.append((c2 + r2 * math.cos(b), r2 * math.sin(b)))
    return pts
NZ, NY = 2.18, -1.6
tube('dyn_neon_moon', [(LX + 0.03, NY + x, NZ + z) for x, z in moon_pts(0.17, 0.1)], 0.008, C, M_NEON, cyclic=True, kind='POLY', bevel_res=3)
def star(cx, cz, r):
    return [(LX + 0.03, NY + cx + (r if i % 2 == 0 else r * 0.45) * math.sin(i * math.pi / 5), NZ + cz + (r if i % 2 == 0 else r * 0.45) * math.cos(i * math.pi / 5)) for i in range(10)]
tube('dyn_neon_star', star(0.34, 0.1, 0.07), 0.006, C, M_NEON2, cyclic=True, kind='POLY', bevel_res=3)
tube('dyn_neon_star2', star(0.27, -0.12, 0.04), 0.005, C, M_NEON2, cyclic=True, kind='POLY', bevel_res=3)

# --- cork board and an air conditioner on the left wall near the desk ---
G = group('cork_root', (LX, 1.62, 1.62), yaw=90, c=C)
par(G, box('static_cork', (0.7, 0.016, 0.5), (0, -0.008, 0), C, mat('cork', '#c99a6b', 0.95), bevel=0.004))
bm = bmesh.new()
bm_box(bm, (0.74, 0.024, 0.02), (0, -0.012, 0.26)); bm_box(bm, (0.74, 0.024, 0.02), (0, -0.012, -0.26))
bm_box(bm, (0.02, 0.024, 0.5), (-0.36, -0.012, 0)); bm_box(bm, (0.02, 0.024, 0.5), (0.36, -0.012, 0))
par(G, bm_object('static_cork_frame', bm, FR_W, C, bevel=0.004))
bm, mats = bmesh.new(), []
r5 = random.Random(9)
for i, (x, z, w, h, hx) in enumerate([(-0.22, 0.1, 0.11, 0.13, '#f6efe2'), (-0.07, 0.13, 0.1, 0.1, '#f6d98a'), (0.08, 0.1, 0.12, 0.15, '#8fd3ff'), (0.24, 0.12, 0.09, 0.11, '#f0a6c8'),
                                      (-0.24, -0.1, 0.1, 0.1, '#9fe0cf'), (-0.08, -0.08, 0.13, 0.16, '#f6efe2'), (0.1, -0.12, 0.1, 0.1, '#c9a0e8'), (0.25, -0.09, 0.1, 0.14, '#f6efe2')]):
    m = acol(hx)
    if m not in mats:
        mats.append(m)
    bm_box(bm, (w, 0.002, h), (x, -0.018 - i * 0.0003, z), rot=(0, r5.uniform(-0.15, 0.15), 0), mi=mats.index(m))
    if hx == '#f6efe2':
        mm = acol(r5.choice(['#7d74c9', '#f28f7c', '#4fae8a']))
        if mm not in mats:
            mats.append(mm)
        bm_box(bm, (w * 0.8, 0.002, h * 0.62), (x, -0.0195 - i * 0.0003, z + h * 0.1), rot=(0, 0, 0), mi=mats.index(mm))
par(G, bm_object('static_cork_notes', bm, mats, C, smooth=False))
for x, z in ((-0.22, 0.155), (-0.07, 0.17), (0.08, 0.165), (0.24, 0.165), (-0.24, -0.06), (-0.08, -0.01), (0.1, -0.08), (0.25, -0.03)):
    par(G, sphere('static_pin', 0.007, (x, -0.022, z), C, r5.choice([M_PINK, M_MINT, M_YEL])))
A = group('aircon_root', (LX, 1.55, 2.38), yaw=90, c=C)
par(A, box('static_aircon', (0.82, 0.2, 0.27), (0, -0.1, 0), C, FR_W, bevel=0.035, segs=4))
par(A, box('static_aircon_louver', (0.74, 0.05, 0.012), (0, -0.17, -0.115), C, M_GREY, rot=(math.radians(25), 0, 0), bevel=0.004))
par(A, box('dyn_aircon_led', (0.02, 0.003, 0.004), (0.33, -0.201, -0.06), C, EM['mint'], bevel=0))

# --- string lights: along the back wall and round onto the left wall ---
M_WIRE = mat('wire', '#2a2740', 0.6)
M_SBULB = mat('string_bulb', '#fff2d6', 0.5, emit='#ffc27a', strength=8)
def sag(a, b, drop, n=10):
    return [tuple(Vector(a).lerp(Vector(b), i / n) - Vector((0, 0, drop * math.sin(math.pi * i / n)))) for i in range(n + 1)]
anchors = [(LX + 0.03, -2.25, 2.5), (LX + 0.03, -0.9, 2.52), (LX + 0.03, 0.4, 2.5), (LX + 0.03, 2.33, 2.55), (-1.3, BY - 0.03, 2.5), (-0.2, BY - 0.03, 2.55), (0.45, BY - 0.03, 2.52), (1.3, BY - 0.03, 2.58), (2.34, BY - 0.03, 2.5)]
pts = []
for a, b in zip(anchors, anchors[1:]):
    seg = sag(a, b, 0.16 if abs(a[1] - b[1]) + abs(a[0] - b[0]) > 1.0 else 0.08)
    pts += seg if not pts else seg[1:]
tube('static_string_wire', pts, 0.003, C, M_WIRE, res=4, bevel_res=1)
bm = bmesh.new()
bmc = bmesh.new()
acc, last = 0.0, Vector(pts[0])
for p in pts[1:]:
    p = Vector(p)
    d = (p - last).length
    while acc + d >= 0.2:
        t = (0.2 - acc) / d
        q = last.lerp(p, t)
        bmesh.ops.create_icosphere(bm, subdivisions=2, radius=0.021, matrix=Matrix.Translation(q - Vector((0, 0, 0.032))))
        bm_box(bmc, (0.012, 0.012, 0.018), q - Vector((0, 0, 0.01)))
        last, d, acc = q, d * (1 - t), 0.0
    acc += d
    last = p
bm_object('dyn_string_bulbs', bm, M_SBULB, C)
bm_object('static_string_caps', bmc, M_WIRE, C, smooth=False)
for a in anchors:
    sphere('static_string_hook', 0.008, a, C, FR_W)

# --- on the desk ---
HS = group('headphone_root', (DX + 0.7, DY + 0.16, DZ), yaw=-20, c=C)
par(HS, cyl('static_hp_base', 0.055, 0.012, (0, 0, 0.006), C, FR_WOOD, bevel=0.004, verts=32))
par(HS, cyl('static_hp_pole', 0.008, 0.25, (0, 0, 0.135), C, FR_W, bevel=0.002))
par(HS, box('static_hp_rest', (0.06, 0.03, 0.014), (0, 0, 0.262), C, FR_WOOD, bevel=0.006, segs=3))
par(HS, torus('static_hp_band', 0.085, 0.009, (0, 0, 0.19), C, M_PINK, rot=(math.radians(90), 0, 0), arc=180, seg=40, rseg=10))
for sx in (-1, 1):
    par(HS, cyl('static_hp_cup', 0.042, 0.035, (sx * 0.088, 0, 0.175), C, M_PINK, rot=(0, math.radians(90), 0), bevel=0.012, segs=3))
    par(HS, cyl('static_hp_pad', 0.038, 0.016, (sx * 0.068, 0, 0.175), C, M_CREAM, rot=(0, math.radians(90), 0), bevel=0.007, segs=3))
lathe('static_desk_mug', [(0, 0), (0.034, 0), (0.038, 0.006), (0.04, 0.09), (0.036, 0.09), (0.034, 0.012), (0, 0.012)], (DX - 0.52, DY - 0.2, DZ), C, M_MINT, steps=28)
o = torus('static_desk_mug_handle', 0.024, 0.006, (DX - 0.565, DY - 0.2, DZ + 0.048), C, M_MINT, arc=180, seg=24, rseg=8)
o.rotation_euler = (math.radians(90), math.radians(90), 0)
lathe('static_pencup', [(0, 0), (0.034, 0), (0.036, 0.004), (0.036, 0.1), (0.032, 0.1), (0.032, 0.008), (0, 0.008)], (DX + 0.45, DY + 0.02, DZ), C, M_LAV, steps=24)
for i, mm in enumerate([M_PINK, M_YEL, M_MINT, M_CREAM]):
    a = i * 1.7
    cyl('static_pen', 0.004, 0.15, (DX + 0.45 + 0.012 * math.cos(a), DY + 0.02 + 0.012 * math.sin(a), DZ + 0.085), C, mm, rot=(0.14 * math.sin(a), -0.14 * math.cos(a), 0), bevel=0.001, verts=10)
plant('succulent', (DX + 0.62, DY - 0.2, DZ), 0.04, 0.05, M_POT, 11, 0.02, 0.055, 0.03, 31, droop=0.8, c=C)
bm = bmesh.new()
stack(bm, 0, 0, 0, 3, w=0.15, d=0.2)
bm_object('static_desk_books', bm, [M_PAGES] + M_BOOKS, C, bevel=0.003, segs=1, loc=(DX - 0.62, DY + 0.02, DZ), rot=(0, 0, 0.3))
box('static_tablet', (0.16, 0.008, 0.23), (DX + 0.36, DY - 0.2, DZ + 0.004), C, M_DARK, rot=(math.radians(90), 0, math.radians(-8)), bevel=0.003)
for i, hx in enumerate(['#f6d98a', '#f0a6c8']):
    box('static_sticky', (0.05, 0.0015, 0.05), (DX + 0.34 + i * 0.058, DY + 0.186, DZ + 0.2), C, acol(hx), rot=(0, (i - 0.5) * 0.12, 0), bevel=0)

# --- window sill ---
plant('sill_a', (0.85, HALF - 0.05, 1.0), 0.045, 0.06, M_POT, 7, 0.07, 0.09, 0.03, 61, upright=True, c=C)
plant('sill_b', (1.12, HALF - 0.06, 1.0), 0.05, 0.065, M_POT2, 9, 0.04, 0.08, 0.05, 62, droop=1.0, c=C)
M_FLAME = mat('candle_flame', '#fff0c0', 0.5, emit='#ffb24d', strength=6)
cyl('static_candle', 0.028, 0.07, (1.62, HALF - 0.06, 1.035), C, M_CREAM, bevel=0.005)
sphere('dyn_candle_flame', 0.5, (1.62, HALF - 0.06, 1.085), C, M_FLAME, scale=(0.012, 0.012, 0.024))
bm = bmesh.new()
stack(bm, 0, 0, 0, 2, w=0.12, d=0.16)
bm_object('static_sill_books', bm, [M_PAGES] + M_BOOKS, C, bevel=0.003, segs=1, loc=(1.38, HALF - 0.06, 1.0))

# --- cables, power strip, slippers, backpack ---
tube('static_cable_pc', [(DX + 1.0, HALF - 0.1, 0.3), (DX + 0.92, HALF - 0.06, 0.05), (DX + 0.6, HALF - 0.08, 0.012), (DX + 0.2, HALF - 0.12, 0.012)], 0.005, C, M_WIRE, res=10, bevel_res=2)
tube('static_cable_mon', [(DX, HALF - 0.14, DZ + 0.2), (DX + 0.03, HALF - 0.06, DZ - 0.1), (DX + 0.1, HALF - 0.07, 0.2), (DX + 0.2, HALF - 0.12, 0.014)], 0.004, C, M_WIRE, res=10, bevel_res=2)
box('static_powerstrip', (0.3, 0.055, 0.03), (DX + 0.25, HALF - 0.12, 0.016), C, FR_W, bevel=0.008, segs=3)
box('dyn_powerstrip_led', (0.012, 0.012, 0.002), (DX + 0.38, HALF - 0.12, 0.032), C, EM['amber'], bevel=0)
for i, (x, y, yaw) in enumerate(((1.02, 0.55, 80), (1.08, 0.36, 96))):
    g = group('slipper_root', (x, y, 0.013), yaw=yaw, c=C)
    par(g, soft_box('static_slipper_sole', (0.1, 0.25, 0.022), (0, 0, 0.011), C, M_CREAM, puff=0.15, cuts=3, levels=1))
    par(g, soft_box('static_slipper_top', (0.105, 0.13, 0.06), (0, 0.055, 0.04), C, M_PINK, puff=0.5, pinch=0.3, cuts=4, levels=2))
BP = group('backpack_root', (-2.12, 1.25, 0), yaw=70, c=C)
par(BP, soft_box('static_backpack', (0.32, 0.17, 0.42), (0, 0, 0.215), C, mat('backpack', '#6fb7e8', 0.9), rot=(math.radians(-8), 0, 0), puff=0.35, levels=2, flat_bottom=0.0))
par(BP, soft_box('static_backpack_pocket', (0.24, 0.06, 0.18), (0, -0.1, 0.15), C, mat('backpack_pocket', '#4a8fd0', 0.9), rot=(math.radians(-8), 0, 0), puff=0.4, levels=2))
par(BP, torus('static_backpack_handle', 0.035, 0.007, (0, 0.03, 0.43), C, M_DARK, rot=(math.radians(90), 0, 0), arc=180, seg=20, rseg=8))
# wall clock above the bed
W = group('wallclock_root', (2.12, BY, 2.32), yaw=0, c=C)
par(W, cyl('static_wallclock', 0.15, 0.03, (0, -0.015, 0), C, FR_W, rot=(math.radians(90), 0, 0), bevel=0.01, segs=3, verts=48))
par(W, cyl('static_wallclock_face', 0.128, 0.004, (0, -0.031, 0), C, acol('#3d3a6b'), rot=(math.radians(90), 0, 0), bevel=0, verts=48))
for i in range(12):
    a = i * math.pi / 6
    par(W, box('static_wallclock_tick', (0.006, 0.003, 0.02), (0.108 * math.sin(a), -0.034, 0.108 * math.cos(a)), C, M_CREAM, rot=(0, -a, 0), bevel=0))
par(W, box('static_wallclock_h', (0.008, 0.003, 0.07), (0.02, -0.036, 0.025), C, M_CREAM, rot=(0, math.radians(-38), 0), bevel=0))
par(W, box('static_wallclock_m', (0.006, 0.003, 0.1), (-0.035, -0.037, 0.03), C, M_PINK, rot=(0, math.radians(50), 0), bevel=0))
# under-bed glow
box('dyn_led_bed', (0.008, 1.7, 0.006), (HALF - 1.12 - 0.03 + 0.1, HALF - 2.06 / 2 - 0.05, 0.175), C, M_LED, bevel=0)
print('decor done', len(C.objects))
