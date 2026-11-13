# What makes the room an internet otaku's den, around the user's models: a sofa at the foot of
# the bed facing an old television and its console, a record corner, figures on wall shelves,
# posters and record sleeves over the walls, and the cans, cup noodles, cables and manga of
# someone who lives at the screen. Nothing here lights the room but the television's screen
# (the user's decision: the screens are the room's light). All of it is made
# here (no outside models); the pictures are the room's own atlas and drawn covers.
C=wipe('otaku')
R180=math.pi

# --- the sofa, at the foot of the bed, looking toward the television in the near right ---
SX,SY=2.08,.27
OLIVE=mat('sofa_olive','#5d6b3e',.97);surface(OLIVE,(120,120,120),.2,.16)
block('sofa_base',(1.74,.80,.20),(SX,SY,.20),C,mat('sofa_base_dark','#2c3222',.9),bevel=.03,lm=True)
for x in (SX-.80,SX+.80):
    for y in (SY-.33,SY+.33):cyl('sofa_leg',.022,.10,(x,y,.05),C,WOOD,verts=12)
for i,x in enumerate((SX-.37,SX+.37)):
    o=soft_box('sofa_seat',(.72,.66,.19),(x,SY-.05,.40),C,OLIVE,cuts=6,levels=1,puff=.22,seed=i);o['lm']=1
    o=soft_box('sofa_back',(.72,.22,.50),(x,SY+.30,.66),C,OLIVE,rot=(-.14,0,0),cuts=6,levels=1,puff=.3,seed=i+3);o['lm']=1
for x in (SX-.82,SX+.82):
    o=soft_box('sofa_arm',(.18,.80,.40),(x,SY,.44),C,OLIVE,cuts=5,levels=1,puff=.25);o['lm']=1
soft_box('sofa_cushion_mustard',(.40,.14,.38),(SX-.52,SY+.10,.66),C,mat('cushion_mustard','#c79a3a',.96),rot=(-.35,0,.25),cuts=6,levels=1,puff=.5,pinch=.4)
soft_box('sofa_cushion_plum',(.38,.13,.36),(SX+.56,SY+.12,.65),C,mat('cushion_plum','#6a3c6e',.96),rot=(-.3,0,-.2),cuts=6,levels=1,puff=.5,pinch=.4)
plush('sofa_plush',(SX+.20,SY+.02,.49),C,1.05)


# --- the old television and the console in the near left corner, turned to the rug ---
# Built about its own origin (the board's middle, the screen looking +Y), then turned as one.
TV_AT,TV_TURN=(-1.98,-2.26),math.radians(-28)
TV_POSE=Matrix.Translation((TV_AT[0],TV_AT[1],0))@Matrix.Rotation(TV_TURN,4,'Z')
TX,TY=0,0
_before=set(C.objects)
TV_WOOD=mat('tv_board_wood','#4a372e',.5);surface(TV_WOOD,(3,90,12),.12,.4)
block('tv_board',(1.00,.42,.035),(TX,TY,.335),C,TV_WOOD,bevel=.004,lm=True)
block('tv_board_foot',(1.00,.42,.035),(TX,TY,.03),C,TV_WOOD,bevel=.004)
for x in (TX-.48,TX,TX+.48):block('tv_board_side',(.03,.40,.29),(x,TY,.18),C,TV_WOOD,bevel=.003)
block('tv_board_back',(.98,.012,.29),(TX,TY-.20,.18),C,TRIM,bevel=0)
CRT=mat('crt_plastic','#8d8a80',.55)
block('crt_body',(.58,.34,.47),(TX-.14,TY+.07,.59),C,CRT,bevel=.03,lm=True)
block('crt_tube_housing',(.42,.24,.36),(TX-.14,TY-.17,.57),C,CRT,bevel=.05)
for i in range(7):block('crt_vent',(.30,.004,.008),(TX-.14,TY-.292,.50+i*.022),C,BLACK,bevel=0)
block('crt_bezel',(.50,.012,.39),(TX-.14,TY+.244,.60),C,BLACK,bevel=.01)
art('dyn_tv_screen','game',.43,.325,(TX-.14,TY+.252,.615),C,rot=(R90,0,R180),emission=1.5)
for i in range(3):cyl('crt_knob',.011,.01,(TX-.30+i*.035,TY+.25,.425),C,STEEL,rot=(R90,0,0),verts=12)
sphere('dyn_tv_power',.006,(TX+.07,TY+.252,.425),C,mat('tv_power_led','#ff4a3a',emit='#ff3a2a',strength=4),seg=8)
# The console on the board beside it, a cartridge standing in it, games stacked on the shelf.
CONSOLE=mat('console_grey','#8f93a6',.5)
block('game_console',(.27,.20,.055),(TX+.31,TY+.04,.38),C,CONSOLE,bevel=.012)
block('console_cartridge',(.11,.02,.07),(TX+.31,TY+.05,.44),C,mat('cartridge','#c9a53c',.5),bevel=.004)
sphere('dyn_console_led',.005,(TX+.21,TY+.142,.385),C,mat('console_led','#5dff8a',emit='#4dff7a',strength=4),seg=8)
for i in range(9):
    block('game_case',(.135,.19,.016),(TX+.24,TY+.02,.056+i*.017),C,PALETTE[(i*4)%9],rot=(0,0,RNG.uniform(-.15,.15)),bevel=.002)
