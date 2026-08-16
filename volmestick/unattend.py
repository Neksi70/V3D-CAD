#!/usr/bin/env python3
# VolmeStick - Erzeugt die autounattend.xml fuer Windows-Setup.
#
# Windows Setup sucht beim Start automatisch nach "autounattend.xml" im Wurzel-
# verzeichnis jedes angeschlossenen Datentraegers (also auch auf dem Stick bzw.
# in der ISO). Was hier drinsteht, entscheidet, welche Fragen das Setup NICHT
# mehr stellt - genau das, was Rufus unter "Windows User Experience" anbietet.
#
# Zwei Sorten Eingriff:
#   1. XML-Elemente (Sprache, Konto, OOBE-Seiten ausblenden)
#   2. RunSynchronous-Befehle: "reg add ..." in der jeweiligen Setup-Phase.
#      Die Hardware-Sperren MUESSEN in der Phase windowsPE gesetzt werden,
#      denn danach hat das Setup schon geprueft und bricht ab.

import base64
import xml.sax.saxutils as _sx

NS = "urn:schemas-microsoft-com:unattend"
ARCHS = ("amd64", "x86", "arm64")

# Generische KMS-Client-Keys (oeffentlich dokumentiert). Sie aktivieren nichts,
# sie sagen dem Setup nur, welche Edition installiert werden soll, und
# ueberspringen damit die Key-Abfrage.
EDITION_KEYS = {
    "Windows 11/10 Pro":         "VK7JG-NPHTM-C97JM-9MPGT-3V66T",
    "Windows 11/10 Home":        "YTMG3-N6DKC-DKB77-7M9GH-8HVX7",
    "Windows 11/10 Education":   "YNMGQ-8RYV3-4PGQ3-C8XTP-7CFBY",
    "Windows 11/10 Enterprise":  "XGVPP-NMH47-7TTHJ-W3FW7-8HV2C",
}

STANDARD = {
    "sprache": "de-DE",
    "tastatur": "0407:00000407",     # Deutsch
    "zeitzone": "W. Europe Standard Time",
    "computername": "",              # leer = Windows wuerfelt einen Namen
    "benutzer": "",                  # leer = kein Konto vorgeben
    "passwort": "",
    "produkt_key": "",
    "edition_index": 0,              # 0 = Setup fragt
    "bypass_hardware": True,         # TPM 2.0 / Secure Boot / RAM / CPU / Datentraeger
    "bypass_konto": True,            # kein Microsoft-Konto noetig
    "bypass_netzwerk": True,         # Installation ohne Internet (BypassNRO)
    "keine_datenerhebung": True,     # Telemetrie aus, Privatsphaere-Fragen weg
    "kein_bitlocker": True,          # keine automatische Geraeteverschluesselung
    "qol": True,                     # Copilot, OneDrive, Outlook(neu), Schnellstart ...
    "wtg_platten_offline": False,    # Windows To Go: interne Platten in Ruhe lassen
    "dateiendungen": False,          # Explorer zeigt Dateiendungen
    "passwort_aendern": False,       # Kennwort beim ersten Anmelden erzwingen
    "eula_ueberspringen": True,
    "sprachauswahl_ueberspringen": True,
    "express_einstellungen": True,   # OOBE-Seiten (Cortana, Werbe-ID ...) weg
    "extra_befehle": [],             # laufen beim ersten Anmelden
}


def _t(x):
    return _sx.escape(str(x))


def kennwort_kodiert(kennwort):
    """Microsofts Kodierung: an das Kennwort wird der Name des XML-Elements
    ("Password") angehaengt, das Ganze als UTF-16LE in Base64. Ein leeres
    Kennwort ergibt genau den Wert, den auch Rufus einsetzt - anders als eine
    leere Klartextangabe, an der das Anlegen des Kontos scheitern kann."""
    return base64.b64encode((kennwort + "Password").encode("utf-16-le")).decode()


def _komponente(name, arch, inhalt):
    return (
        f'    <component name="{name}" processorArchitecture="{arch}" '
        f'publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS" '
        f'xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State" '
        f'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n'
        f"{inhalt}"
        f"    </component>\n"
    )


