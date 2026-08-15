#!/usr/bin/env bash
# Spielt den kompletten Weg durch: Paket bauen, hochladen, zuweisen, abholen, zurueckmelden.
# Braucht keinen Windows-Rechner - nur den Server, der auch unter Linux laeuft.
set -uo pipefail
cd "$(dirname "$0")/.."
export PATH="$PATH:$HOME/.dotnet"

PORT=${PORT:-8791}
B="http://localhost:$PORT"
ARBEIT=$(mktemp -d /tmp/vthin-test-XXXXXX)
BIN=src/VolmeThin.Server/bin/Debug/net8.0-windows
ok=0; fail=0

p(){ if [ "$2" = "$3" ]; then echo "  ok    $1"; ok=$((ok+1)); else echo "  FEHLT $1 (erwartet '$3', war '$2')"; fail=$((fail+1)); fi; }
json(){ python3 -c "import sys,json;$1"; }

aufraeumen(){
  if [ -n "${SPID:-}" ]; then kill "$SPID" 2>/dev/null; wait "$SPID" 2>/dev/null; fi
  rm -rf "$ARBEIT"
}
trap aufraeumen EXIT

echo "== Vorbereiten =="
dotnet build -v q --nologo >/dev/null || { echo "Build fehlgeschlagen"; exit 1; }
dotnet tests/VolmeThin.Tests/bin/Debug/net8.0-windows/vthintests.dll paket "$ARBEIT/probe.v3pkg" probe "Probeprogramm" 1.0.0 >/dev/null
dotnet src/VolmeThin.Builder/bin/Debug/net8.0-windows/volmethin-cli.dll bauen "$ARBEIT/probe.v3pkg" \
  --out "$ARBEIT/Probeprogramm.exe" --stub build/VolmeThin/stub/VolmeThinStub.exe >/dev/null 2>&1 \
  || { echo "Stub fehlt - erst ./publish.sh ausfuehren"; exit 1; }

cat > "$BIN/config.json" <<EOF
{ "Port": $PORT, "AdminSchluessel": "test-admin", "AgentSchluessel": "test-agent",
  "Datenverzeichnis": "$ARBEIT/daten" }
EOF
if curl -s -o /dev/null --max-time 2 "$B/"; then
  echo "Auf Port $PORT antwortet schon etwas - bitte beenden oder PORT= setzen."; exit 1
fi

# exec, damit $! wirklich der Serverprozess ist und nicht die Subshell darum herum.
( cd src/VolmeThin.Server && exec dotnet bin/Debug/net8.0-windows/volmethin-server.dll >"$ARBEIT/server.log" 2>&1 ) &
SPID=$!
gestartet=nein
for i in $(seq 30); do
  if curl -s -o /dev/null --max-time 2 "$B/"; then gestartet=ja; break; fi
  sleep 0.5
done
if [ "$gestartet" != ja ]; then echo "Server kam nicht hoch:"; cat "$ARBEIT/server.log"; exit 1; fi

echo "== Zugang =="
p "ohne Anmeldung kein Katalog" "$(curl -s -o /dev/null -w %{http_code} $B/api/stand)" "401"
p "falscher Schluessel abgewiesen" "$(curl -s -o /dev/null -w %{http_code} -X POST $B/api/anmelden -H 'Content-Type: application/json' -d '{"schluessel":"falsch"}')" "401"
p "richtiger Schluessel akzeptiert" "$(curl -s -o /dev/null -w %{http_code} -X POST $B/api/anmelden -H 'Content-Type: application/json' -d '{"schluessel":"test-admin"}')" "200"

echo "== Katalog =="
head -c 5000 /dev/urandom > "$ARBEIT/muell.exe"
p "EXE ohne Paket wird abgelehnt" "$(curl -s -o /dev/null -w %{http_code} -X POST $B/api/upload -H 'X-VT-Admin: test-admin' -F datei=@$ARBEIT/muell.exe)" "400"
UP=$(curl -s -X POST $B/api/upload -H 'X-VT-Admin: test-admin' -F datei=@$ARBEIT/Probeprogramm.exe)
p "Upload angenommen" "$(echo "$UP" | json 'print(json.load(sys.stdin)["id"])')" "probe"
p "Pruefsumme passt zur Datei" "$(echo "$UP" | json 'print(json.load(sys.stdin)["sha256"])')" "$(sha256sum "$ARBEIT/Probeprogramm.exe" | cut -d' ' -f1 | tr a-f A-F)"

echo "== Agent =="
p "Anmeldung mit falschem Schluessel abgewiesen" "$(curl -s -o /dev/null -w %{http_code} -X POST $B/api/agent/anmelden -H 'Content-Type: application/json' -d '{"schluessel":"falsch","name":"PC-01"}')" "401"
AN=$(curl -s -X POST $B/api/agent/anmelden -H 'Content-Type: application/json' -d '{"schluessel":"test-agent","name":"PC-01","raum":"Kursraum 1","betriebssystem":"Windows 11","agentVersion":"1.0.0"}')
TOK=$(echo "$AN" | json 'print(json.load(sys.stdin)["token"])')
ID1=$(echo "$AN" | json 'print(json.load(sys.stdin)["id"])')
p "Token erhalten" "$([ ${#TOK} -gt 20 ] && echo ja)" "ja"
ID2=$(curl -s -X POST $B/api/agent/anmelden -H 'Content-Type: application/json' -d '{"schluessel":"test-agent","name":"PC-01"}' | json 'print(json.load(sys.stdin)["id"])')
p "erneute Anmeldung behaelt den Eintrag" "$ID1" "$ID2"
p "Auftraege ohne Token abgewiesen" "$(curl -s -o /dev/null -w %{http_code} $B/api/agent/auftraege)" "401"
p "ohne Zuweisung nichts zu tun" "$(curl -s $B/api/agent/auftraege -H "X-VT-Token: $TOK" | json 'print(len(json.load(sys.stdin)["auftraege"]))')" "0"

