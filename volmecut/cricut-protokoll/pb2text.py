import sys,glob,os
from google.protobuf import descriptor_pb2 as d
T={1:'double',2:'float',3:'int64',4:'uint64',5:'int32',6:'fixed64',7:'fixed32',8:'bool',9:'string',12:'bytes',13:'uint32',15:'sfixed32',16:'sfixed64',17:'sint32',18:'sint64'}
L={1:'',2:'required ',3:'repeated '}
def enum(e,ind):
    s=f"{ind}enum {e.name} {{\n"
    for v in e.value: s+=f"{ind}  {v.name} = {v.number};\n"
    return s+ind+"}\n"
def msg(m,ind,syn):
    s=f"{ind}message {m.name} {{\n"
    for e in m.enum_type: s+=enum(e,ind+'  ')
    for n in m.nested_type:
        if n.options.map_entry: continue
        s+=msg(n,ind+'  ',syn)
    oneofs={}
    for f in m.field:
        t=T.get(f.type) or f.type_name.lstrip('.')
        lab=L[f.label] if not (syn=='proto3' and f.label==1) else ''
        if f.HasField('oneof_index') and not f.proto3_optional: lab=f"/*oneof {m.oneof_decl[f.oneof_index].name}*/ "
        s+=f"{ind}  {lab}{t} {f.name} = {f.number};\n"
    return s+ind+"}\n"
for p in sorted(glob.glob(sys.argv[1]+'/*.pb')):
    fd=d.FileDescriptorProto(); fd.ParseFromString(open(p,'rb').read())
    if fd.name.startswith('google/'): continue
    s=f'// {fd.name}\nsyntax = "{fd.syntax or "proto2"}";\npackage {fd.package};\n'
    for dep in fd.dependency: s+=f'import "{dep}";\n'
    s+='\n'
    for e in fd.enum_type: s+=enum(e,'')+'\n'
    for m in fd.message_type: s+=msg(m,'',fd.syntax)+'\n'
    open(p[:-3],'w').write(s)
