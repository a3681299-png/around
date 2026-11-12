# Geometry and illustrated surfaces for the supplied night-studio reference.
# These are authored materials, not crops of the user's reference image.
import numpy as np

for _image_name in ('studio_paint','studio_timeline','studio_blueprint','studio_contour'):
    if bpy.data.images.get(_image_name):bpy.data.images.remove(bpy.data.images[_image_name],do_unlink=True)

R90 = math.pi / 2
RNG = random.Random(118)
INK = mat('graphite', '#171c28', .43, .25)
BLACK = mat('rubber', '#10131d', .76)
STEEL = mat('gunmetal', '#3e485b', .32, .65)
PAPER = mat('paper', '#d6d7df', .94)
WHITE = mat('warm_plastic', '#cbd0dc', .38)
NAVY = mat('navy_fabric', '#202d4e', .94)
BLUE = mat('blue_plastic', '#304f9b', .45)
PALETTE = [mat('book_'+str(i), c, .76) for i,c in enumerate(
    ['#b7c4dd','#344a78','#d5b8ac','#5c6378','#a45561','#c6b987','#dad9d4','#304559','#83638e'])]
WOOD = mat('dark_walnut', '#584338', .32)


def surface(m, scale, detail=.08, contrast=.25):
    nt=m.node_tree
    p=next(n for n in nt.nodes if n.type=='BSDF_PRINCIPLED')
    base=tuple(p.inputs['Base Color'].default_value)
    tex=nt.nodes.new('ShaderNodeTexNoise'); tex.inputs['Scale'].default_value=1
    tex.inputs['Detail'].default_value=3
    coord=nt.nodes.new('ShaderNodeTexCoord')
    vec=nt.nodes.new('ShaderNodeVectorMath'); vec.operation='MULTIPLY'; vec.inputs[1].default_value=scale
    nt.links.new(coord.outputs['Generated'],vec.inputs[0]); nt.links.new(vec.outputs[0],tex.inputs['Vector'])
    ramp=nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].color=tuple(v*(1-contrast) for v in base[:3])+(1,)
    ramp.color_ramp.elements[1].color=tuple(min(1,v*(1+contrast)) for v in base[:3])+(1,)
    nt.links.new(tex.outputs['Fac'],ramp.inputs[0]); nt.links.new(ramp.outputs['Color'],p.inputs['Base Color'])
    bump=nt.nodes.new('ShaderNodeBump'); bump.inputs['Strength'].default_value=detail; bump.inputs['Distance'].default_value=.018
    nt.links.new(tex.outputs['Fac'],bump.inputs['Height']); nt.links.new(bump.outputs['Normal'],p.inputs['Normal'])


surface(WOOD,(2,145,9),.15,.5)
surface(NAVY,(140,140,140),.15,.16)


def woven_grid(m,counts,color,width=.018):
    """Continuous woven lines survive the lightmap's mip levels; thin separate boxes do not."""
    nt=m.node_tree;p=next(n for n in nt.nodes if n.type=='BSDF_PRINCIPLED')
    old=p.inputs['Base Color'].links[0].from_socket if p.inputs['Base Color'].is_linked else None
    coord=nt.nodes.new('ShaderNodeTexCoord');sep=nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(coord.outputs['Generated'],sep.inputs[0]);axes=[]
    for axis,count in zip(('X','Y'),counts):
        if not count:continue
        mul=nt.nodes.new('ShaderNodeMath');mul.operation='MULTIPLY';mul.inputs[1].default_value=count
        fract=nt.nodes.new('ShaderNodeMath');fract.operation='FRACT'
        nt.links.new(sep.outputs[axis],mul.inputs[0]);nt.links.new(mul.outputs[0],fract.inputs[0])
        if width>.1:
            less=nt.nodes.new('ShaderNodeMath');less.operation='LESS_THAN';less.inputs[1].default_value=width
            nt.links.new(fract.outputs[0],less.inputs[0])
        else:
            opposite=nt.nodes.new('ShaderNodeMath');opposite.operation='SUBTRACT';opposite.inputs[0].default_value=1
            nt.links.new(fract.outputs[0],opposite.inputs[1])
            distance=nt.nodes.new('ShaderNodeMath');distance.operation='MINIMUM'
            nt.links.new(fract.outputs[0],distance.inputs[0]);nt.links.new(opposite.outputs[0],distance.inputs[1])
            ramp=nt.nodes.new('ShaderNodeMath');ramp.operation='DIVIDE';ramp.inputs[1].default_value=max(.045,width)
            nt.links.new(distance.outputs[0],ramp.inputs[0])
            less=nt.nodes.new('ShaderNodeMath');less.operation='SUBTRACT';less.inputs[0].default_value=1;less.use_clamp=True
            nt.links.new(ramp.outputs[0],less.inputs[1])
        axes.append(less)
    maximum=nt.nodes.new('ShaderNodeMath');maximum.operation='MAXIMUM';maximum.inputs[1].default_value=0
    for i,node in enumerate(axes):nt.links.new(node.outputs[0],maximum.inputs[i])
    mix=nt.nodes.new('ShaderNodeMixRGB');mix.inputs[1].default_value=p.inputs['Base Color'].default_value
    mix.inputs[2].default_value=srgb(color)
    if old:nt.links.new(old,mix.inputs[1])
    nt.links.new(maximum.outputs[0],mix.inputs[0]);nt.links.new(mix.outputs[0],p.inputs['Base Color'])