echo "== Zuweisen und ausliefern =="
curl -s -o /dev/null -X POST $B/api/zuweisung -H 'X-VT-Admin: test-admin' -H 'Content-Type: application/json' -d '{"art":"raum","schluessel":"Kursraum 1","programme":["probe"]}'
p "Auftrag erscheint" "$(curl -s $B/api/agent/auftraege -H "X-VT-Token: $TOK" | json 'a=json.load(sys.stdin)["auftraege"];print(a[0]["id"] if a else "keiner")')" "probe"
curl -s $B/api/agent/paket/probe -H "X-VT-Token: $TOK" -o "$ARBEIT/geladen.exe"
p "geladene Datei ist Byte-gleich" "$(sha256sum "$ARBEIT/geladen.exe" | cut -d' ' -f1)" "$(sha256sum "$ARBEIT/Probeprogramm.exe" | cut -d' ' -f1)"
p "Wiederaufnahme wird unterstuetzt" "$(curl -s -o /dev/null -w %{http_code} -r 100-199 $B/api/agent/paket/probe -H "X-VT-Token: $TOK")" "206"
p "Download ohne Token abgewiesen" "$(curl -s -o /dev/null -w %{http_code} $B/api/agent/paket/probe)" "401"
p "geladene EXE traegt das Paket" "$(dotnet src/VolmeThin.Builder/bin/Debug/net8.0-windows/volmethin-cli.dll info "$ARBEIT/geladen.exe" | grep Kennung | awk '{print $3}')" "probe"

echo "== Rueckmeldung =="
curl -s -o /dev/null -X POST $B/api/agent/meldung -H "X-VT-Token: $TOK" -H 'Content-Type: application/json' -d '{"programmId":"probe","version":"1.0.0","ok":true}'
p "erledigter Auftrag verschwindet" "$(curl -s $B/api/agent/auftraege -H "X-VT-Token: $TOK" | json 'print(len(json.load(sys.stdin)["auftraege"]))')" "0"
curl -s -o /dev/null -X POST $B/api/agent/meldung -H "X-VT-Token: $TOK" -H 'Content-Type: application/json' -d '{"programmId":"probe","version":"1.0.0","ok":false,"text":"Testfehler"}'
p "Fehler landet am Rechner" "$(curl -s $B/api/stand -H 'X-VT-Admin: test-admin' | json 'print(json.load(sys.stdin)["rechner"][0]["fehler"]["probe"])')" "Testfehler"

echo "== Neue Fassung =="
dotnet tests/VolmeThin.Tests/bin/Debug/net8.0-windows/vthintests.dll paket "$ARBEIT/probe2.v3pkg" probe "Probeprogramm" 2.0.0 >/dev/null
dotnet src/VolmeThin.Builder/bin/Debug/net8.0-windows/volmethin-cli.dll bauen "$ARBEIT/probe2.v3pkg" \
  --out "$ARBEIT/Probeprogramm2.exe" --stub build/VolmeThin/stub/VolmeThinStub.exe >/dev/null 2>&1
curl -s -o /dev/null -X POST $B/api/upload -H 'X-VT-Admin: test-admin' -F datei=@$ARBEIT/Probeprogramm2.exe
p "Katalog haelt nur eine Fassung" "$(curl -s $B/api/stand -H 'X-VT-Admin: test-admin' | json 'print(len(json.load(sys.stdin)["programme"]))')" "1"
p "neue Version wird nachgereicht" "$(curl -s $B/api/agent/auftraege -H "X-VT-Token: $TOK" | json 'a=json.load(sys.stdin)["auftraege"];print(a[0]["version"] if a else "keiner")')" "2.0.0"
curl -s -o /dev/null -X POST $B/api/agent/meldung -H "X-VT-Token: $TOK" -H 'Content-Type: application/json' -d '{"programmId":"probe","version":"2.0.0","ok":true}'
p "danach wieder Ruhe" "$(curl -s $B/api/agent/auftraege -H "X-VT-Token: $TOK" | json 'print(len(json.load(sys.stdin)["auftraege"]))')" "0"
p "Fehlermarke ist weg" "$(curl -s $B/api/stand -H 'X-VT-Admin: test-admin' | json 'print(len(json.load(sys.stdin)["rechner"][0]["fehler"]))')" "0"

echo "== Aufraeumen =="
curl -s -o /dev/null -X DELETE $B/api/programm/probe -H 'X-VT-Admin: test-admin'
p "Entfernen loescht auch die Zuweisung" "$(curl -s $B/api/stand -H 'X-VT-Admin: test-admin' | json 'd=json.load(sys.stdin);print(len(d["programme"]), len(d["zuweisung"]["proRaum"].get("Kursraum 1",[])))')" "0 0"
p "Paketdatei ist mitgeloescht" "$(ls "$ARBEIT/daten/pakete" | wc -l)" "0"

echo
echo "$ok bestanden, $fail fehlgeschlagen"
[ $fail -eq 0 ]
