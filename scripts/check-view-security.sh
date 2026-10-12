#!/usr/bin/env bash
#
# Faellt, wenn eine Migration eine Sicht in public anlegt, ohne
# security_invoker zu setzen.
#
# ═══════════════════════════════════════════════════════════════
# WARUM EIN QUELLTEXT-GATE UND KEIN DATENBANK-TEST
# ═══════════════════════════════════════════════════════════════
#
# Der naheliegende Test waere einer in supabase/tests: Testdatenbank
# aufbauen, nachsehen, ob eine Sicht fuer anon lesbar ist. Der waere
# immer gruen — und zwar falsch gruen.
#
# Die Testdatenbank setzt Supabases Vorgaberechte nicht:
#
#   alter default privileges in schema public
#     grant all on tables to anon, authenticated, service_role;
#
# steht in scripts/test-db/sql/10-supabase-stubs.sql nicht (nachgesehen
# am 12.10.2026). Dort erbt also keine Sicht ein SELECT fuer anon, und
# ein Test, der danach sucht, findet nie etwas. Er wuerde den Zustand
# bescheinigen, der in Produktion gerade NICHT gilt.
#
# Das ist dieselbe Falle wie beim alten Baseline-Dump: eine Pruefung,
# die gruen ist, weil die Umgebung den Fehler nicht hergibt.
#
# Deshalb hier der Quelltext. Was geprueft wird, ist die Ursache und
# nicht die Wirkung: eine Sicht, die ohne security_invoker entsteht,
# laeuft mit den Rechten ihres Eigentuemers, und dann greift RLS der
# Basistabellen nicht — unabhaengig davon, wer sie gerade lesen darf.
#
# ═══════════════════════════════════════════════════════════════
# WARUM security_invoker UND NICHT NUR EIN revoke
# ═══════════════════════════════════════════════════════════════
#
# Gemessen gegen PostgreSQL 16.15 am 12.10.2026:
#
#   create or replace view (ohne WITH-Klausel)  → revoke haelt,
#                                                 security_invoker WEG
#   drop view + create view                     → beides weg
#
# Ein revoke in einer Migration haelt also, solange niemand die Sicht
# loescht und neu anlegt. security_invoker verschwindet schon beim
# naechsten create or replace — lautlos. Genau deshalb muss es IN der
# Definition stehen, bei jedem create, und genau deshalb prueft dieses
# Skript die create-Anweisung und nicht ein nachgestelltes alter.
#
# ═══════════════════════════════════════════════════════════════
# AUFRUF
# ═══════════════════════════════════════════════════════════════
#
#   scripts/check-view-security.sh [migrationsordner]
#
# Vorgabe: supabase/migrations
#
# Exit 0  keine Sicht ohne security_invoker
# Exit 1  mindestens eine gefunden
# Exit 2  Aufruffehler

set -euo pipefail

ORDNER="${1:-supabase/migrations}"

[ -d "$ORDNER" ] || { echo "Ordner fehlt: $ORDNER" >&2; exit 2; }

echo "── Sichten in public: security_invoker"
echo "   Ordner: $ORDNER"

# Die Pruefung arbeitet auf einer normalisierten Fassung jeder Datei:
# Zeilenumbrueche zwischen "create view" und dem "as" sind erlaubt,
# und im Repo steht die WITH-Klausel mal auf derselben, mal auf der
# naechsten Zeile. Deshalb wird jede Datei zu einer Zeile gefaltet,
# Kommentare vorher entfernt.
#
# ── Zwei Fallen, in die der erste Entwurf gelaufen ist ──
#
# 1. grep ohne Treffer gibt Exit 1 zurueck. Unter "set -o pipefail"
#    reisst das die ganze Pipe mit, und "set -e" beendet das Skript —
#    an einer Datei, die einfach keine Sicht enthaelt. Der erste Lauf
#    endete so mit Exit 1 und gab KEINE einzige Zeile aus: es sah wie
#    ein Befund aus und war ein Absturz. Dieselbe Klasse wie der
#    SIGPIPE-Absturz in restore.sh (grep | head unter pipefail).
#    Deshalb an jedem grep ein "|| true".
#
# 2. "... | while read" laeuft in einer Subshell; ein Zaehler darin
#    erreicht die aufrufende Shell nie. Deshalb sammelt der Lauf in
#    eine Datei und zaehlt danach — im uebergebenen Arbeitsordner,
#    nicht unter einem festen Namen in /tmp, wo zwei parallele Laeufe
#    sich gegenseitig die Treffer zuschreiben wuerden.
#
# awk-kompatibles grep -E, kein -P: -P ist in manchen CI-Images nicht
# einkompiliert, und ein Gate, das an der grep-Variante haengt, ist
# kein Gate.

