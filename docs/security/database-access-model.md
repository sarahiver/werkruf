# Zugriffsmodell der Datenbank

Wer darf was, und wie ein neues Objekt in `public` richtig angelegt
wird.

## Der Grundsatz

```
Default = kein Zugriff für anon und authenticated.
Zugriff wird explizit vergeben, nie geerbt.
```

Das ist nicht die Vorgabe von Supabase. Es ist die, die
`20261012140000_deny_by_default.sql` herstellt.

## Warum, in einem Absatz

G2 hat beim ersten Restore-Beweis gegen einen echten Produktionsdump
fünf `ops_`-Sichten gefunden, die für `anon` lesbar waren — `user_id`,
Firmennamen und Sync-Fehler **aller** Kunden, über das öffentlich
ausgelieferte Data API. Niemand hatte diese Rechte vergeben. Die
Sichten hatten sie **geerbt**.

Gefunden wurde es nur, weil der Dump erstmals ohne `--no-privileges`
lief und die Rechte damit überhaupt sichtbar wurden. Ein Modell, in
dem Sicherheit von einer Erbschaft abhängt, die niemand sieht, findet
seine Löcher im Audit. Deshalb dieses Dokument.

## Die Rollen

| Rolle | Was sie ist | Zugriff |
|---|---|---|
| `anon` | der **öffentlich ausgelieferte** API-Schlüssel. Jeder Besucher. | nur was explizit vergeben ist |
| `authenticated` | ein angemeldeter Kunde | nur was explizit vergeben ist, immer zeilenweise durch RLS |
| `service_role` | der Serverpfad: Edge Functions, Cron, Worker. Hat `BYPASSRLS`. Nie an einen Client ausgeliefert. | breit, per Vorgabe |
| `postgres` | legt die Objekte an (57 von 57 in `public`), führt Migrationen aus | Eigentümer |

`service_role` behält ihre Vorgaberechte mit Absicht. Ihr die zu
nehmen hieße, jede Migration müsste einen Grant nachziehen, den sie
ohnehin immer will — Bürokratie ohne Sicherheitsgewinn, und vergessene
Grants würden Serverpfade brechen statt Kunden zu schützen.

## Was in Produktion konfiguriert war

Abgefragt am 12.10.2026 (`pg_default_acl`). Für `public` existieren
**zwei** Sätze Vorgaberechte, von zwei Rollen gesetzt:

```
postgres       | public | Tabellen   | anon=arwdDxtm, authenticated=arwdDxtm
postgres       | public | Sequenzen  | anon=rwU,      authenticated=rwU
postgres       | public | Funktionen | anon=X,        authenticated=X

supabase_admin | public | Tabellen   | anon=arwdDxtm, authenticated=arwdDxtm
supabase_admin | public | Sequenzen  | anon=rwU,      authenticated=rwU
supabase_admin | public | Funktionen | anon=X,        authenticated=X
```

Vorgaberechte hängen am **Erzeuger** eines Objekts, nicht am Schema.
Welcher Satz greift, entscheidet also, wer `create table` sagt — und
das ist hier eindeutig `postgres` (57 von 57 Objekten, SQL-Editor,
`db push`).

Deshalb konfiguriert die Migration nur den `postgres`-Satz. Der
`supabase_admin`-Satz bleibt: `postgres` ist in Supabase kein
Superuser und kein Mitglied von `supabase_admin`, also scheitert
`alter default privileges for role supabase_admin` an den Rechten. Die
Migration versucht es nicht — ein Versuch, der scheitert, wäre ein
roter Lauf; einer, der stillschweigend nichts tut, wäre vorgetäuschte
Sicherheit.

Praktische Reichweite des Rests: er greift nur für Objekte, die
`supabase_admin` anlegt, also Supabase-interne. Sollte sich das
ändern, fällt es in `supabase/tests/defaultRechte.test.sql` auf — der
Test prüft die Wirkung an einem neu angelegten Objekt, nicht die
Konfiguration einer Rolle.

## Funktionen sind der Sonderfall

Für Tabellen und Sequenzen genügt eine schemagebundene Zeile. Für
Funktionen nicht. Gemessen gegen PostgreSQL 16.15:

```
nach: alter default privileges in schema public
        revoke all on routines from anon, authenticated;
  pg_default_acl:  f -> {service_role=X/postgres}
  neue Funktion:   {=X/postgres, postgres=X/…, service_role=X/…}
  anon darf:       JA
```

Das `=X` ohne Namen davor ist **PUBLIC**. PostgreSQL vergibt `EXECUTE`
auf neue Funktionen an PUBLIC als **eingebaute** Vorgabe; die steht
nicht in `pg_default_acl`, und eine schemagebundene Zeile dort wird
mit ihr **verschmolzen**, nicht an ihre Stelle gesetzt. `anon` bekommt
das Recht nicht als `anon`, sondern als Mitglied von PUBLIC.

