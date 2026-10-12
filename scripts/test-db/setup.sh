#!/usr/bin/env bash
#
# Baut die SQL-Testdatenbank von Null auf.
#
# ═══════════════════════════════════════════════════════════════
# WARUM
# ═══════════════════════════════════════════════════════════════
#
# Vorher wurde die Testdatenbank von Hand zusammengesetzt. Nach jedem
# Container-Neustart entstand sie neu — und jedes Mal ein bisschen
# anders. Zuletzt waren google_locations.account_id und
# google_accounts.provider_account_id dort nullable, in Produktion aber
# NOT NULL. Dreizehn Tests waren deshalb gruen, obwohl sie Daten
# erzeugten, die Produktion gar nicht zulaesst.
#
# Dieses Skript ist die einzige Stelle, an der die Testdatenbank
# entsteht. Es nennt jeden Schritt, prueft jeden Exit-Code und bricht
# beim ersten echten Fehler ab.
#
# ═══════════════════════════════════════════════════════════════
# REIHENFOLGE
# ═══════════════════════════════════════════════════════════════
#
#   1. leere Datenbank
#   2. Rollen            anon, authenticated, service_role …
#   3. Baseline          das Produktionsschema, gefiltert
#   4. Supabase-Stubs    auth, cron, net, vault, storage
#   5. Baseline-Luecken  Schluessel und Indizes, die der Dump verlor
#   6. Migrationen       alle, in Dateinamenfolge
#   7. Fixtures          zentrale Testhelfer im Schema test
#   8. Fingerprint       prueft, dass das Schema so hart ist wie Produktion
#
# Schritt 5 steht vor 6, weil vierzehn Migrationen Fremdschluessel
# anlegen und ohne Primaerschluessel im Ziel scheitern.
#
# ═══════════════════════════════════════════════════════════════
# AUFRUF
# ═══════════════════════════════════════════════════════════════
#
#   scripts/test-db/setup.sh
#
# Einstellbar ueber Umgebungsvariablen:
#
#   PGHOST      Vorgabe /tmp        (Unix-Socket; Supabase-Stil)
#   PGPORT      Vorgabe 5433
#   PGUSER      Vorgabe postgres
#   TESTDB      Vorgabe werkruf_test
#
# Exit 0 heisst: die Datenbank steht und ist schemagetreu, soweit die
# Baseline es hergibt. Jeder andere Exit-Code heisst: sie steht nicht.

set -euo pipefail

export PGHOST="${PGHOST:-/tmp}"
export PGPORT="${PGPORT:-5433}"
export PGUSER="${PGUSER:-postgres}"
TESTDB="${TESTDB:-werkruf_test}"

HIER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HIER/../.." && pwd)"
BASELINE="$REPO/supabase/schema/production-baseline-2026-09-22.sql"
MIGRATIONEN="$REPO/supabase/migrations"
LADBAR="$(mktemp -t baseline-ladbar.XXXXXX.sql)"

trap 'rm -f "$LADBAR"' EXIT

schritt() { printf '\n── %s\n' "$1"; }

# psql ohne Spielraum: ON_ERROR_STOP, und der Exit-Code entscheidet.
# Kein Durchsuchen der Ausgabe nach dem Wort ERROR (Auftrag Punkt 19).
p() { psql -v ON_ERROR_STOP=1 -q --no-psqlrc -d "$TESTDB" "$@"; }

# ─────────────────────────────────────────────────────────────────
schritt "Voraussetzungen"

for werkzeug in psql node; do
  command -v "$werkzeug" >/dev/null 2>&1 || {
    echo "FEHLT: $werkzeug" >&2; exit 2; }
done

pg_isready -q || {
  echo "Kein PostgreSQL auf $PGHOST:$PGPORT erreichbar." >&2
  echo "Siehe docs/testing/sql-test-db.md, Abschnitt Voraussetzungen." >&2
  exit 2
}

[ -f "$BASELINE" ] || { echo "Baseline fehlt: $BASELINE" >&2; exit 2; }

echo "PostgreSQL $(psql -d postgres -Atc 'show server_version') auf $PGHOST:$PGPORT"

# ─────────────────────────────────────────────────────────────────
schritt "1 — leere Datenbank $TESTDB"

