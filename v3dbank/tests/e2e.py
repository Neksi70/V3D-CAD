"""Durchlauf im Browser gegen eine Testinstanz (eigener Datenordner, bunq-Sandbox).

Start:  V3DBANK_DATEN=/tmp/v3db/data V3DBANK_CONFIG=/tmp/v3db/config.json python3 server.py
        (config.json: {"host": "127.0.0.1", "port": 8811})
Dann:   python3 tests/e2e.py [http://127.0.0.1:8811] [shot-ordner]
"""
import sys
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8811"
SHOTS = sys.argv[2] if len(sys.argv) > 2 else "/tmp/v3db/shots"
PW = "testpasswort-123"
CSV = """Buchungsdatum;Empfänger/Auftraggeber;Verwendungszweck;Betrag (EUR)
01.09.2026;Stadtwerke Hagen;Abschlag Strom;-85,00
03.09.2026;SumUp Payments;Auszahlung;412,30
05.09.2026;Bambu Lab;Filament PLA;-129,90
05.09.2026;Bambu Lab;Filament PLA;-129,90
12.08.2026;Finanzamt Hagen;USt-VZ;-640,00
"""

fehler = []
with sync_playwright() as p:
    b = p.chromium.launch()
    for schema in ("light", "dark"):
        seite = b.new_page(viewport={"width": 1200, "height": 900}, color_scheme=schema)
        seite.on("pageerror", lambda e: fehler.append(str(e)))
        seite.on("console", lambda m: m.type == "error" and fehler.append(m.text))
        seite.goto(URL)
        seite.wait_for_selector("#tor:not(.versteckt)")
        if seite.is_visible("#tor-pw2"):
            seite.fill("#tor-pw", PW); seite.fill("#tor-pw2", PW)
        else:
            seite.fill("#tor-pw", PW)
        seite.click("#tor-knopf")
        seite.wait_for_selector("#app:not(.versteckt)")
        if schema == "light":
            seite.click("nav button[data-seite=einstellungen]")
            seite.wait_for_selector("#b-sandbox")
            seite.once("dialog", lambda d: d.accept())
            seite.click("#b-sandbox")
            seite.wait_for_selector("#b-meldung.ok", timeout=60000)
            print("bunq:", seite.inner_text("#b-meldung"))
            seite.wait_for_selector("#c-datei")
            seite.fill("#c-konto", "SumUp Geschäftskonto")
            seite.fill("#c-saldo", "1.234,56")
            seite.set_input_files("#c-datei", {"name": "a.csv", "mimeType": "text/csv", "buffer": CSV.encode()})
            seite.click("#c-einlesen")
            seite.wait_for_selector("#c-meldung.ok, #c-meldung.fehler")
            print("csv:", seite.inner_text("#c-meldung"))
            seite.click("#c-einlesen")  # zweites Mal: keine Dubletten
            seite.wait_for_timeout(800)
            print("csv 2:", seite.inner_text("#c-meldung"))
            seite.click("#r-erzeugen")
            seite.wait_for_selector("#r-cert")
            seite.screenshot(path=f"{SHOTS}/einstellungen.png", full_page=True)
        for s in ("uebersicht", "umsaetze", "auswertung"):
            seite.click(f"nav button[data-seite={s}]")
            seite.wait_for_timeout(700)
            seite.screenshot(path=f"{SHOTS}/{s}-{schema}.png", full_page=True)
        if schema == "light":
            seite.click("nav button[data-seite=umsaetze]")
            seite.select_option("#f-zeit", "alles")
            seite.wait_for_timeout(500)
            print("umsätze:", seite.inner_text("#u-summe"))
            seite.click("#u-liste .umsatz >> nth=0")
            seite.wait_for_selector("#dlg-umsatz[open]")
            seite.fill("#d-kategorie", "Testkategorie")
            seite.fill("#d-notiz", "Notiz aus Test")
            seite.screenshot(path=f"{SHOTS}/dialog.png")
            seite.click("#dlg-umsatz button[value=ok]")
            seite.wait_for_timeout(700)
            print("nach Speichern:", seite.inner_text("#u-liste .umsatz >> nth=0").replace("\n", " | "))
            seite.click("nav button[data-seite=auswertung]")
            seite.wait_for_timeout(500)
            seite.hover("#a-chart rect[data-i='8']")
            seite.wait_for_timeout(200)
            seite.screenshot(path=f"{SHOTS}/tooltip.png")
        seite.close()
    # Handy-Breite
    seite = b.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=2)
    seite.goto(URL); seite.fill("#tor-pw", PW); seite.click("#tor-knopf")
    seite.wait_for_selector("#app:not(.versteckt)"); seite.wait_for_timeout(600)
    seite.screenshot(path=f"{SHOTS}/handy.png", full_page=True)
    b.close()
print("JS-Fehler:", fehler or "keine")
