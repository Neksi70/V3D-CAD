    'revolve': { doc: '{profile: [[r, z], …] mm (r = Abstand zur Achse ≥ 0, z = Höhe), center?: [x,y] mm, wall?: mm (aushöhlen), hole?, name?, color?} — Rotationskörper um die senkrechte Achse (Vase, Knauf, Becher). Profil auf der Achse beginnen und enden lassen (erster und letzter Punkt r = 0); wall macht daraus einen Becher (Boden zu, oben offen)', fn(p) {
      return revolve(p);
    } },
    'body.shell': { doc: '{id, thickness: mm, open?: top|bottom|+x|-x|+y|-y oder Liste (Standard top)} — aushöhlen: Wand nach innen, die genannten Seiten bleiben offen (OCCT). Grenzen wie body.fillet: Grundkörper, ungedreht, vor Bool. Runden geht davor oder danach', async fn(p) {
      return shell(p);
    } },
    'body.mirror': { doc: '{id, plane: YZ|XZ|XY (YZ spiegelt in X, XZ in Y, XY in Z), at?: mm (Lage der Ebene, Standard: Körpermitte), copy?: bool} — spiegeln; mit copy eine gespiegelte Kopie (neue id), sonst an Ort und Stelle (id bleibt)', fn(p) {
      return mirror(p);
    } },
    'body.pattern': { doc: '{id, linear?: {count, step:[dx,dy,dz] mm}, circular?: {count, axis?: X|Y|Z (Z), center?: [x,y,z] mm (Ursprung), angle?: ° (360 = voller Kreis)}, union?: bool} — Muster; count zählt das Original mit. Ohne union die Kopien als eigene Körper, mit union alles zu einem', async fn(p, log) {
      return pattern(p, log);
    } },
    'file.import': { doc: '{name: "teil.stl|3mf|obj|step", base64, center?: [x,y] mm} — Datei importieren (mm, Z oben); liegt danach auf der Platte. Über MCP einfacher: Werkzeug import mit Pfad', async fn(p) {
      return importFile(p);
    } },
