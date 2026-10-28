"""E-Rechnung (EN 16931): XRechnung (CII-Syntax) und ZUGFeRD/Factur-X erzeugen, XRechnung/ZUGFeRD (CII oder UBL) einlesen.

Versand: Rechnungen (380) und Gutschriften (381) aus V3D ERP.
Empfang: XML oder ZUGFeRD-PDF → Rechnungseingang (ER) als Entwurf, Lieferant über USt-IdNr./Name.
ZUGFeRD braucht factur-x + pypdf (.venv); XRechnung allein kommt mit der Standardbibliothek aus.
"""
import datetime as _dt
import io
import os
import re
import xml.etree.ElementTree as ET
from xml.sax.saxutils import escape as _x

import erp
from erp import Fehler, zeile, zeilen

XRECHNUNG_ID = "urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0"
FACTURX_ID = "urn:cen.eu:en16931:2017"
PEPPOL_PROZESS = "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0"

# Mengeneinheit → UN/ECE Rec. 20 (und zurück)
EINHEITEN = {"stk": "C62", "stück": "C62", "st": "C62", "std": "HUR", "h": "HUR", "stunde": "HUR", "m": "MTR", "kg": "KGM", "g": "GRM",
             "t": "TNE", "l": "LTR", "m²": "MTK", "m2": "MTK", "m³": "MTQ", "paar": "PR", "satz": "SET", "psch": "LS", "pauschal": "LS",
             "tag": "DAY", "min": "MIN", "km": "KMT", "mm": "MMT", "cm": "CMT", "karton": "CT", "rolle": "RO", "blatt": "ST"}
EINHEITEN_ZURUECK = {"C62": "Stk", "H87": "Stk", "HUR": "Std", "MTR": "m", "KGM": "kg", "GRM": "g", "TNE": "t", "LTR": "l", "MTK": "m²",
                     "MTQ": "m³", "PR": "Paar", "SET": "Satz", "LS": "psch", "DAY": "Tag", "MIN": "min", "KMT": "km", "MMT": "mm", "XPP": "Stk", "EA": "Stk"}


def _einheit(me):
    return EINHEITEN.get((me or "").strip().lower(), "C62")


def _b(v):
    return f"{float(v):.2f}"


def _d102(d):
    return (d or "")[:10].replace("-", "")


def _menge(v):
    s = f"{float(v):.4f}".rstrip("0").rstrip(".")
    return s or "0"


# ================================================================ Daten prüfen und zusammenstellen
def _daten(db, bid):
    b = erp.beleg_lesen(db, bid)
    if b["belegart"] not in ("RE", "GS"):
        raise Fehler("E-Rechnungen gibt es nur für Rechnungen und Gutschriften.")
    if b["status"] != "verarbeitet":
        raise Fehler("Bitte die Rechnung zuerst verarbeiten – erst dann hat sie ihre endgültige Nummer.")
    e = erp.einstellungen(db)
    a = erp.adresse_lesen(db, b["adresse_id"])
    fehlt = []
    for k, t in [("firma_name", "Firmenname"), ("strasse", "Straße"), ("plz", "PLZ"), ("ort", "Ort"), ("ust_id", "USt-IdNr."),
                 ("iban", "IBAN"), ("email", "E-Mail"), ("telefon", "Telefon")]:
        if not (e.get(k) or "").strip():
            fehlt.append(f"Firmendaten: {t}")
    for k, t in [("name1", "Name"), ("strasse", "Straße"), ("plz", "PLZ"), ("ort", "Ort"), ("email", "E-Mail (elektronische Adresse, Pflicht in XRechnung)")]:
        if not (a.get(k) or "").strip():
            fehlt.append(f"Kunde {a['kurz']}: {t}")
    if fehlt:
        raise Fehler("Für die E-Rechnung fehlt noch: " + "; ".join(fehlt) + ".")
    if not b["positionen"]:
        raise Fehler("Die Rechnung hat keine Positionen.")
    zb = zeile(db.execute("SELECT * FROM zahlungsbedingung WHERE id=?", (b["zahlungsbed_id"],))) if b["zahlungsbed_id"] else None
    op = zeile(db.execute("SELECT faellig FROM offener_posten WHERE beleg_id=?", (bid,)))
    vorg = zeile(db.execute("""SELECT r.nummer, r.datum FROM beleg_verknuepfung v JOIN beleg r ON r.id=v.vorgaenger_id
                               WHERE v.nachfolger_id=? AND r.belegart='RE'""", (bid,)))
    lieferung = zeile(db.execute("""SELECT MAX(l.datum) d FROM beleg_verknuepfung v JOIN beleg l ON l.id=v.vorgaenger_id
                                    WHERE v.nachfolger_id=? AND l.belegart='LS'""", (bid,)))
    artnr = {r["id"]: r["artikelnr"] for r in db.execute("SELECT id, artikelnr FROM artikel")}
    return b, e, a, zb, (op or {}).get("faellig"), vorg, (lieferung or {}).get("d") or b["datum"], artnr


