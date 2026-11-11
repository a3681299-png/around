# The desk corner: desk, monitors, keyboard, PC, speakers, chair. Needs lib.py.
C = wipe('desk')
rnd = random.Random(21)


def group(name, loc, yaw=0.0, c=None):
    g = bpy.data.objects.new(name, None)
    g.empty_display_size = 0.1
    g.location = loc
    g.rotation_euler = (0, 0, math.radians(yaw))
    (c or C).objects.link(g)
    return g


def par(g, *objs):
    for o in objs:
        o.parent = g
    return objs[0] if objs else None


def torus(name, R, r, loc, c, m, rot=(0, 0, 0), arc=360, seg=40, rseg=12):
    bm = bmesh.new()
    n = seg if arc >= 360 else max(3, int(seg * arc / 360))
    rings = []
    for i in range(n + (0 if arc >= 360 else 1)):
        a = math.radians(arc) * i / n
        ring = []
        for j in range(rseg):
            b = 2 * math.pi * j / rseg
            rr = R + r * math.cos(b)
            ring.append(bm.verts.new((rr * math.cos(a), rr * math.sin(a), r * math.sin(b))))
        rings.append(ring)
    cnt = len(rings)
    for i in range(cnt if arc >= 360 else cnt - 1):
        a, b = rings[i], rings[(i + 1) % cnt]
        for j in range(rseg):
            k = (j + 1) % rseg
            bm.faces.new((a[j], b[j], b[k], a[k]))
    if arc < 360:
        bm.faces.new(rings[0])
        bm.faces.new(list(reversed(rings[-1])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm_object(name, bm, m, c, loc=loc, rot=rot)


M_TOP = mat('desk_top', '#e8d3b8', 0.45)
M_WHITE = mat('white_paint', '#efeef5', 0.4)
M_STEEL = mat('white_steel', '#dcdce8', 0.35, metal=0.3)
M_DARK = mat('dark_plastic', '#23233a', 0.45)
M_GREY = mat('grey_plastic', '#8d8fa8', 0.5)
M_MATP = mat('desk_mat', '#3b3470', 0.85)
M_LAV = mat('lavender_fabric', '#a79bdc', 0.9)
M_PINK = mat('pink_soft', '#f0a6c8', 0.7)
M_MINT = mat('mint', '#9fe0cf', 0.6)
M_CREAM = mat('cream', '#f6efe2', 0.6)
M_YEL = mat('butter', '#f6d98a', 0.6)
M_RUBBER = mat('rubber', '#1b1b28', 0.7)
M_CHROME = mat('chrome', '#c8cad8', 0.2, metal=1.0)

DX, DY, DZ = -1.15, 1.97, 0.74  # desk centre and top height
D = group('desk_root', (DX, DY, 0))
# top with rounded corners
par(D, outline('static_desk_top', rounded_rect(1.72, 0.76, 0.05), 0.034, (0, 0, DZ - 0.034), C, M_TOP, bevel=0.008, segs=3))
bpy.data.objects['static_desk_top']['lm'] = 1
# steel frame: two side loops and a back bar
for sx in (-1, 1):
    bm = bmesh.new()
    x = sx * 0.76
    for size, loc in (((0.04, 0.6, 0.04), (x, 0, DZ - 0.054)), ((0.04, 0.04, DZ - 0.07), (x, -0.28, (DZ - 0.07) / 2)),
                      ((0.04, 0.04, DZ - 0.07), (x, 0.28, (DZ - 0.07) / 2)), ((0.04, 0.66, 0.03), (x, 0, 0.015))):
        bm_box(bm, size, loc)
    par(D, bm_object('static_desk_leg', bm, M_STEEL, C, bevel=0.006, segs=2))
par(D, box('static_desk_bar', (1.5, 0.03, 0.06), (0, 0.3, DZ - 0.2), C, M_STEEL, bevel=0.006))
# drawer unit on the right
bm = bmesh.new()
bm_box(bm, (0.4, 0.56, 0.56), (0.5, 0.02, 0.33))
for i in range(3):
    bm_box(bm, (0.37, 0.02, 0.165), (0.5, -0.265, 0.145 + i * 0.185), mi=0)
    bm_box(bm, (0.12, 0.014, 0.014), (0.5, -0.285, 0.185 + i * 0.185), mi=1)
par(D, bm_object('static_drawers', bm, [M_WHITE, M_LAV], C, bevel=0.006, segs=2))
for cx_, cy_ in ((0.34, -0.2), (0.66, -0.2), (0.34, 0.24), (0.66, 0.24)):
    par(D, cyl('static_caster', 0.022, 0.02, (cx_, cy_, 0.024), C, M_DARK, rot=(0, math.radians(90), 0), bevel=0.003))
# desk mat
par(D, outline('static_desk_mat', rounded_rect(0.92, 0.4, 0.03), 0.004, (0, -0.13, DZ), C, M_MATP, bevel=0.0015, segs=1))

# --- main monitor ---
MZ = DZ + 0.36
M = group('monitor_root', (DX, DY + 0.2, 0))
MW, MH = 0.86, 0.37
par(M, outline('static_monitor_body', rounded_rect(MW + 0.016, MH + 0.016, 0.012, 4), 0.022, (0, 0.011, MZ), C, M_DARK, rot=(math.radians(90), 0, 0), bevel=0.004))
par(M, box('static_monitor_back', (0.3, 0.03, 0.18), (0, 0.03, MZ), C, M_DARK, bevel=0.012, segs=3))
par(M, box('static_monitor_neck', (0.05, 0.03, 0.26), (0, 0.055, DZ + 0.15), C, M_STEEL, bevel=0.008))
par(M, outline('static_monitor_foot', rounded_rect(0.26, 0.19, 0.04), 0.012, (0, 0.03, DZ), C, M_STEEL, bevel=0.004))
# the screen: its own mesh so the engine can later swap in live UI
M_SCREEN = mat('screen_main', '#10112b', 0.3, emit='#252a6e', strength=0.9)
scr = box('dyn_monitor_screen', (MW, 0.001, MH), (0, -0.0122, MZ), C, M_SCREEN, bevel=0)
par(M, scr)
# what is on it: an editor with coloured lines, a side bar, a small floating player
EM = {k: mat('ui_' + k, h, 0.4, emit=h, strength=s) for k, (h, s) in {
    'violet': ('#a98bff', 2.2), 'pink': ('#ff8fc7', 2.2), 'cyan': ('#7fe3ff', 2.0), 'mint': ('#8dffc9', 1.8),
    'white': ('#e9ecff', 1.6), 'amber': ('#ffd27a', 2.0), 'panel': ('#3a3f95', 1.0), 'panel2': ('#5a48b8', 1.2)}.items()}
bm = bmesh.new()
names = list(EM.keys())
def ui(x, z, w, h, k, d=0.0006):
    bm_box(bm, (w, 0.0004, h), (x, -0.0128 - d, MZ + z), mi=names.index(k))
ui(-MW / 2 + 0.07, 0, 0.12, MH - 0.02, 'panel')
for i in range(9):
    ui(-MW / 2 + 0.045 + (i % 3) * 0.004, MH / 2 - 0.04 - i * 0.032, 0.055 + 0.02 * ((i * 7) % 3), 0.008, 'white' if i % 4 else 'pink')
r3 = random.Random(5)
z = MH / 2 - 0.035
while z > -MH / 2 + 0.03:
    x = -MW / 2 + 0.16 + 0.02 * r3.randrange(0, 4)
    for _ in range(r3.randrange(1, 4)):
        w = r3.uniform(0.03, 0.13)
        if x + w > 0.16:
            break
        ui(x + w / 2, z, w, 0.009, r3.choice(['violet', 'pink', 'cyan', 'mint', 'white', 'amber', 'violet', 'cyan']))
        x += w + 0.012
    z -= 0.021
ui(0.3, 0.02, 0.22, MH - 0.06, 'panel2')
ui(0.3, 0.09, 0.17, 0.11, 'pink', 0.0012)
ui(0.3, -0.005, 0.17, 0.012, 'white', 0.0012)
ui(0.27, -0.03, 0.11, 0.008, 'cyan', 0.0012)
for i in range(5):
    ui(0.225 + i * 0.037, -0.09, 0.022, 0.03 + 0.02 * ((i * 3) % 4) / 3, 'mint', 0.0012)
par(M, bm_object('dyn_screen_ui', bm, [EM[k] for k in names], C, smooth=False))
# light bar on top of the monitor
M_BAR = mat('lightbar', '#fff0d2', 0.4, emit='#ffe2b0', strength=9)
par(M, cyl('static_lightbar', 0.014, 0.46, (0, -0.02, MZ + MH / 2 + 0.03), C, M_DARK, rot=(0, math.radians(90), 0), bevel=0.003))
par(M, box('dyn_lightbar_glow', (0.42, 0.012, 0.003), (0, -0.026, MZ + MH / 2 + 0.017), C, M_BAR, bevel=0))

# --- second monitor, upright, on an arm at the left ---
S = group('monitor2_root', (DX - 0.66, DY + 0.1, 0), yaw=-24)
SW, SH, SZ = 0.3, 0.5, DZ + 0.36
par(S, outline('static_monitor2_body', rounded_rect(SW + 0.014, SH + 0.014, 0.01, 4), 0.02, (0, 0.01, SZ), C, M_DARK, rot=(math.radians(90), 0, 0), bevel=0.004))
par(S, cyl('static_arm_pole', 0.016, 0.42, (0, 0.06, DZ + 0.21), C, M_STEEL, bevel=0.003))
par(S, box('static_arm_joint', (0.04, 0.06, 0.04), (0, 0.035, SZ), C, M_STEEL, bevel=0.008))
par(S, box('static_arm_clamp', (0.07, 0.07, 0.03), (0, 0.06, DZ + 0.012), C, M_STEEL, bevel=0.006))
M_SCREEN2 = mat('screen_side', '#1b1440', 0.3, emit='#3a2a8c', strength=0.9)
par(S, box('dyn_monitor2_screen', (SW, 0.001, SH), (0, -0.0112, SZ), C, M_SCREEN2, bevel=0))
bm = bmesh.new()
def ui2(x, z, w, h, k, d=0.0006):
    bm_box(bm, (w, 0.0004, h), (x, -0.0118 - d, SZ + z), mi=names.index(k))
for i in range(7):
    left = i % 2 == 0
    w = 0.1 + 0.05 * ((i * 5) % 3) / 2
    ui2((-SW / 2 + 0.03 + w / 2) if left else (SW / 2 - 0.03 - w / 2), SH / 2 - 0.06 - i * 0.058, w, 0.036, 'panel' if left else 'violet')
    ui2(((-SW / 2 + 0.04 + w / 2 - 0.01) if left else (SW / 2 - 0.04 - w / 2 + 0.01)), SH / 2 - 0.06 - i * 0.058, w - 0.04, 0.007, 'white', 0.0012)
ui2(0, -SH / 2 + 0.035, SW - 0.04, 0.03, 'panel2')
par(S, bm_object('dyn_screen2_ui', bm, [EM[k] for k in names], C, smooth=False))

# --- keyboard, mouse ---
K = group('keyboard_root', (DX - 0.06, DY - 0.14, DZ + 0.004), yaw=3)
par(K, outline('static_kb_case', rounded_rect(0.33, 0.115, 0.012, 4), 0.016, (0, 0, 0), C, M_CREAM, bevel=0.004))
bm = bmesh.new()
caps = [M_CREAM, M_LAV, M_PINK, M_MINT]
u = 0.0205
for r_ in range(5):
    x = -0.33 / 2 + 0.014
    widths = [1] * 15 if r_ < 4 else [1.25, 1.25, 1.25, 6.25, 1, 1, 1, 1, 1]
    if r_ == 1:
        widths = [1.5] + [1] * 12 + [1.5]
    if r_ == 2:
        widths = [1.75] + [1] * 11 + [2.25]
    if r_ == 3:
        widths = [2.25] + [1] * 10 + [1.75, 1]
    for i, wd in enumerate(widths):
        w = wd * u
        mi = 0
        if i == 0 or i == len(widths) - 1:
            mi = 1
        if (r_, i) in ((0, 0), (2, 12)):
            mi = 2
        if r_ == 4 and i == 3:
            mi = 0
        if (r_, i) in ((3, 12), (4, 5), (4, 6), (4, 7)):
            mi = 3
        bm_box(bm, (w - 0.003, u - 0.003, 0.009), (x + w / 2, 0.041 - r_ * u, 0.0205), mi=mi)
        x += w
par(K, bm_object('static_kb_keys', bm, caps, C, bevel=0.0025, segs=2))
ms = sphere('static_mouse', 0.5, (DX + 0.27, DY - 0.15, DZ + 0.014), C, M_CREAM, scale=(0.062, 0.105, 0.04))
box('static_mouse_wheel', (0.006, 0.02, 0.008), (DX + 0.27, DY - 0.12, DZ + 0.033), C, M_PINK, bevel=0.002)

# --- speakers ---
for sx, yaw in ((-0.36, -14), (0.5, 12)):
    g = group('speaker_root', (DX + sx, DY + 0.19, DZ), yaw=yaw)
    par(g, box('static_speaker', (0.1, 0.11, 0.16), (0, 0, 0.08), C, M_WHITE, bevel=0.014, segs=3))
    par(g, cyl('static_speaker_cone', 0.034, 0.008, (0, -0.056, 0.065), C, M_DARK, rot=(math.radians(90), 0, 0), bevel=0.002))
    par(g, torus('static_speaker_ring', 0.036, 0.004, (0, -0.058, 0.065), C, M_LAV, rot=(math.radians(90), 0, 0)))
    par(g, cyl('static_speaker_tweeter', 0.014, 0.006, (0, -0.056, 0.128), C, M_DARK, rot=(math.radians(90), 0, 0), bevel=0.002))

# --- PC tower on the floor right of the desk, glass front with three rings ---
P = group('pc_root', (DX + 1.06, DY + 0.08, 0), yaw=-6)
par(P, box('static_pc_case', (0.23, 0.46, 0.48), (0, 0, 0.26), C, M_WHITE, bevel=0.012, segs=3))
par(P, box('static_pc_front', (0.2, 0.006, 0.44), (0, -0.232, 0.26), C, mat('pc_glass', '#0f0f24', 0.1), bevel=0.002))
for k, (col, zz) in enumerate((('#ff7fc6', 0.4), ('#a98bff', 0.26), ('#7fe3ff', 0.12))):
    em = mat(f'pc_ring_{k}', col, 0.4, emit=col, strength=7)
    par(P, torus('dyn_pc_ring', 0.052, 0.0055, (0, -0.237, zz), C, em, rot=(math.radians(90), 0, 0)))
    par(P, cyl('static_pc_hub', 0.016, 0.004, (0, -0.236, zz), C, M_GREY, rot=(math.radians(90), 0, 0), bevel=0.001))
for sx in (-1, 1):
    for sy in (-1, 1):
        par(P, cyl('static_pc_foot', 0.018, 0.02, (sx * 0.085, sy * 0.19, 0.01), C, M_DARK, bevel=0.003))
par(P, box('dyn_pc_power', (0.05, 0.004, 0.004), (0, -0.2, 0.502), C, EM['cyan'], bevel=0))

# --- chair ---
CH = group('chair_root', (DX + 0.05, DY - 0.78, 0), yaw=168)  # local -Y is the chair's front
M_SEAT = mat('chair_fabric', '#b8aee6', 0.9)
M_SHELL = mat('chair_shell', '#f2f0f8', 0.4)
par(CH, soft_box('static_chair_seat', (0.5, 0.5, 0.11), (0, 0, 0.5), C, M_SEAT, puff=0.25, pinch=0.25, levels=2))
par(CH, box('static_chair_pan', (0.44, 0.44, 0.03), (0, 0, 0.44), C, M_SHELL, bevel=0.012, segs=3))
back = soft_box('static_chair_back', (0.46, 0.1, 0.6), (0, 0.235, 0.87), C, M_SEAT, rot=(math.radians(-9), 0, 0), puff=0.3, pinch=0.0, levels=2)
par(CH, back)
par(CH, box('static_chair_backshell', (0.4, 0.02, 0.5), (0, 0.292, 0.85), C, M_SHELL, rot=(math.radians(-9), 0, 0), bevel=0.01, segs=3))
par(CH, soft_box('static_chair_head', (0.3, 0.09, 0.16), (0, 0.292, 1.25), C, M_PINK, rot=(math.radians(-6), 0, 0), puff=0.4, levels=2))
par(CH, box('static_chair_spine', (0.07, 0.03, 0.34), (0, 0.3, 0.58), C, M_SHELL, rot=(math.radians(-14), 0, 0), bevel=0.01))
for sx in (-1, 1):
    par(CH, box('static_chair_armpost', (0.03, 0.05, 0.2), (sx * 0.27, 0.02, 0.56), C, M_SHELL, bevel=0.008))
    par(CH, soft_box('static_chair_armpad', (0.07, 0.26, 0.035), (sx * 0.27, -0.02, 0.675), C, M_DARK, puff=0.2, levels=1, cuts=3))
par(CH, cyl('static_chair_mech', 0.07, 0.05, (0, 0, 0.405), C, M_DARK, bevel=0.01))
par(CH, cyl('static_chair_lift', 0.025, 0.26, (0, 0, 0.26), C, M_CHROME, bevel=0.003))
par(CH, cyl('static_chair_lift2', 0.036, 0.12, (0, 0, 0.15), C, M_DARK, bevel=0.006))
for i in range(5):
    a = math.radians(i * 72 + 18)
    arm = box('static_chair_star', (0.3, 0.045, 0.03), (0.15 * math.cos(a), 0.15 * math.sin(a), 0.085), C, M_SHELL, rot=(0, math.radians(8), a), bevel=0.01, segs=3)
    par(CH, arm)
    par(CH, cyl('static_chair_wheel', 0.028, 0.045, (0.3 * math.cos(a), 0.3 * math.sin(a), 0.028), C, M_RUBBER, rot=(math.radians(90), 0, a), bevel=0.008))
par(CH, cyl('static_chair_hub', 0.045, 0.05, (0, 0, 0.095), C, M_SHELL, bevel=0.01))
print('desk done', len(C.objects))
