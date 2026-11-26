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
# The long metal shelf by the door and the tall dark bookcase left of the desk are the user's
# models (reference_models.py: tex_storage, tex_dark_shelf). The binder shelf fills the wall
# between them.
shelf('rear_binders',1.42,.96,2.05,6)
for y,z in [(1.35,2.24)]:
    for k in range(2):
        block('shelf_storage_box',(.35,.31,.15),(-2.72,y,z+k*.155),C,INK)
        block('storage_box_label',(.002,.11,.035),(-2.542,y,z+k*.155),C,PALETTE[k])
# Framed art, postcards and the pinned door tote; the technical print above the metal shelf
# comes with tex_storage.
for i,(yy,z,w,h,kind) in enumerate([(-1.77,2.42,.66,.48,'portrait'),(-1.10,2.40,.33,.43,'sunset'),(.55,2.45,.50,.42,'blueprint')]):
    block('left_frame',(.025,w+.035,h+.035),(-2.978,yy,z),C,INK)
    art('left_print_'+str(i),kind,w,h,(-2.958,yy,z),C,rot=(R90,0,R90))
# The tote hangs from the end of tex_storage.
soft_box('hanging_cap',(.18,.22,.16),(-2.72,-2.23,1.48),C,NAVY,cuts=4,levels=1)
block('cap_peak',(.20,.25,.017),(-2.64,-2.23,1.45),C,NAVY,bevel=.035)
print('reference storage ready',len(C.objects))