for i in range(11):
    block('vhs_tape',(.026,.19,.105+(i%3)*.012),(TX-.42+i*.03,TY+.03,.105),C,PALETTE[(i*2+1)%9],bevel=.002)
_pose=bpy.data.objects.new('tv_pose',None);C.objects.link(_pose);_pose.matrix_world=TV_POSE
for o in set(C.objects)-_before-{_pose}:o.parent=_pose
def tv_point(x,y,z):
    """A point given in the television's own frame, in the room."""
    return tuple(TV_POSE@Vector((x,y,z)))


def controller(name,x,y,z,angle,plug):
    """A gamepad: two grips, a pad, four buttons, and its lead back to the console."""
    m=mat('gamepad_grey','#a9adbd',.5)
    p=bpy.data.objects.new(name+'_pose',None);C.objects.link(p)
    parts=[block(name+'_body',(.15,.065,.026),(0,0,.013),C,m,bevel=.012)]
    for s in (-1,1):
        parts.append(sphere(name+'_grip',.03,(s*.062,-.018,.013),C,m,scale=(1,1.25,.5),seg=12))
    parts.append(block(name+'_pad',(.03,.01,.006),(-.045,.008,.028),C,BLACK,bevel=0))
    parts.append(block(name+'_pad',(.01,.03,.006),(-.045,.008,.028),C,BLACK,bevel=0))
    for i,(bx,by) in enumerate([(.035,.008),(.055,.02),(.055,-.004),(.075,.008)]):
        parts.append(cyl(name+'_button',.007,.006,(bx,by,.028),C,PALETTE[4] if i%2 else PALETTE[5],verts=10,bevel=0))
    for o in parts:o.parent=p
    p.location=(x,y,z);p.rotation_euler=(0,0,angle)
    mid=((x+plug[0])/2+RNG.uniform(-.2,.2),(y+plug[1])/2+RNG.uniform(-.15,.15),.012)
    tube(name+'_lead',[(x+.03*math.sin(angle),y+.03*math.cos(angle),z+.012),(x+.2*math.sin(angle),y+.2*math.cos(angle),.012),mid,(plug[0],plug[1]+.05,.012),plug],.0035,C,BLACK)


PLUG=tv_point(.31,.15,.37)
controller('gamepad_floor',-1.02,-1.18,.024,2.6,PLUG)
controller('gamepad_floor2',-1.38,-1.74,.024,.4,PLUG)

