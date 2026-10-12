# Backup und Restore

Wie ein vollständiges Backup der WERKRUF-Produktionsdatenbank entsteht,
wie man prüft, dass es eines ist, und wie man daraus wiederherstellt.

> **Ein Backup ist erst dann ein Backup, wenn ein Restore bewiesen
> wurde.** Und für WERKRUF zusätzlich: ein Restore ist erst dann
> erfolgreich, wenn auch der Betrieb wieder läuft — Schema und Daten
> allein ergeben ein Produkt, das stumm dasteht.

---

## Der Befund, aus dem das entstand

`supabase/schema/production-baseline-2026-09-22.sql` war das einzige
Backup-Artefakt im Repo. Es ist **unbrauchbar**:

```
CREATE VIEW public.ops_reply_pipeline AS
 SELECT status, source, count(*) AS replies,
    count(*) FILTER (WHERE (created_at > (now() - '24:00:00'::interval))) AS last_24h,
    min(created_at) F
```

Nach `min(created_at) F` ist Schluss. `pg_dump` schreibt Schlüssel,
Indizes, Trigger, Policies, Sequenzen und Rechte **nach** Tabellen und
Sichten — der Schnitt liegt davor. In der Datei stehen 0 Primärschlüssel,
0 Fremdschlüssel, 0 Indizes, 0 Trigger, 0 Policies.

Dazu zwei weitere Fehler im alten Pfad:

| | |
|---|---|
| `--schema=public` | ließ 27 `auth`-Tabellen weg, darunter `auth.users`. Ein Restore hätte alle Kundendaten und **keine einzige Anmeldung** |
| `wc -l` + `ls -lh` als Prüfung | eine abgeschnittene Datei hat Zeilen und eine Größe |

Und ein Betriebsbefund, der schwerer wiegt als die fehlenden
Constraints: von den produktiven Cron-Jobs ist nur `engine-daily` im
Repo versioniert. Ein Restore kann deshalb Schema und Daten vollständig
wiederherstellen und ein Produkt erzeugen, das **nichts mehr tut** —
und das fällt erst eine Woche später auf, wenn keine Wochenmail kommt.

---

## Wohin restauriert wird

**Im Katastrophenfall: in ein neues Supabase-Projekt. Nicht in ein
nacktes PostgreSQL.**

Das ist keine Vorliebe, sondern eine Eigenschaft der Extensions. Ein
vollständiger Produktionsdump enthält `CREATE EXTENSION` für `pg_cron`,
`pg_net` und den Vault. Ein gewöhnliches `postgres:17` kennt keine
davon, und `pg_cron` lässt sich nicht nachträglich hinzufügen — es
braucht `shared_preload_libraries`.

`restore.sh` prüft das vor dem Restore (Schritt 3b) und nennt die
Lücke in einem Satz, statt hundert Folgefehler zu produzieren.

Was ein Restore in ein nacktes PostgreSQL **kann**: das `public`-Schema,
die `auth`-Tabellen, alle Daten, alle Constraints, Policies und Rechte.
Für eine Prüfung des Schemas und der Datenmengen genügt das.

Was es **nicht kann** — und zwar nicht, weil der Dump schlecht ist,
sondern weil diese Dinge Extensions gehören:

| | |
|---|---|
| `cron.job`, `cron.job_run_details` | gehören `pg_cron` |
| die Vault-Geheimnisse | gehören `supabase_vault` |
| `net._http_response` | gehört `pg_net` |

### Und ein Punkt, der schwerer wiegt

`pg_dump` nimmt die **Daten** von Extension-eigenen Tabellen nur mit,
wenn die Extension sie per `pg_extension_config_dump` dafür anmeldet.
`pg_cron` tut das nicht.

> **Die produktiven Cron-Jobs stehen in keinem pg_dump.** Auch nicht im
> neuen. Die Versionierung im Repo ist deshalb nicht gute Praxis,
> sondern der einzige Weg, auf dem sie einen Verlust überleben.

