import json, sys, urllib.request
URL="http://100.66.252.89:8931/mcp"
SF="/tmp/nbc-session"
def post(body, sid=None):
    h={"Content-Type":"application/json","Accept":"application/json, text/event-stream"}
    if sid: h["Mcp-Session-Id"]=sid
    req=urllib.request.Request(URL, data=json.dumps(body).encode(), headers=h, method="POST")
    with urllib.request.urlopen(req, timeout=180) as r:
        sid2=r.headers.get("Mcp-Session-Id"); raw=r.read().decode()
    msgs=[]
    for line in raw.splitlines():
        if line.startswith("data:"): msgs.append(json.loads(line[5:]))
    if not msgs and raw.strip(): msgs=[json.loads(raw)]
    return sid2, msgs
def session():
    try: return open(SF).read().strip()
    except: pass
    sid,_=post({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"v3da-cli","version":"1"}}})
    post({"jsonrpc":"2.0","method":"notifications/initialized"}, sid)
    open(SF,"w").write(sid); return sid
def call(name, args):
    sid=session()
    _,m=post({"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":name,"arguments":args}}, sid)
    for x in m:
        if "result" in x:
            return "\n".join(c.get("text","") for c in x["result"].get("content",[]) if c.get("type")=="text")
        if "error" in x: return "ERR "+json.dumps(x["error"])
    return str(m)
if __name__=="__main__":
    name=sys.argv[1]; args=json.loads(sys.argv[2]) if len(sys.argv)>2 else {}
    if args.get("function","").startswith("@"): args["function"]=open(args["function"][1:]).read()
    print(call(name,args))
