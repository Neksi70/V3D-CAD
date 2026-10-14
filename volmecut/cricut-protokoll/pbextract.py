# Sucht serialisierte FileDescriptorProto in Binaries und schreibt .proto-Text
import sys, re, os
from google.protobuf import descriptor_pb2
def varint(b,i):
    r=s=0
    while True:
        c=b[i]; i+=1; r|=(c&0x7f)<<s; s+=7
        if not c&0x80: return r,i
def try_parse(b,start):
    # parse fields greedily until it stops being valid
    best=None
    i=start
    try:
        while i<len(b):
            tag,j=varint(b,i)
            fn,wt=tag>>3,tag&7
            if fn<1 or fn>14: break
            if wt==2:
                l,j=varint(b,j); j+=l
                if j>len(b): break
            elif wt==0: _,j=varint(b,j)
            else: break
            i=j
            fd=descriptor_pb2.FileDescriptorProto()
            try:
                fd.ParseFromString(bytes(b[start:i]))
                if fd.name.endswith('.proto') and (fd.message_type or fd.enum_type or fd.service): best=(i,fd)
            except Exception: pass
    except IndexError: pass
    return best
out=sys.argv[2]; os.makedirs(out,exist_ok=True)
b=open(sys.argv[1],'rb').read()
seen={}
for m in re.finditer(rb'\x0a([\x01-\x7f])([A-Za-z0-9_/.\-]{1,126}\.proto)',b):
    if m.group(1)[0]!=len(m.group(2)): continue
    r=try_parse(b,m.start())
    if r:
        end,fd=r
        if fd.name in seen and len(seen[fd.name].SerializeToString())>=end-m.start(): continue
        seen[fd.name]=fd
for n,fd in seen.items():
    open(os.path.join(out,n.replace('/','__')+'.pb'),'wb').write(fd.SerializeToString())
    print(n, len(fd.message_type), 'msgs', len(fd.enum_type),'enums', len(fd.service),'svc', 'pkg=',fd.package)
