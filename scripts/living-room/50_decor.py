# Objects left by a person who works, makes music, reads and looks after plants here.
# Clutter stays at furniture edges so the central walking routes remain usable.
C = wipe('decor')
rnd = random.Random(51)
FR_W = bpy.data.materials['white_paint']
FR_WOOD = bpy.data.materials['shelf_wood']
FR_DARK = bpy.data.materials['dark_plastic']
M_WIRE = mat('wire', '#232825', .65)
M_PAPER = mat('paper_warm', '#d9d0b2', .95)
M_INK = mat('ink', '#384945', .9)
M_COFFEE = mat('coffee', '#3c281b', .22)
M_CLAY = mat('stoneware', '#89967f', .3)
M_JACKET = mat('denim', '#354d59', .95)
M_WICKER = mat('wicker', '#b09a70', .9)
M_GLASS = mat('smoked_glass', '#abc4bc', .12, metal=.15, alpha=.26)
M_FILAMENT = mat('filament', '#ffd49a', .4, emit='#ffd49a', strength=4)
_art = {}


def acol(h):
    if h not in _art:
        _art[h] = mat('art_' + h.lstrip('#'), h, .85)
    return _art[h]


def open_book(name, x, y, z, yaw=0, w=.30, h=.23):
    g = group(name, (x, y, z), yaw=yaw, c=C)
    for side in (-1, 1):
        o = box('static_open_page', (w / 2, h, .008), (side * w / 4, 0, .014), C, M_PAPER,
                rot=(0, side * .12, 0), bevel=.001)
        par(g, o)
        for row in range(10):
            line = box('static_print', (w * rnd.uniform(.22, .36), .0012, .0004),
                       (side * w / 4, -.085 + row * .017, .023), C, M_INK, bevel=0)
            par(g, line)
    par(g, tube('static_book_spine', [(0,-h/2,.015),(0,0,.025),(0,h/2,.015)], .004, C, M_INK, bevel_res=1))


def cloth(name, center, size, material, seed, hanging=False):
    # A sagging textile with asymmetric folds, saved as real geometry for baking and collision review.
    rng = random.Random(seed)
    phase = rng.random() * 6
    bm = bmesh.new()
    grid = []
    for j in range(31):
        row = []
        v = j / 30
        for i in range(31):
            u = i / 30
            x, y = (u-.5)*size[0], (v-.5)*size[1]
            z = .009 * math.sin(u*14+v*8+phase) + .004*math.sin(v*37-u*12)
            z += .035 * math.sin(math.pi*u) * math.sin(math.pi*v)
            if hanging and v > .55:
                y = .05*size[1] + .03*math.sin((v-.55)*math.pi)
                z -= (v-.55)*size[1]
            row.append(bm.verts.new((x,y,z)))
        grid.append(row)
    for j in range(30):
        for i in range(30):
            bm.faces.new((grid[j][i],grid[j][i+1],grid[j+1][i+1],grid[j+1][i]))
    o = bm_object(name,bm,material,C,loc=center)
    o['lm'] = 1
    solid = o.modifiers.new('sewn cloth','SOLIDIFY')
    solid.thickness = .003
    return o


# A cable grid, clipped postcards, receipts and two simple original botanical prints.
for y in (1.25, 2.05):
    box('static_left_shelf', (.28,.72,.035), (-2.84,y,1.9), C,FR_WOOD)['lm']=1
    bm=bmesh.new()
    books(bm, y-.3, .55, 1.92, along='y',back=-2.80,depth=.18,hmin=.14,hmax=.26)
    bm_object('static_upper_books',bm,[M_PAGES]+M_BOOKS,C,bevel=.001,segs=1)
for i in range(8):
    tube('static_wall_grid',[(.35+i*.15,BACK-.025,1.18),(.35+i*.15,BACK-.025,2.08)],.0025,C,M_WIRE,kind='POLY',bevel_res=1)
for j in range(7):
    tube('static_wall_grid',[(.35,BACK-.025,1.18+j*.15),(1.4,BACK-.025,1.18+j*.15)],.0025,C,M_WIRE,kind='POLY',bevel_res=1)