Auch die dokumentierte Form half nicht, solange sie schemagebunden
war. Erst ohne `in schema` greift sie:

```
alter default privileges revoke execute on functions from public;
  → pg_default_acl: (global) f -> {postgres=X/postgres}
  → neue Funktion:  {postgres=X/…, service_role=X/…}
  → anon darf:      NEIN,  service_role darf: JA
```

„Global" heißt: für jede Funktion, die `postgres` in **jedem** Schema
anlegt. Nachgezählt über alle 40 Migrationen: 73 Funktionen in
`public`, eine in `pg_temp`, keine `create extension`. Für dieses
Projekt ist die globale Form also deckungsgleich mit der Absicht.

## Muster: Tabelle, die nur der Server anfasst

Audit-Logs, Stripe-Events, Sync-Internas, Rate-Limits, Locks,
Queue-Internas.

```sql
create table public.x (…);
alter table public.x enable row level security;
```

Mehr nicht. Nach `deny_by_default` hat `anon` und `authenticated` dort
kein Recht; `service_role` kommt per Vorgabe durch und umgeht RLS.

**RLS trotzdem anschalten.** RLS ohne Policy verweigert alles — das ist
die zweite Schranke, falls jemand später versehentlich ein Grant
vergibt. Genau diese Doppelung hat in G2 `leads`, `audit_logs`,
`stripe_events` und sieben weitere Tabellen gerettet, als sie durch
die Vorgabe `anon ALL` trugen.

## Muster: Tabelle, die ein Kunde liest

Reihenfolge, und jeder Schritt gehört in dieselbe Migration:

```sql
-- 1. Tabelle
create table public.x (
  id      bigint generated always as identity primary key,
  user_id uuid not null,
  …
);

-- 2. RLS an
alter table public.x enable row level security;

-- 3. Policy, zeilenweise auf den Eigentümer beschränkt
create policy x_owner_read on public.x
  for select to authenticated
  using (user_id = auth.uid());

-- 4. Grant — nur das benötigte Recht
grant select on public.x to authenticated;
```

**Nicht** `grant all`. Schreiben bekommt der Kunde nur, wenn es einen
Grund gibt. `user_profiles` zeigt, warum: die Spalte `plan` entscheidet
über den Produktzugang, und Migration `20260928160000` nimmt
`authenticated` deshalb das Schreibrecht — sonst könnte sich ein Kunde
Pro schenken.

Schritt 3 und 4 gehören zusammen. Eine Policy ohne Grant wirkt nicht;
ein Grant ohne Policy wird von RLS verweigert. Beide Hälften fehlen
leicht einzeln, und die Folgen sind verschieden: fehlt der Grant, sieht
der Kunde nichts; fehlt die Policy, sieht er auch nichts — aber die
nächste permissive Policy öffnet alles.

## Muster: interne Sicht

```sql
create or replace view public.ops_x
  with (security_invoker = true) as
  select … from public.basis;

revoke all on public.ops_x from anon, authenticated;
```

**Beides, und aus umgekehrten Gründen als man denkt.** Gemessen gegen
16.15:

| Nach … | anon darf lesen | `security_invoker` |
|---|---|---|
| Anlegen bei aktiven Vorgaberechten | ja | aus |
| `revoke` + `alter view set (security_invoker = true)` | nein | an |
| `create or replace view` ohne `WITH` | **nein** | **aus** |
| `drop view` + `create view` | ja | aus |

Haltbar ist das `revoke`. `security_invoker` verschwindet beim nächsten
`create or replace view` lautlos, weil `CREATE OR REPLACE VIEW` die
`reloptions` durch die angegebenen ersetzt — und ohne `WITH`-Klausel
ist das die leere Menge.

Deshalb gehört `security_invoker` **in die Sichtdefinition**, nicht in
ein nachgestelltes `ALTER`. `scripts/check-view-security.sh` erzwingt
das im `sql-tests`-Job.

Nach `deny_by_default` ist das `revoke` für neue Sichten
streng genommen überflüssig — aber es kostet nichts und hält auch
dann, wenn jemand die Vorgaberechte wieder aufweicht.

## Muster: Sicht, die ein Kunde liest

```sql
create or replace view public.kunden_x
  with (security_invoker = true) as
  select … from public.basis;

grant select on public.kunden_x to authenticated;
```

`security_invoker = true` ist hier **nicht optional**. Ohne es läuft
die Sicht mit den Rechten ihres Eigentümers, und das RLS der
Basistabellen greift nicht: wer die Sicht lesen darf, liest alle
Zeilen aller Kunden.

Die Basistabelle braucht RLS und eine Policy. Eine Sicht trägt selbst
kein RLS — sie erbt nur, was `security_invoker` durchlässt.

`supabase/tests/defaultRechte.test.sql`, Abschnitt E, zeigt den
Unterschied statt ihn zu behaupten: dieselbe Sicht zweimal angelegt,
mit und ohne `security_invoker`, gegen dieselbe Tabelle mit drei
Zeilen. Mit: 2 Zeilen (RLS greift). Ohne: 3 Zeilen (RLS umgangen).

