#!/usr/bin/env bash
#
# Baut die Testdatenbank auf und laesst alle SQL-Tests laufen.
#
# ═══════════════════════════════════════════════════════════════
# AUFRUF
# ═══════════════════════════════════════════════════════════════
#
#   scripts/test-db/run.sh                  alles: Setup + alle Tests
#   scripts/test-db/run.sh openingHours     Setup + nur passende Tests
#   scripts/test-db/run.sh --kein-setup     nur Tests, bestehende DB
#
# Ein einzelner Test laeuft damit immer gegen ein frisch aufgebautes
# Schema, nicht gegen den Rest eines vorherigen Laufs (Auftrag Punkt 16).
#
# ═══════════════════════════════════════════════════════════════
# WAHRHEIT IST DER EXIT-CODE
# ═══════════════════════════════════════════════════════════════
#
# Kein Durchsuchen der Ausgabe nach dem Wort ERROR. Fruehere Laeufe
# haben so Fehler uebersehen, weil psql sie anders formuliert hat als
# erwartet. Jeder Test laeuft mit
#
#   psql -v ON_ERROR_STOP=1
#
# und zaehlt nur, was der Prozess zurueckgibt.
#
# Am Ende steht, wie viele Dateien gefunden, ausgefuehrt und
# uebersprungen wurden. Uebersprungen soll immer 0 sein; stille Skips
# waren einer der Gruende fuer dieses Paket.

set -uo pipefail

export PGHOST="${PGHOST:-/tmp}"
export PGPORT="${PGPORT:-5433}"
export PGUSER="${PGUSER:-postgres}"
TESTDB="${TESTDB:-werkruf_test}"

HIER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HIER/../.." && pwd)"
TESTS="$REPO/supabase/tests"

MIT_SETUP=1
FILTER=""

for arg in "$@"; do
  case "$arg" in
    --kein-setup) MIT_SETUP=0 ;;
    -*) echo "Unbekannte Option: $arg" >&2; exit 2 ;;
    *)  FILTER="$arg" ;;
  esac
done

# Mit bash aufgerufen, nicht direkt: das Ausführungsrecht geht beim
# Ausliefern über ein ZIP verloren, und ein "Permission denied" an
# dieser Stelle sieht nach einem Testfehler aus.
if [ "$MIT_SETUP" -eq 1 ]; then
  bash "$HIER/setup.sh" || exit $?
fi

printf '\n══ SQL-Tests ══\n\n'

gefunden=0
ausgefuehrt=0
uebersprungen=0
rot=()

for test in "$TESTS"/*.test.sql; do
  gefunden=$((gefunden + 1))
  name="$(basename "$test")"

  if [ -n "$FILTER" ] && [[ "$name" != *"$FILTER"* ]]; then
    uebersprungen=$((uebersprungen + 1))
    continue
  fi

  printf '  %-46s ' "$name"
  protokoll="$(mktemp)"

  if psql -v ON_ERROR_STOP=1 -q --no-psqlrc -d "$TESTDB" \
       -f "$test" >"$protokoll" 2>&1; then
    echo "gruen"
  else
    echo "ROT"
    sed 's/^/      /' "$protokoll"
    rot+=("$name")
  fi

  rm -f "$protokoll"
  ausgefuehrt=$((ausgefuehrt + 1))
done

printf '\n'
printf 'SQL-Dateien:    %s\n' "$gefunden"
printf 'ausgefuehrt:    %s\n' "$ausgefuehrt"
printf 'uebersprungen:  %s%s\n' "$uebersprungen" \
  "$([ -n "$FILTER" ] && echo " (Filter: $FILTER)" || echo "")"
printf 'rot:            %s\n' "${#rot[@]}"

if [ "${#rot[@]}" -gt 0 ]; then
  printf '\nRot:\n'
  for name in "${rot[@]}"; do printf '  %s\n' "$name"; done
  exit 1
fi

printf '\nAlle ausgefuehrten Tests gruen.\n'
