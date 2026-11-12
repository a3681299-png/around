# Keep the room/runtime naming contract, with navigable locations for the new furniture.
C=wipe('meta_marks')
def marker(name,loc,face):
    o=bpy.data.objects.new(name,None);o.empty_display_type='ARROWS';o.empty_display_size=.2
    o.location=loc;o.rotation_euler=(0,0,math.atan2(face[0],-face[1]));C.objects.link(o)
marker('marker_sit_chair',(-.45,.72,.55),(0,1))
marker('marker_sit_bed',(1.43,.83,.68),(-1,0))
marker('marker_sit_floor',(-1.25,-.70,.14),(.3,1))
marker('marker_hide_chair',(-1.04,.67,0),(0,-1))
# The body needs 0.14 m on every side of a spot (src/world/room-life.ts BODY_M): the trolley
# and guitar spots sit in the 0.4 m lane between the trolley and the amplifier.
marker('marker_hide_trolley',(1.80,-1.30,0),(-1,-.2))
marker('marker_stand_window',(-1.10,.84,0),(0,1))
marker('marker_stand_shelf',(-1.94,.10,0),(-1,0))
# Keep the established demonstration's UI behind the initial resident, with clear floor ahead.
marker('marker_stand_center',(.62,-.30,0),(1,-1))
marker('marker_stand_front',(-.25,-2.35,0),(0,-1))
marker('marker_stand_guitar',(1.80,-.95,0),(1,.2))
# Footprints (x0, y0, x1, y1) of the furniture, measured from the placed models
# (reference_models.py) where they stand above the rug.
OBST=[(-3,-1.55,-2.40,2.70),(-2.55,-1.25,-2.25,-.85),(-2.45,2.20,-1.40,2.70),
      (-1.38,1.08,.78,2.70),(-.83,.30,-.07,1.13),
      (1.29,-.45,3,2.70),(.83,1.78,1.37,2.29),
      # the laptop only: the flat books and sketchbook on the rug can be stepped past
      (-1.75,-2.65,-.45,-1.55),(-.35,-.95,.35,-.25),(-1.95,.33,-1.61,.67),
      (.78,-1.70,1.60,-.90),(1.20,-2.70,3,-2.12),
      (2.00,-1.45,2.90,-.45),
      (-2.96,-2.66,-2.35,-2.10)]
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
