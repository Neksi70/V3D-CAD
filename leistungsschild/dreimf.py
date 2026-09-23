# Zwei Körper -> eine 3MF, ein Objekt mit zwei Teilen (Platte / Schrift) in fester Lage
import json,sys,zipfile
d=json.load(open(sys.argv[1])); out=sys.argv[1].replace('.json','.3mf')
def obj(i,name,m):
    v,t,n=m['v'],m['t'],m['n']
    vs=''.join(f'<vertex x="{v[k*n]:.4f}" y="{v[k*n+1]:.4f}" z="{v[k*n+2]:.4f}"/>' for k in range(len(v)//n))
    ts=''.join(f'<triangle v1="{t[k]}" v2="{t[k+1]}" v3="{t[k+2]}"/>' for k in range(0,len(t),3))
    return f'<object id="{i}" name="{name}" type="model"><mesh><vertices>{vs}</vertices><triangles>{ts}</triangles></mesh></object>'
model=('<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xml:lang="de-DE" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources>'
 +obj(1,'Platte (dunkel)',d['meshes']['platte'])+obj(2,'Schrift (weiss)',d['meshes']['schrift'])
 +'<object id="3" name="Leistungsschild" type="model"><components><component objectid="1"/><component objectid="2"/></components></object>'
 +'</resources><build><item objectid="3"/></build></model>')
with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
    z.writestr('[Content_Types].xml','<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>')
    z.writestr('_rels/.rels','<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>')
    z.writestr('3D/3dmodel.model',model)
print(out)
