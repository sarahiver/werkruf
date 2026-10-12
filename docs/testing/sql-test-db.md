# SQL-Testdatenbank

Wie die Testdatenbank entsteht, wie die SQL-Tests laufen, und welche
Regel dafür gilt, dass „alle SQL-Tests grün" wieder etwas bedeutet.

---

## Der Befund, aus dem das entstand

Dreizehn der damals siebzehn SQL-Tests waren monatelang grün und
erzeugten dabei Daten, die Produktion nicht zulässt:

```
google_locations.account_id            uuid NOT NULL   ← Tests ließen es weg
google_accounts.provider_account_id    text NOT NULL   ← Tests ließen es weg
```

Nicht weil die Tests schlecht waren. Weil die Testdatenbank weicher war
als Produktion. Sie war von Hand zusammengesetzt, nach jedem
Container-Neustart neu, und jedes Mal ein bisschen anders.

Ein Test kann das nicht bemerken. Er sieht nur, dass sein Insert
durchgeht.

Dazu kam: **Die SQL-Tests liefen in der CI nie.** Der Schritt
`check-functions → Tests` sucht `supabase/tests/*.test.ts`. Davon gibt
es keine einzige Datei. Dort stand bei jedem Lauf „Keine Tests gefunden
— uebersprungen".

---

## Voraussetzungen

* PostgreSQL ab 16, erreichbar ohne Passwort oder mit `PGPASSWORD`
* `psql` im Pfad
* Node (für den Baseline-Filter)

Produktion läuft auf **17.6**. Die CI benutzt deshalb `postgres:17`.
Lokal genügt 16; das Setup gibt die Version aus, damit der Unterschied
sichtbar bleibt.

Ein lokaler Server, der nichts anderes stört:

```bash
PG=/usr/lib/postgresql/16/bin
$PG/initdb -D /tmp/pgdata -U postgres
$PG/pg_ctl -D /tmp/pgdata -o "-k /tmp -p 5433 -c listen_addresses=" -l /tmp/pg.log start
```

---

## Aufsetzen und laufen lassen

```bash
npm run test:sql                       # Datenbank bauen + alle Tests
scripts/test-db/run.sh openingHours    # bauen + nur passende Tests
scripts/test-db/run.sh --kein-setup    # nur Tests, bestehende Datenbank
scripts/test-db/setup.sh               # nur bauen
```

Einstellbar:

| Variable | Vorgabe | |
|---|---|---|
| `PGHOST` | `/tmp` | Unix-Socket, Supabase-Stil |
| `PGPORT` | `5433` | |
| `PGUSER` | `postgres` | |
| `TESTDB` | `werkruf_test` | |

**Zurücksetzen** heißt: `setup.sh` erneut aufrufen. Das Skript löscht
die Datenbank und baut sie neu. Es gibt keinen Zustand, der einen
Neustart überlebt und keinen, den man von Hand nachziehen muss.

Wahrheit ist immer der **Exit-Code**. Kein Durchsuchen der Ausgabe nach
dem Wort ERROR — frühere Läufe haben so Fehler übersehen, weil psql sie
anders formulierte als erwartet.

---

## Was beim Aufsetzen passiert

```
1  leere Datenbank            drop/create, dann drop schema public
2  Rollen                     anon, authenticated, service_role, …
3  Baseline                   production-baseline-2026-09-22.sql, gefiltert
4  Supabase-Stubs             auth, cron, net, vault, storage
5  Baseline-Lücken            Schlüssel und Indizes, die der Dump verlor
6  Migrationen                alle, zweimal, in Dateinamenfolge
7  Fixtures                   Testhelfer im Schema test
8  Fingerprint                ist das Schema so hart wie Produktion?
```

Schritt 5 steht vor 6, weil vierzehn Migrationen Fremdschlüssel anlegen
und ohne Primärschlüssel im Ziel scheitern:

