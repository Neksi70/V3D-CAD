# GSB-Ablauf aus Tommis Video (26.10.2026)

Quelle: Bildschirmaufnahme, 2:54 min, ohne Ton, myfactory „Echte Datenbank“. Ausgewertet über 52 Standbilder.
Kunden heißen hier „Kunde A“. Artikel- und Chargenangaben dienen nur als Formatbeispiel. Das Video selbst wurde nach der Auswertung gelöscht.

## Gezeigter Ablauf (ein Lohnauftrag von Anfang bis Lieferschein)

| # | Zeit | Was passiert | myfactory-Maske |
|---|------|--------------|-----------------|
| 1 | 0:00–0:23 | **Auftragsbestätigung AB260116** (12.10.) für Kunde A öffnen. Position „Ventilgehäuse“, 3.830 Stk à 0,6325 €. Darunter steht automatisch der **Arbeitsplan als Unterpositionen**: Rohteil (R-Nummer), AG000001 Wareneingangsprüfung, AG000019 Nut fräsen 12 mm ±0,1 (Abstand 13,5 ±0,2), AG000012 Endprüfung, AG000013 Endverpackung (LS erstellen, verpacken, Bereitstellung WA). Hinweis „WE vorhanden“ in grün. | Verkaufsschnellerfassung |
| 2 | 0:23 | Rechts die **Positionskennzeichen**: Anzahl Behälter 40, Ausschussteile 0, Behälter „Lochkiste SMB“ (sonst z. B. „Schäferkiste“), Chargennummer, Untergrund „Europalette“. Darunter die Pos-Referenzen: **Produktionsauftrag PA002099** und **Wareneingang WE2600226**. | Positionskennzeichen |
| 3 | 0:24–0:46 | **Wareneingang WE2600226** öffnen: ein *Einkaufsbeleg* an Kunde A, der dafür auch als **Lieferant** angelegt ist (K…-Nummer). Artikel „Ventilgehäuse (Rohmaterial)“, Preis 0. Im Dialog „Varianteneigenschaften“ werden Menge und Charge erfasst. **Menge von 3.830 auf 3.750 korrigiert**, weil tatsächlich weniger kam. | Einkaufsbelegerfassung |
| 4 | 0:46–1:05 | Zurück in die AB: **dieselbe Mengenkorrektur auf 3.750 noch einmal von Hand**. Position 2 (Ritzel, 62.850 Stk, andere Charge) hat Lieferscheine und eine Rechnung als Referenz, ist also schon teilweise geliefert. | Verkaufsschnellerfassung |
| 5 | 1:05–1:56 | **Produktionsauftrag PA002099**: Erstellt / Eingeplant / Freigegeben / Fertigmelden je 3.750. Die Positionen sind die Arbeitsgänge. „Entnehmen“ (Rohteil aus dem Standardlager) bringt die **Fehlermeldung „Diese Betriebsstätte hat keinen Zugriff auf das Quelllager ‚Standardlager‘ (Lagerprüfung Code 10007)“**. Er versucht es mehrmals, die Entnahme klappt nicht. | Produktionsauftrag bearbeiten → Entnahmen |
| 6 | 1:56–2:17 | **Neuer Lieferschein**, Kunde wählen. Der Dialog „Lieferschein erfassen“ zeigt **alle offenen AB-Positionen des Kunden über mehrere Aufträge**, je mit Chargennummer und offener Menge (28 Zeilen). Die gewünschte Zeile wird angehakt (grün = Lagerbestand vorhanden). | Lieferschein erfassen |
| 7 | 2:17–2:31 | Im LS stehen die Arbeitsgänge als Unterpositionen 1.1–1.5 (ME „mal“). Positionskennzeichen am LS: **Anzahl Behälter 40, Ausschussteile 677**, Behälter, Charge, Untergrund. Lagerbestand Standardlager 3.750. | Verkaufsschnellerfassung (LS) |
| 8 | 2:31–2:38 | **Verarbeiten → LS2600326**. Druckdialog: Variante „SR: GSB Standard Lieferschein neu“, Ausgabe als PDF- oder XRechnung-Download. | Drucken |
| 9 | 2:38–2:54 | Danach landet er auf der **Login-Seite** von myfactory, die Sitzung ist weg. *Vermutung:* Das ist die Instabilität, die Tommi beklagt. Es kann aber auch ein bewusstes Abmelden gewesen sein, das bitte nachfragen. | Login |

