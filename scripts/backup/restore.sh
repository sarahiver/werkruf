#!/usr/bin/env bash
#
# Stellt ein Backup in eine LEERE Datenbank wieder her und prueft es.
#
# ═══════════════════════════════════════════════════════════════
# WAS DIESES SKRIPT NIEMALS TUT
# ═══════════════════════════════════════════════════════════════
#
# Es schreibt nicht in Produktion. Die Zieldatenbank wird angelegt,
# und wenn sie schon existiert, bricht das Skript ab, statt zu
# ueberschreiben — ausser --neu ist gesetzt. Ein Restore, der eine
# vorhandene Datenbank stillschweigend ersetzt, ist ein Werkzeug, mit
# dem man sich genau einmal die Produktion zerstoert.
#
# Es loest keinen Mailversand und keine Google-Schreibaktion aus: die
# wiederhergestellten Cron-Jobs werden unmittelbar nach dem Restore
# deaktiviert, bevor irgendein Zeitplan greifen kann.
#
# ═══════════════════════════════════════════════════════════════
# WARUM EINE LEERE DATENBANK
# ═══════════════════════════════════════════════════════════════
#
# Nicht die G1-Testdatenbank. Die enthaelt ergaenzte Schluessel,
# Stubs und Fixtures, die als [TESTAUFBAU] markiert sind — und genau
# die wuerden verdecken, was im Dump fehlt. G1 hat die Tests
# belastbar gemacht; es hat das Backup nicht geprueft. Ein Restore,
# der auf Testkrücken aufsetzt, beweist nichts.
#
# ═══════════════════════════════════════════════════════════════
# AUFRUF
# ═══════════════════════════════════════════════════════════════
#
#   scripts/backup/restore.sh <datei.dump> [--neu] [--vergleich <url>]
#
#   --neu              vorhandene Zieldatenbank vorher loeschen
#   --vergleich <url>  Fingerabdruck gegen diese Quelldatenbank
#                      diffen (lesend; typisch die Produktionsurl)
#
# Ziel ueber Umgebung:
#   PGHOST   Vorgabe /tmp
#   PGPORT   Vorgabe 5433
#   PGUSER   Vorgabe postgres
#   ZIELDB   Vorgabe werkruf_restore

set -euo pipefail

export PGHOST="${PGHOST:-/tmp}"
export PGPORT="${PGPORT:-5432}"
export PGUSER="${PGUSER:-postgres}"
ZIELDB="${ZIELDB:-werkruf_restore}"

HIER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

DATEI=""
NEU=0
QUELLE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --neu)       NEU=1; shift ;;
    --vergleich) QUELLE="${2:?--vergleich braucht eine URL}"; shift 2 ;;
    -*)          echo "Unbekannte Option: $1" >&2; exit 2 ;;
    *)           DATEI="$1"; shift ;;
  esac
done

[ -n "$DATEI" ] || { echo "Aufruf: restore.sh <datei.dump> [--neu] [--vergleich <url>]" >&2; exit 2; }
[ -f "$DATEI" ] || { echo "Datei fehlt: $DATEI" >&2; exit 2; }

ABDRUCK_DIR="$(mktemp -d)"
trap 'rm -rf "$ABDRUCK_DIR"' EXIT

# ─────────────────────────────────────────────────────────────────
echo "══ 1 — Dump verifizieren, VOR dem Restore"
#
# Der alte Baseline-Dump war im Repo beschaedigt, obwohl der Workflow
# gruen gewesen war. Eine Pruefung bei der Erzeugung findet das nicht.
# Also wird hier noch einmal geprueft, an der Stelle, an der die Datei
# wirklich benutzt wird.
bash "$HIER/verify.sh" "$DATEI"

# ─────────────────────────────────────────────────────────────────
echo
echo "══ 2 — Leere Zieldatenbank $ZIELDB"

vorhanden="$(psql -d postgres -Atc \
  "select 1 from pg_database where datname = '$ZIELDB'" || true)"

