# The bed by the window: frame, mattress, duvet with folds, pillows, a plush cat, the nightstand
# and its lamp. Needs lib.py and 20_desk.py (group, par, torus and the shared materials).
C = wipe('bed')
rnd = random.Random(31)
M_BEDWOOD = mat('bed_wood', '#d9b991', 0.5)
M_SHEET = mat('sheet', '#f4f1fa', 0.9)
M_DUVET = mat('duvet', '#8f86d6', 0.95)
M_DUVET_IN = mat('duvet_inside', '#e9d5ee', 0.95)
M_HEAD = mat('headboard', '#6f66b8', 0.9)
M_PILLOW = mat('pillow', '#faf7ff', 0.95)
M_PILLOW2 = mat('pillow_pink', '#f3b5d2', 0.95)
M_THROW = mat('throw', '#f3d9a4', 0.95)
M_PLUSH = mat('plush', '#fbf2e4', 1.0)
M_BRASS = bpy.data.materials['brass']

BW, BL = 1.12, 2.06
B = group('bed_root', (HALF - BW / 2 - 0.03, HALF - BL / 2 - 0.05, 0), c=C)
# frame: a low platform with rounded rails and short tapered legs
par(B, box('static_bed_platform', (BW, BL, 0.1), (0, 0, 0.23), C, M_BEDWOOD, bevel=0.02, segs=4))
bpy.data.objects['static_bed_platform']['lm'] = 1
for sx in (-1, 1):
    for sy in (-1, 1):
        par(B, cyl('static_bed_leg', 0.03, 0.18, (sx * (BW / 2 - 0.08), sy * (BL / 2 - 0.1), 0.09), C, M_BEDWOOD, bevel=0.006, r2=0.04))
# headboard: wood back with two upholstered panels
par(B, box('static_headboard', (BW + 0.06, 0.05, 0.9), (0, BL / 2 + 0.0, 0.6), C, M_BEDWOOD, bevel=0.02, segs=4))
for sx in (-1, 1):
    par(B, soft_box('static_headpad', (BW / 2 - 0.03, 0.09, 0.5), (sx * (BW / 4), BL / 2 - 0.055, 0.78), C, M_HEAD, puff=0.35, levels=2))
# mattress and sheet
par(B, soft_box('static_mattress', (BW - 0.04, BL - 0.06, 0.22), (0, -0.01, 0.39), C, M_SHEET, puff=0.06, cuts=8, levels=2))
TOP = 0.505

