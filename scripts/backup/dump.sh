#!/usr/bin/env bash
#
# Erzeugt ein Backup der WERKRUF-Datenbank — zwei Artefakte, zwei Zwecke.
#
# ═══════════════════════════════════════════════════════════════
# WARUM ZWEI DATEIEN
# ═══════════════════════════════════════════════════════════════
#
# production-baseline-2026-09-22.sql sollte beides sein: lesbare
# Schemareferenz im Repo UND Wiederherstellungsgrundlage. Es war am
# Ende keines von beidem — abgeschnitten mitten in einer CREATE VIEW,
# ohne Schluessel, Indizes, Trigger und Policies.
#
# Eine Datei fuer zwei Zwecke ist der Fehler, nicht die Abschneidung.
# Deshalb hier getrennt:
#
#   werkruf-<stand>.dump        Custom Format, vollstaendig
#                               → das Wiederherstellungsartefakt
#                               → ENTHAELT KUNDENDATEN, nie ins Repo
#
#   werkruf-schema-<stand>.sql  Plain SQL, nur Schema
#                               → die lesbare Referenz
#                               → darf ins Repo
#
# WARUM CUSTOM FORMAT FUER DEN RESTORE
#
#   pg_restore --list  prueft die Datei maschinell: ein abgeschnittenes
#                      Archiv hat kein lesbares Inhaltsverzeichnis und
#                      faellt auf, ohne dass jemand Textmuster raet.
#   komprimiert        kleiner, also weniger Uebertragungsrisiko.
#   selektiv           einzelne Tabellen wiederherstellbar, ohne den
#                      ganzen Dump anzufassen.
#   parallel           pg_restore -j bei groesseren Datenmengen.
#
# Plain SQL kann das nicht: ob eine .sql-Datei vollstaendig ist, laesst
# sich nur an Textmustern erraten — genau die Luecke, durch die der
# alte Dump gefallen ist.
#
# WARUM TROTZDEM EIN PLAIN-SCHEMA-EXPORT
#
# Weil man ein Schema lesen und versionieren will. Diff im
# Pull-Request, Suche nach einer Spalte, Nachvollziehbarkeit. Das
# Custom-Format ist binaer.
#
# ═══════════════════════════════════════════════════════════════
# WAS DIESES SKRIPT ANDERS MACHT ALS DER ALTE WORKFLOW
# ═══════════════════════════════════════════════════════════════
#
#   1. Direkte Verbindung, nicht der Pooler (siehe PRUEFUNG unten).
#   2. pg_dump-Hauptversion wird gegen den Server geprueft und das
#      Skript bricht bei Abweichung ab.
#   3. Alle Schemas, nicht nur public. --schema=public hiesse: ein
#      Backup ohne auth.users. Also ohne eine einzige Anmeldung.
#   4. Prueft sich selbst sofort nach dem Schreiben (verify.sh).
#   5. Schreibt eine .sha256 daneben. Der alte Dump war im Repo
#      kaputt, obwohl der Workflow gruen war — die Beschaedigung lag
#      NACH der Erzeugung. Eine Pruefsumme findet das, eine
#      Verifikation beim Erzeugen nicht.
#
# ═══════════════════════════════════════════════════════════════
# AUFRUF
# ═══════════════════════════════════════════════════════════════
#
#   DATABASE_URL='postgresql://...' scripts/backup/dump.sh [zielordner]
#
# Zielordner Vorgabe: ./backup (in .gitignore aufnehmen).
#
# Die Verbindung MUSS die direkte sein, nicht der Pooler:
#
#   direkt   db.<ref>.supabase.co:5432
#   Pooler   aws-0-<region>.pooler.supabase.com:6543   ← nicht nehmen
#
# Das Skript warnt, wenn der Host nach Pooler aussieht, und bricht bei
# Port 6543 ab. pg_dump braucht eine durchgehende Sitzung; ein
# Transaction-Pooler kann sie mitten im Lauf beenden.

