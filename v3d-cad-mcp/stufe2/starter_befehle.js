    'starter.list': { undo: false, doc: '{filter?} — alle Generatoren mit eigenem Fenster (Vase, Schraube/Mutter, Zahnrad, Gehäuse, Laterne …) mit Name und Beschreibung. Die Kinder-Generatoren laufen über gen.*', fn(p) {
      const f = String(p.filter || '').toLowerCase();
      return { starters: starters().filter(s => !f || (s.t + ' ' + s.d).toLowerCase().includes(f)).map(s => ({ name: s.t, desc: s.d })) };
    } },
    'starter.inspect': { undo: false, doc: '{name} — Regler eines Generators: key, Art (wahl = Knopfgruppe mit options, range/number mit min/max, checkbox, auswahl, text), Beschriftung, aktueller Wert. Öffnet das Fenster kurz und schließt es wieder', async fn(p) {
      return starterInspect(p.name);
    } },
    'starter.run': { doc: '{name, params?: {key: wert} (keys aus starter.inspect; bei wahl der Knopf-Text), center?: [x,y] mm, timeout?: s (Standard 120)} — Generator mit diesen Einstellungen bauen; liefert die neuen Teile. Knopfgruppen werden zuerst gesetzt (sie blenden Regler ein), dann die Regler', async fn(p, log) {
      return starterRun(p, log);
    } },