Zu bestätigen mit:

```sql
select extname, extversion, extconfig is not null as daten_im_dump
  from pg_extension order by extname;
```

Steht bei `pg_cron` `daten_im_dump = false`, gilt der Satz.

---

## Voraussetzungen

```
psql und pg_dump, Hauptversion wie Produktion (17)
die DIREKTE Verbindungs-URL, nicht der Pooler
ein PostgreSQL für den Restore-Test (lokal oder Container)
```

**Direkt oder Pooler** — das ist der Unterschied, an dem der alte Dump
vermutlich gescheitert ist:

```
direkt   db.<ref>.supabase.co:5432                 ← diese nehmen
Pooler   aws-0-<region>.pooler.supabase.com:6543   ← nicht
```

`pg_dump` braucht eine durchgehende Sitzung. Ein Transaction-Pooler kann
sie mitten im Lauf beenden. `dump.sh` bricht bei Port 6543 ab und warnt
bei einem Pooler-Host.

Beide Skripte prüfen die pg_dump-Hauptversion gegen den Server und
brechen bei Abweichung ab. Ein älteres `pg_dump` als der Server lässt
Objekte weg, ohne das zu melden.

---

## Backup erstellen

```bash
DATABASE_URL='postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres' \
  scripts/backup/dump.sh ./backup
```

Es entstehen **zwei Dateien mit zwei Zwecken** — die alte Baseline
versuchte beides zu sein und war am Ende keines:

| Datei | Zweck | ins Repo? |
|---|---|---|
| `werkruf-<stand>.dump` | Custom Format, Schema **und Daten**, alle Schemas | **nie** |
| `werkruf-schema-<stand>.sql` | Plain SQL, nur Schema, nur `public` | ja |

Dazu je eine `.sha256`.

### Warum Custom Format für den Restore

`pg_restore --list` prüft die Datei **maschinell**: ein abgeschnittenes
Archiv hat kein lesbares Inhaltsverzeichnis und fällt auf, ohne dass
jemand Textmuster raten muss. Dazu: komprimiert, selektiv
wiederherstellbar, parallel (`-j`).

Bei Plain SQL lässt sich Vollständigkeit nur erraten — genau die Lücke,
durch die der alte Dump gefallen ist.

### Umgang mit dem Dump

Der `.dump` enthält echte Bewertungen, Mailadressen und Profile.

```
nicht ins Repo
nicht als GitHub-Artefakt  (jeder mit Leserecht könnte ihn laden)
verschlüsselt ablegen, Aufbewahrung begrenzen
```

Deshalb erzeugt der Workflow `export-supabase-schema.yml` nur die
**Schemareferenz**. Das vollständige Backup ist ein lokaler Vorgang.

---

## Backup verifizieren

```bash
scripts/backup/verify.sh ./backup/werkruf-<stand>.dump
```

Läuft automatisch am Ende von `dump.sh` und erneut am Anfang von
`restore.sh` — **absichtlich zweimal**. Der alte Dump war im Repo
beschädigt, obwohl der Workflow grün gewesen war: die Beschädigung lag
*nach* der Erzeugung. Eine Prüfung beim Erzeugen kann das nicht finden,
eine Prüfsumme und eine zweite Prüfung an der Verwendungsstelle schon.

Geprüft wird:

| Custom Format | Plain SQL |
|---|---|
| `.sha256` stimmt | `.sha256` stimmt |
| `pg_restore --list` lesbar | endet an einer Statementgrenze |
| TABLE, VIEW, FUNCTION, CONSTRAINT, INDEX, TRIGGER, POLICY, SEQUENCE je > 0 | `\unrestrict` vorhanden, wenn `\restrict` da ist |
| TABLE DATA > 0 (sonst ist es ein Schema-Dump) | `-- PostgreSQL database dump complete` |
| die zehn Kerntabellen namentlich | PRIMARY KEY, FOREIGN KEY, CREATE INDEX, CREATE POLICY, ENABLE ROW LEVEL SECURITY je > 0 |
| **`auth.users`** | |