def block(name, size, loc, c, material=INK, rot=(0,0,0), bevel=.008, lm=False):
    o=box(name,size,loc,c,material,rot,bevel,segs=3)
    if lm:o['lm']=1
    return o


def rod(name,a,b,r,c,m=STEEL):
    v=Vector(b)-Vector(a)
    return cyl(name,r,v.length,(Vector(a)+Vector(b))/2,c,m,
               rot=v.to_track_quat('Z','Y').to_euler(),bevel=0,verts=12)


def label(name,text,loc,size,c,material=PAPER,rot=(R90,0,0)):
    cu=bpy.data.curves.new(name,'FONT');cu.body=text;cu.size=size;cu.extrude=.0002;cu.align_x='CENTER'
    cu.materials.append(material)
    o=bpy.data.objects.new(name,cu);o.location=loc;o.rotation_euler=rot;c.objects.link(o)
    # The bake/export operates on meshes and ordinary curves, not font datablocks.
    dg=bpy.context.evaluated_depsgraph_get()
    me=bpy.data.meshes.new_from_object(o.evaluated_get(dg),depsgraph=dg)
    transform=o.matrix_world.copy();bpy.data.objects.remove(o,do_unlink=True)
    mesh=bpy.data.objects.new(name,me);mesh.matrix_world=transform;c.objects.link(mesh)
    bpy.data.curves.remove(cu)
    return mesh


