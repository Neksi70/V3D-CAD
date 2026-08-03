// Prueft die veroeffentlichten Firestore-Regeln fuer gemeinsame Sitzungen
// gegen die ECHTE Datenbank — aus der Sicht eines Gastes OHNE Konto, denn
// genau der darf jetzt mitschreiben. Legt nur kurzlebige Testdokumente an
// und raeumt sie am Ende wieder ab.
//
// Mit einer echten, laufenden Sitzung aufrufen, um zusaetzlich die
// Kapern-Abwehr zu pruefen:   node tests/mitsehen_rules_test.mjs <sitzungs-id>
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, setDoc, getDoc, updateDoc, deleteDoc, addDoc, collection, getDocs } from 'firebase/firestore';

const cfg = { apiKey:"AIzaSyB1TC58k0AmuU6pclev-WLr1-VGIgu98Q4", authDomain:"volme3d.firebaseapp.com", projectId:"volme3d", storageBucket:"volme3d.firebasestorage.app", messagingSenderId:"287060944142", appId:"1:287060944142:web:4e9175ff4f769e9310235f" };
const db = getFirestore(initializeApp(cfg));

let fails = 0;
const ok = (n, c, extra) => { if (c) console.log('  ✓ ' + n); else { fails++; console.log('  ✗ ' + n + (extra ? '  → ' + extra : '')); } };
const denied = e => String(e && e.code).includes('permission-denied');
async function mustFail(name, fn){ try { await fn(); ok(name, false, 'wurde ERLAUBT'); } catch(e){ ok(name, denied(e), e.code || String(e)); } }
async function mustWork(name, fn){ try { await fn(); ok(name, true); } catch(e){ ok(name, false, e.code || String(e)); } }

const SID = 's_test' + Date.now().toString(36);
const ref = doc(db, 'sessions', SID);
const now = Date.now(), exp = now + 3*60*60*1000;
const LIVE = process.argv[2] || '';

console.log('\n1) Die Sitzung selbst bleibt geschuetzt');
await mustFail('Sitzung ohne Konto anlegen', () => setDoc(ref, { name:'x', host:'fremd', codeHash:'x', createdAt:now, expiresAt:exp, live:true }));
await mustFail('unbekannte Sitzung lesen', () => getDoc(ref).then(d => { if (!d.exists()) throw { code:'permission-denied' }; }));

console.log('\n2) Gast ohne Konto darf am Stand mitarbeiten');
const st = doc(db, 'sessions', SID, 'state', 'doc');
await mustWork('Stand schreiben', () => setDoc(st, { data:'GZ1:test', by:'g_1', byName:'Betreuer', at:now, expiresAt:exp, rev:1 }));
await mustWork('Stand lesen', () => getDoc(st).then(d => { if (!d.exists()) throw new Error('leer'); }));
await mustWork('Stand aktualisieren', () => setDoc(st, { data:'GZ1:test2', by:'g_1', byName:'Betreuer', at:now, expiresAt:exp, rev:2 }));

console.log('\n3) Ablauf laesst sich nicht austricksen');
await mustFail('abgelaufener Stand wird abgelehnt', () => setDoc(doc(db,'sessions',SID,'state','alt'), { data:'x', by:'g', at:now, expiresAt: now - 1000 }));
await mustFail('Ablauf weiter als 24 h wird abgelehnt', () => setDoc(doc(db,'sessions',SID,'state','lang'), { data:'x', by:'g', at:now, expiresAt: now + 40*60*60*1000 }));

console.log('\n4) Kamera und Markierungen');
await mustWork('Kamera senden', () => setDoc(doc(db,'sessions',SID,'cams','g_1'), { t:[0,0,0], th:.6, ph:.75, r:12, sel:[], name:'Betreuer', at:now, expiresAt:exp }));
const marks = collection(db, 'sessions', SID, 'marks');
await mustWork('Markierung setzen', () => addDoc(marks, { p:[1,2,3], t:'Hier klemmt es', at:now, by:'Betreuer', expiresAt:exp }));
await mustFail('zu langer Text wird abgelehnt', () => addDoc(marks, { p:[1,2,3], t:'x'.repeat(81), at:now, by:'B', expiresAt:exp }));
await mustFail('unerwartetes Feld wird abgelehnt', () => addDoc(marks, { p:[1,2,3], t:'x', at:now, by:'B', expiresAt:exp, schmuggel:'boese' }));
await mustFail('kaputte Koordinate wird abgelehnt', () => addDoc(marks, { p:[1,2], t:'x', at:now, by:'B', expiresAt:exp }));
await mustWork('Anwesenheit melden', () => setDoc(doc(db,'sessions',SID,'eyes','v_test'), { at:now, name:'Betreuer' }));
await mustFail('Anwesenheit mit Fremdfeld', () => setDoc(doc(db,'sessions',SID,'eyes','v_bad'), { at:now, name:'B', extra:1 }));

if (LIVE){
  console.log('\n5) Laufende Sitzung ' + LIVE + ' — Kapern-Abwehr');
  const lr = doc(db, 'sessions', LIVE);
  let cur = null;
  try { const d = await getDoc(lr); cur = d.exists() ? d.data() : null; } catch(e){}
  ok('laufende Sitzung ist ohne Konto lesbar', !!cur, 'nicht gefunden — laeuft sie noch?');
  if (cur){
    await mustFail('Eigentuemer uebernehmen', () => updateDoc(lr, { host:'ich_boese' }));
    await mustFail('Code austauschen',        () => updateDoc(lr, { codeHash:'0000' }));
    await mustFail('Sitzung verlaengern',     () => updateDoc(lr, { expiresAt: Date.now() + 20*60*60*1000 }));
    await mustFail('Sitzung loeschen',        () => deleteDoc(lr));
    await mustWork('Stift anfordern (erlaubt)', () => updateDoc(lr, { penReq:'g_pruef', penReqName:'Prüfung' }));
    await mustWork('Anfrage zuruecknehmen',     () => updateDoc(lr, { penReq:'', penReqName:'' }));
    await mustWork('Stand der Sitzung lesbar',  () => getDoc(doc(db,'sessions',LIVE,'state','doc')).then(d => { if (!d.exists()) throw new Error('noch kein Stand'); }));
  }
}

console.log('\n6) Aufraeumen');
try{
  for (const sub of ['marks','eyes','cams']){
    const q = await getDocs(collection(db,'sessions',SID,sub));
    for (const d of q.docs) await deleteDoc(d.ref);
  }
  await deleteDoc(st);
  ok('Testdaten wieder entfernt', true);
}catch(e){ ok('Testdaten wieder entfernt', false, e.code || String(e)); }

console.log(fails ? `\n${fails} Prüfung(en) fehlgeschlagen\n` : '\nRegeln verhalten sich wie vorgesehen\n');
process.exit(fails ? 1 : 0);
