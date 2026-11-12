C=wipe('decor')
# Blue cutting-mat-like grid rug, bound on all four edges.
RUG=mat('rug_indigo','#263451',.96);surface(RUG,(160,140,120),.12,.18)
woven_grid(RUG,(20,16),'#8999bc',.025)
block('grid_rug',(3.75,3.05,.023),(-.08,-.94,.012),C,RUG,bevel=.015,lm=True)
GRID=mat('rug_grid','#7186a9',.98)
for x in (-1.94,1.79):block('rug_binding',(.024,3.06,.008),(x,-.94,.026),C,NAVY,bevel=.004)
for y in (-2.46,.58):block('rug_binding',(3.75,.024,.008),(-.08,y,.026),C,NAVY,bevel=.004)


def flatbook(name,x,y,z,w=.25,d=.32,angle=0,kind='comic'):
    block(name+'_pages',(w,d,.032),(x,y,z+.016),C,PAPER,rot=(0,0,angle),bevel=.002)
    art(name+'_cover',kind,w+.012,d+.01,(x,y,z+.034),C,rot=(0,0,angle))


for sx,sy,count in [(-1.98,-2.27,4),(-1.45,.69,4),(-1.68,.17,2),(.15,-.65,3),(.65,-1.03,2)]:
    for k in range(count):flatbook('floor_comic',sx+(RNG.random()-.5)*.05,sy+(RNG.random()-.5)*.05,.04+k*.039,angle=RNG.uniform(-.25,.25),kind=('comic' if k%2 else 'sunset'))
# Round low table, tapered legs, mugs, three drink cans and an opened snack bag.
TX,TY=-1.05,-1.63
cyl('coffee_table_top',.47,.045,(TX,TY,.43),C,WOOD,verts=64,bevel=.012)
for a in (0,2.1,4.2):rod('table_leg',(TX+.26*math.cos(a),TY+.26*math.sin(a),.41),(TX+.35*math.cos(a),TY+.35*math.sin(a),.035),.029,C,WOOD)
mug('table_mug',(TX-.22,TY-.06,.455),C,'#171c2b',.055)
for i,color in enumerate(('#d6a254','#233d69','#c3ccdb')):
    x,y=TX+.03+i*.11,TY+.13
    m=mat('can_label_'+str(i),color,.32,.25)
    lathe('drink_can',[(.033,0),(.037,.012),(.037,.14),(.032,.15)],(x,y,.455),C,m,steps=24)
    cyl('can_lid',.032,.003,(x,y,.607),C,STEEL,verts=24)
    tube('can_tab',[(x+.01*math.cos(t),y+.017*math.sin(t),.611) for t in np.linspace(0,math.tau,15)],.002,C,INK,cyclic=True,kind='POLY')
    label('can_brand','POP',(x,y-.037,.50),.025,C,PAPER)
SNACK=mat('snack_orange','#ec892c',.35)
soft_box('snack_bag',(.24,.15,.065),(TX+.11,TY-.14,.49),C,SNACK,rot=(0,0,-.2),cuts=5,levels=1,puff=.05,noise=.13)
label('snack_label','CRUNCH',(TX+.11,TY-.16,.527),.035,C,PAPER,rot=(0,0,-.2))
for i in range(5):cyl('collector_badge',.024,.003,(TX-.1+i*.055,TY-.30,.456),C,PALETTE[i],bevel=0,verts=20)
block('table_controller',(.16,.10,.032),(TX-.14,TY+.16,.48),C,BLACK,bevel=.026)
for s in (-1,1):sphere('controller_grip',.041,(TX-.14+s*.065,TY+.12,.475),C,BLACK,scale=(.8,1.3,.6),seg=16)
# Open laptop on the rug, with an illustrated sticker-covered lid facing the camera.
LX,LY=-.10,-.22
_laptop_before=set(C.objects)
block('laptop_base',(.62,.43,.022),(LX,LY,.054),C,STEEL,bevel=.012)
block('laptop_keyboard',(.54,.25,.004),(LX,LY+.04,.068),C,INK)
for j in range(4):
    for i in range(13):block('laptop_key',(.032,.037,.003),(LX-.235+i*.039,LY-.04+j*.05,.073),C,PALETTE[3],bevel=.001)
block('laptop_trackpad',(.18,.095,.002),(LX,LY-.137,.068),C,STEEL)
block('laptop_lid',(.62,.019,.40),(LX,LY+.19,.27),C,INK,rot=(math.radians(-12),0,0),bevel=.012)
# Interior screen points toward the back; the sticker side is the visible face in the reference.
art('dyn_laptop_screen','paint',.57,.35,(LX,LY+.205,.27),C,rot=(math.radians(-102),0,0),emission=1.3)
for j in range(3):
    for i in range(4):
        x=LX-.22+i*.145;z=.14+j*.12
        sy=LY+.176+.2126*(z-.27)-.01
        sphere('laptop_sticker',.045,(x,sy,z),C,PALETTE[(i+j)%len(PALETTE)],scale=(1,.03,.82),seg=16)
        if (i+j)%2==0:
            for s in (-1,1):sphere('sticker_ear',.014,(x+s*.026,sy+.005,z+.032),C,PAPER,scale=(.6,.15,1),seg=12)
        for s in (-1,1):sphere('sticker_eye',.004,(x+s*.014,sy-.003,z+.003),C,INK,scale=(1,.2,1),seg=8)
_pivot=Vector((LX,LY+.19,0));_turn=Matrix.Rotation(math.radians(35),3,'Z')
for _o in set(C.objects)-_laptop_before:
    if _o.name.startswith(('laptop_base','laptop_key','laptop_trackpad')):_o.location.y+=.43
    _o.location=_pivot+_turn@(_o.location-_pivot)
    _o.rotation_euler=(_turn@_o.rotation_euler.to_matrix()).to_euler()
