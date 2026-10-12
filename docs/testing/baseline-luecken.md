# Lücken in der Produktions-Baseline

Erfasst während G1. **Noch nicht behoben** — das ist G2.

Datei: `supabase/schema/production-baseline-2026-09-22.sql`
Erzeugt von: `.github/workflows/export-supabase-schema.yml`
Stand der Prüfung: 09.10.2026

---

## 1 — Die Datei ist abgeschnitten

Das ist die Ursache, aus der fast alles andere hier folgt.

Sie endet mitten in einem Statement:

```sql
CREATE VIEW public.ops_reply_pipeline AS
 SELECT status,
    source,
    count(*) AS replies,
    count(*) FILTER (WHERE (created_at > (now() - '24:00:00'::interval))) AS last_24h,
    min(created_at) F
```

Nach `min(created_at) F` ist Schluss. Es fehlt außerdem das
`\unrestrict`, das `pg_dump` 17 als Gegenstück zum `\restrict` in
Zeile 5 schreibt — ein weiterer Beleg, dass der Dump nicht
durchgelaufen ist.

**Was damit fehlt:** `pg_dump` schreibt Schlüssel, Indizes, Trigger,
Policies, Sequenzen und Rechte **nach** Tabellen und Sichten. Der
Schnitt liegt davor. Gezählt in der Datei:

```
CREATE TABLE        22        ✓ vollständig (Tabellen stehen vor Sichten)
CREATE VIEW         13        1 abgeschnitten (ops_reply_pipeline)
CREATE FUNCTION     71        ✓
PRIMARY KEY          0        ✗
FOREIGN KEY          0        ✗
CREATE INDEX         0        ✗
CREATE TRIGGER       0        ✗
CREATE POLICY        0        ✗
CREATE SEQUENCE      0        ✗
GRANT                0        ✗ (auch durch --no-privileges)
ALTER TABLE          0        ✗
```

**Vermutete Ursache:** Der Dump läuft über
`secrets.SUPABASE_POOLER_DB_URL`, also über Supavisor. `pg_dump`
braucht eine durchgehende Sitzung; ein Pooler kann sie abschneiden.
Die Ausgabe wird per `>` in die Datei geschrieben, und der
Verify-Schritt prüft nur `wc -l` und `ls -lh` — eine abgeschnittene
Datei hat Zeilen und eine Größe und fällt dort nicht auf.

**Für G2:** Dump über eine direkte Verbindung statt über den Pooler;
danach prüfen, dass die Datei mit `\unrestrict` endet und
`PRIMARY KEY` darin vorkommt. Beides ist eine Zeile im Workflow.

---

## 2 — `--schema=public` lässt die Supabase-Schemas weg

```yaml
pg_dump --schema-only --no-owner --no-privileges --schema=public
```

Nicht enthalten: `auth`, `cron`, `net`, `vault`, `storage`,
`extensions`. Vierzehn Migrationen greifen darauf zu und scheitern ohne
sie:

```
ERROR:  schema "auth" does not exist
ERROR:  relation "cron.job" does not exist
```

Im Testaufbau ersetzt durch Stubs in
`scripts/test-db/sql/10-supabase-stubs.sql`. Die Stubs sind die
kleinste Form, die den produktiven Code laden lässt — kein Nachbau.

**Für G2:** entscheiden, ob die Baseline diese Schemas mitnehmen soll.
`auth.users` wäre nützlich (zwei Migrationen verweisen darauf), die
übrigen eher nicht: sie gehören Supabase, nicht WERKRUF.

---

## 3 — `--no-privileges` nimmt die Rechte nicht mit

Jede Migration dieses Projekts endet mit Rechtevergabe:

```sql
revoke all on function ... from public, anon, authenticated;
grant execute on function ... to service_role;
```

Ohne die Rollen scheitert jede davon. Im Testaufbau in
`00-rollen.sql`. Rollen sind Cluster-Objekte, kein Schemainhalt —
`pg_dump` würde sie auch ohne `--no-privileges` nicht liefern, nur
`pg_dumpall --roles-only`.

**Folge:** Welche Rechte Produktion wirklich vergeben hat, steht
nirgends im Repo. Ein falsch gesetztes `grant` auf `anon` wäre lokal
nicht zu sehen.

---

## 4 — PostgreSQL-17-Syntax

Zwei Zeilen lassen die Datei auf PostgreSQL 16 nicht laden:

| Zeile | |
|---|---|
| `SET transaction_timeout = 0;` | GUC erst ab 17 |
| `\restrict <token>` | psql-Metabefehl neuerer Versionen |

Im Testaufbau von `baseline-filter.mjs` auskommentiert — beide sind
`pg_dump`-Präambel, kein Schema. Produktion läuft 17.6, die CI benutzt
`postgres:17`.

---

## 5 — Zwei Funktionen greifen auf Tabellen zu, die es nicht gibt

**Das ist der einzige Punkt hier, der Produktion betreffen könnte.**

