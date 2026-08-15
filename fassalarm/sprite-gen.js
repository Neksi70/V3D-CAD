// Baut die Affen-Sprites aus Zeichenbefehlen. Entscheidend fuer die Lesbarkeit
// sind drei Dinge: getrennte Arm-Massen statt eines Ovals, eine dunkle Kontur
// um die Silhouette und ein Gesicht mit Brauenwulst statt Vollbreit-Grinsen.
const W=44,H=38;
const grid=()=>Array.from({length:H},()=>Array(W).fill('.'));
const row=(g,r,c1,c2,ch)=>{ for(let c=c1;c<=c2;c++) if(c>=0&&c<W&&r>=0&&r<H) g[r][c]=ch; };
const box=(g,r1,r2,c1,c2,ch)=>{ for(let r=r1;r<=r2;r++) row(g,r,c1,c2,ch); };
const px=(g,r,c,ch)=>{ if(r>=0&&r<H&&c>=0&&c<W) g[r][c]=ch; };
// dunkle Kontur rund um alles Gemalte -- macht die Figur erst plastisch
const outline=(g,ch)=>{
  const add=[];
  for(let r=0;r<H;r++) for(let c=0;c<W;c++){
    if(g[r][c]!=='.') continue;
    for(const [dr,dc] of [[-1,0],[1,0],[0,-1],[0,1]]){
      const y=r+dr,x=c+dc;
      if(y>=0&&y<H&&x>=0&&x<W&&g[y][x]!=='.'){ add.push([r,c]); break; }
    }
  }
  for(const [r,c] of add) g[r][c]=ch;
};

// ---- Kopf: Fellkuppe mit Scheitelkamm, Brauenwulst, tiefliegende Augen,
// Monokel, kurze Schnauze. Kein Hut -- der Schaedel traegt sich selbst.
function head(g){
  row(g,3,20,23,'F');                                            // Scheitelkamm
  row(g,4,17,26,'F'); row(g,5,15,28,'F');                        // Kuppe
  row(g,4,18,25,'b'); row(g,5,17,26,'b');                        // Licht von oben
  row(g,6,14,29,'F'); box(g,7,15,13,30,'F');
  box(g,9,11,11,12,'f'); box(g,9,11,31,32,'f');                  // Ohren
  px(g,10,12,'P'); px(g,10,31,'P');
  row(g,7,14,29,'f'); row(g,8,13,30,'f');                        // Brauenwulst
  // Augen: 3x2, Pupille unten -- rechts sitzt das Monokel drin
  row(g,9,16,18,'W'); px(g,10,16,'W'); px(g,10,17,'K'); px(g,10,18,'W');
  row(g,9,25,27,'W'); px(g,10,25,'W'); px(g,10,26,'K'); px(g,10,27,'W');
  row(g,8,24,28,'e'); row(g,11,24,28,'e');                       // Monokelfassung
  px(g,9,24,'e'); px(g,9,28,'e'); px(g,10,24,'e'); px(g,10,28,'e');
  px(g,9,27,'C');                                                // Glanz im Glas
  // Schnauze: kurz, tief sitzend, ringsum dunkles Fell = Bart
  box(g,12,17,14,29,'f');
  row(g,12,17,26,'P'); box(g,13,15,16,27,'P'); row(g,16,17,26,'P');
  px(g,13,19,'K'); px(g,13,24,'K');                              // Nuestern
  row(g,15,18,25,'K'); px(g,14,17,'K'); px(g,14,26,'K');         // Mund, Winkel hoch
  row(g,18,15,28,'f'); row(g,19,17,26,'f');                      // Bart laeuft aus
}
// ---- Hinterkopf: gleiche Kuppe, aber kein Gesicht -- nur Fell und Ohren,
// die von hinten als schmale Sicheln stehen.
function backHead(g){
  row(g,5,20,23,'F');
  row(g,6,17,26,'F'); row(g,7,15,28,'F');
  row(g,6,18,25,'b'); row(g,7,17,26,'b');                        // Licht von oben
  box(g,8,17,13,30,'F');
  row(g,8,15,28,'b');                                            // Scheitelglanz
  box(g,10,12,11,12,'f'); box(g,10,12,31,32,'f');                // Ohren von hinten
  px(g,11,13,'e'); px(g,11,30,'e');
  box(g,9,15,13,14,'f'); box(g,9,15,29,30,'f');                  // Fell faellt seitlich ab
  row(g,16,15,28,'f'); row(g,17,17,26,'f');                      // Nacken im Schatten
}
// ---- Rumpf mit Brustschild und Tragegurt: schmale Schultern, breiter Bauch
function trunk(g,r1,r2){
  const shape=[[20,14,29],[21,13,30],[22,12,31],[23,11,32],[24,11,32],[25,11,32],
               [26,11,32],[27,12,31],[28,13,30],[29,14,29],[30,15,28]];
  for(const [r,c1,c2] of shape) if(r>=r1&&r<=r2) row(g,r,c1,c2,'F');
  const shield=[[21,17,26],[22,16,27],[23,15,28],[24,15,28],[25,15,28],
                [26,16,27],[27,17,26],[28,19,24]];
  for(const [r,c1,c2] of shield) row(g,r,c1,c2,'P');
  for(let i=0;i<7;i++) row(g,21+i,17+i,18+i,'N');                // Gurt quer
}
// ---- Beine und Fuesse
function legs(g){
  box(g,31,33,13,20,'F'); box(g,31,33,23,30,'F');
  box(g,31,33,13,13,'b'); box(g,31,33,23,23,'b');
  row(g,34,12,20,'f'); row(g,34,23,31,'f');
  row(g,35,10,20,'f'); row(g,35,23,33,'f');
  row(g,36,10,20,'f'); row(g,36,23,33,'f');
  row(g,36,12,18,'P'); row(g,36,25,31,'P');                      // Zehen
}
// ---- Arm als eigene Masse mit Bizeps-Bauch: Lichtkante aussen, Falte innen.
// spans = [zeile, aussen, innen] je Zeile, mirror spiegelt an der Sprite-Mitte.
function arm(g,spans,mirror,knuckle){
  for(const [r,co,ci] of spans){
    const [c1,c2]=mirror?[W-1-ci,W-1-co]:[co,ci];
    row(g,r,c1,c2,'F');
    px(g,r,mirror?c2:c1,'b'); px(g,r,mirror?c1:c2,'f');
  }
  if(knuckle){
    const last=spans[spans.length-1], [a,b]=mirror?[W-1-last[2],W-1-last[1]]:[last[1],last[2]];
    row(g,last[0]+1,a,b,'P'); row(g,last[0]+2,a+1,b-1,'P');
  }
}
// Bizeps -> Handgelenk: aussen bauchig, innen gerade an der Achsel
const ARM=[[20,4,10],[21,3,10],[22,2,10],[23,1,10],[24,1,10],[25,1,10],
           [26,2,10],[27,2,10],[28,3,9],[29,3,9]];