# --- the record corner: a turntable on a crate, a crate of sleeves beside it ---
CRATE=mat('crate_pine','#8a6a4c',.7);surface(CRATE,(4,60,10),.12,.3)


def crate(name,x,y,w=.36,d=.40,h=.30):
    block(name+'_floor',(w,d,.015),(x,y,.0125),C,CRATE,bevel=.002)
    for k in range(3):
        z=.055+k*(h-.07)/2
        for yy in (y-d/2,y+d/2):block(name+'_slat',(w,.014,.06),(x,yy,z),C,CRATE,bevel=.003)
        for xx in (x-w/2,x+w/2):block(name+'_slat',(.014,d,.06),(xx,y,z),C,CRATE,bevel=.003)
    for xx in (x-w/2+.012,x+w/2-.012):
        for yy in (y-d/2+.012,y+d/2-.012):block(name+'_post',(.022,.022,h),(xx,yy,h/2),C,CRATE,bevel=.002)


def sleeves(name,x,y,z,count,along='y',lean=.08):
    """Record sleeves on edge, each a different drawn cover, a little out of line."""
    for i in range(count):
        t=(i-(count-1)/2)*.012
        loc=(x,y+t,z+.158) if along=='y' else (x+t,y,z+.158)
        rot=(R90+RNG.uniform(-lean,lean),0,0) if along=='y' else (R90,0,R90+RNG.uniform(-lean,lean))
        art(name+'_'+str(i),'album'+str((i*3+len(name))%10),.31,.31,loc,C,rot=rot)


# In the near right corner, under the sleeves on the wall, by the amplifier and the guitar.
DX,DY=2.70,-2.36
crate('crate_a',DX,DY)
sleeves('crate_a_sleeves',DX,DY,.02,22)
crate('crate_b',DX-.46,DY-.04,h=.30)
sleeves('crate_b_sleeves',DX-.46,DY-.04,.02,15,lean=.16)
# The turntable sits across the first crate.
DECK=mat('deck_black','#1b1c22',.4)
block('deck_plinth',(.44,.36,.055),(DX,DY,.345),C,DECK,bevel=.01)
cyl('deck_platter',.150,.016,(DX-.04,DY,.38),C,STEEL,verts=40)
cyl('deck_record',.146,.004,(DX-.04,DY,.39),C,mat('vinyl','#0c0c10',.25),verts=40,bevel=0)
cyl('deck_label',.048,.002,(DX-.04,DY,.393),C,PALETTE[4],verts=24,bevel=0)
cyl('deck_spindle',.004,.016,(DX-.04,DY,.40),C,STEEL,verts=8,bevel=0)
cyl('deck_arm_pivot',.018,.04,(DX+.16,DY+.13,.39),C,STEEL,verts=16)
rod('deck_arm',(DX+.16,DY+.13,.415),(DX+.04,DY-.06,.405),.004,C,STEEL)
block('deck_headshell',(.022,.034,.012),(DX+.035,DY-.07,.40),C,BLACK,rot=(0,0,.55),bevel=.002)
for i in range(2):cyl('deck_knob',.013,.014,(DX-.175+i*.04,DY-.14,.378),C,STEEL,verts=12)
art('leaning_sleeve','album7',.31,.31,(DX-.50,DY+.26,.17),C,rot=(R90-.2,0,R180+.25))

# --- figures and manga on two shelves over the bed, on the right wall ---
SHELF=mat('wall_shelf_white','#b9bfd0',.5)


