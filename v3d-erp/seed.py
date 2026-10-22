"""Erfundene Testdaten für den Prototyp (keine echten Firmen oder Personen)."""
import datetime as dt

import erp


def d(n):
    return (dt.date.today() + dt.timedelta(days=n)).isoformat()


def benutzer_sicherstellen(db):
    """Nur in einer leeren Datenbank Startbenutzer anlegen – danach Kennwörter mit benutzer.py verwalten."""
    if db.execute("SELECT 1 FROM benutzer LIMIT 1").fetchone():
        return
    for login, name, rolle in [("demo", "Demo Benutzer", "admin"), ("werkstatt", "Werkstatt-Tablet", "werkstatt")]:
        if not db.execute("SELECT 1 FROM benutzer WHERE login=?", (login,)).fetchone():
            db.execute("INSERT INTO benutzer(login,name,pw_hash,rolle) VALUES(?,?,?,?)", (login, name, erp.pw_hash(login), rolle))


def befuellen(db, benutzer="seed"):
    benutzer_sicherstellen(db)
    if db.execute("SELECT 1 FROM adresse LIMIT 1").fetchone():
        return False

    # Kunden
    k1 = erp.adresse_speichern(db, dict(kurz="BEISPIELWERK", name1="Beispielwerk Nord AG", strasse="Musterallee 1", plz="20095",
                                        ort="Hamburg", telefon="040 000000", email="einkauf@beispielwerk.example",
                                        kunde=dict(zahlungsbed_id=2)), benutzer)
    k2 = erp.adresse_speichern(db, dict(kurz="MUSTER ANTRIEB", name1="Muster Antriebstechnik GmbH", strasse="Testweg 7", plz="44135",
                                        ort="Dortmund", email="info@muster-antrieb.example", kunde=dict(zahlungsbed_id=3, rabatt_pct=3)), benutzer)
    k3 = erp.adresse_speichern(db, dict(kurz="TESTKUNDE SUED", name1="Testkunde Süd KG", strasse="Probestraße 12", plz="70173",
                                        ort="Stuttgart", kunde=dict(zahlungsbed_id=2)), benutzer)
    # Lieferanten
    l1 = erp.adresse_speichern(db, dict(kurz="STAHL MUSTER", name1="Stahlhandel Muster GmbH", plz="58089", ort="Hagen",
                                        email="vertrieb@stahl-muster.example", lieferant=dict(zahlungsbed_id=3, unsere_kundennr="K-4711")), benutzer)
    l2 = erp.adresse_speichern(db, dict(kurz="OBERFLAECHE", name1="Oberflächentechnik Beispiel", plz="58095", ort="Hagen",
                                        lieferant=dict(zahlungsbed_id=1)), benutzer)
    db.execute("INSERT INTO ansprechpartner(adresse_id,anrede,vorname,nachname,funktion,email) VALUES(?,?,?,?,?,?)",
               (k1["id"], "Herr", "Max", "Muster", "Einkauf", "m.muster@beispielwerk.example"))

    # Artikel
    A = {}
    for nr, kurz, bez, me, gr, vk, ek, lf, mb, lief in [
        ("100100", "ADAPTERPLATTE AP-60", "Adapterplatte AP-60, Stahl verzinkt, gefräst", "Stk", "Fertigteile", 89.00, 41.50, 1, 10, None),
        ("100200", "GRUNDRAHMEN SV", "Grundrahmen Sondervorrichtung, geschweißt", "Stk", "Fertigteile", 4850.00, 2100.00, 1, 0, None),
        ("200100", "FLACHSTAHL 60x10", "Flachstahl S235 60x10 mm", "m", "Rohmaterial", 0, 6.80, 1, 50, l1),
        ("200200", "VIERKANTROHR 80x80", "Vierkantrohr S355 80x80x4 mm", "m", "Rohmaterial", 0, 14.20, 1, 30, l1),
        ("300100", "VERZINKEN", "Feuerverzinken je kg (Fremdleistung)", "kg", "Fremdleistung", 0, 1.10, 0, 0, l2),
        ("900100", "KONSTRUKTION STD", "Konstruktion / CAD je Stunde", "Std", "Dienstleistung", 95.00, 0, 0, 0, None),
        ("900200", "MONTAGE STD", "Montage vor Ort je Stunde", "Std", "Dienstleistung", 78.00, 0, 0, 0, None),
    ]:
        A[nr] = erp.artikel_speichern(db, dict(artikelnr=nr, kurz=kurz, bezeichnung=bez, me=me, gruppe=gr, vk_preis=vk, ek_preis=ek,
                                               lagerfuehrung=lf, meldebestand=mb, hauptlieferant_id=lief and lief["id"]), benutzer)
    # Anfangsbestand
    for nr, m in [("100100", 12), ("200100", 120), ("200200", 18)]:
        db.execute("INSERT INTO lagerbewegung(datum,artikel_id,lager_id,menge,text) VALUES(?,?,1,?,?)", (d(-60), A[nr]["id"], m, "Anfangsbestand"))

    def pos(nr, menge, preis=None):
        a = A[nr]
        return dict(artikel_id=a["id"], text=a["bezeichnung"], menge=menge, me=a["me"],
                    einzelpreis=a["vk_preis"] if preis is None else preis, steuer_pct=19)

    def beleg(art, adr, positionen, datum, projekt=None, betreff=None, verarbeiten=True):
        b = erp.beleg_speichern(db, dict(belegart=art, adresse_id=adr["id"], datum=datum, projekt_id=projekt, betreff=betreff,
                                         zahlungsbed_id=(adr.get("kunde") or adr.get("lieferant") or {}).get("zahlungsbed_id"),
                                         positionen=positionen), benutzer)
        if verarbeiten:
            b = erp.beleg_verarbeiten(db, b["id"], benutzer)["beleg"]
        return b

    def weiter(b, art, datum, verarbeiten=True):
        n = erp.beleg_weiterverarbeiten(db, b["id"], art, benutzer)
        db.execute("UPDATE beleg SET datum=? WHERE id=?", (datum, n["id"]))
        if verarbeiten:
            n = erp.beleg_verarbeiten(db, n["id"], benutzer)["beleg"]
        return n

    # ---- Projekt 1: Sondervorrichtung (läuft, Material überfällig)
    p1 = erp.projekt_speichern(db, dict(titel="Sondervorrichtung Schweißzelle", kunde_id=k1["id"], ansprechpartner="Hr. Muster",
        meilensteine=[
            dict(titel="Auftrag bestätigt", verantwortlich="Büro", plan_start=d(-48), plan_ende=d(-46), ist_meilenstein=1, ausloeser="AB"),
            dict(titel="Konstruktion", verantwortlich="Konstruktion", plan_start=d(-45), plan_ende=d(-30), zugesagt=d(-31), ist_ende=d(-29), grund="Änderungswunsch Kunde"),
            dict(titel="Freigabe Zeichnung durch Kunde", verantwortlich="Kunde", plan_start=d(-29), plan_ende=d(-22), zugesagt=d(-26), ist_ende=d(-21), grund="Freigabe Kunde verzögert"),
            dict(titel="Material bestellt", verantwortlich="Einkauf", plan_start=d(-21), plan_ende=d(-19), ausloeser="BE"),
            dict(titel="Material eingetroffen", verantwortlich="Lager", plan_start=d(-19), plan_ende=d(-2), zugesagt=d(-5), ausloeser="WE", grund="Lieferant liefert später"),
            dict(titel="Fertigung Grundrahmen", verantwortlich="Werkstatt", plan_start=d(-1), plan_ende=d(8), zugesagt=d(5)),
            dict(titel="Montage & Inbetriebnahme intern", verantwortlich="Werkstatt", plan_start=d(9), plan_ende=d(15), zugesagt=d(12)),
            dict(titel="Vorabnahme beim Hersteller", verantwortlich="Projektleitung", plan_start=d(16), plan_ende=d(16), zugesagt=d(14), ist_meilenstein=1),
            dict(titel="Auslieferung", verantwortlich="Versand", plan_start=d(18), plan_ende=d(19), zugesagt=d(17), ausloeser="LS"),
            dict(titel="Endabnahme beim Kunden", verantwortlich="Projektleitung", plan_start=d(22), plan_ende=d(22), zugesagt=d(21), ist_meilenstein=1),
        ]), benutzer)
    an = beleg("AN", k1, [pos("100200", 1), pos("900100", 24)], d(-55), p1["id"], "Sondervorrichtung Schweißzelle")
    weiter(an, "AB", d(-46))
    be = beleg("BE", l1, [pos("200200", 36, 14.20), pos("200100", 20, 6.80)], d(-19), p1["id"], "Material Sondervorrichtung")
    weiter(be, "WE", d(0), verarbeiten=False)   # Wareneingang als Entwurf – zum Ausprobieren

    # ---- Projekt 2: Lohnbearbeitung – Kunde schickt Sinter-Rohteile, GSB bohrt/schneidet Gewinde, liefert in Losen zurück
    ld = erp.artikel_speichern(db, dict(artikelnr="300400", kurz="LD-40 BEARBEITUNG", bezeichnung="Lagerdeckel LD-40 – Bohren Ø6,8 + Gewinde M8 (Lohnbearbeitung)",
                                        me="Stk", gruppe="Lohnbearbeitung", vk_preis=0.62, ek_preis=0, lagerfuehrung=0,
                                        kalk=dict(ruestzeit_min=45, losgroesse=2500, stueckzeit_min=0.42, stundensatz=72, material=0, fremd=0, aufschlag_pct=15)), benutzer)
    p2 = erp.projekt_speichern(db, dict(titel="Lagerdeckel LD-40 – 5.000 Stk. Bohren/Gewinde", kunde_id=k2["id"], ansprechpartner="Fr. Beispiel",
        meilensteine=[
            dict(titel="Auftrag bestätigt", verantwortlich="Büro", plan_start=d(-20), plan_ende=d(-20), ist_meilenstein=1, ausloeser="AB"),
            dict(titel="Rohteile vom Kunden eingetroffen", verantwortlich="Lager", plan_start=d(-16), plan_ende=d(-12), ausloeser="WK"),
            dict(titel="Erstmuster & Prüfprotokoll", verantwortlich="QS", plan_start=d(-11), plan_ende=d(-9)),
            dict(titel="Bearbeitung Los 1 (2.500 Stk.)", verantwortlich="Werkstatt", plan_start=d(-8), plan_ende=d(-2)),
            dict(titel="Lieferung Los 1", verantwortlich="Versand", plan_start=d(-1), plan_ende=d(-1), ist_meilenstein=1, ausloeser="LS"),
            dict(titel="Bearbeitung Los 2 (2.500 Stk.)", verantwortlich="Werkstatt", plan_start=d(0), plan_ende=d(6)),
            dict(titel="Restlieferung Los 2", verantwortlich="Versand", plan_start=d(8), plan_ende=d(8), ist_meilenstein=1, ausloeser="LS"),
        ]), benutzer)
    ab2 = beleg("AB", k2, [dict(artikel_id=ld["id"], text=ld["bezeichnung"], menge=5000, me="Stk", einzelpreis=0.62, steuer_pct=19)],
                d(-20), p2["id"], "Lohnbearbeitung LD-40, Ihre Bestellung 4500012345")
    db.execute("UPDATE beleg SET ihre_referenz='4500012345' WHERE id=?", (ab2["id"],))
    # Wareneingang Kundenmaterial: 3.000 Rohteile Charge SW-2610-A (Rest 2.000 folgt)
    wk = erp.beleg_weiterverarbeiten(db, ab2["id"], "WK", benutzer)
    wk["positionen"][0].update(menge=3000, charge_nr="SW-2610-A")
    wk.update(ihre_referenz="LS 88412", datum=d(-13))
    wk = erp.beleg_speichern(db, wk, benutzer)
    erp.beleg_verarbeiten(db, wk["id"], benutzer)
    if erp.DOK_ORDNER:      # Beispiel-Werkszeugnis (erfunden) als PDF anhängen
        try:
            import io
            from reportlab.pdfgen import canvas as _cv
            buf = io.BytesIO(); c = _cv.Canvas(buf)
            c.setFont("Helvetica-Bold", 16); c.drawString(60, 780, "Werkszeugnis 3.1 (Beispiel)")
            c.setFont("Helvetica", 11)
            for i, t in enumerate(["Sinterwerk Beispiel GmbH", "Werkstoff: Sint-D11", "Charge: SW-2610-A", "Menge: 3.000 Stk", "Dichte: 6,9 g/cm³ – i. O.", "TESTDOKUMENT – erfundene Daten"]):
                c.drawString(60, 740 - i * 18, t)
            c.save()
            erp.dokument_speichern(db, "beleg", wk["id"], "Werkszeugnis_SW-2610-A.pdf", buf.getvalue(), "application/pdf", benutzer)
        except Exception:
            pass
    # Los 1 geliefert (2.500 aus Charge SW-2610-A)
    ls2 = erp.beleg_weiterverarbeiten(db, ab2["id"], "LS", benutzer)
    ls2["positionen"][0]["menge"] = 2500
    ls2["positionen"] = ls2["positionen"][:1]
    ls2.update(datum=d(-1), betreff="Lohnbearbeitung LD-40 – Los 1")
    ls2 = erp.beleg_speichern(db, ls2, benutzer)
    erp.beleg_verarbeiten(db, ls2["id"], benutzer)
    db.execute("INSERT INTO charge_bewegung(charge_id,datum,art,menge,text,benutzer) SELECT id, ?, 'ausschuss', -12, 'Ausschuss: Gewinde ausgerissen', 'seed' FROM charge WHERE chargennr='SW-2610-A'", (d(-2),))

    # ---- Projekt 3: abgeschlossen
    p3 = erp.projekt_speichern(db, dict(titel="Umbau Prüfstand Linie 3", kunde_id=k3["id"], ansprechpartner="Hr. Probe", status="abgeschlossen",
        meilensteine=[
            dict(titel="Auftrag bestätigt", plan_start=d(-70), plan_ende=d(-70), ist_ende=d(-70), ist_meilenstein=1, verantwortlich="Büro"),
            dict(titel="Aufmaß vor Ort", plan_start=d(-66), plan_ende=d(-65), ist_ende=d(-65), verantwortlich="Projektleitung"),
            dict(titel="Konstruktion Umbau", plan_start=d(-64), plan_ende=d(-50), ist_ende=d(-51), verantwortlich="Konstruktion"),
            dict(titel="Vormontage Werkstatt", plan_start=d(-34), plan_ende=d(-20), zugesagt=d(-21), ist_ende=d(-20), grund="Kapazität Fertigung", verantwortlich="Werkstatt"),
            dict(titel="Umbau beim Kunden", plan_start=d(-14), plan_ende=d(-8), ist_ende=d(-8), verantwortlich="Montage"),
            dict(titel="Abnahme & Übergabe", plan_start=d(-6), plan_ende=d(-6), ist_ende=d(-6), ist_meilenstein=1, verantwortlich="Projektleitung"),
            dict(titel="Schlussrechnung", plan_start=d(-4), plan_ende=d(-4), ist_meilenstein=1, ausloeser="RE", verantwortlich="Büro"),
        ]), benutzer)
    ab3 = beleg("AB", k3, [pos("900100", 40), pos("900200", 64)], d(-70), p3["id"], "Umbau Prüfstand Linie 3")
    ls3 = weiter(ab3, "LS", d(-6))
    weiter(ls3, "RE", d(-4))

    # Ein Angebot ohne Projekt, ein offener Entwurf
    beleg("AN", k2, [pos("100100", 120, 84.00)], d(-3), None, "Rahmenangebot AP-60 2027")
    beleg("RE", k1, [pos("900100", 6)], d(-40), None, "Konstruktionsänderung Halter")
    db.execute("INSERT INTO projekt_verlauf(projekt_id,zeit,benutzer,text) SELECT id, ?, 'seed', 'Testdaten angelegt' FROM projekt", (erp.jetzt(),))
    return True