def illustrated(kind):
    """Small, packed, original drawings for screens, prints and book covers."""
    name='studio_'+kind
    if bpy.data.images.get(name):return bpy.data.images[name]
    n=512
    a=np.ones((n,n,4),dtype=np.float32)
    def rect(x,y,w,h,color):
        a[max(0,int(y*n)):min(n,int((y+h)*n)),max(0,int(x*n)):min(n,int((x+w)*n)),:3]=color
    def oval(x,y,rx,ry,color):
        yy,xx=np.ogrid[:n,:n]
        mask=((xx/n-x)/rx)**2+((yy/n-y)/ry)**2<1
        a[mask,:3]=color
    def line(x,y,x2,y2,width,color):
        length=max(abs(x2-x),abs(y2-y));steps=max(2,int(length*n))
        for t in np.linspace(0,1,steps):rect(x+(x2-x)*t,y+(y2-y)*t,width,width,color)
    def face(x,y,s,hair):
        oval(x,y,s*.45,s*.60,hair)
        oval(x,y-.02*s,s*.31,s*.40,(.92,.76,.75))
        for sign in (-1,1):
            oval(x+sign*s*.13,y+s*.04,s*.065,s*.065,(.15,.14,.3))
            oval(x+sign*s*.12,y+s*.02,s*.022,s*.025,(.9,.94,1))
        line(x-.08*s,y+.24*s,x+.06*s,y+.24*s,.004,(.5,.26,.32))
        for k in range(8):
            xx=x+(k-3.5)*s*.1
            line(xx,y-.45*s,xx+(3.5-k)*s*.025,y-.10*s,.022,hair)
        rect(x-s*.18,y+s*.5,s*.36,s*.43,(.23,.29,.49))
        line(x-s*.18,y+s*.5,x-s*.40,y+s*.82,.02,(.9,.77,.76))
        line(x+s*.18,y+s*.5,x+s*.40,y+s*.7,.02,(.9,.77,.76))
    if kind in ('portrait','comic'):
        rect(0,0,1,1,(.09,.14,.27) if kind=='portrait' else (.78,.77,.89))
        for i in range(45):
            x,y=RNG.random(),RNG.random();line(x,y,x+.014,y,.004,(.51,.68,.98));line(x+.007,y-.007,x+.007,y+.007,.003,(.7,.8,1))
        face(.49,.48,.74,(.61,.69,.89))
        if kind=='comic':
            face(.18,.35,.36,(.52,.2,.4));face(.83,.65,.32,(.85,.37,.48))
        for i in range(8):rect(.06+i*.115,.92,.06,.012,(.68,.76,.95))
    elif kind=='sunset':
        for y in range(n):a[y,:,:3]=np.array((.12,.22,.48))*(1-y/n)+np.array((.93,.43,.19))*(y/n)
        oval(.6,.57,.08,.08,(1,.79,.45))
        for x in range(n):
            y=int(n*(.72+.1*math.sin(x*.023)+.06*math.sin(x*.06)))
            a[y:,x,:3]=(.04,.08,.16)
    elif kind in ('blueprint','contour'):
        rect(0,0,1,1,(.035,.065,.13))
        if kind=='blueprint':
            for i in range(15):
                p=.05+i*.065;line(p,.05,p,.95,.0015,(.15,.25,.39));line(.05,p,.95,p,.0015,(.15,.25,.39))
            for x,y,w,h in [(.13,.18,.68,.64),(.19,.24,.4,.25),(.2,.56,.32,.2),(.66,.25,.1,.49)]:
                for p,q in [((x,y),(x+w,y)),((x,y),(x,y+h)),((x+w,y),(x+w,y+h)),((x,y+h),(x+w,y+h))]:line(*p,*q,.004,(.52,.69,.91))
        else:
            for k in range(20):
                pts=[]
                for t in np.linspace(0,math.tau,100):
                    r=.08+k*.014;pts.append((.5+r*math.cos(t)*(1+.25*math.sin(3*t)),.5+r*1.35*math.sin(t)))
                for p,q in zip(pts,pts[1:]):line(*p,*q,.002,(.34,.44,.62))
    else:
        # A real arrangement of application chrome, tracks, layer stack, thumbnails and panels.
        rect(0,0,1,1,(.66,.72,.85));rect(0,0,1,.055,(.08,.12,.22))
        for i in range(18):rect(.02+i*.05,.017,.028,.012,(.6,.69,.8))
        rect(.015,.08,.18,.84,(.28,.34,.45));rect(.21,.08,.6,.74,(.88,.89,.94));rect(.83,.08,.155,.84,(.59,.64,.74))
        for i in range(20):
            rect(.035,.10+i*.039,.12,.006,(.67,.74,.81));rect(.85,.10+i*.039,.10,.008,(.28,.34,.46))
        if kind=='timeline':
            for i in range(13):
                rect(.23,.12+i*.048,.56,.001,(.5,.57,.68))
                for j in range(5):rect(.24+j*.11,.126+i*.048,.04+(i%3)*.017,.03,((.42,.52,.76) if i%2 else (.64,.43,.68)))
            line(.48,.1,.48,.81,.004,(.98,.38,.36))
        else:
            # The artwork itself is a separate, UV-mapped plane over this application canvas.
            rect(.25,.12,.53,.52,(.95,.95,.97))
            for i in range(6):rect(.23,.69+i*.018,.54-(i%3)*.08,.005,(.47,.52,.66))
        for i in range(22):rect(.018+i*.044,.96,.028,.021,(.25+(i%4)*.15,.37,.69))
    img=bpy.data.images.new(name,n,n,alpha=False)
    img.pixels.foreach_set(np.flipud(a).ravel());img.pack()
    return img


