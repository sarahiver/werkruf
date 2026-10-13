-- Abnahme fuer die Zustimmung (Paket H1, Consent).
--
--   psql -f consent.test.sql
--
-- Setzt 20261013090000_founding_partner_und_consent.sql und
-- 20261013140000_consent_erfassen.sql voraus.
-- Bricht beim ersten fehlgeschlagenen assert ab.
--
-- ═══════════════════════════════════════════════════════════════
-- WIE HIER EINE SITZUNG ENTSTEHT
-- ═══════════════════════════════════════════════════════════════
--
-- accept_terms() haengt an auth.uid(). In der Testdatenbank ist das
-- ein Stub, der null liefert (scripts/test-db/sql/10-supabase-stubs.sql,
-- mit Begruendung: wer RLS pruefen will, braucht eine echte Instanz).
--
-- Fuer diese Abnahme wird auth.uid() deshalb INNERHALB der
-- Transaktion durch die Fassung ersetzt, die Supabase in Produktion
-- benutzt: sie liest die JWT-Claims aus den Sitzungsvariablen. DDL
-- ist in Postgres transaktional — mit dem rollback am Ende steht der
-- Stub wieder da, und keine andere Testdatei sieht etwas davon.
--
-- Das ist kein Nachbau der Zustimmung, sondern nur der Sitzung: Was
-- geprueft wird, ist das Verhalten von accept_terms gegenueber dem,
-- was auth.uid() sagt.
--
-- ═══════════════════════════════════════════════════════════════
-- WAS GEPRUEFT WIRD
-- ═══════════════════════════════════════════════════════════════
--
--   1  ohne Sitzung: keine Zustimmung
--   2  falsche Fassung: keine Zustimmung, kein Eintrag
--   3  richtige Fassung: Eintrag mit Serverzeit und Serverversion
--   4  zweiter Klick verschiebt den Zeitpunkt nicht
--   5  der echte Weg: als Rolle authenticated — und die Spalten
--      bleiben dabei direkt nicht schreibbar
--   6  jeder stimmt nur fuer sich zu
--   7  Founding Partner genauso wie jeder andere
--   8  Rechte

\set ON_ERROR_STOP on

begin;

/* Die Produktionsfassung von auth.uid(). Rollt mit zurueck. */
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid
$$;

/* Zwei Nutzer: user_a stimmt zu, user_b ist die Abgrenzung. */
select test.benutzer('user_a');
select test.benutzer('user_b');

/* ═══════════════════════════════════════════════════════
   1 — OHNE SITZUNG KEINE ZUSTIMMUNG
   ═══════════════════════════════════════════════════════ */
do $$
declare v_fehler boolean := false;
begin
  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);

  assert auth.uid() is null, 'Vorbedingung: keine Sitzung';

  begin
    perform public.accept_terms(public.current_terms_version());
  exception when others then
    v_fehler := true;
  end;

  assert v_fehler, 'Ohne Sitzung wirft accept_terms';
  assert (select count(*) from public.user_profiles
           where accepted_terms_at is not null) = 0,
    'und es entsteht kein Eintrag';
end $$;

/* ═══════════════════════════════════════════════════════
   2 — FALSCHE FASSUNG: NICHTS WIRD FESTGEHALTEN
   ═══════════════════════════════════════════════════════

   Der Fall, der ohne Abgleich still falsch waere: Der Browser hat
   eine alte Seite offen, der Nutzer klickt, und wir halten eine
   Zustimmung zu einer Fassung fest, die er nie gesehen hat. */
do $$
declare
  v_a       uuid := test.id('user_a');
  v_fehler  boolean;
begin
  perform pg_catalog.set_config('request.jwt.claim.sub', v_a::text, true);
  assert auth.uid() = v_a, 'Vorbedingung: Sitzung von user_a';

  v_fehler := false;
  begin
    perform public.accept_terms('agb-v99');
  exception when others then
    v_fehler := true;
  end;
  assert v_fehler, 'Eine fremde Fassung wird abgelehnt';

  v_fehler := false;
  begin
    perform public.accept_terms(null);
  exception when others then
    v_fehler := true;
  end;
  assert v_fehler, 'Keine Fassung wird abgelehnt';

  assert (select accepted_terms_at from public.user_profiles where id = v_a) is null,
    'und nichts wird festgehalten';
