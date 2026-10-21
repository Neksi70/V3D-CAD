# Checkliste: Umstieg von myfactory – was wir von dir brauchen

Ziel: Ein eigenes System für dein Unternehmen, in dem du dich sofort zurechtfindest (gleiche Begriffe, gleiche Abläufe, gleiche Nummern), aber ohne den Ballast, den du nie benutzt.
Wir schauen uns dafür an, **wie** du myfactory nutzt. Deine Kundendaten werden dabei nicht abgeschrieben oder gespeichert.

---

## 1. Vorab regeln (bevor irgendwer reinschaut)
- [ ] **Vertrag zur Auftragsverarbeitung (AVV)** unterschreiben (Entwurf liegt bei). Du bleibst verantwortlich für deine Daten, Volme 3D arbeitet nur in deinem Auftrag.
- [ ] Kurz prüfen, ob dein myfactory-Vertrag zusätzliche Benutzer erlaubt (meist: ja, ggf. kostenpflichtig). **Bitte nicht dein eigenes Login weitergeben.**

## 2. Eigenen Benutzer anlegen
In myfactory unter **Administration › Berechtigungen**:
- [ ] Neuen Benutzer anlegen, z. B. `volme3d-analyse`, mit eigenem Kennwort
- [ ] Rechte: **nur lesen**. Keine Rechte zum Verarbeiten, Löschen, Drucken/Versenden, keine Administration und keine Benutzerverwaltung.
- [ ] Mit **„Simulation“** einmal prüfen, dass der Benutzer wirklich nichts ändern kann
- [ ] Zeitlich begrenzen: Nach der Analyse sperren wir den Benutzer wieder (Termin: ________)
- [ ] Gern im Änderungsprotokoll mitlaufen lassen, dann ist alles nachvollziehbar

## 3. Ein kurzes Gespräch (ca. 30–45 Min.)
Am besten zeigst du einmal deinen normalen Arbeitstag:
- [ ] Welche Menüpunkte öffnest du täglich, welche wöchentlich, welche monatlich?
- [ ] Welche Belegarten nutzt du wirklich? (z. B. Angebot → Auftrag → Lieferschein → Rechnung)
- [ ] Wer arbeitet noch damit, und in welcher Rolle?
- [ ] Was nervt dich an myfactory? Was darf auf keinen Fall fehlen?
- [ ] Welche Tastenkürzel und Abkürzungen benutzt du ständig?
- [ ] Buchhaltung: Machst du die in myfactory, oder geht alles an den Steuerberater (DATEV)?
- [ ] Hängen andere Programme dran? (Webshop, Versand, Bank, Kasse, Outlook …)

## 4. Was ich mit dem Lesezugang anschaue
Nur **Strukturen**, keine Inhalte:
- Menüpunkte, Masken und Felder, die bei dir tatsächlich befüllt sind
- Belegarten, Nummernkreise, Belegstatus, Zahlungs- und Mahnkonditionen, Preislisten (Aufbau, nicht deine Preise)
- deine Belegformulare (Aufbau, damit dein neuer Ausdruck vertraut aussieht)
- das Mengengerüst, z. B. „ca. 800 Kunden, 3.000 Artikel, 150 Rechnungen/Monat“

Ich notiere **keine** Namen, Adressen, Preise einzelner Kunden oder Belegsummen.

**Zum KI-Assistenten:** Bei der Entwicklung hilft mir ein KI-Assistent. Er sieht nur Masken **ohne** personenbezogene Daten (Konfiguration, Belegarten, leere Eingabemasken). Kunden- und Lieferantenlisten schaue ich mir allein an und gebe nur den Aufbau weiter. Die Import-Programme für die Datenübernahme entstehen mit erfundenen Testdaten. Deine echten Daten laufen ohne den Assistenten durch (siehe AVV, Anlage 3).

## 5. Später: Datenübernahme
Wenn das neue System steht, exportierst **du** deine Daten. Wir übernehmen sie dann in einem Rutsch:
- [ ] Kunden, Lieferanten, Ansprechpartner (Stammdatenlisten → Excel-Export)
- [ ] Artikel mit Preisen und Beständen
- [ ] Offene Belege und offene Posten zum Stichtag
- [ ] Historie: Wie weit zurück? (Für Steuerzwecke müssen alte Belege 8–10 Jahre lesbar bleiben. Das kann auch ein Archiv-Export sein, man muss sie nicht ins neue System übernehmen.)
- [ ] Alternativ über die REST-Schnittstelle von myfactory (Administration › Datenzugriff), falls es viele Daten sind

## 6. Abschluss der Analyse
- [ ] Analyse-Benutzer sperren oder löschen
- [ ] Du bekommst die Übersicht „myfactory → neues System“ (wo finde ich was?) zum Gegenlesen
