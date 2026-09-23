#!/usr/bin/env python3
"""Eingangsrechnungen erfassen — Hilfsprogramm für server.js (läuft im .venv).

  erfassen.py scan <eingang> <ausgang.jpg>   Foto/PDF -> zugeschnittener, entzerrter Scan (JPEG)
  erfassen.py ocr <bild>                      Texterkennung -> JSON {"zeilen": [...]} auf stdout
  erfassen.py pdftext <eingang.pdf>          digitales PDF: {"zeilen": [...], "zugferd": {...}|null}
  erfassen.py zugferd <scan> <ausgang.pdf>    stdin: JSON mit Rechnungsdaten -> ZUGFeRD-PDF (EN 16931)

Alles lokal (RapidOCR/ONNX, kein Cloud-Dienst) — Rechnungsdaten verlassen den Server nicht.
"""
import io
import json
import math
import os
import subprocess
import sys
import re
import tempfile
from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from xml.sax.saxutils import escape

import cv2
import numpy as np
from PIL import Image, ImageOps

MAX_SEITE = 2400  # längste Bildkante nach dem Zuschneiden (px) — reicht für OCR, hält PDFs klein


def pdf_erste_seite(pfad):
    """Erste PDF-Seite als Bild (pdftoppm, 200 dpi)."""
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(['pdftoppm', '-r', '200', '-png', '-f', '1', '-l', '1', pfad, os.path.join(tmp, 's')],
                       check=True, capture_output=True, timeout=60)
        name = sorted(os.listdir(tmp))[0]
        return Image.open(os.path.join(tmp, name)).convert('RGB')


def ist_pdf(pfad):
    with open(pfad, 'rb') as f:
        return f.read(5) == b'%PDF-'


def laden(pfad):
    if ist_pdf(pfad):
        return pdf_erste_seite(pfad)
    im = Image.open(pfad)
    im = ImageOps.exif_transpose(im)  # Handyfotos: Hochkant-Flag anwenden
    return im.convert('RGB')


def ecken_ordnen(p):
    s = p.sum(1); d = np.diff(p, axis=1).ravel()
    return np.array([p[np.argmin(s)], p[np.argmin(d)], p[np.argmax(s)], p[np.argmax(d)]], dtype=np.float32)