Exit ≠ 0 heißt: diesen Dump nicht verwenden.

---

## Restore ausführen

```bash
PGHOST=localhost PGPORT=5432 PGUSER=postgres ZIELDB=werkruf_restore \
  scripts/backup/restore.sh ./backup/werkruf-<stand>.dump --neu \
  --vergleich 'postgresql://...'      # optional, lesend
```

**Nie gegen Produktion.** Ohne `--neu` bricht das Skript ab, wenn die
Zieldatenbank existiert, statt zu überschreiben.

Was passiert:

```
1  Dump verifizieren           vor dem Restore, nicht danach
2  leere Zieldatenbank         angelegt, nicht wiederverwendet
3  Rollen                      aus scripts/test-db/sql/00-rollen.sql
4  pg_restore                  --no-owner, -j 4
5  Cron SOFORT stilllegen      active = false, vor jedem Zeitplan
6  Fingerabdruck               über 1000 Zeilen Objekte
7  Kernchecks                  Tabellen, Funktionen, RLS, Pflichtspalten
7b Kundentrennung              wirklich als authenticated lesen
8  Vergleich mit der Quelle    Cron-Matrix, Datenmengen, diff
```

**Nicht auf die G1-Testdatenbank restaurieren.** Die enthält als
`[TESTAUFBAU]` markierte Schlüssel, Stubs und Fixtures — und genau die
würden verdecken, was im Dump fehlt.

Schritt 5 ist keine Formalität: ein wiederhergestellter `mail-worker`,
der in einer Testdatenbank mit echten Kundenadressen losläuft,
verschickt echte Mails. Deaktiviert, nicht gelöscht — die Definitionen
müssen prüfbar bleiben.

Schritt 7b bricht ab, wenn `auth.uid()` ein Stub ist. Das ist gewollt:
gegen einen Stub liefert jede Abfrage null Zeilen, und der Test wäre
grün, ohne etwas geprüft zu haben. Er wird nicht übersprungen, sondern
sichtbar als nicht geprüft gemeldet.

---

## Nach dem Restore

Ein DB-Restore stellt **nur die Datenbank** wieder her. Das Folgende
liegt außerhalb und muss separat kommen:

### Secrets

Vault-Secrets sind im Dump verschlüsselt und nach einem Restore in eine
andere Datenbank nicht entschlüsselbar. Neu setzen:

| Secret | wo | wofür |
|---|---|---|
| `gbp_worker_secret` | Vault | alle Cron-Jobs, die `net.http_post` auf eine Edge Function machen |

Dazu die Edge-Function-Umgebung in den Supabase-Projekteinstellungen:

```
BREVO_API_KEY            Mailversand
EMAIL_DELIVERY_MODE      auf test, bis der Betrieb steht
EMAIL_TEST_RECIPIENT
GOOGLE_CLIENT_ID / _SECRET   OAuth
STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET
die Schlüssel für die Tokenverschlüsselung
```

Konkrete Namen in `supabase/functions/*/index.ts` an den
`requireEnv(...)`-Aufrufen. **Werte stehen nirgends im Repo und gehören
dort nicht hin.**

### Edge Functions

Kommen nicht aus `pg_dump`. Aus dem Repo deployen:

```bash
supabase functions deploy --project-ref <ref>
```

Macht auch `.github/workflows/deploy.yml` bei einem Push auf `main`.
Zwölf Funktionen, Stand 12.10.2026.

### Cron-Jobs

Siehe unten — der offene Punkt.

### Frontend

Vercel, aus dem Repo. Nicht Teil des Datenbank-Restores. Nach einem
Restore in eine neue Datenbank müssen `REACT_APP_SUPABASE_URL` und der
Anon-Key angepasst werden.