```
ERROR:  there is no unique constraint matching given keys
        for referenced table "google_locations"
```

Schritt 6 läuft **zweimal**. Jede Migration dieses Projekts trägt
„Wiederholbar" im Kopf; einmal stimmte das nicht, und es fiel zufällig
auf. Der zweite Durchgang kostet Sekunden und prüft eine Eigenschaft,
auf die sich jeder Deploy verlässt. Eine Migration, die bewusst nicht
wiederholbar ist, gehört in `NICHT_WIEDERHOLBAR` in `setup.sh`, mit
Begründung.

Woher am Ende was kommt:

| | Baseline | + Migrationen | + Testaufbau |
|---|---|---|---|
| Tabellen | 22 | 30 | 32 |
| Sichten | 13 | 16 | 16 |
| Funktionen | 71 | 115 | 115 |
| Primärschlüssel | **0** | 10 | 26 |
| Fremdschlüssel | **0** | 10 | 13 |
| Indizes | **0** | 45 | 53 |
| Policies | **0** | 12 | 12 |

Die Nullen in der Baseline-Spalte sind kein Tippfehler. Siehe
[baseline-luecken.md](./baseline-luecken.md).

---

## Baseline oder Migration — was gehört wohin

**Die Baseline** ist der Stand der Produktionsdatenbank vom 22.09.2026,
erzeugt mit `pg_dump --schema-only --schema=public` über den Workflow
`.github/workflows/export-supabase-schema.yml`. Sie wird **nicht
bearbeitet**. Der Filter `baseline-filter.mjs` macht sie ladbar, ohne
sie zu ändern.

**Migrationen** sind alles danach. Sie laufen in Dateinamenfolge und
werden nie nachträglich editiert.

**`scripts/test-db/sql/`** ist Testaufbau und ausdrücklich *kein*
Produktionsschema:

| Datei | |
|---|---|
| `00-rollen.sql` | Cluster-Rollen; `--no-privileges` hat sie nicht mitgenommen |
| `10-supabase-stubs.sql` | `auth`, `cron`, `net`, `vault`, `storage`; `--schema=public` hat sie nicht mitgenommen |
| `20-baseline-luecken.sql` | Schlüssel und Indizes, die der abgeschnittene Dump verlor |
| `80-fixtures.sql` | Testhelfer |
| `90-fingerprint.sql` | prüft die Härte des Schemas |

Jeder Eintrag in `20-baseline-luecken.sql` nennt seinen **Beleg** — eine
Stelle im produktiven Code, die beweist, dass Produktion diese
Eindeutigkeit besitzt. Ein `references public.google_locations(id)` kann
nur existieren, wenn dort ein Unique-Constraint liegt. Was keinen Beleg
hat, kommt nicht dorthin, sondern auf die G2-Liste.

---

## Die Regel für neue Tests

> Eine SQL-Testdatei darf keine Produktionsschema-Tabelle selbst mit
> vereinfachter Struktur anlegen, und keine Produktionsfunktion durch
> eine eigene Fassung ersetzen.

Beides gab es, beides ist weg:

* `ops_alerts_resolution.test.sql` legte `public.sync_jobs` selbst an —
  elf Spalten statt der echten — und zog die zu prüfende Funktion als
  Textausschnitt aus der Migration nach (`\ir
  migrations_fragment_…sql`). Die asserts prüften eine Kopie. Wäre die
  Migration davon abgewichen, wäre der Test grün geblieben.
* `criticalAlerts.test.sql` überschrieb `public.wants_notification()`
  mit eigenem Rumpf. Abbestellt wird jetzt über
  `notification_preferences` abbestellt — also so, wie ein Kunde es tut.

`schemaHaerte.test.sql`, Abschnitt 8, hält das fest: Es prüft, dass
`public.sync_jobs` seine echten Spalten hat. Eine Nachbildung hätte
weniger.

---

## Fixtures