for i in range(8):
    x=.43+(i%4)*.23
    z=1.38+(i//4)*.43+rnd.uniform(-.04,.04)
    paper=acol(rnd.choice(['#c4b590','#b7c6ba','#d2c7b2','#b9a58f']))
    box('static_postcard',(.17,.002,.24),(x,BACK-.04,z),C,paper,rot=(0,rnd.uniform(-.07,.07),0),bevel=0)
    box('static_clip',(.018,.018,.03),(x,BACK-.055,z+.12),C,M_BRASS,bevel=.003)
    for row in range(4):
        box('static_postcard_writing',(.10-row*.012,.002,.003),(x,BACK-.042,z-.03-row*.022),C,M_INK,bevel=0)
for x,z in ((2.05,2.05),(2.65,1.92)):
    box('static_picture_frame',(.43,.03,.57),(x,BACK-.025,z),C,FR_WOOD,bevel=.005)
    box('static_print_paper',(.38,.005,.52),(x,BACK-.045,z),C,M_PAPER,bevel=0)['lm']=1
    tube('static_print_stem',[(x-.07,BACK-.05,z-.2),(x,BACK-.05,z),(x+.04,BACK-.05,z+.17)],.003,C,M_INK,bevel_res=1)
    for side in (-1,1):
        for k in range(3):
            leaf=sphere('static_print_leaf',1,(x+side*.05,BACK-.05,z-.12+k*.1),C,acol('#69715a'),scale=(.045,.0015,.023),seg=12)
            leaf.rotation_euler.y=side*.5

# Bay plants form several overlapping silhouettes against the bright window.
for i,(x,r,h) in enumerate([(-2.0,.085,.12),(-1.65,.06,.09),(-.5,.09,.15),(-.2,.07,.11)]):
    plant('bay_plant', (x,3.36,1.065),r,h,M_POT if i%2 else M_CLAY,12,.14,.18,.075,80+i,droop=.5,c=C)
plant('desk_fern',(DX+.69,DY+.24,DZ),.06,.09,M_CLAY,18,.10,.16,.045,93,droop=.8,c=C)
plant('hanging_ivy',(-2.64,1.35,2.28),.11,.14,M_POT,18,.12,.22,.09,94,droop=1.4,c=C)
for k in range(4):
    x=-2.62+rnd.uniform(-.08,.08)
    pts=[(x+.07*math.sin(j),1.30-.025*j,2.33-.12*j) for j in range(7)]
    tube('static_ivy_vine',pts,.003,C,M_LEAF2,res=4,bevel_res=1)
    for j in range(1,7):
        sphere('static_ivy_leaf',1,(pts[j][0]+(-1)**j*.04,pts[j][1],pts[j][2]),C,M_LEAF,
               scale=(.055,.015,.035),rot=(.4,0,j),seg=12)
for offset in (-.085,.085):
    tube('static_hanger', [(-2.64+offset,1.35,2.28),(-2.64,1.35,2.82)],.003,C,M_WICKER,kind='POLY',bevel_res=1)

# Glass pendants, visible wires and warm filaments over the equipment.
for i,(x,y,z) in enumerate([(-1.8,2.7,2.22),(-1.2,2.95,2.38),(-.55,2.8,2.12)]):
    cyl('static_pendant_rose',.035,.025,(x,y,2.88),C,M_WIRE)
    tube('static_pendant_cord',[(x,y,2.88),(x,y,z+.1)],.003,C,M_WIRE,kind='POLY',bevel_res=1)
    cyl('pbr_pendant_socket',.025,.055,(x,y,z+.09),C,M_BRASS)
    lathe('pbr_pendant_glass',[(.025,.09),(.065,.055),(.09,0),(.086,-.08),(.045,-.12),(.015,-.13)],
          (x,y,z),C,M_GLASS,steps=32,cap=False)
    tube('dyn_filament',[(x-.012,y,z+.02),(x-.012,y,z-.04),(x+.012,y,z-.04),(x+.012,y,z+.02)],.002,C,M_FILAMENT,bevel_res=1)

# MIDI controller beside the main keyboard and a little audio interface.
g=group('midi_root',(DX+.73,DY-.14,DZ),yaw=-90,c=C)
par(g,box('static_midi_case',(.66,.21,.045),(0,0,.023),C,M_DARK,bevel=.01))
bm=bmesh.new()
for i in range(21):
    bm_box(bm,(.026,.13,.012),(-.29+i*.029,-.026,.052),mi=0)
    if i%7 not in (2,6):
        bm_box(bm,(.013,.075,.014),(-.275+i*.029,.005,.065),mi=1)
par(g,bm_object('static_midi_keys',bm,[M_CREAM,M_DARK],C,bevel=.001,segs=1))
for i in range(6):
    par(g,cyl('static_midi_knob',.008,.012,(-.24+i*.05,.077,.052),C,M_DARK,verts=16))
box('static_audio_interface',(.16,.12,.045),(DX-.55,DY-.12,DZ+.025),C,acol('#5b6b62'),bevel=.005)
for x in (DX-.59,DX-.53):
    cyl('pbr_audio_knob',.013,.015,(x,DY-.187,DZ+.03),C,M_BRASS,rot=(math.pi/2,0,0),verts=20)
lathe('static_desk_mug',[(0,0),(.037,0),(.043,.008),(.046,.095),(.040,.095),(.035,.012),(0,.012)],
      (DX-.71,DY-.2,DZ),C,M_CLAY,steps=32)
torus('static_mug_handle',.027,.006,(DX-.76,DY-.2,DZ+.05),C,M_CLAY,rot=(math.pi/2,math.pi/2,0),arc=180)
cyl('pbr_coffee_surface',.039,.001,(DX-.71,DY-.2,DZ+.073),C,M_COFFEE,bevel=0)
torus('static_coffee_ring',.041,.0006,(DX-.48,DY-.29,DZ+.001),C,acol('#796348'),seg=32,rseg=4,arc=290)
open_book('desk_notebook',DX+.40,DY-.27,DZ+.006,yaw=-9,w=.23,h=.16)
for i in range(4):
    box('static_desk_paper',(.13,.20,.0008),(DX-.37+i*.015,DY+.02,DZ+.002+i*.002),C,M_PAPER,rot=(0,0,.2+i*.14),bevel=0)
for i in range(3):
    cyl('static_pen',.003,.15,(DX+.20+i*.014,DY-.29,DZ+.01),C,M_INK,rot=(0,math.pi/2,.2),verts=10)
box('static_phone',(.073,.145,.008),(DX-.45,DY-.12,DZ+.008),C,M_DARK,rot=(0,0,-.2),bevel=.005)

# A clamped microphone arm folds over the free edge of the desk, with its cable following it.
arm=[(DX+.78,DY+.03,DZ+.03),(DX+.73,DY-.04,1.26),(DX+.32,DY-.40,1.13)]
box('static_mic_clamp',(.055,.085,.055),(arm[0][0],arm[0][1],DZ-.012),C,M_DARK,bevel=.005)
for a,b in zip(arm,arm[1:]):
    for dz in (-.016,.016):
        tube('static_mic_arm',[(a[0],a[1],a[2]+dz),(b[0],b[1],b[2]+dz)],.006,C,M_DARK,kind='POLY',bevel_res=1)
for x,y,z in arm:
    cyl('pbr_mic_joint',.018,.024,(x,y,z),C,M_BRASS,rot=(math.pi/2,0,0),verts=20)
mx,my,mz=arm[-1]
cyl('static_microphone',.025,.14,(mx,my,mz-.07),C,M_DARK,bevel=.008)
for z in (mz-.03,mz-.10):
    torus('static_mic_mount',.035,.0025,(mx,my,z),C,M_WIRE,seg=24,rseg=6)
tube('static_microphone_cable',[(mx,my,mz-.14),(mx+.08,my,mz-.18),arm[-1],arm[1],arm[0],
     (DX+.8,DY+.06,.60),(DX+.5,DY+.3,.1)],.0025,C,M_WIRE,res=5,bevel_res=1)
# Headphones hang from a hook, clear of both the chair and the mouse surface.
hx,hy,hz=DX-.87,DY-.25,DZ-.22
box('static_headphone_hook',(.06,.04,.018),(hx,hy,DZ-.02),C,M_DARK,bevel=.004)
tube('static_headphone_hanger',[(hx,hy,DZ-.02),(hx,hy,hz+.085)],.004,C,M_WIRE,kind='POLY',bevel_res=1)
torus('static_headphone_band',.085,.009,(hx,hy,hz),C,M_DARK,rot=(math.pi/2,0,0),arc=180)
for x in (hx-.083,hx+.083):
    o=soft_box('static_headphone_cup',(.047,.065,.09),(x,hy,hz-.035),C,M_DARK,cuts=3,levels=1,puff=.2)

# Loose cables have plausible endpoints and a power strip below the desk.
for i in range(5):
    x=DX-.4+i*.23
    tube('static_loose_cable',[(x,DY+.2,1.02),(x+.06,DY+.35,.6),(x-.08,DY+.36,.05),
         (x+.22,DY+.1,.012),(DX+.45,DY-.03,.02)],.0035,C,M_WIRE,res=7,bevel_res=1)
box('static_powerstrip',(.32,.07,.033),(DX+.45,DY-.03,.025),C,FR_W,bevel=.006)
for i in range(3):
    box('static_powerplug',(.04,.035,.045),(DX+.35+i*.085,DY-.03,.055),C,M_DARK,bevel=.004)
cloth('static_chair_jacket',(DX+.05,DY-.55,.94),(.52,.65),M_JACKET,12,True)

# A music-and-reading corner spills gently into the room.
open_book('floor_book',-.8,-1.25,.022,yaw=-14,w=.36,h=.27)
for i in range(3):
    box('static_magazine',(.24,.31,.006),(-.65+i*.04,-1.65+i*.025,.02+i*.009),C,
        acol(['#966b53','#697a70','#b49c6c'][i]),rot=(0,0,.08-i*.22),bevel=.001)
cloth('static_thrown_sweater',(1.45,.18,.025),(.55,.52),mat('sweater','#9c7955',.95),27)
for i,(x,y) in enumerate([(1.87,.35),(1.96,.11)]):
    o=soft_box('static_slipper',( .11,.26,.065),(x,y,.04),C,acol('#9b8065'),rot=(0,0,.2-i*.4),cuts=3,levels=1,puff=.3)

# Woven laundry basket, with a crumpled shirt above the rim.
cx,cy=2.63,-.65
for j in range(17):
    z=.025+j*.019
    torus('static_basket_weave',.18+z*.12,.006,(cx,cy,z),C,M_WICKER,seg=36,rseg=4)
for i in range(28):
    a=i*math.tau/28
    tube('static_basket_upright',[(cx+.18*math.cos(a),cy+.18*math.sin(a),.02),
         (cx+.22*math.cos(a),cy+.22*math.sin(a),.35)],.005,C,M_WICKER,kind='POLY',bevel_res=1)
cloth('static_basket_shirt',(cx,cy,.29),(.4,.43),M_SHEET,6)
cloth('static_basket_towel',(cx+.02,cy-.08,.36),(.2,.43),M_JACKET,8,True)

# A partly open shipping carton, packing paper and a tote beside the bookcase.
M_CARD=mat('cardboard','#9b805b',.95)
for size,loc in [((.45,.32,.012),(-2.62,.95,.006)),((.45,.012,.24),(-2.62,1.10,.12)),
                 ((.012,.32,.24),(-2.84,.95,.12)),((.012,.32,.24),(-2.40,.95,.12)),((.45,.012,.24),(-2.62,.79,.12))]:
    box('static_carton',size,loc,C,M_CARD,bevel=.002)
box('static_carton_flap',(.45,.15,.005),(-2.62,.73,.26),C,M_CARD,rot=(.35,0,0),bevel=.001)
box('static_shipping_label',(.14,.002,.08),(-2.62,.782,.14),C,M_PAPER,bevel=0)
cloth('static_packing_paper',(-2.62,.95,.24),(.30,.22),M_PAPER,37)
print('decor done',len(C.objects))
