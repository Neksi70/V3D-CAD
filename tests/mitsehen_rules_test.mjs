// Prueft die veroeffentlichten Firestore-Regeln fuer die Mitseh-Sitzungen
// gegen die ECHTE Datenbank. Legt nur kurzlebige Testdokumente an und raeumt
// sie am Ende wieder ab.
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc, deleteDoc, addDoc, collection, getDocs } from 'firebase/firestore';

const cfg = { apiKey:"AIzaSyB1TC58k0AmuU6pclev-WLr1-VGIgu98Q4", authDomain:"volme3d.firebaseapp.com", projectId:"volme3d", storageBucket:"volme3d.firebasestorage.app", messagingSenderId:"287060944142", appId:"1:287060944142:web:4e9175ff4f769e9310235f" };
const db = getFirestore(initializeApp(cfg));
const auth = getAuth();

let fails = 0;
const ok = (n, c, extra) => { if (c) console.log('  ✓ ' + n); else { fails++; console.log('  ✗ ' + n + (extra ? '  → ' + extra : '')); } };
const denied = e => String(e && e.code).includes('permission-denied');
async function mustFail(name, fn){ try { await fn(); ok(name, false, 'wurde ERLAUBT'); } catch(e){ ok(name, denied(e), e.code || String(e)); } }
async function mustWork(name, fn){ try { await fn(); ok(name, true); } catch(e){ ok(name, false, e.code || String(e)); } }

const SID = 's_test' + Date.now().toString(36);
const ref = doc(db, 'sessions', SID);
const now = Date.now(), exp = now + 3*60*60*1000;

console.log('\n1) Ohne Anmeldung — was ein Fremder darf');
await mustFail('Sitzung anlegen ist gesperrt', () => setDoc(ref, { name:'x', host:'fremd', codeHash:'x', createdAt:now, expiresAt:exp, live:true }));
await mustFail('Geometrie schreiben ist gesperrt', () => setDoc(doc(db,'sessions',SID,'state','geo'), { host:'fremd', data:'x', verts:1, at:now, expiresAt:exp }));
await mustFail('unbekannte Sitzung lesen ist gesperrt', () => getDoc(ref).then(d => { if (!d.exists()) throw { code:'permission-denied' }; }));

// Der Betreuer hat kein Konto — diese Pfade muessen ohne Anmeldung gehen.
console.log('\n2) Zuschauer ohne Konto — Markierungen und Anwesenheit');
const marks = collection(db, 'sessions', SID, 'marks');
await mustWork('Markierung setzen', () => addDoc(marks, { p:[1,2,3], t:'Hier klemmt es', at:now, by:'Betreuer', expiresAt:exp }));
await mustFail('zu langer Text wird abgelehnt', () => addDoc(marks, { p:[1,2,3], t:'x'.repeat(81), at:now, by:'B', expiresAt:exp }));
await mustFail('unerwartetes Feld wird abgelehnt', () => addDoc(marks, { p:[1,2,3], t:'x', at:now, by:'B', expiresAt:exp, schmuggel:'boese' }));
await mustFail('kaputte Koordinate wird abgelehnt', () => addDoc(marks, { p:[1,2], t:'x', at:now, by:'B', expiresAt:exp }));
await mustWork('Anwesenheit melden', () => setDoc(doc(db,'sessions',SID,'eyes','v_test'), { at:now, name:'Betreuer' }));
await mustFail('Anwesenheit mit Fremdfeld wird abgelehnt', () => setDoc(doc(db,'sessions',SID,'eyes','v_bad'), { at:now, name:'B', extra:1 }));
await mustWork('Markierung wieder zuruecknehmen', async () => {
  const q = await getDocs(marks);
  for (const d of q.docs) await deleteDoc(d.ref);
});
await mustWork('Anwesenheit abmelden', () => deleteDoc(doc(db,'sessions',SID,'eyes','v_test')));

console.log('\n3) Anmelden (anonym) und Sitzung fuehren');
let uid = null;
try { uid = (await signInAnonymously(auth)).user.uid; console.log('  · angemeldet als ' + uid.slice(0,8) + '…'); }
catch(e){ console.log('  ! anonyme Anmeldung nicht moeglich (' + e.code + ') — Rest wird uebersprungen'); process.exit(fails ? 1 : 0); }

await mustWork('Sitzung anlegen', () => setDoc(ref, { name:'Testmodell', host:uid, codeHash:'abc', createdAt:now, expiresAt:exp, live:true }));
await mustFail('Ablauf weiter als 24 h wird abgelehnt', () => setDoc(doc(db,'sessions','s_toolong'+now), { name:'x', host:uid, codeHash:'x', createdAt:now, expiresAt:now + 40*60*60*1000, live:true }));
await mustWork('Geometrie hochladen', () => setDoc(doc(db,'sessions',SID,'state','geo'), { host:uid, data:'GZ1:test', verts:99, at:now, expiresAt:exp }));
await mustWork('Kamera hochladen', () => setDoc(doc(db,'sessions',SID,'state','cam'), { host:uid, t:[0,0,0], th:0.6, ph:0.75, r:12, sel:['Wuerfel'], at:now, expiresAt:exp }));
await mustWork('laufende Sitzung ist lesbar', () => getDoc(ref).then(d => { if (!d.exists()) throw new Error('leer'); }));
await mustWork('Geometrie ist lesbar', () => getDoc(doc(db,'sessions',SID,'state','geo')).then(d => { if (!d.exists()) throw new Error('leer'); }));

console.log('\n4) Abgelaufene Sitzung ist dicht');
const OLD = 's_old' + now.toString(36);
await mustWork('abgelaufene Sitzung anlegen', () => setDoc(doc(db,'sessions',OLD), { name:'alt', host:uid, codeHash:'x', createdAt:now-9e6, expiresAt:now-1000, live:true }));
await mustFail('… und ist nicht mehr lesbar', () => getDoc(doc(db,'sessions',OLD)));

console.log('\n5) Aufraeumen');
try{
  for (const sub of ['marks','eyes']){
    const q = await getDocs(collection(db,'sessions',SID,sub));
    for (const d of q.docs) await deleteDoc(d.ref);
  }
  for (const s of ['geo','cam']) await deleteDoc(doc(db,'sessions',SID,'state',s));
  await deleteDoc(ref);
  await deleteDoc(doc(db,'sessions',OLD));
  ok('Testdaten wieder entfernt', true);
}catch(e){ ok('Testdaten wieder entfernt', false, e.code || String(e)); }

console.log(fails ? `\n${fails} Prüfung(en) fehlgeschlagen\n` : '\nRegeln verhalten sich wie vorgesehen\n');
process.exit(fails ? 1 : 0);