# cloth draped over the bed: hangs over the room side (-X) and, for the duvet, the foot (-Y)
def drape(name, y0, y1, m, thick, lift, quilt, over_foot, over_side, seed, amp0=0.02):
    bm = bmesh.new()
    nu = 48
    nv = max(12, int((y1 - y0 + over_foot) / 0.03))
    hw = BW / 2 - 0.02
    r2 = random.Random(seed)
    ph = [(r2.uniform(2, 7), r2.uniform(2, 7), r2.uniform(0, 6.28), r2.uniform(0.5, 1)) for _ in range(6)]
    def wr(u, v):
        return sum(a * math.sin(fu * u + fv * v + p) for fu, fv, p, a in ph) / len(ph) * 2
    grid = []
    for j in range(nv + 1):
        row = []
        for i in range(nu + 1):
            s = -hw - over_side + (2 * hw + over_side + 0.02) * i / nu
            t = y0 - over_foot + (y1 - y0 + over_foot) * j / nv
            x, y, z = s, t, TOP + lift
            w = wr(s * 4, t * 4)
            dx = max(0, -hw - s)
            dy = max(0, y0 - t) if over_foot else 0
            fall = math.hypot(dx, dy)
            if dx > 0:
                x = -hw - 0.035 * math.sin(min(1, dx / 0.09) * math.pi / 2) - 0.03 * (dx / over_side)
            if dy > 0:
                y = y0 - 0.035 * math.sin(min(1, dy / 0.09) * math.pi / 2) - 0.03 * (dy / over_foot)
            z -= max(0, fall - 0.035)
            inside = max(0, 1 - (s / hw) ** 4)
            if quilt:
                # pillowy quilting on top, fading over the edge
                q = abs(math.sin(math.pi * (s + hw) / 0.27)) * abs(math.sin(math.pi * (t - y0) / 0.29))
                z += 0.03 * (q ** 0.6) * (1 if fall == 0 else max(0, 1 - fall / 0.1))
            z += 0.03 * inside * (1 if fall == 0 else 0)
            amp = amp0 + 0.035 * min(1, fall / 0.2)
            z += amp * w
            if fall > 0:
                # vertical folds on the hanging part
                fold = math.sin((t if dx > 0 else s) * 26 + 2 * w)
                if dx > 0:
                    x -= 0.022 * fold * min(1, fall / 0.1)
                if dy > 0:
                    y -= 0.022 * fold * min(1, fall / 0.1)
            if fall > 0.15:
                z += 0.018 * math.sin(s * 13 + t * 17 + seed)
            row.append(bm.verts.new((x, y, z)))
        grid.append(row)
    for j in range(nv):
        for i in range(nu):
            bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    o = bm_object(name, bm, m, C)
    sd = o.modifiers.new('solid', 'SOLIDIFY')
    sd.thickness = thick
    sd.offset = 1
    ss = o.modifiers.new('sub', 'SUBSURF')
    ss.levels = ss.render_levels = 1
    return o
par(B, drape('static_duvet', -BL / 2, 0.42, M_DUVET, 0.04, 0.03, True, 0.26, 0.3, 3))
# the folded-back top of the duvet, showing its lighter inside
par(B, soft_box('static_duvet_fold', (BW + 0.02, 0.3, 0.075), (-0.02, 0.44, TOP + 0.085), C, M_DUVET_IN, rot=(math.radians(4), 0, math.radians(-2)), puff=0.5, pinch=0.2, noise=0.04, seed=4, levels=2))
# pillows
par(B, soft_box('static_pillow_a', (0.5, 0.34, 0.15), (-0.27, 0.8, TOP + 0.13), C, M_PILLOW, rot=(math.radians(28), 0, math.radians(6)), puff=0.7, pinch=0.75, noise=0.03, seed=1))
par(B, soft_box('static_pillow_b', (0.5, 0.34, 0.15), (0.27, 0.82, TOP + 0.14), C, M_PILLOW, rot=(math.radians(34), 0, math.radians(-5)), puff=0.7, pinch=0.75, noise=0.03, seed=2))
par(B, soft_box('static_pillow_c', (0.34, 0.3, 0.13), (-0.02, 0.63, TOP + 0.13), C, M_PILLOW2, rot=(math.radians(40), 0, math.radians(-12)), puff=0.8, pinch=0.7, noise=0.03, seed=5))
# throw blanket across the foot, hanging down the room side
par(B, drape('static_throw', -0.86, -0.4, M_THROW, 0.022, 0.1, False, 0, 0.42, 11, amp0=0.03))
# plush cat sitting against the pillows
PC = group('plush_root', (B.location.x + 0.3, B.location.y + 0.52, TOP + 0.09), yaw=200, c=C)
par(PC, sphere('static_plush_body', 0.5, (0, 0, 0.07), C, M_PLUSH, scale=(0.19, 0.17, 0.2)))
par(PC, sphere('static_plush_head', 0.5, (0, -0.01, 0.215), C, M_PLUSH, scale=(0.2, 0.17, 0.16)))
for sx in (-1, 1):
    par(PC, cyl('static_plush_ear', 0.035, 0.06, (sx * 0.062, -0.005, 0.3), C, M_PLUSH, rot=(0, math.radians(sx * 14), 0), bevel=0.008, r2=0.004, verts=16))
    par(PC, sphere('static_plush_eye', 0.011, (sx * 0.04, -0.082, 0.225), C, M_RUBBER))
    par(PC, sphere('static_plush_cheek', 0.016, (sx * 0.062, -0.075, 0.2), C, M_PINK, scale=(1, 0.4, 0.7)))
    par(PC, sphere('static_plush_foot', 0.5, (sx * 0.06, -0.085, 0.02), C, M_PLUSH, scale=(0.07, 0.09, 0.05)))
    par(PC, sphere('static_plush_arm', 0.5, (sx * 0.09, -0.04, 0.1), C, M_PLUSH, scale=(0.05, 0.06, 0.09)))