def _reg_liste(befehle, ab=1):
    """RunSynchronous-Block aus einer Liste von reg-Kommandos."""
    if not befehle:
        return ""
    zeilen = ["      <RunSynchronous>\n"]
    for i, (beschreibung, cmd) in enumerate(befehle, ab):
        zeilen.append(
            '        <RunSynchronousCommand wcm:action="add">\n'
            f"          <Order>{i}</Order>\n"
            f"          <Description>{_t(beschreibung)}</Description>\n"
            f"          <Path>{_t(cmd)}</Path>\n"
            "        </RunSynchronousCommand>\n"
        )
    zeilen.append("      </RunSynchronous>\n")
    return "".join(zeilen)


def hardware_bypass_befehle():
    """Die Sperren von Windows 11. LabConfig wird vom Setup direkt vor der
    Kompatibilitaetspruefung gelesen, MoSetup gilt fuer Upgrades."""
    r = r"reg add HKLM\System\Setup\LabConfig /v %s /t REG_DWORD /d 1 /f"
    return [
        ("TPM-2.0-Pruefung aus",        "cmd /c " + r % "BypassTPMCheck"),
        ("Secure-Boot-Pruefung aus",    "cmd /c " + r % "BypassSecureBootCheck"),
        ("RAM-Pruefung aus",            "cmd /c " + r % "BypassRAMCheck"),
        ("Datentraeger-Pruefung aus",   "cmd /c " + r % "BypassStorageCheck"),
        ("CPU-Pruefung aus",            "cmd /c " + r % "BypassCPUCheck"),
        ("Upgrade ohne TPM/CPU erlauben",
         r"cmd /c reg add HKLM\System\Setup\MoSetup /v AllowUpgradesWithUnsupportedTPMOrCPU "
         r"/t REG_DWORD /d 1 /f"),
    ]


def _windows_pe(o, arch):
    teile = []
    if o["sprachauswahl_ueberspringen"]:
        s, t = _t(o["sprache"]), _t(o["tastatur"])
        teile.append(_komponente(
            "Microsoft-Windows-International-Core-WinPE", arch,
            f"      <SetupUILanguage>\n        <UILanguage>{s}</UILanguage>\n"
            f"      </SetupUILanguage>\n"
            f"      <InputLocale>{t}</InputLocale>\n"
            f"      <SystemLocale>{s}</SystemLocale>\n"
            f"      <UILanguage>{s}</UILanguage>\n"
            f"      <UserLocale>{s}</UserLocale>\n"))

    setup = ""
    if o["bypass_hardware"]:
        setup += _reg_liste(hardware_bypass_befehle())

    userdata = ""
    if o["produkt_key"]:
        userdata += ("        <ProductKey>\n"
                     f"          <Key>{_t(o['produkt_key'])}</Key>\n"
                     "          <WillShowUI>OnError</WillShowUI>\n"
                     "        </ProductKey>\n")
    if o["eula_ueberspringen"]:
        userdata += "        <AcceptEula>true</AcceptEula>\n"
    if userdata:
        setup += "      <UserData>\n" + userdata + "      </UserData>\n"

    if o["edition_index"]:
        setup += (
            "      <ImageInstall>\n        <OSImage>\n          <InstallFrom>\n"
            '            <MetaData wcm:action="add">\n'
            "              <Key>/IMAGE/INDEX</Key>\n"
            f"              <Value>{int(o['edition_index'])}</Value>\n"
            "            </MetaData>\n"
            "          </InstallFrom>\n"
            "          <WillShowUI>OnError</WillShowUI>\n"
            "        </OSImage>\n      </ImageInstall>\n")

    if setup:
        teile.append(_komponente("Microsoft-Windows-Setup", arch, setup))
    return "".join(teile)


