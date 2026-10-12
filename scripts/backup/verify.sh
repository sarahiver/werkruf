#!/usr/bin/env bash
#
# Ist dieser Dump vollstaendig?
#
# ═══════════════════════════════════════════════════════════════
# WARUM DIESE DATEI DER KERN VON G2 IST
# ═══════════════════════════════════════════════════════════════
#
# Die alte Pruefung war:
#
#   wc -l schema-export/werkruf-schema.sql
#   ls -lh schema-export/werkruf-schema.sql
#
# Eine abgeschnittene Datei hat Zeilen und eine Groesse. Beides sah
# gut aus. Der Workflow war gruen. Im Repo lag ein Dump, der mitten in
# einer CREATE VIEW endete und keinen einzigen Primaerschluessel
# enthielt.
#
# Diese Pruefung muss genau diese Fehlerklasse finden, und zwar nicht
# nur die eine bekannte Abschneidung, sondern jede.
#
# ═══════════════════════════════════════════════════════════════
# AUFRUF
# ═══════════════════════════════════════════════════════════════
#
#   scripts/backup/verify.sh <datei.dump|datei.sql>
#
# Format wird an der Datei erkannt, nicht an der Endung: ein
# Custom-Format-Archiv beginnt mit der Signatur "PGDMP".
#
# Exit 0 = vollstaendig, soweit pruefbar. Jeder andere Code = nicht
# verwenden.

set -uo pipefail

DATEI="${1:?Aufruf: verify.sh <datei>}"
[ -f "$DATEI" ] || { echo "Datei fehlt: $DATEI" >&2; exit 2; }

fehler=0
meckern() { echo "   FEHLT: $1" >&2; fehler=1; }

echo "── Verify: $(basename "$DATEI")  ($(du -h "$DATEI" | cut -f1))"

# ─────────────────────────────────────────────────────────────────
# Pruefsumme, falls vorhanden
#
# Zuerst, weil eine beschaedigte Datei alle weiteren Befunde
# verfaelscht. Und weil genau hier der alte Fehler lag: die Datei war
# bei der Erzeugung in Ordnung und im Repo nicht mehr.
if [ -f "$DATEI.sha256" ]; then
  if ( cd "$(dirname "$DATEI")" && sha256sum --quiet -c "$(basename "$DATEI").sha256" ); then
    echo "   sha256 stimmt"
  else
    echo "   PRUEFSUMME FALSCH — die Datei wurde nach der Erzeugung veraendert." >&2
    exit 1
  fi
else
  echo "   (keine .sha256 daneben — Beschaedigung nach der Erzeugung nicht pruefbar)"
fi

# ─────────────────────────────────────────────────────────────────
# Format erkennen
if [ "$(head -c 5 "$DATEI")" = "PGDMP" ]; then
  FORMAT=custom
else
  FORMAT=plain
fi
echo "   Format: $FORMAT"

# ═════════════════════════════════════════════════════════════════
# CUSTOM FORMAT
# ═════════════════════════════════════════════════════════════════
if [ "$FORMAT" = custom ]; then

  # Das Inhaltsverzeichnis steht am ENDE des Archivs. Ein
  # abgeschnittenes Archiv hat keines, und pg_restore --list
  # scheitert. Das ist der ganze Grund, Custom Format zu nehmen:
  # Vollstaendigkeit ist pruefbar statt erratbar.
  TOC="$(mktemp)"
  trap 'rm -f "$TOC"' EXIT

  if ! pg_restore --list "$DATEI" > "$TOC" 2>&1; then
    echo "   pg_restore --list scheitert — Archiv unlesbar oder abgeschnitten:" >&2
    sed 's/^/     /' "$TOC" >&2
    exit 1
  fi
  echo "   pg_restore --list lesbar, $(grep -c '^[0-9]' "$TOC") Objekte"

  # Erwartete Objektklassen. Der alte Dump hatte von PRIMARY KEY,
  # INDEX, TRIGGER, POLICY und ACL genau null.
  for klasse in TABLE VIEW FUNCTION "CONSTRAINT" INDEX TRIGGER POLICY SEQUENCE; do
    n="$(grep -c "; .* $klasse " "$TOC" || true)"
    if [ "$n" -eq 0 ]; then
      meckern "keine Objekte der Klasse $klasse"
    else
      printf '   %-12s %s\n' "$klasse" "$n"
    fi
  done

  # Tabellendaten. Ein --schema-only-Dump, der versehentlich als
  # Wiederherstellungsartefakt abgelegt wird, faellt hier auf.
  n="$(grep -c "TABLE DATA" "$TOC" || true)"
  if [ "$n" -eq 0 ]; then
    meckern "TABLE DATA — das ist ein Schema-Dump, kein Restore-Artefakt"
  else
    printf '   %-12s %s\n' "TABLE DATA" "$n"
  fi

  # Namentlich: die Tabellen, ohne die WERKRUF nicht arbeitet.
  for t in user_profiles google_accounts google_locations google_reviews \
           events recommendation_events email_queue action_tokens \
           notification_preferences sync_jobs; do
    grep -q " TABLE public $t " "$TOC" || meckern "Tabelle public.$t"
  done

  # auth.users. Der alte Pfad lief mit --schema=public — ein Backup
  # ohne eine einzige Anmeldung. Nach so einem Restore liegen alle
  # Daten da und niemand kann sich einloggen.
  if ! grep -q " TABLE auth users \| TABLE DATA auth users " "$TOC"; then
    meckern "auth.users — ohne sie ist der Restore nutzlos (Dump mit --schema=public?)"
  fi