---

## Recovery Checklist

```
[ ] Dump verifiziert            scripts/backup/verify.sh
[ ] DB restored                 scripts/backup/restore.sh
[ ] Fingerabdruck verglichen    Schritt 8, diff leer
[ ] RLS / Policies              Schritt 7, je Recht geprüft
[ ] Kundentrennung              Schritt 7b, nicht übersprungen
[ ] Datenmengen plausibel       Schritt 8
[ ] Vault-Secrets neu gesetzt   gbp_worker_secret
[ ] Edge Functions deployt      12 Funktionen
[ ] Environment gesetzt         Brevo, Google, Stripe
[ ] Cron Jobs                   Migration anwenden, dann active = true
[ ] Engine                      engine-daily feuert
[ ] Weekly Planner              comm-weekly erzeugt email_queue-Zeilen
[ ] Mail Worker                 EMAIL_DELIVERY_MODE=test, eine Mail durch
[ ] Alerts                      comm-alerts läuft
[ ] Google Sync                 ein Standort synchronisiert
[ ] Frontend                    zeigt Daten
```

Reihenfolge der letzten sechs Punkte ist nicht beliebig: erst Secrets,
dann Functions, dann Cron aktivieren. Ein aktivierter Cron ohne Secret
schlägt fehl und füllt `cron.job_run_details` mit Fehlern.

### Recovery-Reihenfolge

```
1  Ziel bereitstellen        neues Supabase-Projekt (nicht nackt)
2  Dump verifizieren         verify.sh — vor allem anderen
3  Datenbank restaurieren    restore.sh, Crons bleiben inaktiv
4  Vault-Secrets setzen      gbp_worker_secret
5  Edge Functions deployen   aus dem Repo, 12 Stück
6  Environment prüfen        Brevo, Google, Stripe; Delivery auf test
7  Cron-Migration anwenden   die Jobs kommen aus dem Repo, nicht aus
                             dem Dump — siehe oben
8  Smoke Tests               Engine, Planer, Worker, Alerts, Sync
9  Crons aktivieren          active = true, einzeln
```

Schritt 2 steht vor 3, weil ein Restore aus einem beschädigten Dump
Stunden kosten kann, bevor es auffällt.

Schritt 4 vor 5, weil eine Edge Function ohne Secret beim ersten
Aufruf scheitert und der Fehler dann wie ein Codefehler aussieht.

Schritt 7 vor 8 und 8 vor 9: ein aktivierter Cron, der auf eine noch
nicht deployte Function zeigt, erzeugt Fehlerrauschen, in dem der
eigentliche Smoke-Test untergeht.

Schritt 9 einzeln, nicht `update cron.job set active = true`. Zuerst
`engine-daily`, dessen Lauf prüfen, dann der Planer, dann der Worker —
in der Reihenfolge, in der sie montags ohnehin laufen.

---

## Die Betriebsreihenfolge am Montag

Darf durch keine Versionierung verändert werden:

```
04:30  engine-daily    bewertet neu, schreibt events
07:00  comm-weekly     plant daraus die Wochenmail, füllt email_queue
*/10   mail-worker     arbeitet die Queue ab
```

Die Engine **vor** dem Planer. Umgekehrt läse die Montagsmail den Stand
vom letzten Abgleich, der Tage zurückliegen kann.

---

## Offen: Cron-Versionierung

**Dies ist der eine Punkt, der noch fehlt.** Im Repo ist nur
`engine-daily` versioniert (`20261005100000_daily_engine_evaluation.sql`).
Die übrigen Jobs existieren nur in Produktion, von Hand im SQL-Editor
angelegt.

Inventar aufnehmen:

```sql
select jobid, jobname, schedule, active, left(command, 300)
  from cron.job order by jobname;
```

Dann je Job prüfen, **bevor** er versioniert wird:

