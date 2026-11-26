# A wider rented room, with a deep, three-sided window bay and an open camera side.
C = wipe('shell')
rnd = random.Random(101)
M_WALL = mat('wall_plaster', '#aeafa2', 0.95)
M_TRIM = mat('painted_trim', '#d5cfb9', 0.6)
M_FRAME = mat('window_frame', '#7b8175', 0.45)
M_BRASS = mat('brass', '#a08248', 0.3, metal=0.8)
M_BASE = mat('foundation', '#342d28', 0.8)
floor_mats = [mat('oak_' + str(i), color, 0.65) for i, color in enumerate(
    ['#947454', '#a18360', '#8a7156', '#ad8b65', '#9c7b59', '#b19672'])]
outline('static_foundation', FLOOR_PLAN, 0.16, (0, 0, -0.18), C, M_BASE, bevel=0.008)


def floor_limits(y):
    if y <= BACK:
        return -HALF, HALF
    t = (y - BACK) / 0.8
    return -2.4 + 0.3 * t, 0.1 - 0.3 * t


# Individual staggered boards create seams and end grain at the real scale.
bm = bmesh.new()
step = 0.16
row_edges = sorted({FRONT + j * step for j in range(math.ceil((3.5 - FRONT) / step))} | {BACK, 3.5})
for ya, yb in zip(row_edges, row_edges[1:]):
    xmin, xmax = floor_limits(yb)
    x = xmin
    first = True
    while x < xmax - 0.01:
        length = rnd.uniform(0.65, 1.35) if first else rnd.uniform(0.95, 1.6)
        end = min(xmax, x + length)
        bm_box(bm, (end - x - 0.002, yb - ya - 0.002, 0.022),
               ((x + end) / 2, (ya + yb) / 2, -0.011), mi=rnd.randrange(len(floor_mats)))
        first = False
        x = end
bm_object('static_floor_boards', bm, floor_mats, C, bevel=0.0008, segs=1)['lm'] = 1


def wall_segment(name, a, b, bottom, top, material=M_WALL, thickness=0.14):
    delta = Vector((b[0] - a[0], b[1] - a[1]))
    o = box(name, (delta.length, thickness, top - bottom),
            ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (bottom + top) / 2),
            C, material, rot=(0, 0, math.atan2(delta.y, delta.x)), bevel=0.006)
    o['lm'] = 1
    return o


# Back and left full walls; the right wall is a low cutaway for the room camera.
wall_segment('static_wall_left', (-3.07, FRONT), (-3.07, BACK + .07), 0, WALL_H)
wall_segment('static_wall_right', (3.07, FRONT), (3.07, BACK + .07), 0, .7)
wall_segment('static_wall_back_right', (.1, BACK + .07), (3.14, BACK + .07), 0, WALL_H)
wall_segment('static_wall_back_left', (-3.14, BACK + .07), (-2.4, BACK + .07), 0, WALL_H)
bay = [((-2.4, 2.7), (-2.1, 3.5)), ((-2.1, 3.5), (-.2, 3.5)), ((-.2, 3.5), (.1, 2.7))]
for i, (a, b) in enumerate(bay):
    wall_segment('static_bay_apron', a, b, 0, 1.02)
    wall_segment('static_bay_header', a, b, 2.63, WALL_H)
    wall_segment('static_bay_sill', a, b, 1.01, 1.055, M_TRIM, .30)
    for p in (a, b):
        box('static_window_post', (.065, .08, 1.63), (p[0], p[1], 1.835), C, M_FRAME)
    for z in (1.085, 2.585, 1.73):
        wall_segment('static_window_rail', a, b, z, z + .035, M_FRAME, .065)
    if i == 1:
        box('static_window_mullion', (.044, .06, 1.5), (-1.15, 3.49, 1.84), C, M_FRAME)
        for x in (-1.65, -.65):
            box('static_sash_handle', (.055, .018, .012), (x, 3.45, 1.73), C, M_BRASS, bevel=.003)

for a, b in [((-3, FRONT), (-3, BACK)), ((.1, BACK), (3, BACK)),
             ((3, FRONT), (3, BACK)), ((-3, BACK), (-2.4, BACK))] + bay:
    wall_segment('static_skirting', a, b, .005, .13, M_TRIM, .035)

# A door and building details make this a place somebody could enter.
M_DOOR = mat('door_wood', '#777b69', .7)
box('static_door', (.045, .84, 2.03), (-2.97, -1.9, 1.02), C, M_DOOR, bevel=.006)['lm'] = 1
for y in (-2.35, -1.45):
    box('static_door_casing', (.065, .055, 2.13), (-2.94, y, 1.065), C, M_TRIM)
box('static_door_lintel', (.065, .95, .06), (-2.94, -1.9, 2.11), C, M_TRIM)
for z in (.55, 1.42):
    box('static_door_inset', (.018, .65, .68), (-2.937, -1.9, z), C, M_DOOR, bevel=.006)['lm'] = 1
cyl('pbr_door_rose', .025, .018, (-2.91, -1.57, 1.0), C, M_BRASS, rot=(0, math.pi / 2, 0))
box('pbr_door_handle', (.06, .11, .014), (-2.88, -1.62, 1.0), C, M_BRASS, bevel=.005)
for y in (-1.25, .94, 2.1):
    box('static_wall_socket', (.02, .075, .09), (-2.985, y, .24), C, M_TRIM, bevel=.005)
    for z in (.225, .255):
        box('static_socket_slot', (.023, .025, .004), (-2.97, y, z), C, M_BASE, bevel=0)