def _steuer(b):
    """Steuer je Satz (EN 16931: Betrag = Basis × Satz, kaufmännisch gerundet je Kategorie)."""
    saetze = {}
    for p in b["positionen"]:
        saetze[p["steuer_pct"]] = round(saetze.get(p["steuer_pct"], 0) + p["gesamt"], 2)
    return [(s, basis, round(basis * s / 100 + 1e-9, 2)) for s, basis in sorted(saetze.items(), reverse=True)]


# ================================================================ CII erzeugen
def cii_xml(db, bid, profil="xrechnung"):
    b, e, a, zb, faellig, vorg, lieferdatum, artnr = _daten(db, bid)
    gutschrift = b["belegart"] == "GS"
    steuern = _steuer(b)
    netto = round(sum(p["gesamt"] for p in b["positionen"]), 2)
    steuer = round(sum(s[2] for s in steuern), 2)
    brutto = round(netto + steuer, 2)
    kunde_ref = (a.get("kunde") or {}).get("leitweg_id") or b.get("ihre_referenz") or (a.get("kunde") or {}).get("kundennr") or "n/a"
    kat = lambda s: "S" if s > 0 else "Z"

    def adresse(x):
        return (f"<ram:PostalTradeAddress><ram:PostcodeCode>{_x(x['plz'])}</ram:PostcodeCode><ram:LineOne>{_x(x['strasse'])}</ram:LineOne>"
                + (f"<ram:LineTwo>{_x(x['name2'])}</ram:LineTwo>" if x.get("name2") else "")
                + f"<ram:CityName>{_x(x['ort'])}</ram:CityName><ram:CountryID>{_x((x.get('land') or 'DE')[:2].upper())}</ram:CountryID></ram:PostalTradeAddress>")

    zeilen_ = []
    for p in b["positionen"]:
        if erp.ist_textzeile(p):          # reine Textzeile (z. B. „aus Auftragsbestätigung …“) gehört nicht in die E-Rechnung
            continue
        netto_preis = round(p["einzelpreis"] * (1 - (p["rabatt_pct"] or 0) / 100), 4)
        ls = db.execute("""SELECT b.nummer FROM beleg_position v JOIN beleg b ON b.id=v.beleg_id
                           WHERE v.id=? AND b.belegart='LS'""", (p["vorgaenger_pos_id"],)).fetchone() if p.get("vorgaenger_pos_id") else None
        name = p["text"] + (f" – Lieferschein {ls['nummer']}" if ls else "") + (f" – Charge {p['charge_nr']}" if p.get("charge_nr") else "")
        zeilen_.append(f"""<ram:IncludedSupplyChainTradeLineItem>
<ram:AssociatedDocumentLineDocument><ram:LineID>{p['pos']}</ram:LineID></ram:AssociatedDocumentLineDocument>
<ram:SpecifiedTradeProduct>{f"<ram:SellerAssignedID>{_x(artnr[p['artikel_id']])}</ram:SellerAssignedID>" if p.get('artikel_id') in artnr else ''}<ram:Name>{_x(name[:500])}</ram:Name></ram:SpecifiedTradeProduct>
<ram:SpecifiedLineTradeAgreement><ram:NetPriceProductTradePrice><ram:ChargeAmount>{netto_preis:.4f}</ram:ChargeAmount></ram:NetPriceProductTradePrice></ram:SpecifiedLineTradeAgreement>
<ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="{_einheit(p['me'])}">{_menge(p['menge'])}</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery>
<ram:SpecifiedLineTradeSettlement><ram:ApplicableTradeTax><ram:TypeCode>VAT</ram:TypeCode><ram:CategoryCode>{kat(p['steuer_pct'])}</ram:CategoryCode><ram:RateApplicablePercent>{_b(p['steuer_pct'])}</ram:RateApplicablePercent></ram:ApplicableTradeTax>
<ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>{_b(p['gesamt'])}</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation></ram:SpecifiedLineTradeSettlement>
</ram:IncludedSupplyChainTradeLineItem>""")

    bedingung = (zb or {}).get("text") or "Zahlbar ohne Abzug"
    if zb and zb.get("skonto_pct"):
        bedingung = f"#SKONTO#TAGE={zb['skonto_tage']}#PROZENT={zb['skonto_pct']:.2f}#\n{bedingung}"      # XRechnung-Skontoangabe
    kontakt = (f"<ram:DefinedTradeContact><ram:PersonName>{_x(e.get('geschaeftsfuehrer') or e['firma_name'])}</ram:PersonName>"
               f"<ram:TelephoneUniversalCommunication><ram:CompleteNumber>{_x(e['telefon'])}</ram:CompleteNumber></ram:TelephoneUniversalCommunication>"
               f"<ram:EmailURIUniversalCommunication><ram:URIID>{_x(e['email'])}</ram:URIID></ram:EmailURIUniversalCommunication></ram:DefinedTradeContact>")
    hr = f"<ram:SpecifiedLegalOrganization><ram:ID>{_x(e['handelsregister'])}</ram:ID></ram:SpecifiedLegalOrganization>" if e.get("handelsregister") else ""
    ust_kunde = f"<ram:SpecifiedTaxRegistration><ram:ID schemeID=\"VA\">{_x(a['ust_id'])}</ram:ID></ram:SpecifiedTaxRegistration>" if a.get("ust_id") else ""
    bestellung = f"<ram:BuyerOrderReferencedDocument><ram:IssuerAssignedID>{_x(b['ihre_referenz'])}</ram:IssuerAssignedID></ram:BuyerOrderReferencedDocument>" if b.get("ihre_referenz") else ""
    vorgaenger = (f"<ram:InvoiceReferencedDocument><ram:IssuerAssignedID>{_x(vorg['nummer'])}</ram:IssuerAssignedID>"
                  f"<ram:FormattedIssueDateTime><qdt:DateTimeString format=\"102\">{_d102(vorg['datum'])}</qdt:DateTimeString></ram:FormattedIssueDateTime></ram:InvoiceReferencedDocument>") if gutschrift and vorg else ""
    notiz = "".join(f"<ram:IncludedNote><ram:Content>{_x(t)}</ram:Content></ram:IncludedNote>" for t in [b.get("kopftext"), b.get("fusstext")] if (t or "").strip())
    guideline = XRECHNUNG_ID if profil == "xrechnung" else FACTURX_ID
    xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
