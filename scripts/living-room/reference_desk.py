C=wipe('desk')
DX,DY,DZ=-.26,1.82,.79
block('desk_slab',(2.58,1.0,.065),(DX,DY,DZ),C,WOOD,lm=True)
for xx in (-1.46,.94):
    for yy in (1.43,2.21):block('desk_leg',(.045,.045,.74),(xx,yy,.37),C,INK)
rod('desk_brace',(-1.43,2.2,.12),(.95,2.2,.12),.015,C)
# Right-hand chest of drawers and the workstation tower.
block('drawer_case',(.47,.75,.70),(.73,1.83,.35),C,INK)
for i in range(4):
    z=.10+i*.162;block('drawer_front',(.435,.028,.145),(.73,1.438,z),C,STEEL)
    block('drawer_recess',(.13,.01,.022),(.73,1.419,z+.035),C,BLACK,bevel=.006)
block('workstation',(.32,.68,.64),(.25,1.85,.34),C,TRIM)
block('workstation_glass',(.004,.51,.52),(.414,1.83,.36),C,mat('pc_tinted_glass','#141f35',.15,.5))
GLOW=mat('status_blue','#307cff',.3,emit='#226dff',strength=3)
for z in (.48,.52,.56):block('dyn_pc_status',(.01,.006,.012),(.33,1.505,z),C,GLOW,bevel=.002)
block('dyn_pc_line',(.006,.005,.51),(.385,1.504,.34),C,GLOW,bevel=.001)


def display(name,kind,x,y,z,w,h):
    block(name+'_bezel',(w+.045,.045,h+.045),(x,y,z),C,INK,bevel=.015)
    block(name+'_back',(w*.75,.055,h*.7),(x,y+.04,z),C,BLACK,bevel=.035)
    art('dyn_'+name+'_screen',kind,w,h,(x,y-.024,z),C,emission=2.5)
    if kind=='paint':art('dyn_'+name+'_illustration','comic',w*.53,h*.52,(x+w*.015,y-.025,z+h*.12),C,emission=2.5)
    block(name+'_logo',(.035,.001,.005),(x,y-.026,z-h/2-.014),C,STEEL,bevel=0)
    rod(name+'_mount',(x,y+.08,DZ+.04),(x,y+.08,z),.024,C)
    block(name+'_foot',(.27,.19,.025),(x,y,DZ+.045),C,INK,bevel=.025)


display('monitor','paint',.25,2.08,1.36,1.03,.61)
display('monitor2','timeline',-.74,2.12,1.51,.45,.94)
# The portrait monitor has an illustration preview in its lower pane.
art('dyn_portrait_preview','comic',.42,.27,(-.74,2.093,1.2),C,emission=1.9)
for xx in (-.12,.62):
    block('camera_body',(.13,.065,.09),(xx,2.08,1.73),C,STEEL)
    cyl('camera_lens',.034,.045,(xx,2.025,1.73),C,BLACK,rot=(R90,0,0),verts=24)
    cyl('lens_glass',.024,.002,(xx,2.0,1.73),C,mat('lens_blue','#273e65',.1,.5),rot=(R90,0,0))
sphere('webcam',.043,(-.74,2.11,2.05),C,WHITE,seg=24)
cyl('webcam_eye',.022,.01,(-.74,2.07,2.05),C,BLACK,rot=(R90,0,0))
# Pen display tilted toward the chair; all pen buttons and ports are physical geometry.
tablet=block('pen_display',(1.16,.69,.055),(-.20,1.51,.95),C,INK,rot=(math.radians(24),0,0),bevel=.035)
screen=art('dyn_pen_display','paint',1.04,.56,(-.20,1.495,.982),C,rot=(math.radians(24),0,0),emission=2.0)
art('dyn_pen_illustration','comic',.55,.30,(-.184,1.554,1.011),C,rot=(math.radians(24),0,0),emission=2.0)
for i in range(6):
    sphere('tablet_button',.011,(-.747,1.34+i*.066,.92+i*.029),C,STEEL,scale=(1,1,.5),seg=12)
rod('stylus',(.40,1.30,.865),(.52,1.56,.99),.006,C,BLACK)
block('keyboard',(.82,.22,.025),(.22,1.91,.85),C,INK,bevel=.012)
KEYS=mat('keyboard_keys','#303747',.45)
for row in range(5):
    for col in range(17):
        if row==4 and 5<col<10:continue
        block('keycap',(.036 if not(row==4 and col==5) else .22,.031,.012),(-.17+col*.047,1.82+row*.039,.871),C,KEYS,bevel=.003)
        block('key_legend',(.013,.003,.001),(-.17+col*.047,1.82+row*.039,.878),C,PALETTE[0],bevel=0)