# Hazy blue-hour silhouettes follow all three panes. A single distant card left a black gap
# when looking through the side of the bay; the soft colour field also keeps the room in focus.
M_SKY = mat('sky', '#ffffff', 1, emit='#ffffff', strength=.7)
bm = bmesh.new()
for a,b in bay:
    delta=Vector((b[0]-a[0],b[1]-a[1]))
    # Shared corner positions close the bay without a seam between the angled panes.
    outward=Vector((0,0))
    rows=[]
    for j in range(33):
        rows.append([bm.verts.new((a[0]+delta.x*i/48+outward.x,
                                  a[1]+delta.y*i/48+outward.y,1.055+1.58*j/32)) for i in range(49)])
    for j in range(32):
        for i in range(48):
            bm.faces.new((rows[j][i],rows[j+1][i],rows[j+1][i+1],rows[j][i+1]))
sky=bm_object('dyn_window_sky',bm,M_SKY,C,smooth=False)
# The haze depicts the view through glass; it must not block the window's area light.
sky.visible_shadow=False
colors=sky.data.color_attributes.new('Color','FLOAT_COLOR','POINT')
low,high,city,lit=[Vector(srgb(h)[:3]) for h in ('#bdd0cd','#718c9b','#627b88','#d4c2a4')]
for vertex,item in zip(sky.data.vertices,colors.data):
    x,z=vertex.co.x,vertex.co.z
    t=max(0,min(1,(z-1.055)/1.58))
    color=low.lerp(high,t)
    for cx,width,roof in [(-2.2,.48,1.78),(-1.54,.62,1.57),(-.87,.50,1.90),(-.24,.55,1.68)]:
        side=1/(1+math.exp(min(40,(abs(x-cx)-width/2)*35)))
        below=1/(1+math.exp(min(40,(z-roof)*22)))
        color=color.lerp(city,side*below*.58)
        for rz in (1.22,1.43,1.64):
            if rz>roof-.08: continue
            for rx in (cx-.12,cx+.12):
                glow=math.exp(-((x-rx)/.045)**2-((z-rz)/.065)**2)*side*.28
                color=color.lerp(lit,glow)
    item.color=(*color,1)
sky.data.color_attributes.active_color=colors
nt=M_SKY.node_tree
attribute=nt.nodes.new('ShaderNodeVertexColor')
attribute.layer_name='Color'
p=nt.nodes.get('Principled BSDF')
nt.links.new(attribute.outputs['Color'],p.inputs['Base Color'])
nt.links.new(attribute.outputs['Color'],p.inputs['Emission Color'])

M_CURTAIN = mat('curtain_linen', '#c2c1a7', 1)
for xcenter in (-2.32, 0.0):
    bm = bmesh.new()
    rows = []
    for j in range(45):
        t = j / 44
        rows.append([bm.verts.new((xcenter + (u / 24 - .5) * (.42 + .14 * t),
                    2.78 - .07 * math.sin(u / 24 * math.pi * 10) * (.5 + .5 * t),
                    2.71 - t * 2.55 + .015 * math.sin(u * .8) * t)) for u in range(25)])
    for j in range(44):
        for u in range(24):
            bm.faces.new((rows[j][u], rows[j][u+1], rows[j+1][u+1], rows[j+1][u]))
    o = bm_object('static_linen_curtain', bm, M_CURTAIN, C)
    o['lm'] = 1
    solid = o.modifiers.new('cloth thickness', 'SOLIDIFY')
    solid.thickness = .003
cyl('pbr_curtain_rod', .012, 2.9, (-1.15, 2.8, 2.75), C, M_BRASS, rot=(0, math.pi / 2, 0), bevel=.002)

cam = bpy.data.objects.new('camera_main', bpy.data.cameras.new('camera_main'))
coll('meta').objects.link(cam)
cam.location = (3.8, -10.5, 6.9)
CAMERA_TARGET = (-.05, .35, .85)
cam.rotation_euler = (Vector(CAMERA_TARGET) - cam.location).to_track_quat('-Z', 'Y').to_euler()
cam.data.lens = 46
cam.data.sensor_width = 36
cam.data.clip_start, cam.data.clip_end = .1, 80
sc = bpy.context.scene
sc.camera = cam
sc.render.resolution_x, sc.render.resolution_y = 1600, 1000
w = sc.world or bpy.data.worlds.new('World')
sc.world = w
w.use_nodes = True
bg = next(n for n in w.node_tree.nodes if n.type == 'BACKGROUND')
bg.inputs['Color'].default_value = srgb('#b8ccda')
bg.inputs['Strength'].default_value = .22
# The camera sees a cutaway, but its baked illumination comes from a complete room.
# These baffles stay out of the GLB and camera render while providing indirect light and shade.
baffles = wipe('lighting_baffles')
for name,size,loc in [('ceiling',(6.3,6.45,.12),(0,.4,2.98)),
                      ('front',(6.25,.12,2.95),(0,FRONT-.1,1.46)),
                      ('right',(.12,5.6,2.24),(3.14,0,1.82))]:
    o=box('bounce_'+name,size,loc,baffles,M_TRIM,bevel=0)
    o.visible_camera=False
print('shell done', len(C.objects))