# Verbindungen kappen, sonst scheitert DROP DATABASE an einer offenen
# psql-Sitzung von vorher.
psql -q --no-psqlrc -d postgres -c \
  "select pg_terminate_backend(pid) from pg_stat_activity
    where datname = '$TESTDB' and pid <> pg_backend_pid();" >/dev/null
psql -q --no-psqlrc -d postgres -c "drop database if exists $TESTDB;"
psql -q --no-psqlrc -d postgres -v ON_ERROR_STOP=1 -c "create database $TESTDB;"

# Die Baseline legt public selbst an. Also erst wegnehmen, was
# PostgreSQL mitliefert — sonst "schema public already exists".
p -c "drop schema public cascade;"

# ─────────────────────────────────────────────────────────────────
schritt "2 — Rollen"
p -f "$HIER/sql/00-rollen.sql"

# ─────────────────────────────────────────────────────────────────
schritt "3 — Baseline (gefiltert)"
node "$HIER/baseline-filter.mjs" "$BASELINE" > "$LADBAR"
p -f "$LADBAR"
printf '   %s Tabellen, %s Sichten, %s Funktionen\n' \
  "$(p -Atc "select count(*) from pg_tables where schemaname='public'")" \
  "$(p -Atc "select count(*) from pg_views where schemaname='public'")" \
  "$(p -Atc "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'")"

# ─────────────────────────────────────────────────────────────────
schritt "4 — Supabase-Stubs"
p -f "$HIER/sql/10-supabase-stubs.sql"

# ─────────────────────────────────────────────────────────────────
schritt "5 — Baseline-Luecken"
p -f "$HIER/sql/20-baseline-luecken.sql"

# ─────────────────────────────────────────────────────────────────
schritt "6 — Migrationen"

# Zweimal, in Dateinamenfolge.
#
# Jede Migration dieses Projekts traegt "Wiederholbar" im Kopf. Einmal
# stimmte das nicht: 20261007100000 kopierte CREATE FUNCTION aus dem
# Schema-Dump statt CREATE OR REPLACE und scheiterte beim zweiten Lauf.
# Aufgefallen ist das zufaellig. Seitdem laeuft die Reihe grundsaetzlich
# zweimal — der zweite Durchgang kostet Sekunden und prueft eine
# Eigenschaft, auf die sich jeder Deploy verlaesst.
#
# Eine Migration, die bewusst nicht wiederholbar ist, gehoert in
# NICHT_WIEDERHOLBAR unten, mit Begruendung. Leer heisst: alle sind es.
NICHT_WIEDERHOLBAR=()

migrationen_anwenden() {
  local durchgang="$1" anzahl=0
  for migration in "$MIGRATIONEN"/*.sql; do
    local name; name="$(basename "$migration")"

    if [ "$durchgang" = "2" ]; then
      local ausgenommen=0
      for n in ${NICHT_WIEDERHOLBAR+"${NICHT_WIEDERHOLBAR[@]}"}; do
        [ "$n" = "$name" ] && ausgenommen=1
      done
      [ "$ausgenommen" -eq 1 ] && continue
    fi

    anzahl=$((anzahl + 1))
    if ! p -f "$migration" >/dev/null 2>"$LADBAR.err"; then
      echo "   FEHLER in $name (Durchgang $durchgang):" >&2
      sed 's/^/     /' "$LADBAR.err" >&2
      [ "$durchgang" = "2" ] && echo \
        "   Diese Migration ist nicht wiederholbar. Entweder korrigieren
   (CREATE OR REPLACE, IF NOT EXISTS) oder in NICHT_WIEDERHOLBAR in
   scripts/test-db/setup.sh aufnehmen, mit Begruendung." >&2
      rm -f "$LADBAR.err"
      exit 1
    fi
    rm -f "$LADBAR.err"
  done
  printf '   Durchgang %s: %s angewendet, 0 Fehler\n' "$durchgang" "$anzahl"
}

migrationen_anwenden 1
migrationen_anwenden 2

# ─────────────────────────────────────────────────────────────────
schritt "7 — Fixtures"
p -f "$HIER/sql/80-fixtures.sql"

# ─────────────────────────────────────────────────────────────────
schritt "8 — Fingerprint"
p -f "$HIER/sql/90-fingerprint.sql"

printf '\n%s steht.\n' "$TESTDB"