soft_box('mouse',(.10,.16,.057),(.47,1.38,.851),C,BLACK,cuts=4,levels=1,puff=.18)
block('mousepad',(.31,.30,.006),(.49,1.36,.829),C,NAVY,bevel=.025)
tube('mouse_cable',[(.47,1.46,.87),(.62,1.58,.84),(.64,1.95,.84),(.48,2.25,.84)],.003,C,BLACK)
# Phone on a tilted stand, interface, remote and programmable macro pad.
block('phone_stand',(.13,.12,.10),(.91,1.66,.86),C,STEEL)
block('phone',(.105,.018,.215),(.91,1.69,1.04),C,BLACK,rot=(math.radians(-12),0,0),bevel=.012)
art('dyn_phone','timeline',.09,.185,(.91,1.675,1.04),C,rot=(math.radians(78),0,0),emission=1.6)
block('macro_pad',(.19,.18,.026),(.81,1.39,.84),C,STEEL,rot=(0,0,-.12),bevel=.012)
for i in range(3):
    for j in range(3):block('macro_key',(.039,.036,.01),(.75+i*.047,1.34+j*.047,.86),C,PALETTE[(i+j)%3],bevel=.007)
block('remote',(.065,.19,.016),(.59,1.38,.846),C,WHITE,bevel=.016)
for j in range(6):block('remote_key',(.02,.015,.003),(.59,1.32+j*.022,.857),C,INK,bevel=.003)
block('audio_interface',(.22,.15,.055),(-1.20,1.77,.85),C,STEEL)
for xx in (-1.27,-1.19,-1.12):cyl('audio_knob',.013,.015,(xx,1.69,.86),C,BLACK,rot=(R90,0,0))
mug('steel_cup',(-1.10,1.48,.83),C,'#9ca3b5',.045)
# Microphone arm, spring rods, capsule grille and the cable running along it.
rod('mic_clamp',(.98,2.13,.82),(.98,2.13,1.14),.018,C,INK)
arm=[(.98,2.13,1.10),(1.12,2.08,1.50),(.76,2.01,1.78),(.54,1.86,1.58)]
for a,b in zip(arm,arm[1:]):
    rod('mic_arm',a,b,.013,C,INK)
    rod('mic_tension',Vector(a)+Vector((.035,0,0)),Vector(b)+Vector((.035,0,0)),.004,C,STEEL)
for p in arm:sphere('mic_pivot',.028,p,C,INK,seg=16)
cyl('microphone',.034,.15,arm[-1],C,STEEL,rot=(math.radians(20),0,0),verts=24)
for j in range(8):
    tube('mic_grille',[(.54+.035*math.cos(t),1.86+.035*math.sin(t),1.52+j*.014) for t in np.linspace(0,math.tau,25)],.0014,C,BLACK,cyclic=True,kind='POLY',bevel_res=1)
tube('mic_lead',[(*p,) for p in arm]+[(.95,2.23,.75),(.5,2.24,.27),(.23,2.05,.2)],.003,C,BLACK)
for k in range(6):tube('desk_cable',[(-.6+k*.17,2.16,1.24),(-.6+k*.17,2.25,.73),(-.42+k*.18,2.30,.24),(.2,2.14,.12)],.003,C,BLACK)
block('power_strip',(.37,.055,.04),(-.71,2.24,.16),C,WHITE)
for i in range(5):block('power_socket',(.028,.03,.005),(-.85+i*.07,2.24,.185),C,BLACK,bevel=.003)
# Ergonomic chair, caster forks, gas lift, padded seat, armrests and draped sweatshirt.
cx,cy=-.48,.66
cyl('chair_gaslift',.035,.41,(cx,cy,.29),C,STEEL)
for i in range(5):
    a=i*math.tau/5
    p=(cx+.32*math.cos(a),cy+.32*math.sin(a),.095)
    rod('chair_spoke',(cx,cy,.15),p,.017,C,INK)
    for off in (-.018,.018):cyl('caster',.043,.027,(p[0]+off,p[1],.06),C,BLACK,rot=(0,R90,0),verts=16)
soft_box('chair_seat',(.56,.52,.11),(cx,cy,.51),C,NAVY,cuts=5,levels=1)
soft_box('chair_back',(.54,.14,.64),(cx,cy-.22,.85),C,INK,rot=(math.radians(-8),0,0),cuts=6,levels=1)
for s in (-1,1):
    rod('armrest_support',(cx+s*.32,cy,.45),(cx+s*.32,cy,.70),.017,C,INK)
    block('chair_armrest',(.075,.30,.037),(cx+s*.32,cy,.72),C,BLACK,bevel=.018)
JACKET=mat('sweatshirt','#202942',.98);surface(JACKET,(90,90,100),.13,.2)
soft_box('hoodie_body',(.53,.16,.72),(cx,cy-.32,.80),C,JACKET,cuts=7,levels=1,puff=.13,noise=.07)
for s in (-1,1):
    soft_box('hoodie_sleeve',(.16,.18,.61),(cx+s*.29,cy-.27,.76),C,JACKET,rot=(0,s*-.14,0),cuts=6,levels=1,noise=.08)
soft_box('hood',(.29,.23,.21),(cx,cy-.24,1.19),C,JACKET,cuts=6,levels=1,puff=.4)
for a in range(6):
    angle=a*math.tau/6
    rod('embroidered_snowflake',(cx,cy-.411,.88),(cx+.073*math.sin(angle),cy-.411,.88+.073*math.cos(angle)),.003,C,PAPER)
print('reference desk ready',len(C.objects))