if [ -n "$vorhanden" ]; then
  if [ "$NEU" -eq 1 ]; then
    psql -d postgres -q -c \
      "select pg_terminate_backend(pid) from pg_stat_activity
        where datname = '$ZIELDB' and pid <> pg_backend_pid();" >/dev/null
    psql -d postgres -q -v ON_ERROR_STOP=1 -c "drop database $ZIELDB;"
    echo "   alte $ZIELDB geloescht (--neu)"
  else
    echo "ABBRUCH: $ZIELDB existiert bereits." >&2
    echo "Mit --neu loeschen, oder ZIELDB auf einen anderen Namen setzen." >&2
    echo "Dieses Skript ueberschreibt keine vorhandene Datenbank." >&2
    exit 2
  fi
fi

psql -d postgres -q -v ON_ERROR_STOP=1 -c "create database $ZIELDB;"
echo "   angelegt"

# ─────────────────────────────────────────────────────────────────
echo
echo "══ 3 — Rollen"
#
# Rollen sind Cluster-Objekte und stehen in keinem pg_dump. Ohne sie
# scheitert jedes GRANT und jede Policy im Dump.
#
# Dieselbe Datei wie beim Testaufbau, bewusst: es gibt nur eine
# Wahrheit darueber, welche Rollen Supabase mitbringt.
psql -d "$ZIELDB" -q -v ON_ERROR_STOP=1 -f "$HIER/../test-db/sql/00-rollen.sql"
echo "   angelegt"

# ─────────────────────────────────────────────────────────────────
echo
echo "══ 3b — Extensions im Ziel"
#
# WARUM DAS VOR DEM RESTORE STEHT
#
# Ein vollstaendiger Produktionsdump enthaelt CREATE EXTENSION fuer
# pg_cron, pg_net und den Vault. Ein nacktes postgres-Image hat keines
# davon — pg_cron braucht shared_preload_libraries und laesst sich
# nicht nachtraeglich per CREATE EXTENSION hinzufuegen.
#
# Ohne diesen Schritt haette man hundert Folgefehler im Protokoll und
# wuesste nicht, welcher davon die Ursache ist. Hier steht die Ursache
# einmal, vorher, in einem Satz.
#
# Es ist KEIN Abbruch: das public-Schema laesst sich ohne diese
# Extensions wiederherstellen, und fuer eine Pruefung des Schemas und
# der Daten genuegt das. Was fehlt, steht im Bericht.
if [ "$(head -c 5 "$DATEI")" = "PGDMP" ]; then
  pg_restore --list "$DATEI" \
    | grep -oP '^\d+;.* EXTENSION - \K\S+' | sort -u > "$ABDRUCK_DIR/ext-dump.txt" || true

  psql -d "$ZIELDB" -Atc \
    "select name from pg_available_extensions" | sort -u > "$ABDRUCK_DIR/ext-da.txt"

  fehlende="$(comm -23 "$ABDRUCK_DIR/ext-dump.txt" "$ABDRUCK_DIR/ext-da.txt" | tr '\n' ' ')"

  if [ -n "${fehlende// /}" ]; then
    echo "   NICHT VERFUEGBAR: $fehlende"
    echo
    echo "   Das Zielsystem kennt diese Extensions nicht. Das public-Schema"
    echo "   und die Daten lassen sich trotzdem wiederherstellen; alles, was"
    echo "   diesen Extensions GEHOERT, nicht:"
    echo "     pg_cron         → cron.job, cron.job_run_details"
    echo "     supabase_vault  → die Geheimnisse"
    echo "     pg_net          → net._http_response"
    echo
    echo "   Im Katastrophenfall ist das Ziel deshalb ein NEUES"
    echo "   SUPABASE-PROJEKT, kein nacktes PostgreSQL. Siehe"
    echo "   docs/operations/backup-restore.md, \"Wohin restauriert wird\"."
  else
    echo "   alle Extensions des Dumps verfuegbar"
  fi
fi

# ─────────────────────────────────────────────────────────────────
echo
echo "══ 4 — Restore"

PROTOKOLL="$ABDRUCK_DIR/restore.log"

