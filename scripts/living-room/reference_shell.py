C=wipe('shell')
M_WALL=mat('midnight_wall','#4b5269',.92)
surface(M_WALL,(95,95,95),.12,.07)
TRIM=mat('dark_trim','#111522',.52)
block('floor_base',(6.15,5.55,.16),(0,0,-.12),C,TRIM,bevel=.025)
VARNISH=mat('floor_clear_finish','#18233e',.22,.45,alpha=.13)
block('pbr_floor_finish',(6,5.40,.001),(0,0,-.003),C,VARNISH,bevel=0)
# Narrow, staggered boards catch the monitor reflection without reading as a checkerboard.
for row in range(29):
    y=-2.66+row*.188
    x=-3
    length=.35+(row%4)*.31
    while x<2.999:
        end=min(3,x+length)
        block('walnut_board',(end-x-.006,.182,.035),((x+end)/2,y,-.022),C,WOOD,bevel=.002,lm=True)
        x=end;length=1.15+RNG.random()*.7
block('left_wall',(.13,5.5,2.9),(-3.065,0,1.45),C,M_WALL,lm=True)
block('back_wall',(6.15,.13,2.9),(0,2.765,1.45),C,M_WALL,lm=True)
for size,loc in [((.07,5.4,.12),(-2.99,0,.06)),((6,.07,.12),(0,2.69,.06)),((.07,5.4,.12),(2.99,0,.06))]:
    block('wall_edge',size,loc,C,TRIM)
# The room is seen from inside, at eye height (src/living-room/index.ts VIEW): it has its right
# wall and its ceiling. Both are single sheets on the room's inner faces, a hair inside the box of
# the other baked surfaces: the page measures the room by that box (the live stage hangs its light
# on it, enclose.ts puts its own unlit wall and ceiling just outside it, now out of sight).
def sheet(name,corners,material):
    bm=bmesh.new();bm.faces.new([bm.verts.new(p) for p in corners])
    # (Cut up so the baked light has texels to vary over and the vertex tools have vertices.)
    bmesh.ops.subdivide_edges(bm,edges=bm.edges[:],cuts=7,use_grid_fill=True)
    o=bm_object(name,bm,material,C,smooth=False);o['lm']=1
    return o
sheet('right_wall',[(2.999,-2.7,0),(2.999,2.7,0),(2.999,2.7,2.895),(2.999,-2.7,2.895)],M_WALL)
M_CEIL=mat('ceiling_paint','#565c70',.95);surface(M_CEIL,(60,60,60),.08,.05)
sheet('ceiling',[(-3,-2.7,2.895),(-3,2.7,2.895),(2.999,2.7,2.895),(2.999,-2.7,2.895)],M_CEIL)
# The ceiling lamp is off: the room is lit by its screens.
cyl('ceiling_lamp_base',.20,.035,(-.2,-.3,2.875),C,WHITE,verts=40)
lathe('ceiling_lamp_shade',[(.31,0),(.30,-.045),(.24,-.085),(.12,-.105),(0,-.11)],(-.2,-.3,2.86),C,mat('lamp_glass_off','#9aa0b4',.35),steps=40)
# Door on the near left wall; inset panels, hinge barrels and a working-sized handle.
block('door_frame',(.09,.99,2.24),(-2.982,-2.05,1.12),C,mat('door_frame','#8590a8',.6))
block('door',(.10,.88,2.14),(-2.93,-2.05,1.08),C,mat('door_blue','#3c465c',.75),lm=True)
for z,h in [(.6,.77),(1.55,.8)]:block('door_panel',(.014,.72,h),(-2.873,-2.05,z),C,TRIM,bevel=.008)
for z in (.35,1.9):cyl('hinge',.014,.13,(-2.87,-2.45,z),C,STEEL)
rod('door_handle',(-2.84,-1.73,1.01),(-2.84,-1.88,1.01),.012,C,STEEL)
for z in (.56,.95,1.4):
    art('door_postcard','sunset',.23,.18,(-2.859,-2.13,z),C,rot=(R90,0,R90))
    block('postcard_tape',(.005,.06,.023),(-2.85,-2.13,z+.095),C,PALETTE[5],bevel=0)
# Heavy pleated curtains cover the rear window completely, as in the reference.
MC=mat('curtain_midnight','#1a2340',.96);surface(MC,(180,12,120),.2,.17)
for panel in range(2):
    bm=bmesh.new();rows=[]
    for j in range(41):
        t=j/40;row=[]
        for i in range(57):
            u=i/56;x=-1.33+panel*1.12+u*1.12
            row.append(bm.verts.new((x,2.57-.065*math.cos(u*math.pi*14)*(1+.25*t),2.72-t*2.05+.012*math.cos(u*30)*t)))
        rows.append(row)
    for j in range(40):
        for i in range(56):bm.faces.new((rows[j][i],rows[j][i+1],rows[j+1][i+1],rows[j+1][i]))
    o=bm_object('curtain_pleats',bm,MC,C);o['lm']=1
    solid=o.modifiers.new('cloth edge','SOLIDIFY');solid.thickness=.003
rod('curtain_rail',(-1.45,2.53,2.78),(.99,2.53,2.78),.016,C,STEEL)
for i in range(28):
    x=-1.4+i*.086
    tube('curtain_ring',[(x+.022*math.cos(t),2.53,2.76+.027*math.sin(t)) for t in np.linspace(0,math.tau,17)],.004,C,STEEL,cyclic=True,kind='POLY')
block('pelmet',(2.62,.36,.14),(-.23,2.70,2.91),C,TRIM)
block('cove_front_lip',(2.60,.045,.09),(-.22,2.49,2.84),C,TRIM)
# Camera angle is shared with the actual web page, not a render-only composition.
cam=bpy.data.objects.new('camera_main',bpy.data.cameras.new('camera_main'));coll('meta').objects.link(cam)
cam.location=(6.255,-14.145,10.275);target=(-.05,.35,.85)
cam.rotation_euler=(Vector(target)-cam.location).to_track_quat('-Z','Y').to_euler()
cam.data.lens=65;cam.data.sensor_width=36;cam.data.clip_end=80
sc=bpy.context.scene;sc.camera=cam;sc.render.resolution_x=1440;sc.render.resolution_y=1080;sc.render.resolution_percentage=100
sc.world=sc.world or bpy.data.worlds.new('Night');sc.world.use_nodes=True
bg=next(n for n in sc.world.node_tree.nodes if n.type=='BACKGROUND')
bg.inputs['Color'].default_value=srgb('#637eae');bg.inputs['Strength'].default_value=.055
B=wipe('lighting_baffles')
for name,size,loc in [('ceiling',(6.3,5.7,.12),(0,0,3.02)),('front',(6.3,.12,3),(0,-2.86,1.5)),('right',(.12,5.7,3),(3.16,0,1.5))]:
    o=block('bounce_'+name,size,loc,B,M_WALL);o.visible_camera=False
print('reference shell ready')