# ── Der Stichtag, und warum es einen gibt ──
#
# Drei bestehende Migrationen legen Sichten ohne security_invoker an:
#
#   20260929140000  ops_sync_failures
#   20260929160000  ops_gbp_api_monitor
#   20260930090000  ops_gbp_pending_edits
#
# Bestehende Migrationen werden nicht editiert — eine Migration, die
# schon gelaufen ist, umzuschreiben, macht den Verlauf zur Fiktion.
# Stattdessen setzt
#
#   20261012130000_ops_sichten_abdichten.sql
#
# security_invoker fuer JEDE Sicht in public, die es zu diesem
# Zeitpunkt gibt, und prueft sich am Ende selbst. Damit sind alle
# Dateien bis zu diesem Stichtag abgedeckt — nicht durch eine
# Ausnahme, sondern durch eine spaetere Anweisung, die greift.
#
# Alles DANACH muss es selbst mitbringen, weil keine weitere
# Sammelmigration folgt und ein create or replace security_invoker
# wieder entfernt.
#
# Der Stichtag wird ausgegeben, nicht verschwiegen: eine
# uebersprungene Pruefung, die man nicht sieht, ist schlimmer als
# keine.
STICHTAG="${STICHTAG:-20261012130000}"

BEFUNDE="$(mktemp)"
UEBERSPRUNGEN="$(mktemp)"
trap 'rm -f "$BEFUNDE" "$UEBERSPRUNGEN"' EXIT

for datei in "$ORDNER"/*.sql; do
  [ -f "$datei" ] || continue

  # Zeitstempel aus dem Dateinamen. Ohne Zeitstempel (kein
  # Migrationsname) wird geprueft, nicht uebersprungen.
  stempel="$(basename "$datei" | grep -oE '^[0-9]{14}' || true)"
  vor_stichtag=0
  if [ -n "$stempel" ] && [ "$stempel" -le "$STICHTAG" ]; then
    vor_stichtag=1
  fi

  # Blockkommentare weg, dann alles auf eine Zeile: im Repo steht die
  # WITH-Klausel mal auf derselben, mal auf der naechsten Zeile.
  gefaltet="$(
    tr '\n' ' ' < "$datei" \
      | sed -E 's#/\*[^*]*\*+([^/*][^*]*\*+)*/# #g' \
      | sed -E 's/[[:space:]]+/ /g'
  )"

  # Jede create-[or-replace-]view-Anweisung herausziehen, eine pro
  # Zeile. Nicht-greedy gibt es in grep -E nicht, deshalb [^;]* —
  # eine Anweisung endet am Semikolon.
  anweisungen="$(
    printf '%s' "$gefaltet" \
      | grep -oiE 'create (or replace )?view (public\.)?[a-z0-9_]+[^;]* as ' \
      || true
  )"

  [ -n "$anweisungen" ] || continue

  while IFS= read -r anweisung; do
    [ -n "$anweisung" ] || continue
    if printf '%s' "$anweisung" \
         | grep -qiE 'security_invoker[[:space:]]*=[[:space:]]*true'; then
      continue
    fi
    name="$(printf '%s' "$anweisung" \
      | grep -oiE 'view (public\.)?[a-z0-9_]+' \
      | head -1 | sed -E 's/^[Vv][Ii][Ee][Ww] //')"

    if [ "$vor_stichtag" -eq 1 ]; then
      printf '   %s  (%s)\n' "$name" "$(basename "$datei")" \
        >> "$UEBERSPRUNGEN"
      continue
    fi

    printf '   OHNE security_invoker: %s  (%s)\n' \
      "$name" "$(basename "$datei")"
    echo x >> "$BEFUNDE"
  done <<< "$anweisungen"
done

treffer="$(wc -l < "$BEFUNDE" | tr -d ' ')"

if [ -s "$UEBERSPRUNGEN" ]; then
  echo "   Bis Stichtag $STICHTAG, abgedeckt durch"
  echo "   20261012130000_ops_sichten_abdichten.sql:"
  cat "$UEBERSPRUNGEN"
fi

echo
if [ "$treffer" -gt 0 ]; then
  cat >&2 <<'HINWEIS'
FEHLER: Sicht in public ohne security_invoker.

Eine Sicht ohne security_invoker laeuft mit den Rechten ihres
Eigentuemers. Row Level Security der Basistabellen greift dann
nicht: wer die Sicht lesen darf, liest alle Zeilen aller Kunden.

Richtig:

  create or replace view public.ops_x with (security_invoker = true)
    as select ...;

  revoke all on public.ops_x from anon, authenticated;

Das revoke zusaetzlich, nicht stattdessen: Supabase vergibt auf
public Vorgaberechte an anon und authenticated, und ein neu
angelegtes Objekt erbt sie.

Hintergrund: supabase/migrations/20261012130000_ops_sichten_abdichten.sql
HINWEIS
  exit 1
fi

echo "   keine Sicht ohne security_invoker"