<rsm:ExchangedDocumentContext>
<ram:BusinessProcessSpecifiedDocumentContextParameter><ram:ID>{PEPPOL_PROZESS}</ram:ID></ram:BusinessProcessSpecifiedDocumentContextParameter>
<ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>{guideline}</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter>
</rsm:ExchangedDocumentContext>
<rsm:ExchangedDocument><ram:ID>{_x(b['nummer'])}</ram:ID><ram:TypeCode>{381 if gutschrift else 380}</ram:TypeCode>
<ram:IssueDateTime><udt:DateTimeString format="102">{_d102(b['datum'])}</udt:DateTimeString></ram:IssueDateTime>{notiz}</rsm:ExchangedDocument>
<rsm:SupplyChainTradeTransaction>
{''.join(zeilen_)}
<ram:ApplicableHeaderTradeAgreement>
<ram:BuyerReference>{_x(kunde_ref)}</ram:BuyerReference>
<ram:SellerTradeParty><ram:Name>{_x(e['firma_name'])}</ram:Name>{hr}{kontakt}{adresse(e)}
<ram:URIUniversalCommunication><ram:URIID schemeID="EM">{_x(e['email'])}</ram:URIID></ram:URIUniversalCommunication>
<ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">{_x(e['ust_id'].replace(' ', ''))}</ram:ID></ram:SpecifiedTaxRegistration></ram:SellerTradeParty>
<ram:BuyerTradeParty>{f"<ram:ID>{_x((a.get('kunde') or {}).get('kundennr') or '')}</ram:ID>" if (a.get('kunde') or {}).get('kundennr') else ''}<ram:Name>{_x(a['name1'])}</ram:Name>{adresse(a)}
<ram:URIUniversalCommunication><ram:URIID schemeID="EM">{_x(a['email'])}</ram:URIID></ram:URIUniversalCommunication>{ust_kunde}</ram:BuyerTradeParty>
{bestellung}
</ram:ApplicableHeaderTradeAgreement>
<ram:ApplicableHeaderTradeDelivery><ram:ActualDeliverySupplyChainEvent><ram:OccurrenceDateTime><udt:DateTimeString format="102">{_d102(lieferdatum)}</udt:DateTimeString></ram:OccurrenceDateTime></ram:ActualDeliverySupplyChainEvent></ram:ApplicableHeaderTradeDelivery>
<ram:ApplicableHeaderTradeSettlement>
<ram:PaymentReference>{_x(b['nummer'])}</ram:PaymentReference>
<ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>
<ram:SpecifiedTradeSettlementPaymentMeans><ram:TypeCode>58</ram:TypeCode><ram:Information>SEPA-Überweisung</ram:Information>
<ram:PayeePartyCreditorFinancialAccount><ram:IBANID>{_x(e['iban'].replace(' ', ''))}</ram:IBANID><ram:AccountName>{_x(e['firma_name'])}</ram:AccountName></ram:PayeePartyCreditorFinancialAccount>
{f"<ram:PayeeSpecifiedCreditorFinancialInstitution><ram:BICID>{_x(e['bic'].replace(' ', ''))}</ram:BICID></ram:PayeeSpecifiedCreditorFinancialInstitution>" if e.get('bic') else ''}
</ram:SpecifiedTradeSettlementPaymentMeans>
{''.join(f"<ram:ApplicableTradeTax><ram:CalculatedAmount>{_b(st)}</ram:CalculatedAmount><ram:TypeCode>VAT</ram:TypeCode><ram:BasisAmount>{_b(ba)}</ram:BasisAmount><ram:CategoryCode>{kat(s)}</ram:CategoryCode><ram:RateApplicablePercent>{_b(s)}</ram:RateApplicablePercent></ram:ApplicableTradeTax>" for s, ba, st in steuern)}
<ram:SpecifiedTradePaymentTerms><ram:Description>{_x(bedingung)}</ram:Description>{f'<ram:DueDateDateTime><udt:DateTimeString format="102">{_d102(faellig)}</udt:DateTimeString></ram:DueDateDateTime>' if faellig else ''}</ram:SpecifiedTradePaymentTerms>
<ram:SpecifiedTradeSettlementHeaderMonetarySummation><ram:LineTotalAmount>{_b(netto)}</ram:LineTotalAmount><ram:TaxBasisTotalAmount>{_b(netto)}</ram:TaxBasisTotalAmount>
<ram:TaxTotalAmount currencyID="EUR">{_b(steuer)}</ram:TaxTotalAmount><ram:GrandTotalAmount>{_b(brutto)}</ram:GrandTotalAmount><ram:DuePayableAmount>{_b(brutto)}</ram:DuePayableAmount></ram:SpecifiedTradeSettlementHeaderMonetarySummation>
{vorgaenger}
</ram:ApplicableHeaderTradeSettlement>
</rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>"""
    return xml.encode("utf-8"), b


def xrechnung(db, bid):
    xml, b = cii_xml(db, bid, "xrechnung")
    return xml, f"XRechnung_{b['nummer']}.xml"


def zugferd(db, bid):
    """Rechnungs-PDF (PDF/A-3-tauglich, eingebettete Schriften) + Factur-X/ZUGFeRD-XML (Profil EN 16931)."""
    try:
        from facturx import generate_from_binary
    except ImportError:
        raise Fehler("ZUGFeRD braucht das Paket factur-x (Server mit .venv/bin/python starten).")
    import bericht
    xml, b = cii_xml(db, bid, "facturx")
    pdf, _ = bericht.beleg_pdf(db, bid, pdfa=True)
    e = erp.einstellungen(db)
    meta = {"author": e.get("firma_name") or "", "keywords": "Factur-X, ZUGFeRD, E-Rechnung", "title": f"{b['belegart_name']} {b['nummer']}",
            "subject": f"{b['belegart_name']} {b['nummer']} vom {b['datum']}"}
    out = generate_from_binary(pdf, xml, flavor="factur-x", level="en16931", check_xsd=True, pdf_metadata=meta, lang="de-DE")
    return _farbprofil(out), f"{b['belegart_name'].split(' ')[0]}_{b['nummer']}.pdf"


ICC_PFADE = (os.path.join(os.path.dirname(os.path.abspath(__file__)), "ressourcen", "sRGB.icc"),
             "/usr/share/color/icc/colord/sRGB.icc", "/usr/share/color/icc/ghostscript/srgb.icc")


def _farbprofil(pdf):
    """PDF/A verlangt einen OutputIntent mit ICC-Profil – factur-x setzt keinen, also hier ergänzen."""
    icc = next((p for p in ICC_PFADE if os.path.exists(p)), None)
    if not icc:
        return pdf
    from pypdf import PdfReader, PdfWriter
    from pypdf.generic import ArrayObject, DictionaryObject, NameObject, NumberObject, StreamObject, TextStringObject
    w = PdfWriter(clone_from=PdfReader(io.BytesIO(pdf)))
    strom = StreamObject()
    with open(icc, "rb") as f:
        strom.set_data(f.read())
    strom[NameObject("/N")] = NumberObject(3)
    intent = DictionaryObject({NameObject("/Type"): NameObject("/OutputIntent"), NameObject("/S"): NameObject("/GTS_PDFA1"),
                               NameObject("/OutputConditionIdentifier"): TextStringObject("sRGB IEC61966-2.1"),
                               NameObject("/Info"): TextStringObject("sRGB IEC61966-2.1"),
                               NameObject("/DestOutputProfile"): w._add_object(strom)})
    w._root_object[NameObject("/OutputIntents")] = ArrayObject([w._add_object(intent)])
    out = io.BytesIO()
    w.write(out)
    return out.getvalue()


# ================================================================ Einlesen (CII oder UBL, auch aus ZUGFeRD-PDF)
def _lokal(tag):
    return tag.split("}")[-1]


def _kind(el, *pfad):
    for teil in pfad:
        if el is None:
            return None
        el = next((c for c in el if _lokal(c.tag) == teil), None)
    return el


def _text(el, *pfad):
    x = _kind(el, *pfad)
    return (x.text or "").strip() if x is not None and x.text else ""


def _alle(el, name):
    return [x for x in el.iter() if _lokal(x.tag) == name]


def _datum(s):
    s = (s or "").strip()
    if re.fullmatch(r"\d{8}", s):
        return f"{s[:4]}-{s[4:6]}-{s[6:]}"
    return s[:10] if re.match(r"\d{4}-\d{2}-\d{2}", s) else None


def _zahl(s):
    try:
        return float((s or "0").strip())
    except ValueError:
        return 0.0


def xml_auslesen(daten):
    """Gemeinsames Ergebnis für CII und UBL: dict mit Kopf, Verkäufer, Positionen, Summen."""
    try:
        root = ET.fromstring(daten)
    except ET.ParseError:
        raise Fehler("Die Datei ist keine gültige E-Rechnung (XML nicht lesbar).")
    art = _lokal(root.tag)
    if art == "CrossIndustryInvoice":
        doc = _kind(root, "ExchangedDocument")
        tx = _kind(root, "SupplyChainTradeTransaction")
        agr = _kind(tx, "ApplicableHeaderTradeAgreement")
        st = _kind(tx, "ApplicableHeaderTradeSettlement")
        sel = _kind(agr, "SellerTradeParty")
        adr = _kind(sel, "PostalTradeAddress")
        summ = _kind(st, "SpecifiedTradeSettlementHeaderMonetarySummation")
        ust = next((x.text.strip() for x in _alle(sel, "ID") if x.get("schemeID") == "VA" and x.text), "")
        r = dict(syntax="CII", nummer=_text(doc, "ID"), typ=_text(doc, "TypeCode") or "380",
                 datum=_datum(_text(doc, "IssueDateTime", "DateTimeString")),
                 faellig=_datum(_text(st, "SpecifiedTradePaymentTerms", "DueDateDateTime", "DateTimeString")),
                 verkaeufer=dict(name=_text(sel, "Name"), strasse=_text(adr, "LineOne"), plz=_text(adr, "PostcodeCode"), ort=_text(adr, "CityName"),
                                 land=_text(adr, "CountryID") or "DE", ust_id=ust,
                                 email=_text(sel, "URIUniversalCommunication", "URIID") or _text(sel, "DefinedTradeContact", "EmailURIUniversalCommunication", "URIID")),
                 bestellung=_text(agr, "BuyerOrderReferencedDocument", "IssuerAssignedID"),
                 netto=_zahl(_text(summ, "TaxBasisTotalAmount")), steuer=_zahl(_text(summ, "TaxTotalAmount")), brutto=_zahl(_text(summ, "GrandTotalAmount")),
                 iban=_text(st, "SpecifiedTradeSettlementPaymentMeans", "PayeePartyCreditorFinancialAccount", "IBANID"), positionen=[])
        for li in [c for c in tx if _lokal(c.tag) == "IncludedSupplyChainTradeLineItem"]:
            menge_el = _kind(li, "SpecifiedLineTradeDelivery", "BilledQuantity")
            preis_el = _kind(li, "SpecifiedLineTradeAgreement", "NetPriceProductTradePrice")
            basis = _zahl(_text(preis_el, "BasisQuantity")) or 1
            r["positionen"].append(dict(text=_text(li, "SpecifiedTradeProduct", "Name"), artikelnr=_text(li, "SpecifiedTradeProduct", "SellerAssignedID"),
                                        menge=_zahl(menge_el.text if menge_el is not None else "1"), einheit=menge_el.get("unitCode") if menge_el is not None else "C62",
                                        preis=_zahl(_text(preis_el, "ChargeAmount")) / basis,
                                        gesamt=_zahl(_text(li, "SpecifiedLineTradeSettlement", "SpecifiedTradeSettlementLineMonetarySummation", "LineTotalAmount")),
                                        steuer=_zahl(_text(li, "SpecifiedLineTradeSettlement", "ApplicableTradeTax", "RateApplicablePercent"))))
        return r
    if art in ("Invoice", "CreditNote"):
        sup = _kind(root, "AccountingSupplierParty", "Party")
        adr = _kind(sup, "PostalAddress")
        tot = _kind(root, "LegalMonetaryTotal")
        r = dict(syntax="UBL", nummer=_text(root, "ID"), typ="381" if art == "CreditNote" else (_text(root, "InvoiceTypeCode") or "380"),
                 datum=_datum(_text(root, "IssueDate")), faellig=_datum(_text(root, "DueDate") or _text(root, "PaymentMeans", "PaymentDueDate")),
                 verkaeufer=dict(name=_text(sup, "PartyName", "Name") or _text(sup, "PartyLegalEntity", "RegistrationName"), strasse=_text(adr, "StreetName"),
                                 plz=_text(adr, "PostalZone"), ort=_text(adr, "CityName"), land=_text(adr, "Country", "IdentificationCode") or "DE",
                                 ust_id=_text(sup, "PartyTaxScheme", "CompanyID"), email=_text(sup, "EndpointID") or _text(sup, "Contact", "ElectronicMail")),
                 bestellung=_text(root, "OrderReference", "ID"),
                 netto=_zahl(_text(tot, "TaxExclusiveAmount")), steuer=_zahl(_text(root, "TaxTotal", "TaxAmount")), brutto=_zahl(_text(tot, "TaxInclusiveAmount")),
                 iban=_text(root, "PaymentMeans", "PayeeFinancialAccount", "ID"), positionen=[])
        for li in [c for c in root if _lokal(c.tag) in ("InvoiceLine", "CreditNoteLine")]:
            menge_el = _kind(li, "InvoicedQuantity")
            if menge_el is None:                      # Achtung: Elemente ohne Kinder sind „falsy“ → kein `or`
                menge_el = _kind(li, "CreditedQuantity")
            basis = _zahl(_text(li, "Price", "BaseQuantity")) or 1
            r["positionen"].append(dict(text=_text(li, "Item", "Name"), artikelnr=_text(li, "Item", "SellersItemIdentification", "ID"),
                                        menge=_zahl(menge_el.text if menge_el is not None else "1"), einheit=menge_el.get("unitCode") if menge_el is not None else "C62",
                                        preis=_zahl(_text(li, "Price", "PriceAmount")) / basis, gesamt=_zahl(_text(li, "LineExtensionAmount")),
                                        steuer=_zahl(_text(li, "Item", "ClassifiedTaxCategory", "Percent"))))
        return r
    raise Fehler("Unbekanntes Format – erwartet wird XRechnung oder ZUGFeRD (CII oder UBL).")


def einlesen(db, dateiname, daten, benutzer=None):
    """E-Rechnung eines Lieferanten → Rechnungseingang (ER) als Entwurf. Liefert Beleg + Hinweise."""
    pdf = None
    if daten[:5] == b"%PDF-":
        try:
            from facturx import get_xml_from_pdf
        except ImportError:
            raise Fehler("ZUGFeRD-PDFs einlesen braucht das Paket factur-x (Server mit .venv/bin/python starten).")
        try:
            _name, xml = get_xml_from_pdf(daten, check_xsd=False)
        except Exception:
            xml = None
        if not xml:
            raise Fehler("Im PDF steckt keine E-Rechnung (kein ZUGFeRD/Factur-X). Reine PDFs bitte als Dokument ablegen.")
        pdf, daten = daten, xml
    r = xml_auslesen(daten)
    v = r["verkaeufer"]
    if not r["nummer"] or not v["name"]:
        raise Fehler("Rechnungsnummer oder Lieferant fehlen in der E-Rechnung.")
    hinweise = []
    # Lieferant finden: USt-IdNr., sonst Name
    norm = lambda s: re.sub(r"[^A-Z0-9]", "", (s or "").upper())
    lief = None
    if v["ust_id"]:
        for x in db.execute("SELECT a.id, a.ust_id FROM adresse a JOIN lieferant l ON l.adresse_id=a.id"):
            if norm(x["ust_id"]) == norm(v["ust_id"]):
                lief = x["id"]
                break
    if not lief:
        x = db.execute("SELECT a.id FROM adresse a JOIN lieferant l ON l.adresse_id=a.id WHERE lower(a.name1)=lower(?)", (v["name"],)).fetchone()
        lief = x["id"] if x else None
    if not lief:
        neu = erp.adresse_speichern(db, dict(name1=v["name"], strasse=v["strasse"], plz=v["plz"], ort=v["ort"], land=v["land"], ust_id=v["ust_id"],
                                             email=v["email"], notiz="Aus E-Rechnung angelegt – bitte prüfen.", lieferant={}), benutzer)
        lief = neu["id"]
        hinweise.append(f"Lieferant „{v['name']}“ war unbekannt und wurde neu angelegt – bitte Stammdaten prüfen.")
    doppelt = db.execute("SELECT nummer, id FROM beleg WHERE belegart='ER' AND adresse_id=? AND ihre_referenz=?", (lief, r["nummer"])).fetchone()
    if doppelt:
        raise Fehler(f"Diese Rechnung {r['nummer']} wurde bereits eingelesen ({doppelt['nummer'] or 'Entwurf'}).")
    vz = -1 if r["typ"] == "381" else 1
    artikel = {x["artikelnr"]: x["id"] for x in db.execute("SELECT id, artikelnr FROM artikel")}
    pos = [dict(artikel_id=artikel.get(p["artikelnr"]) if p["artikelnr"] else None, text=(p["text"] or "Position")[:300], menge=vz * (p["menge"] or 1),
                me=EINHEITEN_ZURUECK.get(p["einheit"] or "", p["einheit"] or "Stk"), einzelpreis=round(p["preis"], 4), steuer_pct=p["steuer"]) for p in r["positionen"]]
    if not pos:
        pos = [dict(text=f"Rechnung {r['nummer']}", menge=vz, einzelpreis=r["netto"], steuer_pct=19)]
        hinweise.append("Die E-Rechnung enthält keine Positionen – Gesamtbetrag als eine Zeile übernommen.")
    b = erp.beleg_speichern(db, dict(belegart="ER", adresse_id=lief, datum=r["datum"] or erp.heute(), ihre_referenz=r["nummer"],
                                     betreff=f"E-Rechnung {r['nummer']} ({r['syntax']})" + (f" · Bestellung {r['bestellung']}" if r["bestellung"] else ""),
                                     positionen=pos), benutzer)
    if abs(abs(b["brutto"]) - r["brutto"]) > 0.02:
        hinweise.append(f"Summe weicht ab: E-Rechnung {r['brutto']:.2f} €, übernommen {abs(b['brutto']):.2f} € – bitte Positionen prüfen.")
    if r["faellig"]:
        hinweise.append("Fällig laut Lieferant: " + ".".join(reversed(r["faellig"].split("-"))) + ".")
    if erp.DOK_ORDNER:
        erp.dokument_speichern(db, "beleg", b["id"], dateiname if pdf else (dateiname or "e-rechnung.xml"), pdf or daten,
                               "application/pdf" if pdf else "text/plain", benutzer)
    return {"beleg": erp.beleg_lesen(db, b["id"]), "hinweise": hinweise, "daten": {k: r[k] for k in ("nummer", "datum", "brutto", "syntax")}}