# ═════════════════════════════════════════════════════════════════
# PLAIN SQL
# ═════════════════════════════════════════════════════════════════
else

  # Endet die Datei mitten in einem Statement?
  #
  # pg_dump beendet jedes Statement mit einem Semikolon als letztem
  # Zeichen der Zeile. Nach dem letzten Statement folgen nur noch
  # Kommentare, Leerzeilen und — ab pg_dump 17 — \unrestrict.
  #
  # Nicht lastIndexOf(';'): die Kommentarkoepfe von pg_dump enthalten
  # selbst Semikolons ("-- Name: x; Type: VIEW; Schema: public").
  REST="$(python3 - "$DATEI" <<'PY'
import sys
zeilen = open(sys.argv[1], encoding='utf-8', errors='replace').read().split('\n')
letzte = -1
for i in range(len(zeilen) - 1, -1, -1):
    z = zeilen[i].rstrip()
    if z.endswith(';') and not z.lstrip().startswith('--'):
        letzte = i
        break
rest = [z for z in zeilen[letzte + 1:]
        if z.strip() and not z.strip().startswith('--')
        and not z.strip().startswith('\\')]
print('\n'.join(rest).strip())
PY
)"

  if [ -n "$REST" ]; then
    echo "   DATEI ENDET MITTEN IN EINEM STATEMENT:" >&2
    echo "$REST" | head -5 | sed 's/^/     /' >&2
    echo "     → genau die Fehlerklasse des alten Baseline-Dumps" >&2
    fehler=1
  else
    echo "   endet an einer Statementgrenze"
  fi

  # Abschlussmarker von pg_dump.
  #
  # Ab Version 17 schreibt pg_dump \restrict am Anfang und
  # \unrestrict am Ende. Dem alten Dump fehlte das \unrestrict —
  # der klarste Hinweis darauf, dass er nicht durchgelaufen ist.
  if grep -q '^\\restrict' "$DATEI"; then
    grep -q '^\\unrestrict' "$DATEI" \
      || meckern '\unrestrict — \restrict steht da, das Gegenstueck nicht'
  fi
  if ! tail -40 "$DATEI" | grep -qE '^-- (PostgreSQL database dump complete|Completed on)'; then
    meckern '"-- PostgreSQL database dump complete" am Ende'
  fi

  # Objektklassen. Jede einzelne fehlte im alten Dump.
  for muster in "CREATE TABLE" "CREATE VIEW" "CREATE FUNCTION" \
                "PRIMARY KEY" "FOREIGN KEY" "CREATE INDEX" \
                "CREATE POLICY" "ENABLE ROW LEVEL SECURITY"; do
    n="$(grep -c "$muster" "$DATEI" || true)"
    if [ "$n" -eq 0 ]; then
      meckern "$muster"
    else
      printf '   %-28s %s\n' "$muster" "$n"
    fi
  done
fi

# ─────────────────────────────────────────────────────────────────
if [ "$fehler" -ne 0 ]; then
  echo
  echo "VERIFY ROT — diesen Dump nicht verwenden." >&2
  exit 1
fi

echo "   verify gruen"