# --no-owner       die Eigentuemerrollen von Supabase existieren lokal
#                  nicht; der Restore soll daran nicht scheitern
# --single-transaction NICHT: ein einzelner Fehler wuerde alles
#                  zuruecknehmen, und man saehe nur den ersten.
#                  Lieber alles versuchen und danach zaehlen.
# -j 4             parallel, der Grund fuer Custom Format
#
# Exit-Code wird bewusst nicht als einziges Kriterium genommen:
# pg_restore endet bei fehlenden Extensions oder Supabase-eigenen
# Rollen mit Warnungen und Exit 1, obwohl das Schema vollstaendig
# steht. Deshalb unten der Fingerabdruck — er entscheidet.
set +e
pg_restore \
  --dbname="$ZIELDB" \
  --no-owner \
  --jobs=4 \
  --verbose \
  "$DATEI" > "$PROTOKOLL" 2>&1
RESTORE_EXIT=$?
set -e

fehler="$(grep -c '^pg_restore: error' "$PROTOKOLL" || true)"
warnungen="$(grep -c '^pg_restore: warning' "$PROTOKOLL" || true)"

echo "   Exit $RESTORE_EXIT, $fehler Fehler, $warnungen Warnungen"

if [ "$fehler" -gt 0 ]; then
  # ── Erwartet oder nicht? ──
  #
  # Ein Restore in ein nacktes PostgreSQL erzeugt zwangslaeufig
  # Fehler: die Extensions fehlen, und alles, was an ihnen haengt,
  # faellt hinterher. Beim ersten echten Lauf waren das 144 Stueck,
  # und ohne diese Trennung sieht ein erwarteter Folgefehler aus wie
  # ein verlorener Datensatz.
  #
  # Erwartet ist, was eine nicht verfuegbare Extension nennt oder
  # eines ihrer Schemas. Alles andere gehoert angesehen.
  # ── Was in einem nackten PostgreSQL zwangslaeufig scheitert ──
  #
  # Zwei Gruppen, beide keine Restore-Defekte:
  #
  #   1. Objekte der Extensions, die hier fehlen (pg_cron, pg_net,
  #      pg_graphql, Vault).
  #
  #   2. Rollen, die Supabase mitbringt und die kein pg_dump enthaelt,
  #      weil Rollen Cluster-Objekte sind: supabase_admin,
  #      dashboard_user, supabase_storage_admin, supabase_realtime_admin,
  #      authenticator, pgbouncer. 00-rollen.sql legt nur die an, die
  #      die Migrationen brauchen (anon, authenticated, service_role,
  #      supabase_auth_admin, postgres) — bewusst, denn diese Datei ist
  #      die Wahrheit darueber, was WERKRUF voraussetzt, nicht darueber,
  #      was Supabase intern hat.
  #
  # Gruppe 2 fehlte im Muster. Der Lauf vom 12.10.2026 meldete deshalb
  # 106 "sonstige" Fehler, und alle 106 waren
  #
  #   role "supabase_admin" does not exist
  #   role "dashboard_user" does not exist
  #
  # Das ist nicht nur Laerm: 106 erwartete Fehler, die als unerwartet
  # gezaehlt werden, verstecken den 107., der es wirklich ist.
  #
  # ACHTUNG, und das steht hier, damit es beim Lesen nicht untergeht:
  # diese Fehler sind GRANTs und Eigentuemerzuweisungen, die verloren
  # gehen. Im echten Katastrophenfall ist das Ziel ein neues
  # Supabase-Projekt, wo diese Rollen existieren und die Anweisungen
  # greifen. In diesem Beweis gehen sie verloren — die Rechtezahl im
  # Fingerabdruck ist deshalb nur gegen Schritt 5 aussagekraeftig,
  # nicht fuer sich.
  ERWARTET='extension "(pg_cron|pg_net|pg_graphql|supabase_vault|pgsodium)"|schema "(cron|net|graphql|vault|pgsodium)" does not exist|relation "(cron|net|vault)\.|role "(supabase_admin|dashboard_user|supabase_storage_admin|supabase_realtime_admin|supabase_replication_admin|authenticator|pgbouncer)" does not exist'

  # Erst die Fehlerzeilen heraus, dann trennen. Beides in eine Datei,
  # nicht durch eine Pipe mit head: unter set -o pipefail toetet der
  # SIGPIPE von head den ganzen Lauf. Genau daran ist der erste echte
  # Restore gescheitert — nicht am Restore, sondern an dieser Zeile.
  grep '^pg_restore: error' "$PROTOKOLL" > "$ABDRUCK_DIR/fehler.txt" || true
  grep -vE "$ERWARTET" "$ABDRUCK_DIR/fehler.txt" \
    > "$ABDRUCK_DIR/fehler-sonstige.txt" || true

  n_sonstige="$(wc -l < "$ABDRUCK_DIR/fehler-sonstige.txt")"
  n_erwartet=$(( fehler - n_sonstige ))

  echo "   davon aus fehlenden Extensions: $n_erwartet, sonstige: $n_sonstige"

  if [ "$n_sonstige" -gt 0 ]; then
    echo "   Sonstige Fehler, die nichts mit Extensions zu tun haben:"
    sed -n '1,8p' "$ABDRUCK_DIR/fehler-sonstige.txt" | sed 's/^/     /'
  else
    echo "   Alle Fehler stammen aus den fehlenden Extensions."
  fi