def qol_befehle():
    """Was Rufus "Quality of Life" nennt (MSG_324): all die Dinge, die
    Microsoft dem Nutzer aufdraengt. Alles ueber Richtlinien-Schluessel,
    also ohne Eingriff ins Abbild."""
    def r(pfad, wert, daten=1, typ="REG_DWORD"):
        return f"cmd /c reg add {pfad} /v {wert} /t {typ} /d {daten} /f"
    return [
        ("Copilot aus",
         r(r"HKLM\SOFTWARE\Policies\Microsoft\Windows\WindowsCopilot",
           "TurnOffWindowsCopilot")),
        ("OneDrive-Zwangssynchronisation aus",
         r(r"HKLM\SOFTWARE\Policies\Microsoft\Windows\OneDrive",
           "DisableFileSyncNGSC")),
        ("Nachinstallation von Outlook/DevHome aus",
         r"cmd /c reg delete "
         r'"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate'
         r'\Orchestrator\UScheduler_Oobe" /f'),
        ("Schnellstart aus (sonst faehrt Windows nie richtig herunter)",
         r(r'"HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Power"',
           "HiberbootEnabled", 0)),
        ("Bing-/Websuche im Startmenue aus",
         r(r"HKLM\SOFTWARE\Policies\Microsoft\Windows\Explorer",
           "DisableSearchBoxSuggestions")),
        ("Widgets/Nachrichten aus",
         r(r"HKLM\SOFTWARE\Policies\Microsoft\Dsh", "AllowNewsAndInterests", 0)),
        ("Chat-Symbol aus",
         r(r'"HKLM\SOFTWARE\Policies\Microsoft\Windows\Windows Chat"',
           "ChatIcon", 3)),
    ]


def _specialize(o, arch):
    befehle = []
    if o["bypass_konto"] or o["bypass_netzwerk"]:
        # Ohne diesen Schalter besteht die OOBE auf Internet + Microsoft-Konto.
        befehle.append((
            "Installation ohne Internet/Microsoft-Konto erlauben",
            r"cmd /c reg add "
            r"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\OOBE "
            r"/v BypassNRO /t REG_DWORD /d 1 /f"))
    if o["kein_bitlocker"]:
        befehle.append((
            "Automatische Geraeteverschluesselung aus",
            r"cmd /c reg add HKLM\SYSTEM\CurrentControlSet\Control\BitLocker "
            r"/v PreventDeviceEncryption /t REG_DWORD /d 1 /f"))
    if o["keine_datenerhebung"]:
        befehle += [
            ("Telemetrie aus",
             r"cmd /c reg add HKLM\SOFTWARE\Policies\Microsoft\Windows\DataCollection "
             r"/v AllowTelemetry /t REG_DWORD /d 0 /f"),
            ("Werbe-ID aus",
             r"cmd /c reg add "
             r"HKLM\SOFTWARE\Policies\Microsoft\Windows\AdvertisingInfo "
             r"/v DisabledByGroupPolicy /t REG_DWORD /d 1 /f"),
            ("Vorschlaege/Consumer-Apps aus",
             r"cmd /c reg add "
             r"HKLM\SOFTWARE\Policies\Microsoft\Windows\CloudContent "
             r"/v DisableWindowsConsumerFeatures /t REG_DWORD /d 1 /f"),
        ]

    if o["qol"]:
        befehle += qol_befehle()
    if o["wtg_platten_offline"]:
        # SanPolicy 4 = interne Datentraeger bleiben offline. Sonst fasst ein
        # vom Stick gestartetes Windows die Platten des Wirts an.
        befehle.append((
            "Interne Datentraeger offline lassen",
            r"cmd /c reg add HKLM\SYSTEM\CurrentControlSet\Services\partmgr\Parameters "
            r"/v SanPolicy /t REG_DWORD /d 4 /f"))

    teile = []
    if befehle:
        teile.append(_komponente("Microsoft-Windows-Deployment", arch, _reg_liste(befehle)))
    if o["computername"]:
        teile.append(_komponente(
            "Microsoft-Windows-Shell-Setup", arch,
            f"      <ComputerName>{_t(o['computername'])}</ComputerName>\n"))
    return "".join(teile)


