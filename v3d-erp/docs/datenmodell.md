# V3D ERP – Datenmodell (Schritt 1)

Grundlage: Funktionsanalyse myfactory (`~/myfactory-analyse`), Anforderungen GSB (`~/myfactory-analyse/gsb/anforderungen.md`).
Ziel: dieselben Begriffe und Abläufe wie myfactory (vertraut), aber schlank und mit echter Projekt-Terminverfolgung.
Technische Definition: `schema.sql`.

```
                 ┌──────────── kunde (kundennr, Zahlungsbed., Rabatt, Kreditlimit, Leitweg-ID)
adresse ─────────┤
(eine Adresse,   ├──────────── lieferant (lieferantennr, unsere Kd-Nr., Mindestbestellwert)
 viele Rollen)   └──────────── ansprechpartner (n)
   │
   ├── beleg (belegart, nummer erst beim Verarbeiten, status entwurf|verarbeitet|storniert)
   │     ├── beleg_position (Artikel, Menge, Preis, Rabatt, vorgaenger_pos_id → Restmengen)
   │     └── beleg_verknuepfung (Vorgänger → Nachfolger = Belegkette/Vorgang)
   │
   ├── offener_posten (debitor|kreditor, fällig, offen)   ← entsteht beim Verarbeiten von RE/GS/ER
   └── projekt
         ├── meilenstein (Plan Start/Ende, ZUGESAGT (eingefroren), IST, Auslöser-Belegart, Grund)
         └── projekt_verlauf (wer hat wann was verschoben/erledigt)

artikel ── lagerbewegung (+/−, mit Beleg)   ← entsteht beim Verarbeiten von LS (−) / WE (+)
belegart ── belegart_folge (erlaubte Weiterverarbeitung) ── nummernkreis (je Präfix und Jahr)
mail (für Schritt 5: Outlook/Graph) · protokoll (Änderungsprotokoll) · benutzer
```

## Die Regeln (aus myfactory übernommen, Ideen – kein Code)
1. **Eine Adresse, mehrere Rollen.** Kunde und Lieferant hängen an derselben Adresse. Kontaktdaten werden einmal gepflegt.
2. **Belegkette.** Folgebelege entstehen per „Weiterverarbeiten“ und übernehmen die **offene Restmenge** je Position (Teillieferungen!).
   Erlaubte Wege stehen in `belegart_folge`:
   - Verkauf: Angebot → Auftragsbestätigung → Lieferschein → Rechnung → Gutschrift (AB → Rechnung direkt ebenfalls)
   - Einkauf: Preisanfrage → Bestellung → Wareneingang → Rechnungseingang (Bestellung → Rechnungseingang direkt ebenfalls)
3. **„Verarbeiten“ ist der harte Schnitt.** Erst dann gibt es die endgültige Nummer (lückenlos je Jahr, `RE-26-0001`), danach ist der Beleg gesperrt (GoBD). Korrektur nur per Gutschrift.
4. **Belegart steuert die Wirkung:** LS bucht Lager ab, WE bucht zu, RE/GS erzeugen Debitoren-OP, ER erzeugt Kreditoren-OP.
5. **Verfügbar = Bestand − offene Auftragsmengen** (verarbeitete AB minus bereits gelieferte Mengen).

## Neu gegenüber myfactory: Projekt-Terminverfolgung
- Jeder Schritt hat **Plan** und **Zusage**. Die Zusage wird mit „Plan als Zusage einfrieren“ festgeschrieben, danach misst sich jede Verschiebung daran.
- **Verschieben nur mit Grund.** Folgeschritte werden auf Wunsch mitgeschoben und bekommen den Hinweis „Folge aus Schritt X“.
- **Automatisch erledigt:** Ein Schritt mit Auslöser (z. B. Wareneingang) wird erledigt, sobald im Projekt ein solcher Beleg verarbeitet wird.
- Status: gehalten / mit Verzug / in Arbeit / gefährdet (≤ 3 Tage) / überfällig / geplant. Termintreue in %, Endtermin gegenüber Zusage.
- Kundenansicht und PDF ohne interne Informationen.

## Umzug SQLite → PostgreSQL (Produktion bei GSB)
- `INTEGER PRIMARY KEY AUTOINCREMENT` → `BIGSERIAL PRIMARY KEY`, Beträge `REAL` → `NUMERIC(14,2)`
- `ON CONFLICT … DO UPDATE` und `CAST/GLOB` in `erp.py` (Stammnummern) anpassen: `GLOB '[0-9]*'` → `~ '^[0-9]+$'`
- `julianday()` in `op_liste` → `CURRENT_DATE - faellig`
- Verbindung über psycopg statt sqlite3 (einzige neue Abhängigkeit)