set -euo pipefail

ZIEL="${1:-./backup}"
HIER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

: "${DATABASE_URL:?DATABASE_URL fehlt. Direkte Verbindung, nicht der Pooler.}"

STAND="$(date -u +%Y-%m-%dT%H%M%SZ)"
DUMP="$ZIEL/werkruf-$STAND.dump"
SCHEMA="$ZIEL/werkruf-schema-$STAND.sql"

mkdir -p "$ZIEL"

# Der Zielordner ignoriert seinen eigenen Inhalt.
#
# Im Repo liegt (Stand 12.10.2026) keine .gitignore. Ein Dump mit
# echten Bewertungen, Mailadressen und Profilen waere damit ein
# git-add-Fehler weit von einem Commit entfernt. Diese Datei verhindert
# das lokal, ohne eine .gitignore im Projektwurzelverzeichnis
# anzulegen oder zu ersetzen.
if [ ! -f "$ZIEL/.gitignore" ]; then
  cat > "$ZIEL/.gitignore" <<'IGNORE'
# Dieser Ordner enthaelt Datenbankabzuege mit echten Kundendaten.
# Nichts davon gehoert in die Versionsverwaltung.
*
IGNORE
fi

# ─────────────────────────────────────────────────────────────────
echo "── Verbindung pruefen"

# Pooler erkennen. Port 6543 ist der Transaction-Pooler; 5432 am
# pooler-Host ist der Session-Pooler, der fuer pg_dump zwar meist
# geht, aber nicht der dokumentierte Weg ist.
if [[ "$DATABASE_URL" == *":6543"* ]]; then
  echo "ABBRUCH: Port 6543 ist der Transaction-Pooler." >&2
  echo "pg_dump braucht eine durchgehende Sitzung. Nimm die direkte" >&2
  echo "Verbindung (db.<ref>.supabase.co:5432) oder den Session-Pooler." >&2
  exit 2
fi
if [[ "$DATABASE_URL" == *"pooler.supabase.com"* ]]; then
  # Keine Warnung. Der Session Pooler ist hier die richtige Wahl,
  # nicht die zweitbeste.
  #
  # Die direkte Adresse db.<ref>.supabase.co loest bei neueren
  # Supabase-Projekten nur auf IPv6 auf. Ein GitHub-Runner spricht
  # IPv4 und scheitert mit
  #
  #   connection to server at "db.<ref>.supabase.co"
  #   (2a05:d018:...), port 5432 failed: Network is unreachable
  #
  # Der Session Pooler ist IPv4 und haelt eine durchgehende Sitzung —
  # genau das, was pg_dump braucht. Der Transaction Pooler auf 6543
  # tut das nicht; der wird oben abgewiesen.
  echo "   Session Pooler (IPv4, durchgehende Sitzung) — in Ordnung fuer pg_dump"
fi

# ── Was wird da eigentlich verbunden? ──
#
# Ohne diese Zeile sagt ein Fehlschlag nur
#
#   password authentication failed for user "postgres"
#
# und man raet, ob Passwort oder Benutzername falsch ist. Dabei steckt
# die Antwort in der Adresse: der Session Pooler verlangt den Benutzer
# MIT Projektkennung (postgres.<ref>), die direkte Verbindung nicht.
# Wer nur den Host tauscht, behaelt den falschen Benutzer.
#
# Das Passwort wird dabei ersetzt, nicht gekuerzt — gekuerzt verraet es
# die Laenge.
echo "   Verbindung: $(printf '%s' "$DATABASE_URL" \
  | sed -E 's#^(postgres(ql)?://[^:/@]*):[^@]*@#\1:********@#')"

SERVER_NUM="$(psql "$DATABASE_URL" -Atc "select current_setting('server_version_num')")"
SERVER_MAJOR=$(( SERVER_NUM / 10000 ))
CLIENT_MAJOR="$(pg_dump --version | grep -oE '[0-9]+' | head -1)"

