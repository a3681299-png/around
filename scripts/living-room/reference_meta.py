# Keep the room/runtime naming contract, with navigable locations for the new furniture.
C=wipe('meta_marks')
def marker(name,loc,face):
    o=bpy.data.objects.new(name,None);o.empty_display_type='ARROWS';o.empty_display_size=.2
    o.location=loc;o.rotation_euler=(0,0,math.atan2(face[0],-face[1]));C.objects.link(o)
marker('marker_sit_chair',(-.48,.66,.57),(0,1))
marker('marker_sit_bed',(1.43,.83,.68),(-1,0))
marker('marker_sit_floor',(-.75,-.70,.14),(.3,1))
marker('marker_hide_chair',(-1.04,.67,0),(0,-1))
marker('marker_hide_trolley',(1.52,-1.30,0),(-1,-.2))
marker('marker_stand_window',(-1.12,1.05,0),(0,1))
marker('marker_stand_shelf',(-1.94,.10,0),(-1,0))
# Keep the established demonstration's UI behind the initial resident, with clear floor ahead.
marker('marker_stand_center',(.40,-.35,0),(1,-1))
marker('marker_stand_front',(-.25,-2.35,0),(0,-1))
marker('marker_stand_guitar',(1.78,-1.07,0),(1,.2))
OBST=[(-3,-1.55,-2.40,2.70),(-2.38,2.01,-1.52,2.70),
      (-1.57,1.31,1.05,2.38),(-.85,.27,-.10,1.01),
      (1.29,-.45,3,2.70),(.83,1.78,1.37,2.29),
      (-1.61,-2.19,-.49,-1.07),(-.62,-.26,.18,.53),
      (.68,-1.43,1.44,-.68),(.03,-2.54,.68,-1.94),
      (2.30,-2.62,3,-1.65),(2.03,-1.52,2.90,-.45),
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
