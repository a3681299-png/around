# The right side by the half wall: a low dresser with a record player, and a guitar on a stand.
# Needs the earlier scripts.
C = wipe('right')
FR_W = bpy.data.materials['white_paint']
FR_WOOD = bpy.data.materials['shelf_wood']
M_BRASS = bpy.data.materials['brass']
RX_ = HALF - 0.24
G = group('dresser_root', (RX_, -1.45, 0), yaw=-90, c=C)  # local -Y faces the room (-X)
par(G, box('static_dresser', (1.1, 0.42, 0.56), (0, 0, 0.46), C, FR_W, bevel=0.025, segs=4))
bpy.data.objects['static_dresser']['lm'] = 1
for i in range(2):
    for j in range(2):
        par(G, box('static_dresser_drawer', (0.5, 0.02, 0.23), (-0.265 + i * 0.53, -0.21, 0.335 + j * 0.25), C, FR_WOOD, bevel=0.008))
        par(G, sphere('static_dresser_knob', 0.014, (-0.265 + i * 0.53, -0.228, 0.335 + j * 0.25), C, M_BRASS))
for sx in (-1, 1):
    for sy in (-1, 1):
        par(G, cyl('static_dresser_leg', 0.014, 0.19, (sx * 0.47, sy * 0.15, 0.095), C, FR_WOOD, bevel=0.003, r2=0.022, rot=(math.radians(sy * 5), math.radians(-sx * 5), 0)))
# record player
P2 = group('record_root', (RX_ + 0.0, -1.2, 0.74), yaw=-90, c=C)
par(P2, box('static_record_base', (0.4, 0.32, 0.06), (0, 0, 0.03), C, FR_WOOD, bevel=0.012, segs=3))
par(P2, cyl('static_record_platter', 0.135, 0.012, (-0.04, 0, 0.066), C, M_GREY, bevel=0.003, verts=48))
par(P2, cyl('static_record_disc', 0.128, 0.004, (-0.04, 0, 0.074), C, M_RUBBER, bevel=0.001, verts=48))
par(P2, cyl('static_record_label', 0.045, 0.002, (-0.04, 0, 0.077), C, M_PINK, bevel=0, verts=32))
par(P2, cyl('static_record_pivot', 0.016, 0.03, (0.15, 0.1, 0.075), C, M_CHROME, bevel=0.003))
par(P2, box('static_record_arm', (0.008, 0.19, 0.008), (0.105, 0.02, 0.092), C, M_CHROME, rot=(0, 0, math.radians(-28)), bevel=0.002))
par(P2, box('static_record_head', (0.02, 0.03, 0.012), (0.06, -0.065, 0.088), C, M_DARK, rot=(0, 0, math.radians(-28)), bevel=0.003))
# record sleeves leaning beside it, a small plant and a warm jar light
bm = bmesh.new()
for i, mi in enumerate((3, 7, 1, 10)):
    bm_box(bm, (0.31, 0.006, 0.31), (0, i * 0.012, 0.155 + 0.0), rot=(math.radians(-12), 0, 0), mi=mi)