fi

# ─────────────────────────────────────────────────────────────────
echo
echo "══ 5 — Cron sofort stilllegen"
#
# Bevor irgendein Zeitplan greift. Ein wiederhergestellter
# mail-worker, der in einer Testdatenbank mit echten Kundenadressen
# losläuft, verschickt echte Mails.
#
# Deaktiviert, nicht geloescht: die Definitionen muessen pruefbar
# bleiben, sonst waere der Cron-Teil des Fingerabdrucks leer und der
# Vergleich wertlos.
psql -d "$ZIELDB" -q -c "
  do \$\$
  begin
    if pg_catalog.to_regclass('cron.job') is not null then
      update cron.job set active = false;
      raise notice 'Cron-Jobs deaktiviert: %',
        (select count(*) from cron.job);
    else
      raise notice 'pg_cron nicht vorhanden — nichts zu deaktivieren';
    end if;
  end \$\$;" 2>&1 | sed 's/^/   /'

# ─────────────────────────────────────────────────────────────────
echo
echo "══ 6 — Fingerabdruck"

# ON_ERROR_STOP und Exit-Code pruefen.
#
# Beim ersten Lauf dieses Skripts scheiterte fingerprint.sql an einem
# Typfehler (text || "char"), schrieb eine leere Datei, und Schritt 8
# verglich anschliessend zwei leere Dateien und meldete "strukturell
# identisch". Ein Vergleich, der ohne Daten gruen wird, ist schlimmer
# als keiner: er behauptet, geprueft zu haben.
abdruck_ziehen() {
  local url="$1" ziel="$2" was="$3"
  if ! psql "$url" -v ON_ERROR_STOP=1 -Atf "$HIER/fingerprint.sql" \
         > "$ziel" 2> "$ziel.err"; then
    echo "   FINGERABDRUCK $was GESCHEITERT:" >&2
    sed 's/^/     /' "$ziel.err" >&2
    exit 1
  fi
  # Leer ist kein Ergebnis. Eine Datenbank mit WERKRUF darin hat
  # ueber tausend Zeilen Fingerabdruck.
  local n; n="$(wc -l < "$ziel")"
  if [ "$n" -lt 100 ]; then
    echo "   FINGERABDRUCK $was HAT NUR $n ZEILEN — das ist kein Ergebnis." >&2
    exit 1
  fi
}

abdruck_ziehen "$ZIELDB" "$ABDRUCK_DIR/restore.txt" "Restore"

for klasse in schema fremdtabelle spalte sicht funktion constraint index \
              trigger rls policy sequenz identity recht recht-fkt cron; do
  printf '   %-14s %s\n' "$klasse" \
    "$(grep -c "^$klasse|" "$ABDRUCK_DIR/restore.txt" || true)"
done

# ─────────────────────────────────────────────────────────────────
echo
echo "══ 7 — Kernobjekte namentlich"