par(PC, sphere('static_plush_nose', 0.008, (0, -0.088, 0.208), C, M_PINK))

# --- nightstand between the bed and the desk ---
N = group('nightstand_root', (B.location.x - BW / 2 - 0.3, HALF - 0.24, 0), c=C)
par(N, box('static_nightstand', (0.44, 0.38, 0.4), (0, 0, 0.36), C, M_WHITE, bevel=0.025, segs=4))
par(N, box('static_nightstand_drawer', (0.38, 0.02, 0.15), (0, -0.19, 0.44), C, M_BEDWOOD, bevel=0.008))
par(N, box('static_nightstand_drawer2', (0.38, 0.02, 0.15), (0, -0.19, 0.27), C, M_BEDWOOD, bevel=0.008))
for zz in (0.44, 0.27):
    par(N, sphere('static_knob', 0.013, (0, -0.208, zz), C, M_BRASS))
for sx in (-1, 1):
    for sy in (-1, 1):
        par(N, cyl('static_nightstand_leg', 0.012, 0.17, (sx * 0.17, sy * 0.14, 0.085), C, M_BEDWOOD, bevel=0.003, r2=0.02, rot=(math.radians(sy * 5), math.radians(-sx * 5), 0)))
# lamp: ceramic base, brass stem, a warm shade that glows
M_CERAMIC = mat('ceramic_lilac', '#cfc4f2', 0.3)
M_SHADE = mat('lamp_shade', '#ffe6c4', 0.9, emit='#ffb873', strength=1.8)
par(N, lathe('static_lamp_base', [(0, 0), (0.05, 0), (0.062, 0.012), (0.07, 0.05), (0.06, 0.1), (0.035, 0.14), (0.018, 0.17), (0.014, 0.19), (0, 0.19)], (0.07, 0.03, 0.56), C, M_CERAMIC, subsurf=1))
par(N, cyl('static_lamp_stem', 0.006, 0.1, (0.07, 0.03, 0.79), C, M_BRASS, bevel=0))
par(N, lathe('dyn_lamp_shade', [(0.075, 0), (0.105, -0.0), (0.11, 0.004), (0.085, 0.15), (0.08, 0.152), (0.075, 0.15), (0.1, 0.006)], (0.07, 0.03, 0.8), C, M_SHADE, steps=40))
# alarm clock, books and a mug
par(N, cyl('static_clock', 0.045, 0.035, (-0.1, -0.06, 0.607), C, M_MINT, rot=(math.radians(90), 0, math.radians(-15)), bevel=0.008))
par(N, cyl('static_clock_face', 0.037, 0.004, (-0.105, -0.079, 0.607), C, M_CREAM, rot=(math.radians(90), 0, math.radians(-15)), bevel=0.001))
par(N, box('static_clock_hand', (0.003, 0.003, 0.026), (-0.1055, -0.082, 0.615), C, M_RUBBER, rot=(0, math.radians(30), math.radians(-15)), bevel=0))
par(N, box('static_clock_hand2', (0.003, 0.003, 0.018), (-0.1055, -0.082, 0.61), C, M_RUBBER, rot=(0, math.radians(-70), math.radians(-15)), bevel=0))
print('bed done', len(C.objects))