def blatt_finden(bgr):
    """Größtes Viereck (das Papier) im Foto suchen. None, wenn keins überzeugt."""
    h, w = bgr.shape[:2]
    f = 1000.0 / max(h, w)
    klein = cv2.resize(bgr, (int(w * f), int(h * f)))
    grau = cv2.GaussianBlur(cv2.cvtColor(klein, cv2.COLOR_BGR2GRAY), (5, 5), 0)
    kanten = cv2.dilate(cv2.Canny(grau, 40, 120), np.ones((3, 3), np.uint8))
    konturen, _ = cv2.findContours(kanten, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    flaeche = klein.shape[0] * klein.shape[1]
    for k in sorted(konturen, key=cv2.contourArea, reverse=True)[:5]:
        ap = cv2.approxPolyDP(k, 0.02 * cv2.arcLength(k, True), True)
        if len(ap) == 4 and cv2.isContourConvex(ap) and cv2.contourArea(ap) > 0.3 * flaeche:
            # Blatt füllt schon fast das ganze Bild (Scanner, PDF) -> nichts zu tun
            if cv2.contourArea(ap) > 0.97 * flaeche:
                return None
            return ecken_ordnen(ap.reshape(4, 2).astype(np.float32) / f)
    return None


def scan(eingang, ausgang):
    im = laden(eingang)
    bgr = cv2.cvtColor(np.array(im), cv2.COLOR_RGB2BGR)
    ecken = None if ist_pdf(eingang) else blatt_finden(bgr)
    if ecken is not None:
        tl, tr, br, bl = ecken
        breite = int(max(np.linalg.norm(br - bl), np.linalg.norm(tr - tl)))
        hoehe = int(max(np.linalg.norm(tr - br), np.linalg.norm(tl - bl)))
        M = cv2.getPerspectiveTransform(ecken, np.array([[0, 0], [breite - 1, 0], [breite - 1, hoehe - 1], [0, hoehe - 1]], np.float32))
        bgr = cv2.warpPerspective(bgr, M, (breite, hoehe), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    # Beleuchtung ausgleichen: Hintergrund (Papier) schätzen und herausteilen -> weißes Blatt, Schatten weg
    if not ist_pdf(eingang):
        planes = []
        for c in cv2.split(bgr):
            bg = cv2.medianBlur(cv2.dilate(c, np.ones((9, 9), np.uint8)), 31)
            planes.append(cv2.normalize(255 - cv2.absdiff(c, bg), None, 0, 255, cv2.NORM_MINMAX))
        # fast-weißes Papierrauschen (Faserstruktur, JPEG-Schlieren) auf reines Weiß ziehen
        lut = np.clip((np.arange(256) - 0) * 255.0 / 225, 0, 255).astype(np.uint8)
        bgr = cv2.LUT(cv2.merge(planes), lut)
    h, w = bgr.shape[:2]
    if max(h, w) > MAX_SEITE:
        f = MAX_SEITE / max(h, w)
        bgr = cv2.resize(bgr, (int(w * f), int(h * f)), interpolation=cv2.INTER_AREA)
    cv2.imwrite(ausgang, bgr, [cv2.IMWRITE_JPEG_QUALITY, 85])
    print(json.dumps({'zugeschnitten': ecken is not None, 'breite': bgr.shape[1], 'hoehe': bgr.shape[0]}))


def ocr(bild):
    from rapidocr_onnxruntime import RapidOCR
    # Lateinisches PP-OCRv5-Modell (einrichten.sh): kennt Leerzeichen, Umlaute, ß und €.
    # Das mitgelieferte Standardmodell ist chinesisch trainiert und verschluckt all das.
    m = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ocr-modell')
    opt = {'rec_model_path': os.path.join(m, 'rec.onnx'), 'rec_keys_path': os.path.join(m, 'dict.txt')} \
        if os.path.exists(os.path.join(m, 'rec.onnx')) else {}
    res, _ = RapidOCR(**opt)(bild)
    res = res or []
    boxen = []
    winkel = []
    for box, txt, sc in res:
        b = np.array(box, dtype=float)
        dx, dy = b[1] - b[0]
        if dx > 40:
            winkel.append(math.atan2(dy, dx))
        boxen.append((b, txt, sc))
    # Restschräglage herausdrehen, dann nach Zeilen gruppieren
    a = -float(np.median(winkel)) if winkel else 0.0
    ca, sa = math.cos(a), math.sin(a)
    elem = []
    for b, txt, sc in boxen:
        m = b.mean(0)
        x = m[0] * ca - m[1] * sa
        y = m[0] * sa + m[1] * ca
        hoehe = abs(b[3][1] - b[0][1]) or 10
        elem.append({'x': x, 'y': y, 'h': hoehe, 't': txt, 'links': (b[0][0] * ca - b[0][1] * sa)})
    elem.sort(key=lambda e: e['y'])
    zeilen = []
    for e in elem:
        if zeilen and abs(e['y'] - zeilen[-1]['y']) < 0.55 * max(e['h'], zeilen[-1]['h']):
            z = zeilen[-1]
            z['teile'].append(e)
            z['y'] = sum(t['y'] for t in z['teile']) / len(z['teile'])
        else:
            zeilen.append({'y': e['y'], 'h': e['h'], 'teile': [e]})
    text = []
    for z in zeilen:
        teile = sorted(z['teile'], key=lambda t: t['links'])
        text.append('   '.join(t['t'] for t in teile))
    print(json.dumps({'zeilen': text}, ensure_ascii=False))


# --- ZUGFeRD / Factur-X (Profil EN 16931) -----------------------------------
D2 = Decimal('0.01')


def dec(x):
    return Decimal(str(x or 0)).quantize(D2, rounding=ROUND_HALF_UP)


def datum_cii(s):
    s = (s or '').strip() or date.today().isoformat()
    return s.replace('-', '')[:8]


def partei(tag, p, mit_steuer=True):
    x = [f'<ram:{tag}>', f'<ram:Name>{escape(p.get("name") or "unbekannt")}</ram:Name>']
    x.append('<ram:PostalTradeAddress>')
    if p.get('plz'):
        x.append(f'<ram:PostcodeCode>{escape(p["plz"])}</ram:PostcodeCode>')
    if p.get('strasse'):
        x.append(f'<ram:LineOne>{escape(p["strasse"])}</ram:LineOne>')
    if p.get('ort'):
        x.append(f'<ram:CityName>{escape(p["ort"])}</ram:CityName>')
    x.append(f'<ram:CountryID>{escape(p.get("land") or "DE")}</ram:CountryID></ram:PostalTradeAddress>')
    if mit_steuer and p.get('ustId'):
        x.append(f'<ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">{escape(p["ustId"])}</ram:ID></ram:SpecifiedTaxRegistration>')
    if mit_steuer and p.get('steuernummer'):
        x.append(f'<ram:SpecifiedTaxRegistration><ram:ID schemeID="FC">{escape(p["steuernummer"])}</ram:ID></ram:SpecifiedTaxRegistration>')
    x.append(f'</ram:{tag}>')
    return ''.join(x)


def cii_xml(r):
    """r: {nummer, datum, faellig, lieferdatum, waehrung, lieferant{}, kaeufer{}, iban, bic,
           steuern:[{satz, netto}], positionen:[{name, menge, preis, satz}]?}"""
    steuern = [s for s in r.get('steuern') or [] if dec(s.get('netto')) != 0] or [{'satz': 0, 'netto': 0}]
    gruppen = []
    for s in steuern:
        satz = dec(s.get('satz'))
        netto = dec(s.get('netto'))
        ust = (netto * satz / 100).quantize(D2, rounding=ROUND_HALF_UP)
        if s.get('ust') is not None:
            ust = dec(s['ust'])  # Betrag wie auf dem Papier (Rundungsdifferenzen des Lieferanten übernehmen)
        gruppen.append((satz, netto, ust))
    netto_ges = sum(g[1] for g in gruppen)
    ust_ges = sum(g[2] for g in gruppen)
    brutto = netto_ges + ust_ges
    # Positionen: vom Papier, wenn sie je Steuersatz exakt aufgehen — sonst eine Sammelzeile je Satz
    pos = r.get('positionen') or []
    ok = bool(pos)
    if ok:
        for satz, netto, _ in gruppen:
            summe = sum(dec(dec(p.get('menge') or 1) * Decimal(str(p.get('preis') or 0))) for p in pos if dec(p.get('satz')) == satz)
            if summe != netto:
                ok = False
    if not ok:
        pos = [{'name': f'Lieferung/Leistung lt. Rechnung {r.get("nummer") or ""}'.strip() + (f' ({satz:g} % USt)' if len(gruppen) > 1 else ''),
                'menge': 1, 'preis': float(netto), 'satz': float(satz)} for satz, netto, _ in gruppen]

    def kat(satz):
        return 'S' if satz > 0 else 'Z'

    x = ['<?xml version="1.0" encoding="UTF-8"?>',
         '<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" '
         'xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" '
         'xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100" '
         'xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100">',
         '<rsm:ExchangedDocumentContext><ram:GuidelineSpecifiedDocumentContextParameter>'
         '<ram:ID>urn:cen.eu:en16931:2017</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter></rsm:ExchangedDocumentContext>',
         f'<rsm:ExchangedDocument><ram:ID>{escape(r.get("nummer") or "ohne Nummer")}</ram:ID><ram:TypeCode>380</ram:TypeCode>'
         f'<ram:IssueDateTime><udt:DateTimeString format="102">{datum_cii(r.get("datum"))}</udt:DateTimeString></ram:IssueDateTime>'
         '<ram:IncludedNote><ram:Content>Aus Papierrechnung übertragen (Scan anbei).</ram:Content></ram:IncludedNote>'
         '</rsm:ExchangedDocument>',
         '<rsm:SupplyChainTradeTransaction>']
    for i, p in enumerate(pos, 1):
        menge = dec(p.get('menge') or 1)
        preis = Decimal(str(p.get('preis') or 0)).quantize(Decimal('0.0001'), rounding=ROUND_HALF_UP)
        satz = dec(p.get('satz'))
        x.append(f'<ram:IncludedSupplyChainTradeLineItem><ram:AssociatedDocumentLineDocument><ram:LineID>{i}</ram:LineID></ram:AssociatedDocumentLineDocument>'
                 f'<ram:SpecifiedTradeProduct><ram:Name>{escape(str(p.get("name") or "Position")[:200])}</ram:Name></ram:SpecifiedTradeProduct>'
                 f'<ram:SpecifiedLineTradeAgreement><ram:NetPriceProductTradePrice><ram:ChargeAmount>{preis}</ram:ChargeAmount></ram:NetPriceProductTradePrice></ram:SpecifiedLineTradeAgreement>'
                 f'<ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="C62">{menge}</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery>'
                 f'<ram:SpecifiedLineTradeSettlement><ram:ApplicableTradeTax><ram:TypeCode>VAT</ram:TypeCode><ram:CategoryCode>{kat(satz)}</ram:CategoryCode>'
                 f'<ram:RateApplicablePercent>{satz}</ram:RateApplicablePercent></ram:ApplicableTradeTax>'
                 f'<ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>{dec(menge * preis)}</ram:LineTotalAmount>'
                 '</ram:SpecifiedTradeSettlementLineMonetarySummation></ram:SpecifiedLineTradeSettlement></ram:IncludedSupplyChainTradeLineItem>')
    lief = r.get('lieferant') or {}
    x.append('<ram:ApplicableHeaderTradeAgreement>')
    x.append(partei('SellerTradeParty', lief))
    x.append(partei('BuyerTradeParty', r.get('kaeufer') or {}, mit_steuer=False))
    x.append('</ram:ApplicableHeaderTradeAgreement>')
    x.append('<ram:ApplicableHeaderTradeDelivery>')
    # Leistungsdatum; fehlt es auf dem Papier, gilt das Rechnungsdatum (leeres Element = PEPPOL-R008-Warnung)
    if r.get('lieferdatum') or r.get('datum'):
        r = dict(r, lieferdatum=r.get('lieferdatum') or r.get('datum'))
        x.append(f'<ram:ActualDeliverySupplyChainEvent><ram:OccurrenceDateTime><udt:DateTimeString format="102">{datum_cii(r["lieferdatum"])}'
                 '</udt:DateTimeString></ram:OccurrenceDateTime></ram:ActualDeliverySupplyChainEvent>')
    x.append('</ram:ApplicableHeaderTradeDelivery>')
    x.append('<ram:ApplicableHeaderTradeSettlement>')
    x.append(f'<ram:InvoiceCurrencyCode>{escape(r.get("waehrung") or "EUR")}</ram:InvoiceCurrencyCode>')
    iban = (r.get('iban') or '').replace(' ', '').upper()
    if iban:
        x.append('<ram:SpecifiedTradeSettlementPaymentMeans><ram:TypeCode>58</ram:TypeCode>'
                 f'<ram:PayeePartyCreditorFinancialAccount><ram:IBANID>{escape(iban)}</ram:IBANID></ram:PayeePartyCreditorFinancialAccount>')
        if r.get('bic'):
            x.append(f'<ram:PayeeSpecifiedCreditorFinancialInstitution><ram:BICID>{escape(r["bic"].replace(" ", "").upper())}</ram:BICID></ram:PayeeSpecifiedCreditorFinancialInstitution>')
        x.append('</ram:SpecifiedTradeSettlementPaymentMeans>')
    for satz, netto, ust in gruppen:
        x.append(f'<ram:ApplicableTradeTax><ram:CalculatedAmount>{ust}</ram:CalculatedAmount><ram:TypeCode>VAT</ram:TypeCode>'
                 + ('' if satz > 0 else '<ram:ExemptionReason>Steuerfrei bzw. ohne USt-Ausweis lt. Papierrechnung</ram:ExemptionReason>')
                 + f'<ram:BasisAmount>{netto}</ram:BasisAmount><ram:CategoryCode>{kat(satz)}</ram:CategoryCode>'
                 f'<ram:RateApplicablePercent>{satz}</ram:RateApplicablePercent></ram:ApplicableTradeTax>')
    x.append('<ram:SpecifiedTradePaymentTerms>')
    if r.get('faellig'):
        x.append(f'<ram:DueDateDateTime><udt:DateTimeString format="102">{datum_cii(r["faellig"])}</udt:DateTimeString></ram:DueDateDateTime>')
    else:
        x.append('<ram:Description>lt. Papierrechnung</ram:Description>')
    x.append('</ram:SpecifiedTradePaymentTerms>')
    bezahlt = dec(r.get('bezahlt') or 0)
    x.append('<ram:SpecifiedTradeSettlementHeaderMonetarySummation>'
             f'<ram:LineTotalAmount>{netto_ges}</ram:LineTotalAmount>'
             f'<ram:TaxBasisTotalAmount>{netto_ges}</ram:TaxBasisTotalAmount>'
             f'<ram:TaxTotalAmount currencyID="{escape(r.get("waehrung") or "EUR")}">{ust_ges}</ram:TaxTotalAmount>'
             f'<ram:GrandTotalAmount>{brutto}</ram:GrandTotalAmount>'
             + (f'<ram:TotalPrepaidAmount>{bezahlt}</ram:TotalPrepaidAmount>' if bezahlt else '')
             + f'<ram:DuePayableAmount>{brutto - bezahlt}</ram:DuePayableAmount>'
             '</ram:SpecifiedTradeSettlementHeaderMonetarySummation>')
    x.append('</ram:ApplicableHeaderTradeSettlement></rsm:SupplyChainTradeTransaction></rsm:CrossIndustryInvoice>')
    return ''.join(x)


PDFA_DEF = """%!
/ICCProfile (/usr/share/color/icc/ghostscript/srgb.icc) def
[/_objdef {icc_PDFA} /type /stream /OBJ pdfmark
[{icc_PDFA} << /N 3 >> /PUT pdfmark
[{icc_PDFA} ICCProfile (r) file /PUT pdfmark
[/_objdef {OutputIntent_PDFA} /type /dict /OBJ pdfmark
[{OutputIntent_PDFA} << /Type /OutputIntent /S /GTS_PDFA1 /DestOutputProfile {icc_PDFA}
  /OutputConditionIdentifier (sRGB) >> /PUT pdfmark
[{Catalog} << /OutputIntents [ {OutputIntent_PDFA} ] >> /PUT pdfmark
"""


def pdfa_basis(pdf_pfad):
    """Beliebiges PDF -> PDF/A-3-Basis (Ghostscript): sRGB-OutputIntent, Datei-ID, Binär-Header,
    eingebettete Schriften. Ohne das meldet der Validator (Mustang) die Hülle als ungültig."""
    with tempfile.TemporaryDirectory() as tmp:
        d = os.path.join(tmp, 'pdfa_def.ps')
        o = os.path.join(tmp, 'a.pdf')
        with open(d, 'w') as f:
            f.write(PDFA_DEF)
        subprocess.run(['gs', '-q', '-dPDFA=3', '-dBATCH', '-dNOPAUSE', '-dNOSAFER', '-dPDFACompatibilityPolicy=1',
                        '-sColorConversionStrategy=RGB', '-sDEVICE=pdfwrite', '-dAutoFilterColorImages=false',
                        '-dColorImageFilter=/DCTEncode', '-dDownsampleColorImages=false',
                        '-sOutputFile=' + o, d, pdf_pfad], check=True, capture_output=True, timeout=120)
        with open(o, 'rb') as f:
            return f.read()


def zugferd(scan_pfad, ausgang):
    from facturx import generate_from_binary
    r = json.load(sys.stdin)
    with tempfile.TemporaryDirectory() as tmp:
        if ist_pdf(scan_pfad):
            quelle = scan_pfad  # hochgeladenes PDF: alle Seiten, Vektortext bleibt erhalten
        else:
            quelle = os.path.join(tmp, 'b.pdf')
            Image.open(scan_pfad).convert('RGB').save(quelle, 'PDF', resolution=200.0)  # 2400 px ~ A4
        pdf = pdfa_basis(quelle)
    xml = cii_xml(r).encode('utf-8')
    lief = (r.get('lieferant') or {}).get('name') or 'Lieferant'
    meta = {'author': lief, 'keywords': 'Factur-X, ZUGFeRD, Rechnung', 'title': f'{lief}: Rechnung {r.get("nummer") or ""}'.strip(),
            'subject': f'Rechnung {r.get("nummer") or ""} von {lief}'.strip()}
    out = generate_from_binary(pdf, xml, flavor='factur-x', level='en16931', check_xsd=True, pdf_metadata=meta, lang='de-DE')
    with open(ausgang, 'wb') as f:
        f.write(out)
    print(json.dumps({'ok': True, 'bytes': len(out)}))


# --- Digitale PDFs: Textlayer + eingebettete E-Rechnung ----------------------
def _cii_felder(xml):
    """Eingebettete ZUGFeRD/Factur-X-Daten (CII) -> Felder wie felderAusText im Server."""
    from lxml import etree
    t = etree.fromstring(xml)
    ns = {'rsm': 'urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100',
          'ram': 'urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100',
          'udt': 'urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100'}
    if t.tag != '{%s}CrossIndustryInvoice' % ns['rsm']:
        return None

    def txt(pfad, basis=t):
        e = basis.find(pfad, ns)
        return e.text.strip() if e is not None and e.text else None

    def dat(pfad):
        v = txt(pfad)
        return f'{v[:4]}-{v[4:6]}-{v[6:8]}' if v and len(v) >= 8 and v[:8].isdigit() else None

    def num(v):
        try:
            return round(float(v), 2)
        except (TypeError, ValueError):
            return None
    tr = './/rsm:SupplyChainTradeTransaction/'
    sel = t.find(tr + 'ram:ApplicableHeaderTradeAgreement/ram:SellerTradeParty', ns)
    st = tr + 'ram:ApplicableHeaderTradeSettlement/'
    L = {}
    if sel is not None:
        L = {'name': txt('ram:Name', sel), 'strasse': txt('ram:PostalTradeAddress/ram:LineOne', sel),
             'plz': txt('ram:PostalTradeAddress/ram:PostcodeCode', sel), 'ort': txt('ram:PostalTradeAddress/ram:CityName', sel)}
        for reg in sel.findall('ram:SpecifiedTaxRegistration/ram:ID', ns):
            L['ustId' if reg.get('schemeID') == 'VA' else 'steuernummer'] = (reg.text or '').strip()
    steuern = []
    for g in t.findall(st + 'ram:ApplicableTradeTax', ns):
        steuern.append({'satz': num(txt('ram:RateApplicablePercent', g)) or 0,
                        'netto': num(txt('ram:BasisAmount', g)), 'ust': num(txt('ram:CalculatedAmount', g))})
    summe = st + 'ram:SpecifiedTradeSettlementHeaderMonetarySummation/'
    pos = []
    for li in t.findall(tr + 'ram:IncludedSupplyChainTradeLineItem', ns):
        pos.append({'name': txt('ram:SpecifiedTradeProduct/ram:Name', li) or 'Position',
                    'menge': num(txt('ram:SpecifiedLineTradeDelivery/ram:BilledQuantity', li)) or 1,
                    'preis': num(txt('ram:SpecifiedLineTradeAgreement/ram:NetPriceProductTradePrice/ram:ChargeAmount', li)) or 0,
                    'satz': num(txt('ram:SpecifiedLineTradeSettlement/ram:ApplicableTradeTax/ram:RateApplicablePercent', li)) or 0})
    return {
        'lieferant': {k: v for k, v in L.items() if v},
        'nummer': txt('rsm:ExchangedDocument/ram:ID'),
        'datum': dat('rsm:ExchangedDocument/ram:IssueDateTime/udt:DateTimeString'),
        'lieferdatum': dat(tr + 'ram:ApplicableHeaderTradeDelivery/ram:ActualDeliverySupplyChainEvent/ram:OccurrenceDateTime/udt:DateTimeString'),
        'faellig': dat(st + 'ram:SpecifiedTradePaymentTerms/ram:DueDateDateTime/udt:DateTimeString'),
        'iban': (txt(st + 'ram:SpecifiedTradeSettlementPaymentMeans/ram:PayeePartyCreditorFinancialAccount/ram:IBANID') or '').replace(' ', '').upper() or None,
        'bic': txt(st + 'ram:SpecifiedTradeSettlementPaymentMeans/ram:PayeeSpecifiedCreditorFinancialInstitution/ram:BICID'),
        'verwendungszweck': txt(st + 'ram:PaymentReference'),
        'kundennr': txt(tr + 'ram:ApplicableHeaderTradeAgreement/ram:BuyerTradeParty/ram:ID'),
        # zu zahlen = DuePayable (berücksichtigt Anzahlungen), sonst Gesamtbetrag
        'brutto': num(txt(summe + 'ram:DuePayableAmount')) if txt(summe + 'ram:DuePayableAmount') else num(txt(summe + 'ram:GrandTotalAmount')),
        'steuern': steuern,
        'positionen': pos,
    }


def pdftext(pfad):
    r = subprocess.run(['pdftotext', '-layout', '-f', '1', '-l', '3', pfad, '-'], capture_output=True, timeout=60)
    zeilen = []
    for z in r.stdout.decode('utf-8', 'replace').splitlines():
        z = z.strip()
        if z:
            zeilen.append(re.sub(r' {3,}', '   ', z))
    # zu wenig Text = gescanntes PDF -> Server nimmt die Texterkennung
    if sum(len(z) for z in zeilen) < 80:
        zeilen = []
    zf = None
    try:
        from facturx import get_xml_from_pdf
        with open(pfad, 'rb') as f:
            _, xml = get_xml_from_pdf(f.read(), check_xsd=False)
        if xml:
            zf = _cii_felder(xml)
    except Exception:
        zf = None
    print(json.dumps({'zeilen': zeilen, 'zugferd': zf}, ensure_ascii=False))


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else ''
    if cmd == 'scan':
        scan(sys.argv[2], sys.argv[3])
    elif cmd == 'ocr':
        ocr(sys.argv[2])
    elif cmd == 'pdftext':
        pdftext(sys.argv[2])
    elif cmd == 'zugferd':
        zugferd(sys.argv[2], sys.argv[3])
    elif cmd == 'xml':  # nur zum Testen: XML auf stdout
        print(cii_xml(json.load(sys.stdin)))
    else:
        sys.exit(__doc__)