# Open sketchbook: curved leaves and small line drawings.
for s in (-1,1):
    art('sketchbook_page','sketch',.24,.32,(.24+s*.118,-1.10,.06),C,rot=(0,s*.05,-.13))
rod('sketch_pencil',(.10,-1.32,.065),(.39,-1.29,.065),.003,C,PALETTE[5])
# Three-tier metal supplies trolley.
K=wipe('right');CX,CY=1.06,-1.05
for x in (CX-.30,CX+.30):
    for y in (CY-.21,CY+.21):
        rod('cart_post',(x,y,.10),(x,y,.91),.012,K,INK)
        cyl('cart_caster',.037,.025,(x,y,.055),K,BLACK,rot=(0,R90,0),verts=16)
for z in (.17,.47,.78):
    block('cart_tray',(.66,.47,.035),(CX,CY,z),K,INK,bevel=.012)
    for y in (CY-.23,CY+.23):block('cart_lip',(.66,.017,.105),(CX,y,z+.055),K,INK)
    for x in (CX-.32,CX+.32):block('cart_lip',(.017,.47,.105),(x,CY,z+.055),K,INK)
    if z<.7:
        for i in range(3):boxfile('cart_storage',(CX-.22+i*.22,CY,z+.13),K,size=(.19,.37,.19),color=PALETTE[i+5])
for x,y in [(CX-.21,CY+.07),(CX+.21,CY+.06),(CX+.14,CY-.1)]:
    cyl('pencil_cup',.055,.13,(x,y,.865),K,STEEL,verts=20)
    for i in range(9):
        a=i*2.4;px=x+.034*math.cos(a);py=y+.034*math.sin(a)
        rod('colored_pen',(px,py,.83),(px+RNG.uniform(-.026,.026),py+RNG.uniform(-.026,.026),1.04+RNG.uniform(-.04,.03)),.005,K,PALETTE[i])
for x,y,s in [(CX-.08,CY-.1,.75),(CX+.06,CY+.05,.55)]:plush('cart_plush',(x,y,.81),K,s)
rod('cart_handle',(CX-.25,CY+.24,.88),(CX+.25,CY+.24,.88),.013,K,STEEL)
# Backpack with sewn pockets, zip piping, shoulder straps, badges and a plush key chain.
PX,PY=.34,-2.23
BAG=mat('backpack_canvas','#1c263d',.98);surface(BAG,(90,90,110),.18,.20)
soft_box('backpack',(.46,.28,.60),(PX,PY,.34),K,BAG,cuts=7,levels=2,puff=.3)
soft_box('bag_front_pocket',(.34,.09,.27),(PX,PY-.164,.23),K,NAVY,cuts=5,levels=1,puff=.12)
for z,w in [(.20,.32),(.36,.34),(.56,.36)]:
    tube('bag_zip',[(PX-w/2,PY-.183,z-.07),(PX-w/2,PY-.188,z+.01),(PX,PY-.193,z+.05),(PX+w/2,PY-.183,z)],.0035,K,STEEL)
    rod('zip_pull',(PX+w/2,PY-.20,z),(PX+w/2,PY-.20,z-.035),.004,K,STEEL)
for s in (-1,1):tube('shoulder_strap',[(PX+s*.15,PY+.1,.6),(PX+s*.23,PY+.23,.47),(PX+s*.27,PY+.24,.12),(PX+s*.13,PY+.1,.1)],.022,K,BAG)
tube('bag_top_loop',[(PX-.07,PY,.63),(PX-.06,PY,.73),(PX+.07,PY,.73),(PX+.08,PY,.63)],.009,K,INK)
for dx,dz in [(-.11,.43),(.05,.47),(.11,.30)]:
    sphere('bag_badge',.025,(PX+dx,PY-.194,dz),K,PALETTE[int(dz*20)%9],scale=(1,.15,1),seg=20)
plush('bag_keychain',(PX+.21,PY-.22,.06),K,.69)
rod('keychain_loop',(PX+.21,PY-.20,.26),(PX+.21,PY-.22,.18),.0025,K,STEEL)
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
# Near-right magazine bench and front-left moving box.
block('magazine_bench',(.40,.95,.40),(2.68,-2.11,.21),K,PALETTE[3])
for i in range(16):
    block('magazine',(.32,.027,.43+(i%4)*.025),(2.68,-2.51+i*.05,.62),K,PALETTE[i%9],rot=(0,.10,0),bevel=.002)
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
# Two small display figures with their sculpted hair, costume and stands.
for i,x in enumerate((-1.56,-1.31)):
    c=coll('desk');y=1.83
    cyl('figure_base',.07,.012,(x,y,.835),c,INK,verts=24)
    for s in (-1,1):
        rod('figure_boot',(x+s*.025,y,.85),(x+s*.024,y,.95),.014,c,INK)
        rod('figure_leg',(x+s*.024,y,.95),(x+s*.018,y,1.02),.012,c,PALETTE[2])
    sphere('figure_dress',.06,(x,y,1.03),c,PALETTE[1+i*3],scale=(.8,.6,1.2),seg=20)
    sphere('figure_face',.035,(x,y-.005,1.14),c,PALETTE[2],seg=20)
    for s in (-1,1):
        sphere('figure_hair',.024,(x+s*.035,y+.005,1.13),c,PALETTE[0 if i==0 else 4],scale=(.7,.8,2.3),seg=16)
        rod('figure_arm',(x+s*.035,y,1.07),(x+s*.067,y-.02,1.01),.009,c,PALETTE[2])
print('reference props ready',len(C.objects),len(K.objects))