# ── Die Vorbedingung, ohne die die Trennung nicht traegt ──
#
# restore-kernchecks.sql unterscheidet zwei Dinge:
#
#   Restore-Defekt     der Restore hat etwas verloren    → rot
#   Produktionsbefund  der Dump trug es getreu herueber  → Warnung
#
# Diese Unterscheidung beruht auf einem Schluss: wenn RLS nach dem
# Restore aus ist, war es im Dump aus — also in Produktion. Der
# Schluss gilt nur, solange pg_restore an keiner RLS- oder
# Policy-Anweisung gescheitert ist. Ist er das, koennte ein
# "Produktionsbefund" in Wahrheit ein verlorenes ENABLE ROW LEVEL
# SECURITY sein, und dann ist er rot, nicht gelb.
#
# Also nachsehen, statt es anzunehmen.
VERTRAUEN="ja"
if [ -f "$ABDRUCK_DIR/fehler.txt" ] \
   && grep -qiE 'row level security|policy' "$ABDRUCK_DIR/fehler.txt"; then
  VERTRAUEN="nein"
  echo "   WARNUNG: pg_restore hatte Fehler an RLS- oder Policy-Anweisungen."
  echo "   Die Trennung Restore-Defekt / Produktionsbefund traegt fuer"
  echo "   diesen Lauf NICHT. Jeder Befund unten ist als moeglicher"
  echo "   Restore-Verlust zu behandeln:"
  grep -iE 'row level security|policy' "$ABDRUCK_DIR/fehler.txt" \
    | sed -n '1,5p' | sed 's/^/     /'
  echo
fi

KERN_LOG="$ABDRUCK_DIR/kernchecks.log"

set +e
psql -d "$ZIELDB" -v ON_ERROR_STOP=1 -q \
  -f "$HIER/restore-kernchecks.sql" > "$KERN_LOG" 2>&1
KERN_EXIT=$?
set -e

sed 's/^/   /' "$KERN_LOG"

# Produktionsbefunde eigens ausweisen. Sie stehen schon oben im
# Protokoll, aber als WARNING zwischen Notices — und was zwischen
# Notices steht, liest niemand.
#
# Die Zahl aus der Meldung lesen und nicht Zeilen zaehlen: die Befunde
# stehen als mehrzeilige WARNING, Zeilenzaehlen waere vom Umbruch
# abhaengig. Kein \K und kein Gedankenstrich im Muster — beides ist
# von Locale und UTF-8-Behandlung des Greps abhaengig.
BEFUNDE="$(sed -n 's/.*PRODUKTIONSBEFUND.*[^0-9]\([0-9][0-9]*\) Eintraege.*/\1/p' \
  "$KERN_LOG" | head -1)"
BEFUNDE="${BEFUNDE:-0}"

if [ "$KERN_EXIT" -ne 0 ]; then
  echo "   KERNCHECKS ROT — der Restore hat etwas verloren" >&2
  exit 1
fi

if [ "$BEFUNDE" -gt 0 ]; then
  if [ "$VERTRAUEN" = "ja" ]; then
    echo "   Kernchecks: kein Restore-Defekt."
    echo "   ABER $BEFUNDE Produktionsbefund(e) — siehe oben."
    echo "   Der Restore ist bewiesen, die Produktion ist es nicht."
  else
    echo "   KERNCHECKS ROT — $BEFUNDE Befunde, Einordnung nicht belastbar" >&2
    exit 1
  fi
else
  echo "   alle Kernchecks gruen"
fi

# ─────────────────────────────────────────────────────────────────
echo
echo "══ 7b — Kundentrennung, fachlich"
#
# Nicht nur Policy-Namen vergleichen: wirklich als authenticated
# lesen und schreiben versuchen.
#
# Dieser Schritt kann an einem gestubbten auth.uid() scheitern — das
# ist kein Fehler des Restores, sondern eine Grenze der Umgebung, und
# die Ausgabe sagt das. Er wird NICHT uebersprungen, weil ein
# uebersprungener Sicherheitstest schlimmer ist als ein roter.
ISOLATION="offen"
if psql -d "$ZIELDB" -v ON_ERROR_STOP=1 -q \
     -f "$HIER/restore-isolation.sql" > "$ABDRUCK_DIR/iso.log" 2>&1; then
  sed 's/^/   /' "$ABDRUCK_DIR/iso.log"
  echo "   Kundentrennung bestaetigt"
  ISOLATION="gruen"
