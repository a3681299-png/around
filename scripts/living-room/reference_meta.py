# Keep the room/runtime naming contract, with navigable locations for the new furniture.
C=wipe('meta_marks')
def marker(name,loc,face):
    o=bpy.data.objects.new(name,None);o.empty_display_type='ARROWS';o.empty_display_size=.2
    o.location=loc;o.rotation_euler=(0,0,math.atan2(face[0],-face[1]));C.objects.link(o)
# Seats are on the surface as the placed models have it (the chair's seat is toward the desk
# from its centre; the bed's near edge is the side away from the wall).
marker('marker_sit_chair',(-.45,1.31,top_at(-.45,1.31,1.0)),(0,1))
marker('marker_sit_bed',(1.45,1.40,top_at(1.45,1.40,1.2)),(-1,0))
marker('marker_sit_floor',(-1.25,-.70,.14),(.3,1))
marker('marker_hide_chair',(-1.18,.86,0),(0,-1))
# The body needs 0.14 m on every side of a spot (src/world/room-life.ts BODY_M). The names are
# the ones the page and the earlier rooms know; the trolley now stands by the door.
marker('marker_hide_trolley',(-2.02,-1.62,0),(1,.2))
marker('marker_stand_window',(-1.30,1.28,0),(0,1))
marker('marker_stand_shelf',(-1.94,.10,0),(-1,0))
# Keep the established demonstration's UI behind the initial resident, with clear floor ahead.
marker('marker_stand_center',(.62,-.30,0),(1,-1))
marker('marker_stand_front',(.20,-2.35,0),(0,-1))
# (By the music corner in the near right: the rack, the amplifier, the guitar.)
marker('marker_stand_guitar',(1.62,-1.40,0),(1,-.6))
# Everyday life (docs/living-life.md). Not markers (the layout reader would take them for seats):
# `pose_` empties the page reads by name. Where the resident lies on the bed (its chest; the
# arrow is the way its head points), and where the phone is put down on the bed and on the desk.
def clear_top(want, radius=.05, step=.02, search=.25, level=.01):
    """A flat, clear spot on what is under `want` (x, y): the nearest point whose surface is level
    for `radius` round it (the desk's clutter is not a place for a phone)."""
    dg = bpy.context.evaluated_depsgraph_get()
    sc = bpy.context.scene
    def top(x, y):
        # (From under the ceiling: the hidden light baffles sit just above the walls.)
        hit, loc, *_ = sc.ray_cast(dg, Vector((x, y, 2.5)), Vector((0, 0, -1)))
        return loc.z if hit else None
    best = None
    n = int(search / step)
    for i in range(-n, n + 1):
        for j in range(-n, n + 1):
            x, y = want[0] + i * step, want[1] + j * step
            z = top(x, y)
            # On the furniture's top, not the floor beside it (want[2] is about how high it is).
            if z is None or abs(z - want[2]) > .06:
                continue
            ring = [top(x + radius * math.cos(a), y + radius * math.sin(a)) for a in (0, 1.57, 3.14, 4.71)]
            if any(r is None or abs(r - z) > level for r in ring):
                continue
            d = math.hypot(i, j)
            if best is None or d < best[0]:
                best = (d, (x, y, z))
    return best[1] if best else (want[0], want[1], want[2])
# Head to the pillows. The resident lands on its front and rolls onto its back: from the room's
# camera (above the foot of the bed) the face then looks up into the phone's light. The phone is
# put down by its right hand (on its back, toward +X).
marker('pose_lie_bed',(2.05,1.50,top_at(2.05,1.50,1.2)),(0,1))
marker('pose_phone_bed',(2.38,1.40,top_at(2.38,1.40,1.2)+.004),(0,1))
# (The desk's flattest free top is its front right corner, by the right hand.)
marker('pose_phone_desk',clear_top((.42,1.68,top_at(.42,1.68,.95)),search=.3,level=.015),(0,-1))
print('phone on the desk at', tuple(round(v,3) for v in bpy.data.objects['pose_phone_desk'].location))
# Footprints (x0, y0, x1, y1) of the furniture, measured from the placed models
# (reference_models.py) where they stand above the rug.
OBST=[# the left wall: the metal shelf, the binder shelf, the dark bookcase and the magazine box
      (-3,-1.30,-2.55,2.70),(-3,.90,-2.40,2.05),(-2.58,2.15,-1.42,2.70),(-2.40,1.68,-2.02,2.05),
      # the trolley by the door, the backpack
      (-2.92,-1.84,-2.34,-1.26),(-2.62,-1.26,-2.18,-.80),
      # the desk and the chair
      (-1.44,1.52,.64,2.70),(-.95,.66,.05,1.56),
      # the bedside chest, the bed, the sofa at its foot (and the plant by its arm)
      (.62,2.15,1.18,2.70),(1.15,.68,3,2.70),(1.16,-.16,3,.70),(.82,-.40,1.16,.56),
      # the clothes rack, the boxes beside it, the music corner (amplifier, crates, guitar)
      (1.90,-1.80,3,-.72),(1.96,-.72,3,-.16),(1.48,-2.70,3,-2.10),
      # the low table; the laptop only: the flat books and sketchbooks on the rug can be stepped past
      (-1.08,-2.18,-.16,-1.26),(-.24,-.98,.20,-.58),(-1.95,.33,-1.61,.67),
      # the television in the near left corner
      (-2.62,-2.70,-1.36,-1.80)]
CELL=.1;n=60;ny=54
free=[[True]*n for _ in range(ny)]
for j in range(ny):
    for i in range(n):
        x,y=-3+i*CELL,-2.7+j*CELL
        free[j][i]=not any(x+CELL>a+1e-6 and x<c-1e-6 and y+CELL>b+1e-6 and y<d-1e-6 for a,b,c,d in OBST)
rects=[];runs_open={}
for j in range(ny+1):
    runs=set();i=0
    while j<ny and i<n:
        if free[j][i]:
            k=i
            while k<n and free[j][k]:k+=1
            runs.add((i,k));i=k
        else:i+=1
    for run in list(runs_open):
        if run not in runs:rects.append((run[0],runs_open.pop(run),run[1],j))
    for run in runs:runs_open.setdefault(run,j)
bm=bmesh.new()
for i,j,k,l in rects:
    x0,x1,y0,y1=-3+i*CELL,-3+k*CELL,-2.7+j*CELL,-2.7+l*CELL
    bm.faces.new([bm.verts.new(p) for p in ((x0,y0,0),(x1,y0,0),(x1,y1,0),(x0,y1,0))])
bmesh.ops.recalc_face_normals(bm,faces=bm.faces)
o=bm_object('navmesh_floor',bm,mat('navmesh','#33ff88',1,alpha=.3),C,smooth=False)
o.hide_render=True;o.display_type='WIRE'
print('reference layout ready',len(rects),'rectangles')
