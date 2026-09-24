# V3D Bank

Kontostände und Umsätze von **bunq**, **Revolut Business** und **SumUp** an einem Ort — nur lesend.

- Dienst: `v3dbank.service` (User-Unit), Port **8801**, lauscht **nur auf der Tailnet-Adresse**
  (`config.json` → `host`). Nicht in den Funnel hängen.
- Adresse: http://100.125.34.44:8801 bzw. http://v3da.tailf05fe9.ts.net:8801

## Sicherheit
- Alle Zugangsdaten liegen in `data/tresor.json`, AES-256-GCM, Schlüssel per scrypt aus dem Master-Passwort.
  Das Passwort wird nicht gespeichert → nach Neustart ist der Tresor zu, bis sich jemand anmeldet;
  bis dahin ruft der Server nichts ab. Passwort vergessen = Tresor löschen und Banken neu verbinden.
- Umsätze selbst liegen unverschlüsselt in `data/bank.db` (nur Besitzer lesbar).
- Anmeldung: 5 Fehlversuche → 10 min Sperre, Sitzung läuft nach 30 min Leerlauf ab.

## Banken
| Bank | Weg | Hinweise |
|---|---|---|
| bunq | Public API, API-Schlüssel aus der App | In der App „Alle IP-Adressen erlauben“, sonst an die Server-IP gebunden. Sandbox-Knopf zum Ausprobieren. |
| Revolut Business | Business API, eigenes Zertifikat + OAuth | Zertifikat in der App erzeugen → bei Revolut hochladen → Client-ID eintragen → Freigabe-Link → Weiterleitungsadresse einfügen (Code gilt 2 min). Refresh-Token läuft nicht ab. |
| SumUp | Händler-API, `sup_sk_…` | Liefert Kartenverkäufe, Erstattungen, Auszahlungen (Pseudo-Konto „SumUp Kasse“, ohne Saldo). |
| SumUp-Geschäftskonto | CSV-Import | Keine öffentliche API. me.sumup.com → Geschäftskonto → Herunterladen → CSV. |

Umbuchungen (SumUp-Auszahlung, Revolut zwischen eigenen Konten) laufen unter Kategorie „Umbuchung“ und
zählen in der Auswertung nicht als Einnahme/Ausgabe.

## Tests
- `python3 tests/test_banken.py` — Tresor, Revolut, SumUp, CSV ohne Netz
- `tests/e2e.py` — Browser-Durchlauf gegen eine Testinstanz mit eigenem Datenordner (Kopf der Datei)
