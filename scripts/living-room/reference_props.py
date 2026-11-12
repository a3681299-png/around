C=wipe('decor')
# The grid rug with the low table, laptop, sketchbook, floor books and the supplies trolley,
# the backpack and the clothes rack are the user's models (reference_models.py: tex_floorset,
# tex_backpack, tex_rack). This part keeps the things around them.


def flatbook(name,x,y,z,w=.25,d=.32,angle=0,kind='comic'):
    block(name+'_pages',(w,d,.032),(x,y,z+.016),C,PAPER,rot=(0,0,angle),bevel=.002)
    art(name+'_cover',kind,w+.012,d+.01,(x,y,z+.034),C,rot=(0,0,angle))


# Stacks off the rug (the rug's own books come with tex_floorset).
for sx,sy,count in [(-1.98,-2.27,4),(-1.78,.50,4)]:
    for k in range(count):flatbook('floor_comic',sx+(RNG.random()-.5)*.05,sy+(RNG.random()-.5)*.05,.04+k*.039,angle=RNG.uniform(-.25,.25),kind=('comic' if k%2 else 'sunset'))
K=wipe('right')
# Guitar with shaped body, pickguard, bridge, six strings, frets and tuning machines.
before=set(K.objects)
outline('electric_guitar_body',[(-.13,0),(-.20,.05),(-.21,.17),(-.14,.27),(-.15,.36),(-.09,.44),(-.07,.32),(.05,.31),(.10,.47),(.14,.38),(.12,.27),(.21,.17),(.22,.06),(.13,0)],.045,(0,0,0),K,mat('guitar_cream','#aab6d6',.25),bevel=.02,segs=4)
outline('guitar_pickguard',[(-.07,.05),(-.12,.10),(-.11,.24),(-.07,.30),(.06,.31),(.10,.24),(.08,.07)],.004,(0,0,.047),K,INK,bevel=.005)
block('guitar_neck',(.055,.58,.035),(0,.60,.025),K,WOOD,bevel=.005)
block('fingerboard',(.052,.58,.005),(0,.60,.048),K,TRIM,bevel=.001)
outline('headstock',[(-.027,0),(-.045,.09),(-.025,.19),(.04,.21),(.045,.07),(.028,0)],.025,(0,.88,.02),K,WOOD,bevel=.008)
for i in range(18):rod('guitar_fret',(-.026,.32+i*.029,.055),(.026,.32+i*.029,.055),.001,K,STEEL)
for i in range(6):
    x=-.018+i*.0072
    rod('guitar_string',(x,.08,.061),(x,1.06,.061),.00065,K,STEEL)
    s=-1 if i<3 else 1;z=.94+(i%3)*.055
    rod('tuner_shaft',(0,z,.04),(s*.065,z,.04),.005,K,STEEL)
    sphere('tuner_key',.012,(s*.067,z,.04),K,STEEL,scale=(1,.6,.3),seg=12)
for y in (.16,.23):block('guitar_pickup',(.076,.03,.015),(0,y,.058),K,WHITE,bevel=.004)
for x,y in [(.13,.10),(.15,.16)]:cyl('guitar_knob',.012,.014,(x,y,.065),K,STEEL,verts=16)
g=bpy.data.objects.new('guitar_pose',None);K.objects.link(g);g.location=(2.75,-.63,.17);g.rotation_euler=(R90,math.radians(-13),math.radians(-8))
for o in set(K.objects)-before-{g}:o.parent=g
# Amplifier and plugged-in pedals.
block('amplifier',(.59,.35,.53),(2.24,-.62,.29),K,INK,bevel=.025)
GRILLE=mat('amp_grille','#555a70',.85)
block('speaker_cloth',(.51,.004,.39),(2.24,-.798,.27),K,GRILLE)
for i in range(29):rod('speaker_weave',(1.995+i*.017,-.802,.075),(1.995+i*.017,-.802,.46),.0015,K,BLACK)
for j in range(25):rod('speaker_weave',(1.99,-.803,.08+j*.015),(2.49,-.803,.08+j*.015),.0014,K,BLACK)
for i in range(6):cyl('amp_knob',.009,.012,(2.04+i*.065,-.804,.51),K,WHITE,rot=(R90,0,0),verts=12)
label('amp_brand','NIGHT TONE',(2.23,-.81,.455),.022,K,PAPER)
block('pedalboard',(.69,.27,.038),(2.30,-1.27,.063),K,INK,bevel=.015)
for i,col in enumerate(('#275a9d','#d3a13c','#2d89bb')):
    x=2.08+i*.22;m=mat('pedal_'+str(i),col,.36)
    block('guitar_pedal',(.17,.22,.044),(x,-1.27,.10),K,m,bevel=.009)
    for dx in (-.04,.04):cyl('pedal_knob',.013,.018,(x+dx,-1.21,.132),K,BLACK,verts=12)
    cyl('footswitch',.012,.012,(x,-1.34,.132),K,STEEL,verts=16)
tube('instrument_lead',[(2.76,-.69,.28),(2.9,-.9,.035),(2.61,-1.1,.035),(2.62,-1.27,.11)],.004,K,BLACK)
# Small white magazine box beside the clothes rack, and the front-left moving box.
block('magazine_bench',(.30,.44,.34),(1.40,-2.42,.17),K,WHITE)
for i in range(8):
    block('magazine',(.24,.024,.36+(i%4)*.022),(1.40,-2.60+i*.05,.48),K,PALETTE[i%9],rot=(0,.10,0),bevel=.002)
boxfile('floor_archive',(-2.53,-2.35,.17),K,size=(.43,.39,.32),color=PALETTE[3])
flatbook('box_comic',-2.53,-2.35,.34,w=.30,d=.26,angle=.1)
# Rear wall wire display, pins, notes, postcards and headphones.
for i in range(8):rod('wall_grid',(1.21+i*.105,2.65,1.73),(1.21+i*.105,2.65,2.43),.004,C,INK)
for j in range(7):rod('wall_grid',(1.21,2.65,1.73+j*.115),(1.945,2.65,1.73+j*.115),.004,C,INK)
for i,(x,z) in enumerate([(1.34,2.25),(1.59,2.22),(1.82,2.23),(1.41,1.99),(1.69,1.94),(1.87,1.84)]):
    art('pinned_print_'+str(i),'sunset' if i%2 else 'comic',.15,.19,(x,2.641,z),C)
    block('paper_clip',(.019,.012,.034),(x,2.627,z+.103),C,STEEL,bevel=.002)
art('wall_contour','contour',.65,.92,(2.57,2.68,2.12),C)
art('wall_sunset','sunset',.31,.44,(2.08,2.677,2.01),C)


def headphones(name,x,y,z,c):
    tube(name+'_band',[(x+.13*math.cos(a),y,z+.14*math.sin(a)) for a in np.linspace(0,math.pi,24)],.014,c,INK,kind='POLY',bevel_res=2)
    for s in (-1,1):
        soft_box(name+'_earcup',(.067,.087,.12),(x+s*.12,y,z),c,BLACK,cuts=4,levels=1)
        rod(name+'_slider',(x+s*.12,y,z+.04),(x+s*.12,y,z+.12),.006,c,STEEL)


headphones('wall_headphones',1.93,2.60,1.82,C)
headphones('bed_headphones',2.06,.49,.81,C)
print('reference props ready',len(C.objects),len(K.objects))
