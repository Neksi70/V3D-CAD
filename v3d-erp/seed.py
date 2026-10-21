"""Erfundene Testdaten für den Prototyp (keine echten Firmen oder Personen)."""
import datetime as dt

import erp


def d(n):
    return (dt.date.today() + dt.timedelta(days=n)).isoformat()


def befuellen(db, benutzer="seed"):
    if db.execute("SELECT 1 FROM adresse LIMIT 1").fetchone():
        return False
    if not db.execute("SELECT 1 FROM benutzer WHERE login='demo'").fetchone():
        db.execute("INSERT INTO benutzer(login,name,pw_hash,rolle) VALUES('demo','Demo Benutzer',?,'admin')", (erp.pw_hash("demo"),))

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

    # ---- Projekt 2: Adapterplatten-Serie
    p2 = erp.projekt_speichern(db, dict(titel="Adapterplatten Serie 2. Los (60 Stk.)", kunde_id=k2["id"], ansprechpartner="Fr. Beispiel",
        meilensteine=[
            dict(titel="Auftrag bestätigt", verantwortlich="Büro", plan_start=d(-20), plan_ende=d(-20), ist_meilenstein=1, ausloeser="AB"),
            dict(titel="Rohmaterial bestellt", verantwortlich="Einkauf", plan_start=d(-19), plan_ende=d(-18), ausloeser="BE"),
            dict(titel="Rohmaterial eingetroffen", verantwortlich="Lager", plan_start=d(-18), plan_ende=d(-9), ausloeser="WE"),
            dict(titel="CNC-Fertigung", verantwortlich="Werkstatt", plan_start=d(-8), plan_ende=d(1)),
            dict(titel="Oberfläche (Fremdvergabe)", verantwortlich="Einkauf", plan_start=d(2), plan_ende=d(7)),
            dict(titel="Endkontrolle & Prüfprotokoll", verantwortlich="QS", plan_start=d(8), plan_ende=d(9)),
            dict(titel="Teillieferung 30 Stk.", verantwortlich="Versand", plan_start=d(10), plan_ende=d(10), ist_meilenstein=1, ausloeser="LS"),
            dict(titel="Restlieferung 30 Stk.", verantwortlich="Versand", plan_start=d(17), plan_ende=d(17), ist_meilenstein=1, ausloeser="LS"),
        ]), benutzer)
    ab2 = beleg("AB", k2, [pos("100100", 60)], d(-20), p2["id"], "Adapterplatten AP-60, 2. Los")
    be2 = beleg("BE", l1, [pos("200100", 40, 6.80)], d(-18), p2["id"], "Flachstahl für AP-60")
    weiter(be2, "WE", d(-10))

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