def figure(name,x,y,z,hair,dress,face=-R90,scale=1.0):
    """A small scale figure on a round base: skirt, torso, head, hair with two tails."""
    s=scale;skin=mat('figure_skin','#f1d3c5',.6);h=mat(name+'_hair',hair,.45);d=mat(name+'_dress',dress,.5)
    p=bpy.data.objects.new(name+'_pose',None);C.objects.link(p)
    parts=[cyl(name+'_base',.034*s,.006,(0,0,.003),C,BLACK,verts=20,bevel=0),
           lathe(name+'_legs',[(.008*s,0),(.011*s,.04*s),(.012*s,.05*s)],(0,0,.006),C,skin,steps=10),
           lathe(name+'_dress',[(.032*s,.045*s),(.026*s,.06*s),(.014*s,.085*s),(.016*s,.10*s),(.011*s,.112*s),(0,.115*s)],(0,0,.006),C,d,steps=14),
           sphere(name+'_head',.020*s,(0,0,.006+.133*s),C,skin,seg=12),
           sphere(name+'_hair',.0235*s,(0,.004*s,.006+.138*s),C,h,scale=(1,1,.95),seg=12)]
    for side in (-1,1):
        parts.append(sphere(name+'_tail',.011*s,(side*.026*s,.006*s,.006+.118*s),C,h,scale=(.7,.7,2.0),seg=10))
        parts.append(rod(name+'_arm',(side*.014*s,0,.006+.10*s),(side*.03*s,-.008*s,.006+.07*s),.0035*s,C,skin))
    for o in parts:o.parent=p
    p.location=(x,y,z);p.rotation_euler=(0,0,face)
    return p


HAIR=['#e86a9a','#6fb7e8','#f1d36b','#a98be0','#7fd6b3','#f08c5a','#d9dbe6','#3d3f55']
for k,z in enumerate((1.62,2.02)):
    block('wall_shelf',(.20,1.56,.022),(2.895,1.76,z),C,SHELF,bevel=.004)
    for y in (1.12,2.40):
        block('shelf_bracket',(.16,.018,.018),(2.90,y,z-.02),C,STEEL,bevel=0)
        block('shelf_bracket',(.018,.018,.13),(2.985,y,z-.075),C,STEEL,bevel=0)
for i in range(7):
    figure('figure_'+str(i),2.885+RNG.uniform(-.02,.02),1.08+i*.125,1.631,HAIR[i%8],HAIR[(i+3)%8],face=-R90+RNG.uniform(-.3,.3),scale=RNG.uniform(.95,1.25))
# The far half of the lower shelf: manga standing in a row, a bookend.
y=1.98
while y<2.50:
    w=RNG.uniform(.014,.022);hh=RNG.uniform(.165,.185)
    block('shelf_manga',(.125,w,hh),(2.90,y+w/2,1.631+hh/2),C,RNG.choice(PALETTE),bevel=.001)
    block('shelf_manga_band',(.002,w*.8,.03),(2.837,y+w/2,1.631+hh*.75),C,PAPER,bevel=0)
    y+=w+.002
# The upper shelf: boxed figures (a window box each, a picture on the front), a plush, a robot.
for i,(yy,crop) in enumerate([(1.14,(.64,.55,.90,.87)),(1.40,(.52,.70,.74,1)),(1.66,(.20,.62,.42,.93)),(2.30,(.80,.67,1,1))]):
    block('figure_box',(.14,.21,.27),(2.90,yy,2.166),C,PALETTE[(i*2+1)%9],bevel=.004)
    art('figure_box_front_'+str(i),'crop'+str(i),.17,.23,(2.828,yy,2.166),C,rot=(R90,0,-R90),crop=crop)
plush('shelf_plush',(2.90,1.96,2.033),C,.9)
ROBOT=mat('robot_white','#d8dbe6',.4)
block('robot_body',(.07,.09,.09),(2.90,2.08,2.12),C,ROBOT,bevel=.008)
block('robot_head',(.05,.06,.045),(2.90,2.08,2.19),C,ROBOT,bevel=.008)
for s in (-1,1):
    block('robot_leg',(.03,.03,.06),(2.90,2.08+s*.025,2.06),C,PALETTE[1],bevel=.004)
    block('robot_arm',(.03,.025,.08),(2.90,2.08+s*.062,2.12),C,PALETTE[4],bevel=.004)
sphere('dyn_robot_eye',.008,(2.868,2.08,2.19),C,mat('robot_eye','#7de8ff',emit='#6fe0ff',strength=3),seg=8)

