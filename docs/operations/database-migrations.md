# Datenbankmigrationen

Wie eine Änderung am Schema von einer Datei im Repo nach Produktion
kommt — und warum es dafür genau einen Weg gibt.

## Der Befund, aus dem das entstand

Bis zum 12.10.2026 wendete **kein Workflow** Migrationen an.
Nachgesehen über alle sechs Workflows: `db push` kam in keinem vor.
`deploy.yml` deployt ausschließlich Edge Functions.

Migrationen gingen von Hand in den Supabase-SQL-Editor. Das ist die
Ursache des G2.1-Inventurdiffs:

| | |
|---|---|
| in Produktion, nicht im Repo | 8 Sichten, 1 Funktion, 14 Trigger |
| im Repo, nicht in Produktion | 3 Migrationen (G2-Paket) |

Der Drift lief in beide Richtungen, weil nichts ihn schloss. Für den
Katastrophenfall ist das kein Problem — ein Restore holt alles aus dem
Dump, nicht aus den Migrationen. Für den Normalbetrieb ist es eines,
und es wird mit jedem Fremdkunden größer.

## Der Weg

```
Migration schreiben
→ Pull Request
→ CI prüft (deploy.yml: Lint, Deno, SQL-Tests)
→ mergen
→ Actions → "Apply Supabase migrations" → Modus wählen → Dispatch
→ Produktion
```

**Kein automatischer Lauf bei Push.** Produktion wird nur geschrieben,
wenn ein Mensch den Knopf drückt und ein Wort tippt.

## Die drei Modi

| Modus | Bestätigung | Was passiert |
|---|---|---|
| `vorschau` | — | liest nur. Zeigt vorhanden / angewendet / offen und die Dateinamen. Schreibt nichts. |
| `anwenden` | `MIGRATE` | wendet die offenen Migrationen an. |
| `verlauf-nachtragen` | `NACHTRAGEN` | markiert Migrationen als angewendet, **ohne** sie auszuführen. |

### Warum es den dritten Modus gibt

Supabase hält den Migrationsstand in
`supabase_migrations.schema_migrations`. **Diese Tabelle existiert in
Produktion nicht** (abgefragt am 12.10.2026):

```
ERROR: 42P01: relation "supabase_migrations.schema_migrations"
       does not exist
```

Weil alles von Hand lief, weiß Supabase von keiner der 40
Migrationen. Gemessen mit der CLI gegen eine leere Datenbank ohne
Verlaufstabelle:

```
$ supabase db push --dry-run
Would push these migrations:
 • 20260922132500_admin_leads_security.sql
 • 20260923070000_stripe_subscription_mvp.sql
 … alle 40
```

`anwenden` würde also beim ersten Lauf **alle 40 erneut ausführen**.
Bei `create table if not exists` geht das durch; bei einem
`create type` oder `alter table add column` nicht.

**Deshalb ist der erste Lauf `vorschau`, der zweite
`verlauf-nachtragen`, und erst danach wird `anwenden` benutzt.**

`verlauf-nachtragen` ist eine Behauptung über die Wirklichkeit —
„diese Migration ist drin" — und der Workflow prüft sie nicht. Darum
die getippte Bestätigung und darum ist die Versionsliste explizit
angebbar: nachtragen soll man nach dem Lesen der Vorschau, nicht
pauschal.

Gemessen, dass der Weg trägt:

```
$ supabase migration repair --status applied 20260922132500
→ exit 0, Tabelle angelegt, 1 Eintrag
$ supabase db push --dry-run
→ 39 offen statt 40
```

## Was der Workflow prüft, bevor er schreibt

In dieser Reihenfolge, jeder Schritt eine harte Schranke:

1. **Modus und Bestätigung** — ohne Netz, als erster Schritt.
2. **`scripts/check-view-security.sh`** — keine Sicht in `public` ohne
   `security_invoker`.
3. **`scripts/test-db/run.sh`** — die komplette SQL-Suite, Migrationen
   **zweimal** (`setup.sh` Zeile 136; der zweite Durchgang prüft
   Wiederholbarkeit). Eine Migration, die beim zweiten Mal wirft, darf
   Produktion nicht erreichen.
4. **Ziel prüfen** — die Projektkennung aus `supabase/config.toml`
   muss in der Verbindungszeichenkette vorkommen. Sonst Abbruch,
   bevor geschrieben wird. Ausgegeben wird nur die Kennung aus
   `config.toml`; die Zeichenkette selbst nie.
5. **Vorschau** — zwei unabhängige Quellen: selbst gerechnet
   (Dateinamen gegen die Verlaufstabelle) und
   `supabase db push --dry-run`. Weichen sie ab, ist das der
   interessanteste Befund des Laufs.

Die Tests laufen **im Workflow** und nicht per `needs:` auf
`deploy.yml`. Zwischen zwei Workflows gibt es in GitHub Actions keine
verlässliche Abhängigkeit — „war neulich grün" ist keine Zusicherung
für den Stand, der jetzt angewendet wird.