def _oobe(o, arch):
    s, t = _t(o["sprache"]), _t(o["tastatur"])
    teile = [_komponente(
        "Microsoft-Windows-International-Core", arch,
        f"      <InputLocale>{t}</InputLocale>\n"
        f"      <SystemLocale>{s}</SystemLocale>\n"
        f"      <UILanguage>{s}</UILanguage>\n"
        f"      <UserLocale>{s}</UserLocale>\n")]

    oobe = "      <OOBE>\n"
    if o["eula_ueberspringen"]:
        oobe += "        <HideEULAPage>true</HideEULAPage>\n"
    if o["bypass_konto"]:
        oobe += "        <HideOnlineAccountScreens>true</HideOnlineAccountScreens>\n"
    if o["express_einstellungen"]:
        oobe += ("        <HideWirelessSetupInOOBE>true</HideWirelessSetupInOOBE>\n"
                 "        <HideLocalAccountScreen>false</HideLocalAccountScreen>\n")
    if o["keine_datenerhebung"]:
        # 3 = alle Datenschutz-Schalter auf "aus", Fragen entfallen
        oobe += "        <ProtectYourPC>3</ProtectYourPC>\n"
    oobe += "      </OOBE>\n"

    shell = oobe
    shell += f"      <TimeZone>{_t(o['zeitzone'])}</TimeZone>\n"

    if o["benutzer"]:
        # Der wirksame Hebel gegen den Microsoft-Konto-Zwang: Steht in der
        # Antwortdatei ein lokales Konto, ueberspringt die Ersteinrichtung die
        # Kontoseite - auch mit angeschlossenem Netzwerk. Der frueher uebliche
        # Schalter BypassNRO allein genuegt seit Windows 11 24H2 nicht mehr.
        shell += (
            "      <UserAccounts>\n        <LocalAccounts>\n"
            '          <LocalAccount wcm:action="add">\n'
            f"            <Name>{_t(o['benutzer'])}</Name>\n"
            f"            <DisplayName>{_t(o['benutzer'])}</DisplayName>\n"
            "            <Group>Administrators;Power Users</Group>\n"
            "            <Password>\n"
            f"              <Value>{kennwort_kodiert(o['passwort'])}</Value>\n"
            "              <PlainText>false</PlainText>\n"
            "            </Password>\n"
            "          </LocalAccount>\n"
            "        </LocalAccounts>\n      </UserAccounts>\n")
        if not o["passwort"]:
            # Ohne Kennwort meldet sich der erste Start von selbst an
            shell += ("      <AutoLogon>\n"
                      f"        <Username>{_t(o['benutzer'])}</Username>\n"
                      "        <Enabled>true</Enabled>\n"
                      "        <LogonCount>1</LogonCount>\n"
                      "      </AutoLogon>\n")
        if o["passwort_aendern"]:
            o["extra_befehle"] = list(o["extra_befehle"]) + [
                f'net user "{_t(o["benutzer"])}" /logonpasswordchg:yes',
                "net accounts /maxpwage:unlimited"]

    befehle = list(o["extra_befehle"])
    if o["dateiendungen"]:
        befehle.append(r"reg add "
                       r'"HKCU\Software\Microsoft\Windows\CurrentVersion'
                       r'\Explorer\Advanced" /v HideFileExt /t REG_DWORD /d 0 /f')
    if o["qol"]:
        befehle += [
            r"reg delete "
            r'"HKCU\Software\Microsoft\Windows\CurrentVersion\Run" '
            r"/v OneDriveSetup /f",
            r"reg add "
            r'"HKCU\Software\Microsoft\Windows\CurrentVersion\Search" '
            r"/v BingSearchEnabled /t REG_DWORD /d 0 /f",
        ]
    if o["keine_datenerhebung"]:
        befehle.append((r"reg add "
                        r'"HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\ContentDeliveryManager" '
                        r"/v SilentInstalledAppsEnabled /t REG_DWORD /d 0 /f"))
    if befehle:
        shell += "      <FirstLogonCommands>\n"
        for i, cmd in enumerate(befehle, 1):
            shell += ('        <SynchronousCommand wcm:action="add">\n'
                      f"          <Order>{i}</Order>\n"
                      f"          <CommandLine>cmd /c {_t(cmd)}</CommandLine>\n"
                      f"          <Description>VolmeStick {i}</Description>\n"
                      "          <RequiresUserInput>false</RequiresUserInput>\n"
                      "        </SynchronousCommand>\n")
        shell += "      </FirstLogonCommands>\n"

    teile.append(_komponente("Microsoft-Windows-Shell-Setup", arch, shell))
    return "".join(teile)