Im Schema `test`. Alle sind mehrfach aufrufbar und setzen **nur
Pflichtfelder** — was ein Test fachlich braucht, setzt er selbst,
sichtbar in seinem eigenen Text.

```sql
select test.basis();      -- user_a + konto_a + S&I. (gewählt) + WERKRUF
select test.fremder();    -- user_b + konto_b, für Abgrenzungstests

select test.benutzer('user_a');                     -- auth.users + Profil + Benachrichtigungen
select test.konto('konto_a', 'user_a');             -- mit provider_account_id
select test.standort('standort_si', 'user_a', 'konto_a', null, true);
select test.bewertungen('standort_si', 4, 5, true, interval '3 days');
```

Die Kennungen heißen, statt UUIDs zu sein:

```sql
test.id('user_a')            -- 11111111-…
test.id('user_b')            -- 22222222-…
test.id('standort_si')       -- 33333333-…
test.id('standort_werkruf')  -- 44444444-…
test.id('konto_a')           -- 55555555-…
test.id('konto_b')           -- 66666666-…
```

`test.id()` wirft bei unbekanntem Namen. Ein Tippfehler soll nicht
still `null` ergeben — `null` in einer Pflichtspalte wäre genau der
Fehler zurück, um den es hier ging.

Ein Standort und sein Konto gehören zusammen: `test.bewertungen()` liest
Nutzer und Konto aus der Standortzeile, damit sie nicht auseinander
laufen können.

### Einen Fixture ergänzen

Nur, wenn mehr als eine Testdatei dasselbe braucht. Und nur
Pflichtfelder. Ein Helfer, der fachliche Daten mitbringt, macht Tests
unlesbar — man sieht dann nicht mehr, woran eine Behauptung hängt.

`test.bewertungen()` entstand so: `google_reviews` hat fünf
Pflichtspalten, drei davon ließen die alten Tests weg, und drei Dateien
schrieben denselben Insert.

---

## Isolation

Jede Testdatei läuft in `begin; … rollback;`. Sie hinterlässt nichts,
hängt von keiner anderen ab, und läuft auch einzeln:

```bash
scripts/test-db/run.sh openingHours
```

Ein Test darf nicht lesen, was ein anderer erzeugt hat. Und auch nicht,
was ein früherer **Abschnitt derselben Datei** verbraucht hat — daran
scheiterte `criticalAlerts.test.sql`, Abschnitt L: Er baute darauf, dass
ein erneuter Lauf die Mails von Abschnitt H wiederholt. Kann nicht
funktionieren, weil `schedule_communications` danach
`mark_events_delivered()` ruft.

**Keine stillen Skips.** Keine `if exists(...) then test`-Hüllen. Fehlt
eine Voraussetzung, soll der Test scheitern, nicht sich überspringen.
Der Lauf berichtet am Ende, wie viele Dateien gefunden, ausgeführt und
übersprungen wurden; übersprungen soll ohne Filter immer 0 sein.

---

## Was lokal nicht geprüft werden kann

**RLS.** `auth.uid()` ist lokal `null`, weil es keinen JWT gibt. Tests
laufen als Eigentümer der Tabellen, nicht als `authenticated`.
Policy-Verhalten prüft `supabase/tests/customer_isolation_sessions.mjs`
gegen eine echte Supabase-Instanz.

**Cron, pg_net, Vault.** Die Stubs schreiben nur Zeilen. Kein Job
feuert, keine HTTP-Anfrage geht hinaus, kein Geheimnis ist entschlüsselt
— ein Testaufbau soll keine Geheimnisse halten, auch keine erfundenen.
Ein Test, der auf einem Stub-Ergebnis aufbaut, testet den Stub.

**Das vollständige Produktionsschema.** Der Fingerprint prüft die
Eigenschaften, von denen Tests abhängen — kein Schema-Diff. Dafür
bräuchte es einen vollständigen Dump.