## Was der Workflow niemals tut

```
supabase db reset        setzt die Datenbank zurück
drop/create database     dto.
--include-all            umgeht den Verlauf und wendet alles an, was
                         remote nicht steht — genau der gefährliche
                         Fall oben
--include-seed           Testdaten nach Produktion
automatisches Reconcile  Produktion auf das Repo zwingen
```

Keines dieser Kommandos steht in der Datei. Der einzige schreibende
Befehl ist `supabase db push` mit festen Flags.

### Und einer, den man nicht erwartet

`supabase db push --help` sagt:

> Vault secrets from config.toml are updated before migrations unless
> `--skip-vault` is set.

`db push` schreibt also ohne weiteres Zutun in den Vault — dort liegen
die Produktionsgeheimnisse. `supabase/config.toml` hat derzeit keine
Vault-Einträge, aber „derzeit" ist keine Zusicherung: ein späterer
Eintrag würde bei der nächsten Migration stillschweigend ein Geheimnis
in Produktion überschreiben. **`--skip-vault` ist Pflicht, nicht
Vorsicht.**

## Parallelität

```yaml
concurrency:
  group: produktions-migration
  cancel-in-progress: false
```

Maximal ein Lauf gegen Produktion. `cancel-in-progress` ist
**false**: einen laufenden Migrationslauf mitten im `psql`
abzuschneiden ist schlimmer als zu warten — ein halb angewendeter Lauf
hinterlässt einen Zustand, den niemand aufgeschrieben hat.

## Exit-Code ist Wahrheit

Keine Textsuche nach `ERROR`. Gemessen, dass die CLI sich daran hält:

```
$ supabase migration list --db-url <falsche Datenbank>
→ exit 1
```

`psql`-Aufrufe laufen mit `-v ON_ERROR_STOP=1`. Alle Shell-Schritte
mit `set -euo pipefail`.

## Rollback

**Es gibt keinen.** Produktions-Migrationen sind forward-only. Ein
Fehler wird durch eine **neue Korrekturmigration** behoben, nicht
durch eine Down-Migration.

Gründe: eine Down-Migration ist Code, der nur im Schadensfall läuft
und deshalb nie getestet ist; und sie kann Daten nicht
zurückbringen, die eine Up-Migration gelöscht hat.

Bei destruktiven Migrationen (Spalte löschen, Tabelle umbauen) gilt
vorher `docs/operations/backup-restore.md` — Backup ziehen, Restore
beweisen, dann migrieren.

## Bestehende Migrationen nicht editieren

Append-only. Eine Migration, die schon gelaufen ist, umzuschreiben
macht den Verlauf zur Fiktion: die Datei sagt dann etwas anderes als
das, was in Produktion passiert ist, und niemand kann es mehr
nachvollziehen.

Falsch war etwas? Neue Migration mit einem späteren Zeitstempel.

## Auditierbarkeit

Die Actions-History hält wer, wann, welcher Commit, Exit 0/1. Der
Workflow schreibt zusätzlich in die Zusammenfassung, was dort nicht
steht: welcher Modus mit welcher Absicht lief und welche Migrationen
angewendet wurden. Kein eigenes Audit-System.

## Der SQL-Editor zeigt kein NOTICE

Wer eine Migration von Hand einspielt, sieht bei Erfolg nur

```
Success. No rows returned.
```

Die `raise notice`-Zeilen erscheinen nie. Fehler erscheinen (eine
Exception wird rot angezeigt) — die Fail-closed-Bauweise trägt dort
also, aber die positive Bestätigung fehlt.

Deshalb hat jede Migration aus G2/G2.2 am Fuß eine **Kontrollabfrage,
die Zeilen zurückgibt**. Nach einem Handeinsatz ist die zu laufen.

## Eine Kuriosität

`supabase/migrations/20261005240000_recommendation_class.sql` trägt im
Namen die Stunde **24**. Die CLI kann das Datum nicht lesen und gibt
den Rohwert zurück:

```json
{"local":"20261005240000","remote":"","time":"20261005240000"}
```

Für die Sortierung ist das harmlos — die Reihenfolge ist
lexikografisch. Umbenennen wäre eine Änderung an einer bestehenden
Migration und ist deshalb nicht erlaubt. Festgehalten, damit niemand
es für einen Fehler hält.

## Einmalige Einrichtung

Alles vorhanden. `SUPABASE_DIRECT_DB_URL` (Session Pooler, IPv4) wird
vom Workflow benutzt und ist vom Restore-Beweis bereits erprobt. Kein
neues Secret.

Die Supabase-CLI ist im Migrationsworkflow auf **2.120.0** festgenagelt.
`deploy.yml` nimmt weiter `latest` — für einen Function-Deploy ein
kalkulierbares Risiko, für einen Lauf, der das Produktionsschema
schreibt, keines. Die Flags hier sind gegen genau diese Version
gelesen.