par(G, bm_object('static_sleeves', bm, [M_PAGES] + M_BOOKS, C, bevel=0.002, segs=1, loc=(0.38, 0.1, 0.74)))
plant('dresser_plant', (RX_ + 0.02, -1.92, 0.74), 0.07, 0.1, M_POT2, 10, 0.1, 0.2, 0.1, 71, droop=1.2, c=C)
M_JAR = mat('jar_light', '#fff0cf', 0.4, emit='#ffc27a', strength=3.5)
par(G, lathe('dyn_jar', [(0, 0), (0.04, 0), (0.05, 0.02), (0.05, 0.09), (0.035, 0.11), (0.035, 0.125), (0, 0.125)], (0.2, -0.08, 0.74), C, M_JAR, subsurf=1))
# guitar on a stand
GT = group('guitar_root', (HALF - 0.36, -0.42, 0), yaw=38, c=C)
M_GUITAR = mat('guitar_top', '#f0c58e', 0.35)
M_GSIDE = mat('guitar_side', '#9a5b3c', 0.4)
tilt = math.radians(-12)
gb = group('guitar_body_root', (0, 0.05, 0.1), c=C)
gb.rotation_euler = (tilt, 0, 0)
par(GT, gb)
def bout(pts_n=48):
    pts = []
    for i in range(pts_n):
        a = 2 * math.pi * i / pts_n
        s, c_ = math.sin(a), math.cos(a)
        # lower bout wider than the upper, a waist between
        r = 0.2 - 0.035 * s - 0.045 * math.cos(2 * a) * (1 if True else 0) + 0.012 * math.cos(4 * a)
        pts.append((r * c_ * 0.95, r * s * 1.25))
    return pts
body = outline('static_guitar_body', bout(), 0.095, (0, 0.045, 0.27), C, M_GSIDE, rot=(math.radians(90), 0, 0), bevel=0.012, segs=3)
par(gb, body)
par(gb, outline('static_guitar_top', [(x * 0.97, y * 0.97) for x, y in bout()], 0.004, (0, -0.052, 0.27), C, M_GUITAR, rot=(math.radians(90), 0, 0), bevel=0.001, segs=1))
par(gb, cyl('static_guitar_hole', 0.045, 0.002, (0, -0.058, 0.33), C, M_RUBBER, rot=(math.radians(90), 0, 0), bevel=0, verts=32))
par(gb, torus('static_guitar_rosette', 0.05, 0.004, (0, -0.057, 0.33), C, M_GSIDE, rot=(math.radians(90), 0, 0)))
par(gb, box('static_guitar_bridge', (0.1, 0.01, 0.018), (0, -0.06, 0.18), C, M_GSIDE, bevel=0.003))
par(gb, box('static_guitar_neck', (0.05, 0.022, 0.5), (0, -0.045, 0.72), C, M_GSIDE, bevel=0.008, segs=3))
par(gb, box('static_guitar_fret', (0.046, 0.004, 0.62), (0, -0.058, 0.67), C, M_DARK, bevel=0.001))
par(gb, box('static_guitar_headstock', (0.07, 0.016, 0.14), (0, -0.04, 1.03), C, M_GSIDE, bevel=0.01, segs=3))
for sx in (-1, 1):
    for k in range(3):
        par(gb, cyl('static_guitar_peg', 0.008, 0.02, (sx * 0.042, -0.04, 0.985 + k * 0.04), C, M_CHROME, rot=(0, math.radians(90), 0), bevel=0.002, verts=12))
bm = bmesh.new()
for k in range(6):
    bm_box(bm, (0.0012, 0.0012, 0.8), (-0.016 + k * 0.0064, -0.062, 0.58))
par(gb, bm_object('static_guitar_strings', bm, M_CHROME, C, smooth=False))
par(GT, tube('static_guitar_stand', [(-0.16, -0.12, 0.0), (0, 0.06, 0.32), (0.16, -0.12, 0.0)], 0.008, C, M_DARK, res=8, bevel_res=2, kind='POLY'))
par(GT, tube('static_guitar_stand_b', [(0, 0.06, 0.32), (0, 0.24, 0.0)], 0.008, C, M_DARK, res=4, bevel_res=2, kind='POLY'))
par(GT, tube('static_guitar_stand_c', [(-0.08, -0.03, 0.12), (-0.08, -0.1, 0.1), (0.08, -0.1, 0.1), (0.08, -0.03, 0.12)], 0.007, C, M_DARK, res=4, bevel_res=2, kind='POLY'))
light('L_jar', 'POINT', (RX_ - 0.08, -1.25, 0.86), coll('lights'), '#ffbf78', 4, size=0.05) if not bpy.data.objects.get('L_jar') else None
print('right done', len(C.objects))