# --- the walls: posters, a tapestry, record sleeves, washi tape ---
TAPE=[mat('washi_'+str(i),c,.8) for i,c in enumerate(('#e7c35a','#e8809c','#7fc8d8'))]


def poster(name,kind,w,h,at,wall,crop=None,tilt=0,frame=False):
    """`wall`: 'back' (looks -Y), 'right' (looks -X), 'left' (looks +X); `at` is along the
    wall and up. A taped sheet, a hair off the wall and a little crooked."""
    a,z=at
    if wall=='back':loc=(a,2.688,z);rot=(R90,tilt,0)
    elif wall=='right':loc=(2.990,a,z);rot=(R90,tilt,-R90)
    else:loc=(-2.990,a,z);rot=(R90,tilt,R90)
    art(name,kind,w,h,loc,C,rot=rot,crop=crop)
    for s in (-1,1):
        d=s*(w/2-.02)
        if wall=='back':block(name+'_tape',(.05,.002,.018),(a+d,2.686,z+h/2-.004),C,RNG.choice(TAPE),bevel=0)
        elif wall=='right':block(name+'_tape',(.002,.05,.018),(2.988,a-d,z+h/2-.004),C,RNG.choice(TAPE),bevel=0)
        else:block(name+'_tape',(.002,.05,.018),(-2.988,a+d,z+h/2-.004),C,RNG.choice(TAPE),bevel=0)


# The right wall, front to back: sleeves in a grid over the record corner, a tall tapestry.
for i in range(4):
    for j in range(3):
        poster('wall_sleeve_%d_%d'%(i,j),'album'+str((i*3+j*5)%10),.30,.30,(-2.50+i*.335,1.43+j*.335),'right',tilt=RNG.uniform(-.02,.02))
poster('tapestry_portrait','portrait',.92,.92,(-.10,2.06),'right')
block('tapestry_rod',(.018,.98,.018),(2.985,-.10,2.53),C,WOOD,bevel=.004)
block('tapestry_rod',(.018,.98,.018),(2.985,-.10,1.59),C,WOOD,bevel=.004)
poster('right_comic_tall','c_red',.46,.56,(.72,2.20),'right',crop=(.64,.55,.90,.87),tilt=.03)
poster('right_sketch','sketch',.40,.40,(.70,1.62),'right',tilt=-.04)
poster('right_headphones','c_phones',.33,.54,(-.98,2.16),'right',crop=(.80,.67,1,1),tilt=.02)
# The left wall, over the long metal shelf: a row of sleeves between the framed prints.
for i in range(5):poster('left_sleeve_'+str(i),'album'+str((i*7+2)%10),.26,.26,(-.62+i*.29,2.56),'left',tilt=RNG.uniform(-.04,.04))
poster('left_cabin','c_cabin',.56,.34,(1.42,2.66),'left',crop=(.02,.02,.40,.25))
# The back wall over the bed: around the wire grid and the prints already there.
poster('back_purple','c_purple',.40,.50,(1.02,2.42),'back',crop=(.50,.70,.74,1),tilt=-.03)
poster('back_face','c_face',.36,.50,(2.50,1.36),'back',crop=(.20,.62,.42,.93),tilt=.04)
for i,(x,z) in enumerate([(2.20,2.56),(2.05,1.60),(1.02,1.84),(1.02,1.50)]):
    poster('back_sleeve_'+str(i),'album'+str(i+4),.28,.28,(x,z),'back',tilt=RNG.uniform(-.05,.05))
# The back wall left of the window, over the dark bookcase; the left wall by the door.
poster('back_left_peak','c_peak',.56,.30,(-2.30,2.62),'back',crop=(.08,.28,.46,.47))

# (No neon, fairy lights, coloured strips or mirror ball: the user wants the screens to be the
# room's light, 2026-11-13.)

