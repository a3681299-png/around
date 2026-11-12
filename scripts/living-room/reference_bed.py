C=wipe('bed')
BX,BY,BW,BL=2.02,1.05,1.45,2.65
BEDWOOD=mat('bed_dark_wood','#302a30',.48)
for x in (BX-.62,BX+.62):
    for y in (BY-1.16,BY+1.16):block('bed_leg',(.075,.075,.26),(x,y,.13),C,BEDWOOD)
block('bed_frame',(BW,BL,.18),(BX,BY,.29),C,BEDWOOD,bevel=.035)
SHEET=mat('sheet_blue_grey','#8d95b2',.95);surface(SHEET,(150,130,90),.18,.12)
DUVET=mat('duvet_navy','#596780',.96);surface(DUVET,(160,130,100),.13,.2)
soft_box('mattress',(1.42,2.58,.24),(BX,BY,.48),C,SHEET,cuts=6,levels=1,puff=.13)
for x in (BX-.37,BX+.37):
    o=soft_box('arched_headboard',(.78,.14,.55),(x,2.42,.77),C,NAVY,cuts=7,levels=2,puff=.5)
    o['lm']=1
PILLOW=mat('pillow_stripes','#9ea9c7',.96);surface(PILLOW,(140,140,90),.12,.10)
woven_grid(PILLOW,(6,0),'#64728f',.38)
for x in (BX-.36,BX+.35):
    o=soft_box('striped_pillow',(.63,.47,.18),(x,2.0,.70),C,PILLOW,rot=(.16,0,.08),cuts=7,levels=2,puff=.4,pinch=.35,noise=.04);o['lm']=1
soft_box('dark_pillow',(.62,.4,.17),(BX,1.75,.71),C,NAVY,rot=(.15,0,-.1),cuts=7,levels=1,pinch=.3)


def blanket_point(u,v):
    x=BX+u*.88;y=-.41+v*2.14
    # Four broad diagonal folds, local creases and the weight falling over three mattress edges.
    edge=max(0,(abs(u)-.74)/.26)
    foot=max(0,(.12-v)/.12)
    z=.674-.35*edge**1.1-.22*foot
    z+=.014*math.sin(v*19+u*7)+.009*math.sin(v*39-u*13)
    for slope,offset,width,height in [(.28,.21,.065,.065),(-.35,.52,.055,.055),(.42,.77,.055,.065),(-.16,.92,.035,.04)]:
        z+=height*math.exp(-((v-slope*u-offset)/width)**2)*(1-.45*abs(u))
    return (x,y,z)


bm=bmesh.new();rows=[]
for j in range(81):rows.append([bm.verts.new(blanket_point(-1+2*i/60,j/80)) for i in range(61)])
for j in range(80):
    for i in range(60):bm.faces.new((rows[j][i],rows[j][i+1],rows[j+1][i+1],rows[j+1][i]))
o=bm_object('rumpled_duvet',bm,DUVET,C);o['lm']=1
solid=o.modifiers.new('duvet thickness','SOLIDIFY');solid.thickness=.018
# Stitched quilting follows the draped surface instead of lying on an unrelated flat plane.
SEAM=mat('quilt_seam','#626d89',.97)
for u in np.linspace(-.85,.85,8):
    tube('quilt_stitch',[(p[0],p[1],p[2]+.004) for p in [blanket_point(u,v) for v in np.linspace(.1,.94,40)]],.0015,C,SEAM,kind='POLY',bevel_res=1)
# The dark checked throw hangs over the foot of the bed.
THROW=mat('throw_checked','#151d32',.98)
woven_grid(THROW,(22,12),'#5e6d91',.025)
def throwpoint(u,v):
    x=BX+u*.86;y=-.44+v*.91
    # Follow the duvet underneath, with a real gap, so the two fabrics never cut through.
    z=blanket_point(u*.86/.88,(y+.41)/2.14)[2]+.037
    z+=.008*math.sin(u*10+v*7)+.004*math.sin(u*23-v*8)
    return (x,y,z)
bm=bmesh.new();grid=[]
for j in range(31):grid.append([bm.verts.new(throwpoint(-1+i/25,j/30)) for i in range(51)])
for j in range(30):
    for i in range(50):bm.faces.new((grid[j][i],grid[j][i+1],grid[j+1][i+1],grid[j+1][i]))
o=bm_object('checked_throw',bm,THROW,C);o['lm']=1
plush('bed_cat',(2.49,1.75,.76),C,1.25)
block('bed_closed_notebook',(.27,.20,.025),(1.9,.91,.754),C,INK,rot=(0,0,.2),bevel=.004)
rod('bed_pen',(1.80,.84,.781),(2.02,.94,.781),.003,C,PALETTE[3])
# Bedside chest and mushroom lamp: the one small warm pool in the blue room.
NX,NY=1.10,2.03
block('nightstand',(.49,.45,.49),(NX,NY,.29),C,PALETTE[0],bevel=.025)
for z in (.21,.43):
    block('nightstand_drawer',(.45,.025,.19),(NX,NY-.235,z),C,WHITE)
    rod('nightstand_pull',(NX-.04,NY-.256,z),(NX+.04,NY-.256,z),.006,C,STEEL)
cyl('lamp_base',.10,.025,(NX,NY,.55),C,WHITE)
lathe('lamp_stem',[(.07,0),(.066,.07),(.03,.18),(.026,.25)],(NX,NY,.55),C,WHITE)
lathe('lamp_shade',[(.01,.13),(.07,.12),(.12,.08),(.15,.025),(.15,0),(.139,0),(.12,.065),(.06,.108),(.01,.12)],(NX,NY,.77),C,INK)
WARM=mat('lamp_glow','#ffe0a6',.4,emit='#ffd394',strength=5)
sphere('dyn_bedside_bulb',.05,(NX,NY,.77),C,WARM,seg=20).visible_shadow=False
block('digital_clock',(.16,.065,.065),(NX+.11,NY-.15,.58),C,INK,bevel=.008)
label('dyn_clock_digits','01:42',(NX+.11,NY-.185,.563),.027,C,mat('clock_lcd','#a3d8ff',emit='#9bd0ff',strength=1.5))
for x,y in [(NX-.16,NY-.12),(NX+.17,NY+.08)]:
    cyl('lotion_bottle',.023,.12,(x,y,.60),C,WHITE)
    block('lotion_pump',(.04,.012,.009),(x+.01,y,.67),C,INK)
print('reference bed ready')