end $$;

/* ═══════════════════════════════════════════════════════
   3 — DIE RICHTIGE FASSUNG
   ═══════════════════════════════════════════════════════ */
do $$
declare
  v_a    uuid := test.id('user_a');
  v_wann timestamptz;
  v_zeile record;
begin
  perform pg_catalog.set_config('request.jwt.claim.sub', v_a::text, true);

  v_wann := public.accept_terms(public.current_terms_version());

  assert v_wann is not null, 'accept_terms gibt den Zeitpunkt zurueck';

  select accepted_terms_version, accepted_terms_at into v_zeile
    from public.user_profiles where id = v_a;

  assert v_zeile.accepted_terms_version = public.current_terms_version(),
    format('Gespeichert wird die Serverversion (erhalten: %s)',
           coalesce(v_zeile.accepted_terms_version, 'NULL'));
  assert v_zeile.accepted_terms_at = v_wann, 'und der zurueckgegebene Zeitpunkt';

  /* Serverzeit, nicht Clientzeit: Der Aufrufer schickt keinen
     Zeitstempel und kann keinen schicken. */
  assert v_zeile.accepted_terms_at between pg_catalog.now() - interval '1 minute'
                                       and pg_catalog.now() + interval '1 minute',
    'Der Zeitpunkt kommt vom Server';
end $$;

/* ═══════════════════════════════════════════════════════
   4 — ZWEITER KLICK VERSCHIEBT NICHTS
   ═══════════════════════════════════════════════════════

   Auch gegen den eigenen Nutzer: Er kann sein Zustimmungsdatum nicht
   durch erneutes Klicken nach vorn holen. */
do $$
declare
  v_a      uuid := test.id('user_a');
  v_vorher timestamptz;
  v_zweit  timestamptz;
begin
  select accepted_terms_at into v_vorher from public.user_profiles where id = v_a;

  perform pg_catalog.set_config('request.jwt.claim.sub', v_a::text, true);
  v_zweit := public.accept_terms(public.current_terms_version());

  assert v_zweit = v_vorher, 'Der zweite Aufruf gibt denselben Zeitpunkt zurueck';
  assert (select accepted_terms_at from public.user_profiles where id = v_a) = v_vorher,
    'und aendert die Zeile nicht';
end $$;

/* ═══════════════════════════════════════════════════════
   6 — JEDER STIMMT NUR FUER SICH ZU
   ═══════════════════════════════════════════════════════ */
do $$
declare
  v_a uuid := test.id('user_a');
  v_b uuid := test.id('user_b');
begin
  perform pg_catalog.set_config('request.jwt.claim.sub', v_b::text, true);
  perform public.accept_terms(public.current_terms_version());

  assert (select accepted_terms_at from public.user_profiles where id = v_b) is not null,
    'user_b hat seinen eigenen Eintrag';

  /* accept_terms nimmt keine user_id — es gibt also gar keinen Weg,
     fuer jemand anderen zuzustimmen. Diese Zusage haelt fest, dass
     das so bleibt. */
  assert not exists (
    select 1 from pg_catalog.pg_proc p
     where p.proname = 'accept_terms'
       and pg_catalog.pg_get_function_arguments(p.oid) like '%uuid%'
  ), 'accept_terms nimmt keine user_id an';
end $$;

/* ═══════════════════════════════════════════════════════
   7 — FOUNDING PARTNER: KEIN SONDERWEG
   ═══════════════════════════════════════════════════════ */
do $$
declare
  v_a uuid := test.id('user_a');
begin
  /* Zuruecksetzen, damit der Fall frisch ist. Direkt in der Spalte,
     weil es hier um die Lage geht, nicht um den Weg dorthin. */
  update public.user_profiles
     set accepted_terms_at = null, accepted_terms_version = null,
         plan = 'founding_partner'
   where id = v_a;

  perform pg_catalog.set_config('request.jwt.claim.sub', v_a::text, true);

  assert public.accept_terms(public.current_terms_version()) is not null,
    'Ein Founding Partner stimmt auf demselben Weg zu';
  assert (select accepted_terms_version from public.user_profiles where id = v_a)
         = public.current_terms_version(),
    'und bekommt denselben Eintrag';