# --- the floor of someone who lives at the screen ---
CAN_COLORS=[('#1c1f24','#57e06f'),('#2a4fb4','#e9eef8'),('#e9622a','#f6e7c8'),('#c9ccd6','#d5324a'),('#141518','#f2c230')]


def can(name,x,y,z=0,k=0,lying=None):
    body,band=CAN_COLORS[k%len(CAN_COLORS)]
    p=bpy.data.objects.new(name+'_pose',None);C.objects.link(p)
    parts=[cyl(name,.0325,.118,(0,0,.059),C,mat('can_'+str(k%5),body,.3,.6),verts=18,bevel=.004),
           cyl(name+'_band',.0332,.04,(0,0,.062),C,mat('can_band_'+str(k%5),band,.4),verts=18,bevel=0),
           cyl(name+'_lid',.028,.003,(0,0,.119),C,STEEL,verts=18,bevel=0)]
    for o in parts:o.parent=p
    if lying is None:p.location=(x,y,z)
    else:p.location=(x,y,z+.033);p.rotation_euler=(R90,0,lying)
    return p


def cup_noodle(name,x,y,z=0):
    lathe(name,[(0,0),(.036,0),(.048,.10),(.052,.104),(.05,.108),(.044,.104),(.034,.006),(0,.006)],(x,y,z),C,WHITE,steps=20)
    cyl(name+'_band',.0445,.035,(x,y,z+.055),C,PALETTE[4],verts=20,bevel=0)
    for dx in (-.008,.008):rod(name+'_chopstick',(x+dx-.03,y-.05,z+.105),(x+dx+.05,y+.09,z+.118),.0025,C,WOOD)


def bottle(name,x,y,z=0,color='#9fc4ea',lying=None):
    p=bpy.data.objects.new(name+'_pose',None);C.objects.link(p)
    parts=[lathe(name,[(0,0),(.03,0),(.033,.02),(.033,.15),(.028,.175),(.013,.195),(.013,.215),(0,.215)],(0,0,0),C,mat('pet_'+color[1:],color,.15),steps=16),
           cyl(name+'_label',.0335,.05,(0,0,.10),C,PAPER,verts=16,bevel=0),
           cyl(name+'_cap',.015,.016,(0,0,.218),C,WHITE,verts=12,bevel=.002)]
    for o in parts:o.parent=p
    if lying is None:p.location=(x,y,z)
    else:p.location=(x,y,z+.034);p.rotation_euler=(R90,0,lying)


# Round the chair and under the desk's edge.
for i,(x,y,lying) in enumerate([(-1.18,1.52,None),(-1.27,1.47,None),(-1.21,1.40,2.2),(.28,1.42,None),(.20,1.36,None),
                                (-.92,.52,.7),(.12,.86,None),
                                # by the sofa and the television
                                (1.14,-.06,None),(1.20,-.16,1.1),(2.33,-2.02,None),(1.02,-2.20,None),(.95,-2.32,2.9),
                                # on the rug, round the low table
                                (-.05,-2.10,None),(-1.72,-1.36,.4),(-.6,-.55,None)]):
    can('floor_can_'+str(i),x,y,(.024 if abs(x+.35)<1.5 and -2.45<y<-.05 else 0),i,lying)