| Funktion | greift zu auf | Baseline-Zeilen |
|---|---|---|
| `check_rate_limit()` | `public.rate_limits` | 216–225 |
| `prune_rate_limits()` | `public.rate_limits` | 1875 |
| Sperrenbereinigung | `public.sync_locks` | 2233, 2330 |

Keine der beiden Tabellen kommt in der Baseline vor. `pg_dump` lädt mit
`check_function_bodies = false`, deshalb fällt es beim Laden nicht auf.

Zwei Möglichkeiten:

1. Die Tabellen existieren in Produktion und fehlen im Dump — dann ist
   der Dump unvollständiger als Punkt 1 erklärt.
2. Sie existieren nicht — dann werfen diese Funktionen zur Laufzeit.

Welche von beiden gilt, lässt sich nur an der Produktionsdatenbank
feststellen:

```sql
select to_regclass('public.rate_limits'), to_regclass('public.sync_locks');
```

Im Testaufbau entstehen sie als leere Tabellen, in
`20-baseline-luecken.sql`, mit einem `comment on table`, der
`[TESTAUFBAU]` voranstellt.

---

## 6 — Was G1 ergänzt hat, und was davon geraten ist

Nichts davon ist geraten: jeder Eintrag hat einen Beleg im produktiven
Code. Aber **vollständig ist es nicht** — es ist nur, was zum Laufen
nötig war.

**Primärschlüssel, 16.** Jeder entweder Ziel eines Fremdschlüssels aus
einer Migration oder eines `on conflict (id)`, oder eine Spalte
`id uuid DEFAULT gen_random_uuid() NOT NULL` aus der Baseline.

**Unique-Indizes, 6.** Jeder belegt durch eine `ON CONFLICT`-Klausel im
produktiven Code — die kann nur treffen, wenn der Index existiert. Bei
`sync_jobs` sind die `WHERE`-Prädikate aus `enqueue_sync_job()`
übernommen, nicht gewählt: ein partielles `ON CONFLICT` trifft nur bei
identischem Prädikat.

**Fremdschlüssel, 3:**

```
google_accounts.user_id       → auth.users(id)
google_locations.account_id   → google_accounts(id)
google_locations.user_id      → auth.users(id)
```

Nur diese drei, weil nur hier der Beleg eindeutig ist. **Unbekannt
bleibt**, welche weiteren Fremdschlüssel Produktion hat — etwa auf
`events.location_id`, `google_reviews.account_id`,
`sync_jobs.location_id`. Sie zu erraten wäre das, was Punkt 24 des
Auftrags verbietet.

**Identity für `recommendation_events.id`.** Die Baseline sagt
`id bigint NOT NULL` ohne Default, und `record_recommendation_action()`
fügt ohne `id` ein. Beides zusammen kann
nur Identity oder Serial sein.

> Korrektur vom 12.10.2026: Hier stand zuvor
> `log_recommendation_event()` als Beleg. Diese Funktion existiert
> nicht — in keiner Migration und nicht in der Baseline. Die
> Schlussfolgerung war richtig, der Beleg war falsch. Aufgefallen ist
> es in G2, weil ein Kerncheck den erfundenen Namen prüfte. Gesetzt als `GENERATED BY DEFAULT` —
die vorsichtigere Wahl, weil sie auch einen Test zulässt, der eine `id`
explizit setzt. **Unbekannt:** ob Produktion `BY DEFAULT` oder
`ALWAYS` verwendet.

---

## 7 — Weiteres, das G1 nicht angefasst hat

* **Trigger.** Im Testschema steht genau einer, aus einer Migration.
  Wie viele Produktion hat: unbekannt.
* **Indizes zur Leistung.** Die sechs ergänzten sind
  Eindeutigkeitsindizes. Welche Indizes Produktion zur Beschleunigung
  hat, steht nirgends — ein lokaler Test sagt deshalb nichts über
  Laufzeit.
* **Extensions.** Welche Produktion installiert hat, steht nicht in der
  Datei. Lokal gebraucht wurde keine; `gen_random_uuid()` ist seit
  PostgreSQL 13 eingebaut.
* **`ops_reply_pipeline`.** Die abgeschnittene Sicht fehlt im
  Testschema. Keine Migration und kein Test benutzt sie.

---

## Was G2 zu entscheiden hat

1. Dump über eine direkte Verbindung, nicht den Pooler.
2. Verify-Schritt, der Vollständigkeit prüft statt nur `wc -l` —
   mindestens: endet mit `\unrestrict`, enthält `PRIMARY KEY`.
3. `rate_limits` und `sync_locks` an der Produktionsdatenbank klären.
4. Entscheiden, ob `auth` mit in die Baseline soll.
5. Rollen und Rechte separat sichern (`pg_dumpall --roles-only`) oder
   als bewusst nicht erfasst dokumentieren.
6. Danach `20-baseline-luecken.sql` prüfen: Was ein vollständiger Dump
   mitbringt, kann dort weg. Die Datei ist so gebaut, dass sie das von
   selbst merkt — sie ergänzt nur, was fehlt.