def art(name,kind,w,h,loc,c,rot=(R90,0,0),emission=0):
    m=mat(name+'_ink','#ffffff',.65,emit='#ffffff' if emission else None,strength=emission)
    nt=m.node_tree;p=next(n for n in nt.nodes if n.type=='BSDF_PRINCIPLED')
    t=nt.nodes.new('ShaderNodeTexImage')
    quadrants={'portrait':(0,.5),'comic':(.5,.5),'sunset':(0,0),'sketch':(.5,0)}
    if kind in quadrants:
        atlas=bpy.data.images.get('studio_art_atlas')
        if atlas is None:
            atlas=bpy.data.images.load(os.path.normpath(WWD+'../../art/living-room/textures/studio-art-atlas.png'))
            atlas.name='studio_art_atlas';atlas.pack()
        t.image=atlas
    else:t.image=illustrated(kind)
    uv=nt.nodes.new('ShaderNodeUVMap');uv.uv_map='ArtUV';nt.links.new(uv.outputs['UV'],t.inputs['Vector'])
    nt.links.new(t.outputs['Color'],p.inputs['Base Color'])
    if emission:nt.links.new(t.outputs['Color'],p.inputs['Emission Color'])
    me=bpy.data.meshes.new(name)
    me.from_pydata([(-w/2,-h/2,0),(w/2,-h/2,0),(w/2,h/2,0),(-w/2,h/2,0)],[],[(0,1,2,3)])
    me.materials.append(m);u=me.uv_layers.new(name='ArtUV')
    for v,co in zip(u.data,[(0,0),(1,0),(1,1),(0,1)]):
        v.uv=tuple(quadrants[kind][i]+co[i]*.5 for i in range(2)) if kind in quadrants else co
    o=bpy.data.objects.new(name,me);c.objects.link(o);o.location=loc;o.rotation_euler=rot
    if not emission:o['lm']=1
    return o


def mug(name,loc,c,color='#373a50',radius=.052):
    m=mat(name+'_ceramic',color,.24)
    lathe(name,[(0,0),(radius*.87,0),(radius,.025),(radius,.13),(radius*.85,.135),(radius*.83,.025),(0,.025)],loc,c,m,steps=24)
    x,y,z=loc
    tube(name+'_handle',[(x+radius*.88,y,z+.10),(x+radius*1.7,y,z+.11),(x+radius*1.7,y,z+.04),(x+radius*.88,y,z+.04)],.009,c,m)
    cyl(name+'_coffee',radius*.81,.002,(x,y,z+.11),c,mat('coffee','#130b09',.14),bevel=0,verts=24)


def book(name,loc,c,size=(.035,.19,.25),color=None,flat=False,angle=0):
    w,d,h=size;m=color or RNG.choice(PALETTE)
    rot=(0,angle,0) if not flat else (0,0,angle)
    block(name+'_pages',(w*.8,d*.94,h*.96),loc,c,PAPER,rot,bevel=.001)
    for side in (-1,1):
        block(name+'_cover',(w*.1,d,h),(loc[0]+side*w*.45,loc[1],loc[2]),c,m,rot,bevel=.001)
    block(name+'_spine',(w,.013,h),(loc[0],loc[1]-d/2,loc[2]),c,m,rot,bevel=.001)
    for z in (-.22,.23):block(name+'_title',(w*.6,.001,.011),(loc[0],loc[1]-d/2-.008,loc[2]+z*h),c,PAPER,bevel=0)


def boxfile(name,loc,c,size=(.28,.28,.24),color=INK):
    block(name,size,loc,c,color,bevel=.013)
    w,d,h=size
    block(name+'_lid',(w+.012,d+.012,.025),(loc[0],loc[1],loc[2]+h/2),c,color)
    block(name+'_label',(.09,.002,.045),(loc[0],loc[1]-d/2-.001,loc[2]+.015),c,PAPER,bevel=.001)
    block(name+'_handle',(.05,.006,.013),(loc[0],loc[1]-d/2-.004,loc[2]-.035),c,BLACK,bevel=.005)


def plush(name,loc,c,scale=1):
    x,y,z=loc;s=scale;m=mat('plush_lilac','#c0c5e6',.98)
    sphere(name+'_body',.11*s,(x,y,z+.1*s),c,m,scale=(1,.78,.9),seg=24)
    for side in (-1,1):
        sphere(name+'_ear',.04*s,(x+side*.07*s,y,z+.19*s),c,m,scale=(.65,.6,1.3),seg=16)
        sphere(name+'_eye',.008*s,(x+side*.04*s,y-.083*s,z+.11*s),c,BLACK,seg=12)
        sphere(name+'_blush',.013*s,(x+side*.064*s,y-.079*s,z+.086*s),c,PALETTE[4],scale=(1,.2,.5),seg=12)
    sphere(name+'_nose',.006*s,(x,y-.09*s,z+.085*s),c,PALETTE[4],seg=12)


print('reference helpers ready')