def baue_unattend(optionen=None, arch="amd64"):
    """Liefert die fertige autounattend.xml als Text."""
    if arch not in ARCHS:
        raise ValueError(f"Unbekannte Architektur: {arch}")
    o = dict(STANDARD)
    o.update(optionen or {})
    if o["bypass_konto"] and not str(o.get("benutzer", "")).strip():
        # Ohne lokales Konto in der Antwortdatei besteht Windows 11 ab 24H2 auf
        # einem Microsoft-Konto. Lieber ein sinnvoller Name als eine Sackgasse.
        o["benutzer"] = "Benutzer"
    for k in ("bypass_hardware", "bypass_konto", "bypass_netzwerk",
              "keine_datenerhebung", "kein_bitlocker", "eula_ueberspringen",
              "sprachauswahl_ueberspringen", "express_einstellungen"):
        o[k] = bool(o[k])

    abschnitte = [("windowsPE", _windows_pe(o, arch)),
                  ("specialize", _specialize(o, arch)),
                  ("oobeSystem", _oobe(o, arch))]

    xml = ['<?xml version="1.0" encoding="utf-8"?>\n',
           "<!-- Erzeugt von VolmeStick -->\n",
           f'<unattend xmlns="{NS}">\n']
    for pas, inhalt in abschnitte:
        if inhalt.strip():
            xml.append(f'  <settings pass="{pas}">\n{inhalt}  </settings>\n')
    xml.append("</unattend>\n")
    return "".join(xml)


def zusammenfassung(optionen=None):
    """Klartext, was diese Einstellungen bewirken - fuer die Oberflaeche."""
    o = dict(STANDARD)
    o.update(optionen or {})
    z = []
    if o["bypass_hardware"]:
        z.append("Laeuft auch ohne TPM 2.0, Secure Boot und mit wenig RAM/alter CPU")
    if o["bypass_konto"]:
        z.append("Kein Microsoft-Konto noetig (dafuer wird ein lokales Konto "
                 "angelegt - ohne das besteht Windows 11 seit 24H2 darauf)")
    if o["bypass_netzwerk"]:
        z.append("Installation ohne Internetverbindung moeglich")
    if o["benutzer"]:
        z.append(f"Legt das lokale Konto '{o['benutzer']}' als Administrator an"
                 + ("" if o["passwort"] else " (ohne Passwort, Auto-Anmeldung)"))
    if o["keine_datenerhebung"]:
        z.append("Telemetrie, Werbe-ID und vorgeschlagene Apps aus")
    if o["kein_bitlocker"]:
        z.append("Keine automatische Geraeteverschluesselung")
    if o["qol"]:
        z.append("Copilot, OneDrive-Zwang, Outlook-Nachinstallation, Schnellstart, "
                 "Widgets und Bing-Suche aus")
    if o["wtg_platten_offline"]:
        z.append("Interne Platten des Wirt-PCs bleiben offline (Windows To Go)")
    if o["dateiendungen"]:
        z.append("Explorer zeigt Dateiendungen")
    if o["sprachauswahl_ueberspringen"]:
        z.append(f"Sprache/Tastatur fest auf {o['sprache']}")
    if o["edition_index"]:
        z.append(f"Installiert Abbild-Index {o['edition_index']} ohne Rueckfrage")
    return z


if __name__ == "__main__":
    import sys, json
    opt = json.loads(sys.argv[1]) if len(sys.argv) > 1 else {}
    sys.stdout.write(baue_unattend(opt))