else
  sed 's/^/   /' "$ABDRUCK_DIR/iso.log"
  if grep -q "ist ein Stub" "$ABDRUCK_DIR/iso.log"; then
    echo "   [NICHT GEPRUEFT] auth.uid() ist hier ein Stub."
    echo "   Dieser Test gehoert an einen Restore eines echten Dumps."
    ISOLATION="nicht pruefbar"
  elif grep -q "Kein Nutzer mit Standorten" "$ABDRUCK_DIR/iso.log"; then
    # Seit 12.10.2026 nur noch bei NULL Nutzern. Vorher hiess diese
    # Bedingung "weniger als zwei" — und damit war die Kundentrennung
    # bis zum zweiten Kunden grundsaetzlich nicht pruefbar, also genau
    # bis zu dem Moment, in dem sie stimmen muss. Der Ein-Nutzer-Fall
    # laeuft jetzt mit einer fremden uid als Gegenprobe; siehe
    # restore-isolation.sql, Abschnitt 1b.
    echo "   [NICHT GEPRUEFT] kein einziger Nutzer mit Standorten im Restore."
    ISOLATION="nicht pruefbar"
  else
    echo "   KUNDENTRENNUNG ROT" >&2
    exit 1
  fi
fi

# ─────────────────────────────────────────────────────────────────
if [ -n "$QUELLE" ]; then
  echo
  echo "══ 8 — Vergleich mit der Quelle"
  echo "   (lesend; die Quelle wird nicht angefasst)"

  abdruck_ziehen "$QUELLE" "$ABDRUCK_DIR/quelle.txt" "Quelle"
  echo "   Quelle $(wc -l < "$ABDRUCK_DIR/quelle.txt") Zeilen, Restore $(wc -l < "$ABDRUCK_DIR/restore.txt") Zeilen"

  # ── Cron-Matrix, getrennt ──
  #
  # Schritt 5 hat die Jobs im Restore absichtlich stillgelegt. Dieser
  # eine gewollte Unterschied darf den Vergleich nicht rot machen —
  # also wird das aktiv-Flag fuer den diff neutralisiert und die
  # Matrix separat ausgegeben. Alles andere an den Jobs (Name,
  # Zeitplan, aufgerufene Function) wird streng verglichen.
  echo
  echo "   Cron: Job | Quelle | Restore | Zeitplan identisch"
  python3 - "$ABDRUCK_DIR/quelle.txt" "$ABDRUCK_DIR/restore.txt" <<'PY'
import sys

def cron(pfad):
    d = {}
    for z in open(pfad, encoding='utf-8'):
        if z.startswith('cron|'):
            t = z.rstrip('\n').split('|')
            # cron | name | schedule | aktivflag | ziel
            if len(t) >= 5:
                d[t[1]] = {'schedule': t[2], 'aktiv': t[3], 'ziel': t[4]}
    return d

q, r = cron(sys.argv[1]), cron(sys.argv[2])
for name in sorted(set(q) | set(r)):
    inq = 'ja' if name in q else 'NEIN'
    inr = 'ja' if name in r else 'NEIN'
    gleich = ('ja' if name in q and name in r
              and q[name]['schedule'] == r[name]['schedule']
              and q[name]['ziel'] == r[name]['ziel'] else 'NEIN')
    print(f"     {name:28} {inq:6} {inr:7} {gleich}")