echo "   Server  PostgreSQL $SERVER_MAJOR (server_version_num $SERVER_NUM)"
echo "   Client  pg_dump $CLIENT_MAJOR"

# ─────────────────────────────────────────────────────────────────
# Versionsregel
#
# pg_dump darf NEUER sein als der Server, nie aelter: ein aelteres
# pg_dump kennt neuere Katalogstrukturen nicht und verweigert den
# Dienst oder laesst Objekte weg. Hier wird Gleichheit verlangt, weil
# "neuer ist erlaubt" in der Praxis dazu fuehrt, dass niemand mehr
# hinsieht. Der alte Pfad lief mit pg_dump 17.11 gegen Server 17.6 —
# das war in Ordnung, aber niemand hatte es geprueft.
if [ "$CLIENT_MAJOR" -ne "$SERVER_MAJOR" ]; then
  echo "ABBRUCH: pg_dump $CLIENT_MAJOR passt nicht zu Server $SERVER_MAJOR." >&2
  echo "Gleiche Hauptversion verwenden, etwa:" >&2
  echo "  docker run --rm -e DATABASE_URL -v \"\$PWD/$ZIEL:/out\" \\" >&2
  echo "    postgres:$SERVER_MAJOR pg_dump ..." >&2
  exit 2
fi

# ─────────────────────────────────────────────────────────────────
echo "── 1 — Wiederherstellungsartefakt (Custom Format, mit Daten)"

# --no-owner / --no-privileges NICHT setzen.
#
# Der alte Pfad tat beides. Ohne Rechte im Dump ist nach einem Restore
# nicht mehr nachvollziehbar, was anon und authenticated durften —
# bei einem Produkt mit Row Level Security ist das die halbe
# Sicherheitsarchitektur.
#
# -Fc           Custom Format
# -Z 6          Kompression, Vorgabe
# --no-sync     schneller; die Datei wird danach ohnehin geprueft
pg_dump "$DATABASE_URL" \
  --format=custom \
  --compress=6 \
  --no-sync \
  --verbose \
  --file="$DUMP" 2> "$DUMP.log"

echo "   $DUMP  ($(du -h "$DUMP" | cut -f1))"

# ─────────────────────────────────────────────────────────────────
echo "── 2 — Schemareferenz (Plain SQL, ohne Daten)"

# Hier bewusst nur public: diese Datei ist zum Lesen, und die von
# Supabase verwalteten Schemas (auth, storage, realtime) gehoeren
# nicht zum WERKRUF-Schema. Sie sind im Artefakt aus Schritt 1
# enthalten, wo sie hingehoeren.
pg_dump "$DATABASE_URL" \
  --schema-only \
  --schema=public \
  --no-owner \
  --file="$SCHEMA"

echo "   $SCHEMA  ($(wc -l < "$SCHEMA") Zeilen)"

# ─────────────────────────────────────────────────────────────────
echo "── 3 — Pruefsummen"

# Der Grund: der alte Dump war im Repo beschaedigt, obwohl der
# Workflow gruen war. Eine Pruefung beim Erzeugen kann das nicht
# finden — eine Pruefsumme, die mitreist, schon.
( cd "$ZIEL" && sha256sum "$(basename "$DUMP")" > "$(basename "$DUMP").sha256" )
( cd "$ZIEL" && sha256sum "$(basename "$SCHEMA")" > "$(basename "$SCHEMA").sha256" )
echo "   .sha256 geschrieben"

# ─────────────────────────────────────────────────────────────────
echo "── 4 — Sofort verifizieren"

bash "$HIER/verify.sh" "$DUMP"
bash "$HIER/verify.sh" "$SCHEMA"

echo
echo "Backup fertig: $STAND"
echo
echo "WICHTIG: $DUMP enthaelt Kundendaten."
echo "Nicht ins Repo, nicht als Build-Artefakt. Siehe"
echo "docs/operations/backup-restore.md, Abschnitt \"Umgang mit dem Dump\"."
