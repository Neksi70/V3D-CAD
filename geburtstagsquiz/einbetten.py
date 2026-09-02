#!/usr/bin/env python3
"""Traegt ein Quiz (JSON) fest in eine HTML-Datei ein.

    python3 einbetten.py                      # quiz.json -> index.live.html
    python3 einbetten.py beispiel.json index.html   # Beispiel in die Arbeitskopie

Warum zwei Dateien (wie volme3d.html / volme3d.dist.html):
  index.html      = Arbeitskopie MIT harmlosem Beispiel-Quiz, wird versioniert.
  index.live.html = Auslieferung MIT den echten, persoenlichen Daten.
                    Steht in .gitignore — das Repo hat ein OEFFENTLICHES
                    GitHub-Remote, echte Geburtsdaten gehoeren da nicht hinein.
server.py liefert index.live.html aus, wenn sie existiert, sonst index.html.
Nach jeder Aenderung an quiz.json einmal dieses Skript laufen lassen; einen
Neustart des Dienstes braucht es nicht, server.py liest die Datei je Abruf.
"""
import json
import os
import re
import sys

BASE = os.path.dirname(os.path.abspath(__file__))
quelle = sys.argv[1] if len(sys.argv) > 1 else os.path.join(BASE, "quiz.json")
ziel = sys.argv[2] if len(sys.argv) > 2 else os.path.join(BASE, "index.live.html")
vorlage = os.path.join(BASE, "index.html")

quiz = json.load(open(quelle, encoding="utf-8"))
if not isinstance(quiz.get("fragen"), list) or not quiz["fragen"]:
    sys.exit("Abbruch: %s enthaelt keine Fragen." % quelle)
code = str(quiz.get("finale", {}).get("code", ""))
if not re.fullmatch(r"\d{4}", code):
    sys.exit("Abbruch: der Zahlencode muss genau 4 Ziffern haben (ist: %r)." % code)
leer = [i + 1 for i, f in enumerate(quiz["fragen"]) if not (f.get("frage") or "").strip()]
if leer:
    print("Warnung: Frage %s ohne Text." % ", ".join(map(str, leer)))

html = open(vorlage, encoding="utf-8").read()
block = "/* {{QUIZ-ANFANG}} */\nconst BEISPIEL = %s;\n/* {{QUIZ-ENDE}} */" % json.dumps(
    quiz, ensure_ascii=False, indent=2)
neu, n = re.subn(r"/\* \{\{QUIZ-ANFANG\}\} \*/.*?/\* \{\{QUIZ-ENDE\}\} \*/",
                 lambda m: block, html, flags=re.S)
if n != 1:
    sys.exit("Abbruch: Marker {{QUIZ-ANFANG}}/{{QUIZ-ENDE}} nicht genau einmal gefunden.")
open(ziel, "w", encoding="utf-8").write(neu)
print("%d Fragen + Zahlenschloss (Code %s)  %s -> %s"
      % (len(quiz["fragen"]), code, os.path.basename(quelle), os.path.basename(ziel)))