cup_noodle('cup_noodle_a',-1.05,1.46)
cup_noodle('cup_noodle_b',1.10,-.42)
bottle('bottle_a',.33,1.50,color='#a9d2c9')
bottle('bottle_b',-.72,.62,lying=.5)
bottle('bottle_c',1.30,-1.02,.0,'#cfd7ee')
bottle('bottle_d',2.62,-1.86,0,'#a9d2c9',lying=1.9)
# cans and a figure on the television; a tissue box and a shop bag on the floor
can('tv_can',*tv_point(-.33,.06,.825),2)
figure('tv_figure',*tv_point(-.02,.10,.825),HAIR[1],HAIR[6],face=TV_TURN,scale=1.3)
CARD=mat('cardboard','#a98860',.9);surface(CARD,(40,40,40),.1,.12)
block('pizza_box',(.38,.38,.045),(1.42,-.52,.0225),C,CARD,rot=(0,0,.4),bevel=.004)
cyl('pizza_box_stamp',.09,.002,(1.42,-.52,.046),C,PALETTE[4],verts=24,bevel=0)
block('tissue_box',(.24,.12,.07),(-.86,-.20,.059),C,PALETTE[0],rot=(0,0,-.5),bevel=.006)
soft_box('tissue_tuft',(.07,.05,.06),(-.86,-.20,.115),C,PAPER,cuts=3,levels=1,puff=.6,noise=.25)
soft_box('shop_bag',(.30,.22,.20),(-1.52,1.30,.10),C,mat('bag_white','#d9dde8',.6),rot=(0,0,.5),cuts=5,levels=1,puff=.5,noise=.12,seed=5,flat_bottom=.6)
# Parcels not yet opened, between the clothes rack and the sofa.
block('parcel_box',(.46,.36,.30),(2.24,-.46,.15),C,CARD,rot=(0,0,-.12),bevel=.006)
block('parcel_tape',(.07,.365,.302),(2.24,-.46,.15),C,mat('parcel_tape','#c9b98f',.5),rot=(0,0,-.12),bevel=.002)
block('parcel_box_small',(.30,.24,.18),(2.26,-.45,.39),C,CARD,rot=(0,0,.3),bevel=.006)

# Manga in piles where they were last read.
for sx,sy,z0,count,kinds in [(1.02,-.98,0,5,('comic','album2')),(-.95,-.42,.024,3,('portrait','comic')),
                             (.62,1.20,0,6,('sketch','comic')),(1.78,-1.02,0,4,('album5','sunset')),
                             (-2.18,.18,0,5,('comic','album8'))]:
    for k in range(count):
        flatbook('manga_pile',sx+(RNG.random()-.5)*.05,sy+(RNG.random()-.5)*.05,z0+k*.035,w=.13+.05*(k%2),d=.19+.05*(k%2),angle=RNG.uniform(-.5,.5),kind=kinds[k%2])
flatbook('manga_open_face_down',-.40,.30,0,w=.26,d=.19,angle=.9,kind='comic')

# The power strip by the desk and the leads that wander off from it across the floor.
block('power_strip',(.34,.06,.032),(-1.12,1.66,.016),C,WHITE,rot=(0,0,.2),bevel=.006)
for i in range(4):block('strip_plug',(.035,.04,.03),(-1.23+i*.075,1.64+i*.015,.045),C,BLACK,rot=(0,0,.2),bevel=.004)
sphere('dyn_strip_switch',.007,(-.97,1.69,.034),C,mat('strip_switch','#ff5a3a',emit='#ff3a1a',strength=4),seg=8)
for i,path in enumerate([
        [(-1.25,1.63,.03),(-1.5,1.2,.006),(-1.9,.9,.006),(-2.3,.75,.006),(-2.52,.60,.05)],
        [(-1.0,1.70,.03),(-.6,1.75,.006),(-.3,1.95,.02)],
        [(-1.05,1.60,.03),(-.3,1.30,.006),(.55,1.62,.006),(.60,2.2,.006),(.72,2.45,.20)],
        # to the television in the near left corner, and across the room to the amplifier
        [(-1.15,1.60,.03),(-1.38,.6,.006),(-1.95,-.5,.006),(-1.62,-1.5,.006),tv_point(.56,-.10,.006),tv_point(.30,-.24,.08)],
        [(-.92,1.62,.03),(-.2,.9,.006),(.85,-.25,.006),(1.45,-1.7,.006),(1.72,-2.22,.05)]]):
    tube('floor_lead_'+str(i),path,.0045,C,BLACK)

# On the bed: headphones left where they came off.
headphones('bed_headphones',2.52,1.02,top_at(2.52,1.02)+.13,C)
print('otaku dressing ready',len(C.objects))
