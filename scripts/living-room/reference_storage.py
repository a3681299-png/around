C=wipe('left')
# Left-wall shelving is in local coordinates: the fronts look into the room (+X).
def shelf(name,y,width,height,levels):
    x=-2.72
    for yy in (y-width/2,y+width/2):
        for xx in (-2.94,-2.48):block(name+'_upright',(.035,.035,height),(xx,yy,height/2+.06),C,INK)
    block(name+'_back',(.025,width,height),(-2.965,y,height/2+.06),C,TRIM)
    for j in range(levels):
        z=.12+j*(height-.12)/(levels-1)
        block(name+'_shelf',(.49,width+.03,.035),(x,y,z),C,WOOD)
        if j==levels-1:continue
        clear=(height-.12)/(levels-1)-.05
        # A repeated inventory with varied widths and heights, rather than empty shelves.
        if j==0:
            for k in range(max(1,int(width/.34))):
                yy=y-width/2+.19+k*.35
                o=boxfile(name+'_archive',(0,0,0),C,size=(.28,.32,min(.28,clear)),color=INK)
                # Rotate every component of this box as a set.
                for obj in list(C.objects):
                    if obj.name.startswith(name+'_archive') and not obj.get('placed'):
                        p=obj.location.copy();obj.location=(-2.49-p.y,yy+p.x,z+.04+min(.28,clear)/2+p.z);obj.rotation_euler.z=R90;obj['placed']=True
        elif name=='rear_binders' and j in (1,2):
            for k in range(3):
                yy=y-width/2+.17+k*.30
                block('blue_drawer_bin',(.36,.275,clear*.83),(-2.67,yy,z+.025+clear*.415),C,BLUE)
                block('bin_lip',(.025,.285,.025),(-2.475,yy,z+.04+clear*.83),C,PALETTE[0])
                block('bin_handle',(.009,.09,.025),(-2.455,yy,z+.05+clear*.42),C,INK)
        else:
            yy=y-width/2+.04;k=0
            while yy<y+width/2-.06:
                w=RNG.uniform(.055,.071) if name=='rear_binders' else RNG.uniform(.022,.052)
                h=clear*.94 if name=='rear_binders' else RNG.uniform(clear*.65,clear*.94)
                m=RNG.choice([PALETTE[0],PALETTE[1],WHITE]) if name=='rear_binders' else RNG.choice(PALETTE)
                block(name+'_book',(.23,w,h),(-2.66,yy+w/2,z+.02+h/2),C,m,bevel=.001)
                # Visible title bands, publisher tab and punched binder ring.
                for dz in (.18,.72):block(name+'_spine_label',(.002,w*.72,.016),(-2.541,yy+w/2,z+.02+h*dz),C,PAPER,bevel=0)
                if k%4==0:sphere(name+'_binder_hole',.009,(-2.536,yy+w/2,z+.065),C,BLACK,scale=(.25,1,1),seg=12)
                yy+=w+.006;k+=1
    return height+.06
shelf('near_bookcase',-.30,2.42,1.53,5)
shelf('rear_binders',1.42,.96,2.05,6)
for y,z in [(-1.13,1.73),(-.52,1.72),(.05,1.73),(.67,2.24),(1.35,2.24)]:
    for k in range(2):
        block('shelf_storage_box',(.35,.31,.15),(-2.72,y,z+k*.155),C,INK)
        block('storage_box_label',(.002,.11,.035),(-2.542,y,z+k*.155),C,PALETTE[k])
# Tall cabinet to the left of the displays, with books, figures, drawers and task lights.
x,y=-1.95,2.35
for dx in (-.45,.45):block('tall_case_side',(.035,.47,2.45),(x+dx,y,1.245),C,INK)
block('tall_case_back',(.9,.025,2.45),(x,y+.23,1.245),C,TRIM)
for z in (.06,.54,1.02,1.52,2.02,2.5):block('tall_shelf',(.94,.5,.032),(x,y,z),C,WOOD)
for level,z in enumerate((.07,.55,1.53,2.03)):
    for i in range(12):book('tall_book',(x-.39+i*.063,y-.04,z+.16),C,size=(.042,.27,.24+(i%4)*.035))
for k in range(4):
    block('organizer_drawer',(.38,.42,.12),(-2.01,2.28,.18+k*.13),C,PALETTE[3])
    block('drawer_pull',(.14,.025,.018),(-2.01,2.055,.18+k*.13),C,STEEL)
for xx in (x-.24,x+.18):
    m=mat('wood_mannequin','#9e9a99',.62)
    sphere('mannequin_head',.045,(xx,2.27,1.41),C,m,scale=(.8,.85,1.2))
    sphere('mannequin_torso',.07,(xx,2.27,1.28),C,m,scale=(.65,.4,1.3))
    for s in (-1,1):
        rod('mannequin_upperarm',(xx+s*.05,2.27,1.34),(xx+s*.075,2.25,1.23),.014,C,m)
        rod('mannequin_forearm',(xx+s*.075,2.25,1.23),(xx+s*.065,2.23,1.13),.012,C,m)
        rod('mannequin_thigh',(xx+s*.028,2.27,1.2),(xx+s*.03,2.27,1.1),.018,C,m)
        rod('mannequin_shin',(xx+s*.03,2.27,1.1),(xx+s*.035,2.24,1.035),.012,C,m)
for xx in (-2.25,-1.95):boxfile('collector_box',(xx,2.35,2.63),C,size=(.22,.25,.24),color=PALETTE[1])
# Framed art, a technical print, postcards and the pinned door tote.
for i,(yy,z,w,h,kind) in enumerate([(-1.77,2.42,.66,.48,'portrait'),(-.96,2.32,.33,.43,'sunset'),(-.4,2.32,.32,.4,'sunset'),(.4,2.53,.58,.48,'blueprint')]):
    block('left_frame',(.025,w+.035,h+.035),(-2.978,yy,z),C,INK)
    art('left_print_'+str(i),kind,w,h,(-2.958,yy,z),C,rot=(R90,0,R90))
TOTE=mat('tote_canvas','#aaa6b7',.95)
soft_box('hanging_tote',(.12,.38,.46),(-2.77,-1.65,1.05),C,TOTE,cuts=5,levels=1,puff=.1,noise=.04)
for xx in (-2.77,-2.72):tube('tote_handles',[(xx,-1.82,1.24),(xx,-1.77,1.55),(xx,-1.53,1.56),(xx,-1.49,1.24)],.009,C,TOTE)
soft_box('hanging_cap',(.18,.22,.16),(-2.72,-2.23,1.48),C,NAVY,cuts=4,levels=1)
block('cap_peak',(.20,.25,.017),(-2.64,-2.23,1.45),C,NAVY,bevel=.035)
print('reference storage ready',len(C.objects))