## Muster: Funktion

```sql
create or replace function public.x(…) returns … 
language plpgsql
security definer
set search_path = ''
as $$ … $$;

revoke all on function public.x(…) from public, anon, authenticated;
grant execute on function public.x(…) to service_role;
```

`from public` an erster Stelle, nicht nur die Rollen — siehe oben. 20
der 40 Migrationen tun das schon; nach `deny_by_default` ist es für
neue Funktionen doppelt gesichert.

Soll ein Kunde die Funktion per RPC aufrufen:

```sql
grant execute on function public.x(…) to authenticated;
```

Das tun heute fünf Funktionen, und alle fünf haben den Grant explizit
in ihrer eigenen Migration: `events_feed`, `claim_own_lead`,
`touch_dashboard_visit`, `werkruf_score_location`, `enqueue_email`.

**`security definer` braucht `set search_path`.** Ohne ihn kann ein
Aufrufer über seinen eigenen `search_path` bestimmen, welche Tabelle
die Funktion trifft.

## Was CI erzwingt

| Prüfung | Was sie findet | Wo |
|---|---|---|
| `defaultRechte.test.sql` A | ein `pg_default_acl`-Eintrag für `anon`/`authenticated` auf `public` | `sql-tests` |
| `defaultRechte.test.sql` B | eine neue Tabelle, Sequenz oder Funktion, die offen ist — auf welchem Weg auch immer | `sql-tests` |
| `defaultRechte.test.sql` B (Gegenrichtung) | der Serverpfad ist zu — `service_role` kommt nicht durch | `sql-tests` |
| `defaultRechte.test.sql` C | eine neue Sicht, die `anon` lesen darf | `sql-tests` |
| `defaultRechte.test.sql` D | das Muster „RLS + Policy + Grant" wirkt nicht wie beschrieben | `sql-tests` |
| `defaultRechte.test.sql` E | `security_invoker` wirkt nicht mehr wie angenommen | `sql-tests` |
| `check-view-security.sh` | eine Migration legt eine Sicht ohne `security_invoker` an | `sql-tests` |
| `restore-kernchecks.sql` | ein Recht, das in Produktion ungefiltert erreichbar ist | Restore-Beweis |
| `restore-isolation.sql` | Kunde A sieht oder ändert Zeilen von B | Restore-Beweis |

A und B sind nicht redundant. Gegenprobe: ein Event-Trigger, der nach
jedem `create table` ein `grant select … to anon` ausführt, lässt A
grün und macht B rot.

## Was hier nicht über Textmuster läuft

Keine Prüfung verlangt, dass eine Policy `uid()` im Text enthält.

Die RLS-Prüfung in G2 brauchte vier Anläufe, und drei scheiterten
genau daran: sie stellten eine Erwartung an den Policy-Text statt die
Wirkung zu messen. Der vierte Entwurf meldete gegen Produktion 120
Verletzungen, von denen 115 falsch waren — darunter

```
public.leads: anon darf DELETE, aber keine auf uid()
beschraenkte Policy deckt das ab
```

Richtig war: RLS ist auf `leads` an, es gibt keine Policy für `anon`,
und das **verweigert alles**. Ein Recht ohne Policy ist bei aktivem RLS
kein Loch, sondern ein geschlossener Deckel.

Eine Policy kann auf `auth.uid()`, auf `auth.jwt()` oder auf eine
Hilfsfunktion scopen — `leads` tut es über
`auth.jwt() -> 'app_metadata' ->> 'role' = 'admin'`, und das ist
richtig. Was zählt, ist, ob eine fremde Sitzung fremde Zeilen sieht.
Das messen die Tests, indem sie es versuchen.

## Was offen ist

Der `supabase_admin`-Satz Vorgaberechte (siehe oben) und die
**bestehenden** Grants. `deny_by_default` wirkt ausschließlich auf
Objekte, die später angelegt werden; kein bestehendes Recht wurde
angefasst. Das war Absicht — eine flächige Rechteänderung in
Produktion gehört nicht in dasselbe Paket wie die Regel für die
Zukunft.

Bekannte Altlasten aus G2, nach wie vor offen:

- `leads`: `authenticated` hat INSERT und eine Policy ohne Bedingung
  deckt es ab. Steht in keiner Migration, also in Produktion von Hand
  gebaut. Integritätsrisiko (Spam), keine Preisgabe — `anon` wird von
  RLS verweigert, lesen darf nur `admin`.
- `leads`: `anon` darf **nicht** INSERT, aber der öffentliche
  SmartCheck schreibt als `anon` und verschluckt den Fehler. H1 P0.
- zehn Tabellen tragen `anon ALL` aus der alten Vorgabe; RLS hält den
  Deckel zu, nachgewiesen durch die Kernchecks.