PY

  # aktiv-Flag neutralisieren, nur fuer den diff
  for f in quelle restore; do
    sed -E 's/^(cron\|[^|]*\|[^|]*\|)(aktiv|INAKTIV)\|/\1<aktivflag>|/' \
      "$ABDRUCK_DIR/$f.txt" > "$ABDRUCK_DIR/$f.norm.txt"
  done

  # ── Datenmengen ──
  #
  # Der Fingerabdruck enthaelt bewusst keine Zeilenzahlen: zwischen
  # Dump und Vergleich kommen in der Quelle Zeilen hinzu, im Restore
  # nicht, und ein Vergleich, der deshalb immer abweicht, wird nicht
  # gelesen.
  #
  # Hier trotzdem gezaehlt, aber als eigene Aussage: der Restore darf
  # nicht MEHR haben als die Quelle, und er darf nicht leer sein, wo
  # die Quelle Zeilen hat. Weniger ist bei laufender Produktion
  # normal.
  echo
  echo "   Daten: Tabelle | Quelle | Restore"
  ZAEHL="select 'x'||t||'|'||n from (
    select 'user_profiles' t, count(*) n from public.user_profiles
    union all select 'google_accounts', count(*) from public.google_accounts
    union all select 'google_locations', count(*) from public.google_locations
    union all select 'google_reviews', count(*) from public.google_reviews
    union all select 'events', count(*) from public.events
    union all select 'recommendation_events', count(*) from public.recommendation_events
    union all select 'email_queue', count(*) from public.email_queue
    union all select 'action_tokens', count(*) from public.action_tokens
    union all select 'sync_jobs', count(*) from public.sync_jobs
    union all select 'auth.users', count(*) from auth.users
  ) q order by t"

  psql "$QUELLE"  -Atc "$ZAEHL" | sed 's/^x//' > "$ABDRUCK_DIR/zeilen-q.txt"
  psql -d "$ZIELDB" -Atc "$ZAEHL" | sed 's/^x//' > "$ABDRUCK_DIR/zeilen-r.txt"

  datenfehler=0
  while IFS='|' read -r tabelle nq; do
    nr="$(grep "^$tabelle|" "$ABDRUCK_DIR/zeilen-r.txt" | cut -d'|' -f2)"
    nr="${nr:-0}"
    hinweis=""
    if [ "$nr" -gt "$nq" ]; then
      hinweis="  ← MEHR als die Quelle"; datenfehler=1
    elif [ "$nq" -gt 0 ] && [ "$nr" -eq 0 ]; then
      hinweis="  ← LEER, Quelle hat Zeilen"; datenfehler=1
    elif [ "$nr" -lt "$nq" ]; then
      hinweis="  (Quelle ist seit dem Dump gewachsen)"
    fi
    printf '     %-22s %6s %7s%s\n' "$tabelle" "$nq" "$nr" "$hinweis"
  done < "$ABDRUCK_DIR/zeilen-q.txt"

  [ "$datenfehler" -eq 0 ] || { echo "   DATENPRUEFUNG ROT" >&2; exit 1; }

  echo
  if diff -u "$ABDRUCK_DIR/quelle.norm.txt" "$ABDRUCK_DIR/restore.norm.txt" \
       > "$ABDRUCK_DIR/diff.txt"; then
    echo "   strukturell identisch"
    echo "   (der Unterschied im aktiv-Flag ist gewollt: Schritt 5)"
  else
    nur_quelle="$(grep -c '^-[a-z]' "$ABDRUCK_DIR/diff.txt" || true)"
    nur_restore="$(grep -c '^+[a-z]' "$ABDRUCK_DIR/diff.txt" || true)"
    echo "   UNTERSCHIEDE: $nur_quelle nur in der Quelle, $nur_restore nur im Restore"
    echo
    sed -n '1,60p' "$ABDRUCK_DIR/diff.txt" | sed 's/^/     /'
    cp "$ABDRUCK_DIR/diff.txt" ./restore-diff.txt
    echo
    echo "   vollstaendig in ./restore-diff.txt"
    exit 1
  fi
fi

echo
echo "══ Ergebnis"
echo "   A  Schema und Daten wiederherstellbar:  ja"
echo "   B  Kundentrennung nach Restore:         $ISOLATION"
echo
echo "Restore nach $ZIELDB abgeschlossen."
echo
echo "NOCH NICHT WIEDERHERGESTELLT — siehe docs/operations/backup-restore.md:"
echo "  Edge Functions, Vault-Secrets, Environment, Frontend."
echo "Die Cron-Jobs stehen in $ZIELDB auf active = false."

if [ "$ISOLATION" != "gruen" ]; then
  echo
  echo "Achtung: B ist nicht bewiesen. Fuer die Abnahme muss dieser Lauf"
  echo "gegen einen echten Produktionsdump wiederholt werden."
fi
