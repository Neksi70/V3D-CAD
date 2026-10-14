# Cricut Design Space → Maker 3: Protokoll-Analyse

Stand 14.10.2026, Design Space **10.7.106** (Windows x64, Electron 43.2.0).
Quelle: `https://software.cricut.com/prod/win32-x64/latest.json` →
`CricutDesignSpace-Install-v10.7.106.exe` (SHA-512 stimmt mit Manifest überein).
Rein statische Analyse, nichts von Cricut ausgeführt.

## Architektur (geprüft)

```
Electron-UI (app.asar, Angular)  ──protobuf──►  CricutDevice.exe ("Bridge", C++, 32 bit)
                                                    │  AES-CBC-verschlüsselte Befehle
                                                    ▼
                                           CricutDeviceIO.exe (Rust, 64 bit)
                                           USB-Serial / BT-Classic-Serial / BLE
                                                    ▼
                                               Maker 3 (Firmware)
```

- `resources/plugins/device-common/CricutDevice.exe` – alte Bridge
- `resources/plugins/device-common-next/CricutDevice.exe` – neue Bridge (Hülle `bridge.proto.Message`
  mit `legacy_bridge` = `NativeModel.Bridge.PBCommonBridge`, plus Registry/Session/DataStream)
- `resources/plugins/cricut-device-io/CricutDeviceIO.exe` – reiner Transport
  (`UsbSerialTransportCreateRequest`, `BluetoothLe…WriteCharacteristicRequest` usw.)
- `resources/plugins/plugin-vulcan/CricutVulcanDevice.exe` – anderes Gerät (eigenes Schema)

Die vollständigen Schemas liegen in `proto/` (aus den eingebetteten FileDescriptorProtos
der Binaries geborgen mit `pbextract.py` + `pb2text.py`; ~250 Nachrichten, 7800 Zeilen).

## Schneide-Datenmodell (geprüft, aus Schema)

- `PBDrawVector { cut_type, point, command_number }` mit
  `PBDrawVectorType`: LINE_TO, CURVE_TO, MOVE_TO, LINE_IN/OUT, CURVE_IN/OUT, CHECK_SUM, END_PATH
- `PBDrawVectors { vectors[], in/out/machine_blade_angle, is_closed_path }`
- Geschwindigkeit/Druck: `PBSpeedGroup` (je Achse x/y/za/zb/t), `PBSetMachineState`,
  `PBToolSetting`, Druck in Gramm
- Maschinen-Antwort `PBAck` (FIFO-Stand, Statusbytes, Fehlercode `PBBridgeApiError`)
- Ablauf über Interaktionen `riMATCUT*` (700–730): NeedPathData → SetPathData →
  Processing → AccessoryChange → Progress → CompleteSuccess
- Maschinen-Codenamen in der Bridge: **Zorro** (Maker-Familie), **Athena**, Morph, EasyPress

## Verschlüsselung – der eigentliche Knackpunkt (geprüft)

- Firmware-Fehlercodes: `NO_AES_HANDSHAKE`, `UNKNOWN_ENCRYPTION_REQUIREMENT`,
  `CRC_ERROR_DURING_DECRYPT`, `DECRYPT_SIZE_ERROR` → die Maschine nimmt Befehle nur nach
  einem AES-Handshake an.
- Bridge-Klassen: `ZorroNewAESCommand`, `ZorroResetAESCommand`, `AthenaNewAESCommand`;
  Meldungen „CBC AES – Unexpected response…", `encrypt_command_bytes`, „Unable to decrypt response".
- Der Schlüssel kommt **nicht** aus der Bridge selbst, sondern über die App aus dem Netz:
  Interaktionen 1211–1214 `riOPENDEVICEEncryption{GetHelloWebRequest, SetHelloWebResponse,
  GetWebRequest, SetWebResponse}`, Felder `PBDevicesHelloRequest {type, id}`,
  `PBDevicesResponseRequest {type, response, hello}`,
  `PBCommonBridge.base64_devices_hello_key_response` (Feld 87) und
  `base64_devices_key_response` (Feld 88).
- Zusätzlich gibt es verschlüsselte Pfaddaten (`path_encrypted`, `ENCRYPT_AES_PATH_MA`,
  „Invalid key size in encrypted path").

**Schlussfolgerung (vermutet, nicht live geprüft):** Pro Verbindung erzeugt die Maschine
ein Hello, das Cricut-Server (mit Login des Nutzers) in einen Sitzungsschlüssel übersetzen.
Ohne diesen Server-Schritt kann kein Fremdprogramm den Maker 3 ansteuern.

## Offen

- **Welcher HTTP-Endpunkt** den Hello-Austausch macht: In der lokalen UI nur Codec-/Enum-Code
  gefunden, kein Aufrufer. Der Electron-Hauptprozess (`cricut-ele-design-space/main.js`) ist
  mit javascript-obfuscator verschleiert; das statische Entschlüsseln wurde in dieser Sitzung
  vom Sicherheits-Klassifizierer gestoppt (fremden Code ausführen/auswerten).
- Bekannte API-Routen (geprüft, ohne Handshake-Bezug): `apis.cricut.com` …
  `/Devices/unitdevices`, `/Machines/serialNumber/{sn}/firmwareValues`,
  `/Machines/{id}/firmware`, `/Analytics/getmachine`.

## Was das für VolmeCut heißt

1. **Eigenständiger Treiber (ohne Cricut)**: nicht machbar, solange der Sitzungsschlüssel vom
   Cricut-Server kommt. Den AES-Schutz auszuhebeln wäre zudem eine Umgehung einer technischen
   Schutzmaßnahme (§ 95a UrhG-Nähe) und Cricut geht juristisch gegen Drittsoftware vor.
2. **Mit eigenem Cricut-Konto über Cricuts Server**: technisch denkbar – VolmeCut spräche
   die Bridge (`CricutDevice.exe`) per protobuf an und reicht nur den Hello an Cricuts API
   weiter. Braucht Windows + installiertes Design Space + Konto. Nächster Schritt dafür:
   den Hello-Request einmal auf einem Windows-PC mit Design Space mitschneiden
   (Netzwerk-Log / Fiddler), statt weiter zu deobfuskieren.
3. **Status quo (SVG-Export, 72 dpi)** bleibt der risikoärmste Weg.