// ================= Pose 1: stehend, Knoechel am Boden =================
const A=grid();
head(A);
row(A,20,10,33,'f');                                   // Nackenlinie
trunk(A,20,30);
arm(A,ARM,false,true); arm(A,ARM,true,true);            // Arme neben dem Rumpf
box(A,20,22,11,11,'e'); box(A,20,22,32,32,'e');        // Achselfalte
row(A,30,12,31,'f');                                   // Hueftschatten
legs(A);
outline(A,'e');

// ================= Pose 2: Arme hoch (wirft / klettert) =================
const B=grid();
head(B);
const UP=[];
for(let r=2;r<=18;r++){ const o=2+Math.floor((18-r)/6); UP.push([r,o,o+6]); }
arm(B,UP,false,false); arm(B,UP,true,false);
box(B,0,1,3,9,'P');  box(B,0,1,34,40,'P');             // Pranken oben
row(B,19,10,33,'f'); row(B,20,12,31,'F');
trunk(B,20,30);
row(B,30,12,31,'f');
legs(B);
outline(B,'e');

// ============ Pose 3: von hinten an der Leiter, im Diagonalgang ============
// Ein Bild reicht: gespiegelt wird daraus der zweite Kletterschritt, weil bei
// der Rueckenansicht das Spiegeln genau die Glieder tauscht.
const C=grid();
backHead(C);
row(C,18,11,32,'f');                                   // Schulterlinie
const BACK=[[19,13,30],[20,12,31],[21,11,32],[22,11,32],[23,11,32],[24,11,32],
            [25,11,32],[26,12,31],[27,13,30],[28,14,29],[29,15,28]];
for(const [r,c1,c2] of BACK) row(C,r,c1,c2,'F');
box(C,21,27,15,28,'b');                                // Silberruecken
box(C,19,29,21,22,'f');                                // Rueckgrat
// linker Arm greift hoch, rechter haelt tiefer -- daher der Diagonalgang
const armUp=(r1,r2,c1,c2)=>{ box(C,r1,r2,c1,c2,'F');
  box(C,r1,r2,c1,c1,'b'); box(C,r1,r2,c2,c2,'f');
  row(C,r1,c1,c2,'P'); row(C,r1+1,c1+1,c2-1,'P'); };   // Pranke am Holm
armUp(2,19,3,10); armUp(9,25,33,40);
box(C,26,33,23,30,'F'); box(C,26,33,23,23,'b');        // rechtes Bein angezogen
box(C,29,35,13,20,'F'); box(C,29,35,20,20,'f');        // linkes Bein gestreckt
row(C,33,23,30,'P'); row(C,35,13,20,'P');              // Fuesse auf den Sprossen
outline(C,'e');

const out=g=>g.map(r=>'    "'+r.join('')+'",').join('\n');
if(process.argv[2]==='--patch'){
  const fs=require('fs'), file='/home/v3da/fassalarm/index.html';
  let h=fs.readFileSync(file,'utf8');
  for(const [name,g] of [['kong',A],['kongThrow',B],['kongClimb',C]]){
    const re=new RegExp('('+name+':mkspr\\(\\[)[\\s\\S]*?(\\],2\\))');
    if(!re.test(h)) throw new Error('Sprite '+name+' nicht gefunden');
    h=h.replace(re,'$1\n'+out(g)+'\n  $2');
  }
  fs.writeFileSync(file,h);
  console.log('kong + kongThrow + kongClimb ersetzt ('+W+'x'+H+')');
} else { console.log(out(A)); }