```
wird er noch gebraucht?
zeigt er auf den aktuellen Endpoint?
dupliziert er einen neueren Job?
passt die Kadenz zur heutigen Architektur?
```

Produktion nicht blind kopieren — sie kann Altlasten enthalten.

Muster für die Migration, aus `20261005100000`:

```sql
do $$
begin
  if exists (select 1 from cron.job where jobname = '<name>') then
    perform cron.unschedule('<name>');
  end if;

  perform cron.schedule('<name>', '<schedule>', $job$
    select net.http_post(
      url     := 'https://<ref>.supabase.co/functions/v1/<pfad>',
      headers := jsonb_build_object(
                   'Content-Type',    'application/json',
                   'X-Worker-Secret', (select decrypted_secret
                                         from vault.decrypted_secrets
                                        where name = 'gbp_worker_secret')),
      body    := '{}'::jsonb,
      timeout_milliseconds := 180000);
  $job$);
end $$;
```

`unschedule` vor `schedule`: so entsteht beim zweiten Einspielen kein
zweiter Job. **Keine Secrets in den Befehlstext** — nur der
Vault-Verweis, wie oben.

`engine-daily` darf dabei nicht doppelt entstehen: entweder die neue
Migration übernimmt ihn (dasselbe Muster ersetzt ihn sauber) oder sie
lässt ihn aus. Nicht beides.

---

## Die alte Baseline

`supabase/schema/production-baseline-2026-09-22.sql` bleibt im Repo,
**als deprecated markiert, nicht gelöscht**.

Gründe fürs Behalten: `scripts/test-db/setup.sh` baut die
Testdatenbank daraus, und `scripts/test-db/sql/20-baseline-luecken.sql`
begründet jede ergänzte Eigenschaft mit einer Zeilennummer in dieser
Datei. Beides bricht, wenn sie verschwindet.

Sobald der erste vollständige Export vorliegt:

1. Export als `supabase/schema/production-schema-<datum>.sql` ablegen.
2. `setup.sh` auf die neue Datei umstellen.
3. `20-baseline-luecken.sql` prüfen — was der vollständige Export
   mitbringt, kann dort weg. Die Datei ist so gebaut, dass sie das von
   selbst merkt: sie ergänzt nur, was fehlt.
4. Erst dann die alte Baseline entfernen, in einem eigenen Commit, mit
   `baseline-luecken.md` als Begründung in der Historie.

Nicht in einem Schritt. Die alte Datei ist kaputt, aber sie ist die
einzige Erklärung dafür, warum der Testaufbau so aussieht, wie er
aussieht.

## Das Pooler-Secret

`SUPABASE_POOLER_DB_URL` wird nach dem Umbau **nirgends mehr
verwendet** — eine repo-weite Suche findet es nur noch in zwei
Kommentaren, die erklären, warum es weg ist. In Workflows laufen
ausschließlich `SUPABASE_ACCESS_TOKEN` (Deploy) und
`SUPABASE_DIRECT_DB_URL` (Export).

Das Secret kann in den Repo-Einstellungen gelöscht werden. Erst nach
dem ersten erfolgreichen Lauf des neuen Workflows — solange der nicht
grün war, ist die alte Verbindung der einzige Weg zur Datenbank, den
die CI kennt.

## Was lokal nicht geprüft werden kann

| | |
|---|---|
| **Kundentrennung gegen einen Stub** | `auth.uid()` liefert im lokalen Testaufbau null. Schritt 7b bricht deshalb dort ab, statt falsch grün zu werden |
| **Vault-Secrets** | verschlüsselt mit einem Schlüssel, der nicht im Dump ist |
| **Ob ein Cron-Job wirklich feuert** | braucht pg_cron und erreichbare Edge Functions |
| **Zustellbarkeit von Mails** | SPF, DKIM, DMARC, Spam-Platzierung — nur extern |

Diese vier gehören in den ersten echten Restore-Durchlauf, nicht in die
lokale Probe.