## Was wir daraus lernen

**Bestätigt** (deckt sich mit Tommis Schmerzpunkten):
- **Eine Mengenkorrektur muss an drei Stellen eingetragen werden** (WE, AB, Produktionsauftrag). Die Wareneingangsmenge muss die Wahrheit sein, alles andere folgt daraus.
- **Die Charge wird mehrfach getragen.** Sie ist ein zusammengesetzter Schlüssel aus 5 Teilen: `400003572 / 50 / 160022690 / 10 / 74548`.
- Den **Produktionsauftrag mit Lagerentnahme** braucht GSB eigentlich nicht. Er scheitert an der Lagerkonfiguration.
- **Instabilität:** Am Ende ist die Sitzung weg (siehe Schritt 9).

**Neu für uns:**
1. **Arbeitsplan mit Prüf- und Fertigungsschritten je Artikel.** Er enthält Maß- und Toleranzangaben und erscheint auf AB und LS als Unterpositionen.
2. **Positionskennzeichen für den Versand:** Anzahl Behälter, Behältertyp (Lochkiste SMB, Schäferkiste …), Ladungsträger (Europalette), Ausschussteile. Sie stehen auf dem Lieferschein.
3. **Ausschuss wird dem Kunden auf dem LS gemeldet**, weil das Material dem Kunden gehört.
4. **Sammel-Lieferschein:** ein LS aus offenen Positionen *mehrerer* Aufträge eines Kunden, mit Chargenanzeige.
5. **Kunde A ist zugleich Lieferant** (eigene K-Nummer), damit der Wareneingang als Einkaufsbeleg möglich ist.
6. Bei den **Teillieferungen** einer AB-Position hängen mehrere LS und eine Rechnung dran.

## Abgleich mit V3D ERP (Stand v. 26.10.)

| Thema | V3D ERP heute | Lücke / Vorschlag |
|-------|---------------|-------------------|
| Wareneingang Kundenmaterial | WK aus der AB, Charge einmal für alle, keine Lieferantenrolle nötig | passt. Abweichende Menge im WK: **AB-Menge automatisch angleichen** (Rückfrage beim Verarbeiten) |
| Charge | ein Textfeld | passt. Die 5 Teile bleiben ein Text, optional „Kunden-Bestell-Nr.“ usw. getrennt (Bedeutung klären) |
| Arbeitsplan | `artikel.arbeitsplan` (nur Namen) | **erweitern**: je Schritt Nummer, Text mit Toleranz, optional „Prüfschritt“. Auf AB/LS als Unterzeilen drucken |
| Produktion | Rückmeldung je Palette/Charge, keine Lagerentnahme | passt und ist einfacher als PA + Entnahme |
| Positionskennzeichen | Kennzeichen nur für Adresse/Artikel | **neu**: Kennzeichen auch für Belegpositionen (Behälter Anzahl/Typ, Ladungsträger). Auf LS drucken |
| Ausschuss auf LS | Ausschuss an der Charge gebucht, nicht auf dem LS | **LS zeigt je Charge „davon Ausschuss“** (aus der Produktion vorbelegt) |
| Sammel-LS | LS nur aus einer AB | **neu**: „Lieferschein aus offenen Positionen“ des Kunden, Auswahlliste mit Charge und Menge |
| Druck | PDF, XRechnung/ZUGFeRD | passt |
| Stabilität | eigener Server, keine Sitzungsabbrüche bei Neustart | passt |

## Rückfragen an Tommi
1. Was bedeuten die 5 Teile der Chargennummer (z. B. Bestell-Nr. / Pos. / Kunden-LS / Pos. / Charge)? Woher kommen sie, vom Lieferschein des Kunden?
2. „Ausschussteile 677“ auf dem LS: Ist das Ausschuss aus eurer Bearbeitung, oder fehlerhafte Rohteile vom Kunden? Geht der Ausschuss physisch mit zurück?
3. Welche Behältertypen und Ladungsträger gibt es (Liste)? Muss die Behälteranzahl auf den LS?
4. Wird der Arbeitsplan beim Kunden so mitgedruckt (AB/LS mit Unterpositionen), oder ist das nur intern?
5. War das Ende im Video (Login-Seite) ein Absturz oder bewusstes Abmelden?
6. Braucht ihr den Produktionsauftrag in myfactory für irgendetwas außer der Entnahme (Kalkulation, Zeiten)?