end $$;

rollback;

/* ═══════════════════════════════════════════════════════
   5 — DER ECHTE WEG: ALS ROLLE authenticated
   ═══════════════════════════════════════════════════════

   Eigene Transaktion, weil hier die Rolle gewechselt wird. Geprueft
   wird beides: dass der Weg ueber accept_terms offen ist UND dass
   daneben keiner offen steht. */
begin;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid
$$;

select test.benutzer('user_a');

do $$
declare
  v_a      uuid := test.id('user_a');
  v_wann   timestamptz;
  v_fehler text;
begin
  perform pg_catalog.set_config('request.jwt.claim.sub', v_a::text, true);

  perform pg_catalog.set_config('role', 'authenticated', true);
  assert current_user = 'authenticated', 'Vorbedingung: wir sind authenticated';

  /* Der Weg, den der Browser nimmt. */
  v_wann := public.accept_terms(public.current_terms_version());
  assert v_wann is not null, 'authenticated darf zustimmen';

  /* Und der Weg daneben: direkt in die Spalte schreiben. Genau das
     muss scheitern — sonst waere die ganze Haertung Dekoration.
     Zuerst die bestehende Zustimmung verschieben: */
  begin
    update public.user_profiles
       set accepted_terms_at = pg_catalog.now() - interval '10 years'
     where id = v_a;
    v_fehler := 'durchgelaufen';
  exception when insufficient_privilege then
    v_fehler := 'verweigert';
  end;
  assert v_fehler = 'verweigert',
    format('Das Datum direkt zu aendern muss scheitern (%s)', v_fehler);

  /* Und die Version: */
  begin
    update public.user_profiles set accepted_terms_version = 'agb-v99' where id = v_a;
    v_fehler := 'durchgelaufen';
  exception when insufficient_privilege then
    v_fehler := 'verweigert';
  end;
  assert v_fehler = 'verweigert',
    format('Die Version direkt zu setzen muss scheitern (%s)', v_fehler);

  perform pg_catalog.set_config('role', 'none', true);

  /* Der Eintrag steht unveraendert. */
  assert (select accepted_terms_at from public.user_profiles where id = v_a) = v_wann,
    'Der Eintrag ist der, den accept_terms geschrieben hat';
end $$;

rollback;

/* ═══════════════════════════════════════════════════════
   8 — RECHTE
   ═══════════════════════════════════════════════════════ */
begin;

do $$
declare v_oid oid;
begin
  select p.oid into v_oid
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'accept_terms';

  assert v_oid is not null, 'accept_terms existiert';
  assert pg_catalog.has_function_privilege('authenticated', v_oid, 'execute'),
    'authenticated darf zustimmen — sonst kann niemand';
  assert not pg_catalog.has_function_privilege('anon', v_oid, 'execute'),
    'anon darf NICHT zustimmen — ohne Sitzung ist keine Zustimmung zuordenbar';
  assert (select prosecdef from pg_catalog.pg_proc where oid = v_oid),
    'accept_terms laeuft als security definer';

  /* record_terms_acceptance bleibt dem Server vorbehalten: Es nimmt
     eine fremde user_id an. */
  select p.oid into v_oid
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'record_terms_acceptance';

  assert not pg_catalog.has_function_privilege('authenticated', v_oid, 'execute'),
    'authenticated darf record_terms_acceptance NICHT aufrufen';
  assert not pg_catalog.has_function_privilege('anon', v_oid, 'execute'),
    'anon auch nicht';
  assert pg_catalog.has_function_privilege('service_role', v_oid, 'execute'),
    'service_role schon';

  /* Die Fassung darf jeder lesen — die Seite muss sie anzeigen
     koennen. */
  select p.oid into v_oid
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'current_terms_version';

  assert pg_catalog.has_function_privilege('authenticated', v_oid, 'execute'),
    'authenticated darf die geltende Fassung lesen';
end $$;

rollback;
