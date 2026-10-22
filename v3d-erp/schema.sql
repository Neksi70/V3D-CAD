-- V3D ERP – Datenmodell (Prototyp)
-- Läuft unter SQLite. Bewusst PostgreSQL-tauglich gehalten:
-- nur INTEGER/TEXT/REAL, Datumswerte als ISO-Text, keine SQLite-Sonderfunktionen im Schema.
-- Beim Umzug nach PostgreSQL: "INTEGER PRIMARY KEY AUTOINCREMENT" → "BIGSERIAL PRIMARY KEY",
-- REAL-Beträge → NUMERIC(14,2).

PRAGMA foreign_keys = ON;

-- ---------- Benutzer ----------
CREATE TABLE IF NOT EXISTS benutzer (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  login       TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  pw_hash     TEXT NOT NULL,            -- pbkdf2_sha256$iter$salt$hash
  rolle       TEXT NOT NULL DEFAULT 'benutzer'   -- admin | benutzer | werkstatt
);

-- ---------- Grundlagen ----------
CREATE TABLE IF NOT EXISTS zahlungsbedingung (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  text        TEXT NOT NULL,
  tage_netto  INTEGER NOT NULL DEFAULT 30,
  skonto_tage INTEGER NOT NULL DEFAULT 0,
  skonto_pct  REAL    NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS lager (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  nr    TEXT NOT NULL UNIQUE,
  name  TEXT NOT NULL
);

-- Belegart steuert, was beim Verarbeiten passiert (wie in myfactory).
CREATE TABLE IF NOT EXISTS belegart (
  code        TEXT PRIMARY KEY,          -- AN, AB, LS, RE, GS, PA, BE, WE, ER
  bereich     TEXT NOT NULL,             -- VK | EK
  name        TEXT NOT NULL,
  praefix     TEXT NOT NULL,             -- Nummernkreis-Präfix, z. B. "RE"
  lager       INTEGER NOT NULL DEFAULT 0,-- -1 Abgang, +1 Zugang, 0 nichts
  op          TEXT,                      -- debitor | kreditor | NULL
  vorzeichen  INTEGER NOT NULL DEFAULT 1,-- -1 bei Gutschrift/Storno
  reihenfolge INTEGER NOT NULL DEFAULT 0
);

-- Erlaubte Weiterverarbeitung (Belegkette)
CREATE TABLE IF NOT EXISTS belegart_folge (
  von   TEXT NOT NULL REFERENCES belegart(code),
  nach  TEXT NOT NULL REFERENCES belegart(code),
  PRIMARY KEY (von, nach)
);

CREATE TABLE IF NOT EXISTS nummernkreis (
  praefix  TEXT NOT NULL,
  jahr     INTEGER NOT NULL,
  naechste INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (praefix, jahr)
);

-- ---------- Adressen: EINE Adresse, mehrere Rollen ----------
CREATE TABLE IF NOT EXISTS adresse (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  adressnr  TEXT NOT NULL UNIQUE,
  kurz      TEXT NOT NULL,               -- Kurzbezeichnung / Matchcode
  name1     TEXT NOT NULL,
  name2     TEXT,
  strasse   TEXT,
  plz       TEXT,
  ort       TEXT,
  land      TEXT NOT NULL DEFAULT 'DE',
  telefon   TEXT,
  email     TEXT,
  ust_id    TEXT,
  notiz     TEXT,
  angelegt  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kunde (
  adresse_id         INTEGER PRIMARY KEY REFERENCES adresse(id),
  kundennr           TEXT NOT NULL UNIQUE,
  zahlungsbed_id     INTEGER REFERENCES zahlungsbedingung(id),
  rabatt_pct         REAL NOT NULL DEFAULT 0,
  kreditlimit        REAL,
  leitweg_id         TEXT,               -- XRechnung (öffentliche Auftraggeber)
  liefersperre       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS lieferant (
  adresse_id         INTEGER PRIMARY KEY REFERENCES adresse(id),
  lieferantennr      TEXT NOT NULL UNIQUE,
  zahlungsbed_id     INTEGER REFERENCES zahlungsbedingung(id),
  unsere_kundennr    TEXT,
  mindestbestellwert REAL
);

CREATE TABLE IF NOT EXISTS ansprechpartner (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  adresse_id  INTEGER NOT NULL REFERENCES adresse(id),
  anrede      TEXT,
  vorname     TEXT,
  nachname    TEXT NOT NULL,
  funktion    TEXT,
  telefon     TEXT,
  email       TEXT
);

-- ---------- Artikel & Lager ----------
CREATE TABLE IF NOT EXISTS artikel (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  artikelnr     TEXT NOT NULL UNIQUE,
  kurz          TEXT NOT NULL,
  bezeichnung   TEXT NOT NULL,
  me            TEXT NOT NULL DEFAULT 'Stk',
  gruppe        TEXT,
  vk_preis      REAL NOT NULL DEFAULT 0,
  ek_preis      REAL NOT NULL DEFAULT 0,
  steuer_pct    REAL NOT NULL DEFAULT 19,
  lagerfuehrung INTEGER NOT NULL DEFAULT 1,
  meldebestand  REAL NOT NULL DEFAULT 0,
  hauptlieferant_id INTEGER REFERENCES adresse(id),
  inaktiv       INTEGER NOT NULL DEFAULT 0,
  memo          TEXT,
  kalk          TEXT                      -- einfache Kalkulation als JSON
);

CREATE TABLE IF NOT EXISTS lagerbewegung (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  datum      TEXT NOT NULL,
  artikel_id INTEGER NOT NULL REFERENCES artikel(id),
  lager_id   INTEGER NOT NULL REFERENCES lager(id),
  menge      REAL NOT NULL,              -- + Zugang, - Abgang
  beleg_id   INTEGER REFERENCES beleg(id),
  text       TEXT
);

-- ---------- Projekte (vor Beleg, weil Belege darauf zeigen) ----------
CREATE TABLE IF NOT EXISTS projekt (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  projektnr     TEXT NOT NULL UNIQUE,
  titel         TEXT NOT NULL,
  kunde_id      INTEGER REFERENCES adresse(id),
  ansprechpartner TEXT,
  status        TEXT NOT NULL DEFAULT 'aktiv',   -- angebot | aktiv | abgeschlossen
  angelegt      TEXT NOT NULL,
  plan_fixiert  TEXT,                             -- Zeitpunkt, an dem die Zusage eingefroren wurde
  memo          TEXT
);

-- ---------- Belege ----------
CREATE TABLE IF NOT EXISTS beleg (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  belegart       TEXT NOT NULL REFERENCES belegart(code),
  nummer         TEXT UNIQUE,            -- erst beim Verarbeiten vergeben
  status         TEXT NOT NULL DEFAULT 'entwurf',  -- entwurf | verarbeitet | storniert
  datum          TEXT NOT NULL,
  adresse_id     INTEGER NOT NULL REFERENCES adresse(id),
  projekt_id     INTEGER REFERENCES projekt(id),
  betreff        TEXT,
  ihre_referenz  TEXT,
  kopftext       TEXT,
  fusstext       TEXT,
  zahlungsbed_id INTEGER REFERENCES zahlungsbedingung(id),
  lager_id       INTEGER REFERENCES lager(id),
  netto          REAL NOT NULL DEFAULT 0,
  steuer         REAL NOT NULL DEFAULT 0,
  brutto         REAL NOT NULL DEFAULT 0,
  angelegt       TEXT NOT NULL,
  angelegt_von   TEXT,
  verarbeitet    TEXT,
  verarbeitet_von TEXT,
  memo           TEXT
);

CREATE TABLE IF NOT EXISTS beleg_position (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  beleg_id      INTEGER NOT NULL REFERENCES beleg(id) ON DELETE CASCADE,
  pos           INTEGER NOT NULL,
  artikel_id    INTEGER REFERENCES artikel(id),
  text          TEXT NOT NULL,
  menge         REAL NOT NULL DEFAULT 1,
  me            TEXT NOT NULL DEFAULT 'Stk',
  einzelpreis   REAL NOT NULL DEFAULT 0,
  rabatt_pct    REAL NOT NULL DEFAULT 0,
  steuer_pct    REAL NOT NULL DEFAULT 19,
  gesamt        REAL NOT NULL DEFAULT 0,  -- netto nach Rabatt
  vorgaenger_pos_id INTEGER REFERENCES beleg_position(id),
  charge_nr     TEXT,                     -- bei Wareneingang eingegeben bzw. bei Lieferung zugeordnet
  charge_id     INTEGER REFERENCES charge(id)
);

-- Belegkette: welcher Beleg ist aus welchem entstanden
CREATE TABLE IF NOT EXISTS beleg_verknuepfung (
  vorgaenger_id INTEGER NOT NULL REFERENCES beleg(id),
  nachfolger_id INTEGER NOT NULL REFERENCES beleg(id),
  PRIMARY KEY (vorgaenger_id, nachfolger_id)
);

CREATE TABLE IF NOT EXISTS offener_posten (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  art        TEXT NOT NULL,              -- debitor | kreditor
  beleg_id   INTEGER NOT NULL REFERENCES beleg(id),
  adresse_id INTEGER NOT NULL REFERENCES adresse(id),
  datum      TEXT NOT NULL,
  faellig    TEXT NOT NULL,
  betrag     REAL NOT NULL,
  offen      REAL NOT NULL,
  mahnstufe  INTEGER NOT NULL DEFAULT 0,
  letzte_mahnung TEXT,
  mahnsperre INTEGER NOT NULL DEFAULT 0
);

-- ---------- Meilensteine / Zeitstrahl ----------
CREATE TABLE IF NOT EXISTS meilenstein (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  projekt_id      INTEGER NOT NULL REFERENCES projekt(id) ON DELETE CASCADE,
  pos             INTEGER NOT NULL,
  titel           TEXT NOT NULL,
  verantwortlich  TEXT,
  ist_meilenstein INTEGER NOT NULL DEFAULT 0,  -- 1 = Punkt (◆), 0 = Zeitraum
  plan_start      TEXT NOT NULL,
  plan_ende       TEXT NOT NULL,
  zugesagt        TEXT NOT NULL,         -- eingefrorener Termin gegenüber dem Kunden
  ist_ende        TEXT,
  ausloeser       TEXT REFERENCES belegart(code),   -- erledigt sich automatisch, wenn ein solcher Beleg im Projekt verarbeitet wird
  ausloeser_beleg_id INTEGER REFERENCES beleg(id),
  grund           TEXT                   -- letzter Verschiebungsgrund (für den Kunden sichtbar)
);

CREATE TABLE IF NOT EXISTS projekt_verlauf (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  projekt_id INTEGER NOT NULL REFERENCES projekt(id) ON DELETE CASCADE,
  zeit       TEXT NOT NULL,
  benutzer   TEXT,
  text       TEXT NOT NULL
);

-- ---------- Kommunikation (Schritt 5: Outlook/Graph oder IMAP) ----------
CREATE TABLE IF NOT EXISTS mail (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id  TEXT UNIQUE,
  richtung    TEXT NOT NULL,            -- ein | aus
  von         TEXT, an TEXT, betreff TEXT, datum TEXT,
  adresse_id  INTEGER REFERENCES adresse(id),
  projekt_id  INTEGER REFERENCES projekt(id),
  beleg_id    INTEGER REFERENCES beleg(id)
);

-- ---------- Chargen (Lohnbearbeitung: Kundenmaterial; auch Einkauf möglich) ----------
CREATE TABLE IF NOT EXISTS charge (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  chargennr     TEXT NOT NULL,             -- Charge des Kunden / Sinterwerks (wie geliefert)
  adresse_id    INTEGER NOT NULL REFERENCES adresse(id),
  artikel_id    INTEGER REFERENCES artikel(id),
  herkunft      TEXT NOT NULL DEFAULT 'kunde',   -- kunde | einkauf
  eingang_beleg_id INTEGER REFERENCES beleg(id),
  eingang_pos_id   INTEGER REFERENCES beleg_position(id),
  kunden_ls     TEXT,                      -- Lieferschein-Nr. des Kunden
  datum         TEXT NOT NULL,
  bemerkung     TEXT,
  UNIQUE (chargennr, adresse_id, artikel_id)
);
CREATE TABLE IF NOT EXISTS charge_bewegung (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  charge_id INTEGER NOT NULL REFERENCES charge(id),
  datum     TEXT NOT NULL,
  art       TEXT NOT NULL,                 -- eingang | lieferung | ausschuss | korrektur
  menge     REAL NOT NULL,                 -- + Eingang, − Lieferung/Ausschuss
  beleg_id  INTEGER REFERENCES beleg(id),
  pos_id    INTEGER REFERENCES beleg_position(id),
  text      TEXT,
  benutzer  TEXT
);
CREATE INDEX IF NOT EXISTS ix_cb_charge ON charge_bewegung(charge_id);

-- ---------- Dokumente (Dateien an Charge, Beleg, Projekt, Adresse, Artikel) ----------
CREATE TABLE IF NOT EXISTS dokument (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  objekt     TEXT NOT NULL,
  objekt_id  INTEGER NOT NULL,
  name       TEXT NOT NULL,
  mime       TEXT,
  groesse    INTEGER,
  datei      TEXT NOT NULL,                -- Dateiname im Dokumentenordner
  hochgeladen TEXT NOT NULL,
  von        TEXT
);
CREATE INDEX IF NOT EXISTS ix_dok ON dokument(objekt, objekt_id);

-- ---------- Mahnwesen ----------
CREATE TABLE IF NOT EXISTS mahnstufe (
  stufe     INTEGER PRIMARY KEY,           -- 1, 2, 3 …
  name      TEXT NOT NULL,                 -- Zahlungserinnerung, 1. Mahnung …
  tage      INTEGER NOT NULL,              -- frühestens so viele Tage nach Fälligkeit bzw. letzter Stufe
  gebuehr   REAL NOT NULL DEFAULT 0,
  text      TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS mahnung (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  nummer     TEXT NOT NULL UNIQUE,
  adresse_id INTEGER NOT NULL REFERENCES adresse(id),
  datum      TEXT NOT NULL,
  stufe      INTEGER NOT NULL,
  gebuehr    REAL NOT NULL DEFAULT 0,
  summe      REAL NOT NULL,                -- offene Posten + Gebühr
  neue_frist TEXT NOT NULL,
  erstellt_von TEXT
);
CREATE TABLE IF NOT EXISTS mahnung_posten (
  mahnung_id INTEGER NOT NULL REFERENCES mahnung(id),
  op_id      INTEGER NOT NULL REFERENCES offener_posten(id),
  offen      REAL NOT NULL,
  tage_ueber INTEGER NOT NULL,
  PRIMARY KEY (mahnung_id, op_id)
);

-- ---------- Zahlungsabgleich (Kontoauszug) ----------
CREATE TABLE IF NOT EXISTS bankimport (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  datei     TEXT NOT NULL,
  format    TEXT NOT NULL,
  zeit      TEXT NOT NULL,
  von       TEXT,
  anzahl    INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS bankumsatz (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  import_id INTEGER REFERENCES bankimport(id),
  datum     TEXT NOT NULL,
  betrag    REAL NOT NULL,                 -- + Eingang, − Ausgang
  name      TEXT,
  iban      TEXT,
  zweck     TEXT,
  schluessel TEXT NOT NULL UNIQUE,         -- gegen doppelten Import
  status    TEXT NOT NULL DEFAULT 'offen', -- offen | zugeordnet | ignoriert
  op_id     INTEGER REFERENCES offener_posten(id),
  skonto    REAL NOT NULL DEFAULT 0,
  erledigt  TEXT,
  von       TEXT
);

-- ---------- Kundenpreise (Preis je Kunde/Artikel, Staffel) ----------
CREATE TABLE IF NOT EXISTS kundenpreis (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  adresse_id  INTEGER NOT NULL REFERENCES adresse(id),
  artikel_id  INTEGER NOT NULL REFERENCES artikel(id),
  ab_menge    REAL NOT NULL DEFAULT 1,
  preis       REAL NOT NULL,
  gueltig_ab  TEXT,
  gueltig_bis TEXT,
  bemerkung   TEXT
);
CREATE INDEX IF NOT EXISTS ix_kp ON kundenpreis(adresse_id, artikel_id);

-- ---------- Kennzeichen (eigene Zusatzfelder) ----------
CREATE TABLE IF NOT EXISTS kennzeichen_def (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  objekt     TEXT NOT NULL,                -- adresse | artikel
  name       TEXT NOT NULL,
  typ        TEXT NOT NULL DEFAULT 'text', -- text | zahl | datum | janein | auswahl
  optionen   TEXT,                         -- bei Auswahl: Werte mit ; getrennt
  reihenfolge INTEGER NOT NULL DEFAULT 0,
  UNIQUE (objekt, name)
);
CREATE TABLE IF NOT EXISTS kennzeichen_wert (
  def_id    INTEGER NOT NULL REFERENCES kennzeichen_def(id) ON DELETE CASCADE,
  objekt_id INTEGER NOT NULL,
  wert      TEXT,
  PRIMARY KEY (def_id, objekt_id)
);

-- ---------- Einstellungen (Briefkopf, Bank, Standardtexte, Logo als data-URL) ----------
CREATE TABLE IF NOT EXISTS einstellung (
  schluessel TEXT PRIMARY KEY,
  wert       TEXT
);

-- ---------- Protokoll (wer hat was geändert) ----------
CREATE TABLE IF NOT EXISTS protokoll (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  zeit     TEXT NOT NULL,
  benutzer TEXT,
  objekt   TEXT NOT NULL,
  objekt_id INTEGER,
  aktion   TEXT NOT NULL,
  details  TEXT
);

CREATE INDEX IF NOT EXISTS ix_beleg_adresse ON beleg(adresse_id);
CREATE INDEX IF NOT EXISTS ix_beleg_projekt ON beleg(projekt_id);
CREATE INDEX IF NOT EXISTS ix_pos_beleg ON beleg_position(beleg_id);
CREATE INDEX IF NOT EXISTS ix_lb_artikel ON lagerbewegung(artikel_id);
CREATE INDEX IF NOT EXISTS ix_ms_projekt ON meilenstein(projekt_id);
