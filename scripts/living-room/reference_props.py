C=wipe('decor')
# The low table, the laptop, sketchbooks and floor books, the supplies trolley, the backpack and
# the clothes rack are the user's models (reference_models.py). This part keeps the things
# around them, and the grid rug they stand on.
RUG=mat('rug_charcoal','#1d2233',.98);surface(RUG,(190,190,60),.25,.14)
woven_grid(RUG,(12,10),'#8e9ab8',.03)
RUG_AT=(-.35,-1.25,3.0,2.4)
# (Many small faces: the page dents the rug under a seated body, src/living-room/soft-surface.ts.)
bm=bmesh.new();grid=[]
for j in range(25):grid.append([bm.verts.new((RUG_AT[0]-RUG_AT[2]/2+RUG_AT[2]*i/30,RUG_AT[1]-RUG_AT[3]/2+RUG_AT[3]*j/24,.012+.0025*math.sin(i*1.7+j*.9))) for i in range(31)])
for j in range(24):
    for i in range(30):bm.faces.new((grid[j][i],grid[j][i+1],grid[j+1][i+1],grid[j+1][i]))
o=bm_object('grid_rug',bm,RUG,C);o['lm']=1
solid=o.modifiers.new('pile','SOLIDIFY');solid.thickness=.012


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
# The guitar leans on the arm of the sofa (reference_otaku.py); its amplifier and pedals are
# the user's floor set, in the near right corner (reference_models.py).
g=bpy.data.objects.new('guitar_pose',None);K.objects.link(g);g.location=(1.03,-.24,.17);g.rotation_euler=(R90,math.radians(-13),math.radians(-8))
for o in set(K.objects)-before-{g}:o.parent=g
# The moving box by the sofa.
boxfile('floor_archive',(2.72,-.44,.17),K,size=(.43,.39,.32),color=PALETTE[3])
flatbook('box_comic',2.72,-.44,.34,w=.30,d=.26,angle=.1)
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
print('reference props ready',len(C.objects),len(K.objects))
