-- Abnahme fuer Entitlement und Zustimmungsspalten (Paket H1).
--
--   psql -f entitlement.test.sql
--
-- Setzt 20261013090000_founding_partner_und_consent.sql voraus.
-- Bricht beim ersten fehlgeschlagenen assert ab.
--
-- ═══════════════════════════════════════════════════════════════
-- WARUM DIESE DATEI NACHGELIEFERT WIRD
-- ═══════════════════════════════════════════════════════════════
--
-- 20261013090000 verweist in zwei Kommentaren auf
-- supabase/tests/entitlement.test.sql — die Datei gab es nicht. Der
-- Satz "dieselbe Pruefung steht in entitlement.test.sql" stand also
-- ueber einer Pruefung, die niemand ausfuehrte. Aufgefallen beim Bau
-- der Consent-UI, weil deren Haertung genau darauf ruht.
--
-- ═══════════════════════════════════════════════════════════════
-- WAS HIER GEPRUEFT WIRD
-- ═══════════════════════════════════════════════════════════════
--
--   1  Die Spaltenliste: was der Client schreiben darf und was nicht
--   2  Der Plan-Constraint
--   3  set_founding_partner / clear_founding_partner
--   4  record_terms_acceptance
--   5  Rechte
--
-- NICHT hier: die Zugriffsregel selbst (has_paid_access) — ihre
-- Fallmatrix steht in operativeMails.test.sql, und der Weg aus dem
-- Browser in consent.test.sql. Dieselbe Sache zweimal zu pruefen
-- heisst, sie einmal zu pflegen und einmal zu vergessen.

\set ON_ERROR_STOP on

begin;

select test.benutzer('user_a');

/* ═══════════════════════════════════════════════════════
   1 — DIE SPALTENLISTE
   ═══════════════════════════════════════════════════════

   20260928160000 vergibt Schreibrechte auf user_profiles als
   Spaltenliste. Eine neue Spalte ist damit automatisch nicht
   schreibbar — eine Whitelist waechst nicht mit.

   Das ist genau richtig und zugleich ein Verhalten, auf das sich
   vier Stellen verlassen, ohne es zu sehen: Entitlement, Stripe,
   Founding Partner und die Zustimmung. Deshalb gemessen. */
do $$
declare
  v_spalte text;
begin
  /* Gesperrt: alles, was Geld, Zugang oder Nachweis bedeutet. */
  foreach v_spalte in array array[
    'plan',
    'stripe_customer_id', 'stripe_subscription_id', 'stripe_subscription_status',
    'stripe_current_period_end', 'stripe_cancel_at_period_end',
    'trial_started_at', 'trial_ends_at',
    'founding_partner_since', 'founding_partner_note',
    'accepted_terms_version', 'accepted_terms_at'
  ] loop
    assert not pg_catalog.has_column_privilege(
      'authenticated', 'public.user_profiles', v_spalte, 'update'),
      format('authenticated darf %s NICHT schreiben', v_spalte);
    assert not pg_catalog.has_column_privilege(
      'anon', 'public.user_profiles', v_spalte, 'update'),
      format('anon darf %s NICHT schreiben', v_spalte);
  end loop;

  /* Offen: die Felder, die der Kunde selbst pflegt. Ohne diese
     Gegenprobe wuerde der Test auch bestehen, wenn gar nichts mehr
     schreibbar waere — und das Profil waere unbenutzbar. */
  foreach v_spalte in array array['full_name', 'company_name', 'city'] loop
    assert pg_catalog.has_column_privilege(
      'authenticated', 'public.user_profiles', v_spalte, 'update'),
      format('authenticated darf %s schreiben', v_spalte);
  end loop;
end $$;

/* ═══════════════════════════════════════════════════════
   2 — DER PLAN-CONSTRAINT
   ═══════════════════════════════════════════════════════ */
do $$
declare
  v_a      uuid := test.id('user_a');
  v_wert   text;
  v_fehler boolean;
begin
  foreach v_wert in array array['free', 'starter', 'pro', 'founding_partner'] loop
    update public.user_profiles set plan = v_wert where id = v_a;
    assert (select plan from public.user_profiles where id = v_a) = v_wert,
      format('%s ist ein erlaubter Plan', v_wert);
  end loop;

  /* Und Unsinn nicht. 'trial' ausdruecklich mitgeprueft: Der Wert
     steht noch in schedule_lifecycle_emails und in subscription.js,
     laesst sich aber nicht setzen. Das ist die Lage, auf die sich
     beide Fassungen der Zugriffsregel berufen. */
  foreach v_wert in array array['trial', 'premium', 'FREE', ''] loop
    v_fehler := false;
    begin
      update public.user_profiles set plan = v_wert where id = v_a;
    exception when check_violation then
      v_fehler := true;
    end;
    assert v_fehler, format('%s ist kein erlaubter Plan', coalesce(v_wert, 'NULL'));
  end loop;
end $$;

/* ═══════════════════════════════════════════════════════
   3 — FOUNDING PARTNER SETZEN UND NEHMEN
   ═══════════════════════════════════════════════════════ */
do $$
declare
  v_a    uuid := test.id('user_a');
  v_seit timestamptz;
  v_noch timestamptz;
  v_plan text;
begin
  update public.user_profiles set plan = 'free',
         founding_partner_since = null, founding_partner_note = null
   where id = v_a;

  v_seit := public.set_founding_partner(v_a, 'Pilotbetrieb Hamburg');

  assert v_seit is not null, 'set_founding_partner gibt den Beginn zurueck';
  select plan into v_plan from public.user_profiles where id = v_a;
  assert v_plan = 'founding_partner', 'der Plan steht';
  assert (select founding_partner_note from public.user_profiles where id = v_a)
         = 'Pilotbetrieb Hamburg', 'die Notiz steht';

  /* Zweiter Aufruf: unveraendert, insbesondere der Beginn. "Seit
     wann ist der dabei" soll nicht bei jedem Aufruf neu anfangen. */
  v_noch := public.set_founding_partner(v_a, 'andere Notiz');
  assert v_noch = v_seit, 'Der Beginn bleibt beim zweiten Aufruf';

  /* Zurueck. Der Beginn bleibt stehen — er ist Historie, nicht
     Zustand. */
  assert public.clear_founding_partner(v_a) = 'founding_partner',
    'clear_founding_partner nennt den vorherigen Plan';
  assert (select plan from public.user_profiles where id = v_a) = 'free',
    'danach free';
  assert (select founding_partner_since from public.user_profiles where id = v_a)
         = v_seit, 'der Beginn bleibt als Historie stehen';
end $$;

do $$
declare
  v_a      uuid := test.id('user_a');
  v_fehler boolean := false;
begin
  /* Kein beliebiger Zielplan: 'founding_partner' ueber
     clear_founding_partner zu setzen waere ein zweiter Weg zu
     demselben Zustand. */
  begin
    perform public.clear_founding_partner(v_a, 'founding_partner');
  exception when others then
    v_fehler := true;
  end;
  assert v_fehler, 'clear_founding_partner nimmt nur free und pro';

  /* Und kein unbekanntes Profil. */
  v_fehler := false;
  begin
    perform public.set_founding_partner('99999999-9999-9999-9999-999999999999');
  exception when others then
    v_fehler := true;
  end;
  assert v_fehler, 'set_founding_partner wirft bei unbekanntem Profil';
end $$;

/* ═══════════════════════════════════════════════════════
   4 — record_terms_acceptance
   ═══════════════════════════════════════════════════════

   Der Weg aus dem Browser steht in consent.test.sql. Hier die
   Funktion selbst: Was sie ablehnt, und dass sie nicht zweimal
   schreibt. */
do $$
declare
  v_a      uuid := test.id('user_a');
  v_wann   timestamptz;
  v_zweit  timestamptz;
  v_fehler boolean;
begin
  update public.user_profiles
     set accepted_terms_at = null, accepted_terms_version = null where id = v_a;

  /* Ohne Version kein Nachweis. */
  v_fehler := false;
  begin
    perform public.record_terms_acceptance(v_a, '');
  exception when others then v_fehler := true;
  end;
  assert v_fehler, 'Eine leere Version wird abgelehnt';

  v_fehler := false;
  begin
    perform public.record_terms_acceptance(v_a, null);
  exception when others then v_fehler := true;
  end;
  assert v_fehler, 'Keine Version wird abgelehnt';

  v_fehler := false;
  begin
    perform public.record_terms_acceptance(v_a, pg_catalog.repeat('x', 65));
  exception when others then v_fehler := true;
  end;
  assert v_fehler, 'Eine zu lange Version wird abgelehnt';

  /* Unbekanntes Profil. */
  v_fehler := false;
  begin
    perform public.record_terms_acceptance(
      '99999999-9999-9999-9999-999999999999', 'datenschutz-2026-09');
  exception when others then v_fehler := true;
  end;
  assert v_fehler, 'Ein unbekanntes Profil wirft';

  /* Der gute Fall, und die Wiederholung. */
  v_wann := public.record_terms_acceptance(v_a, 'datenschutz-2026-09');
  assert v_wann is not null, 'Der gute Fall haelt den Zeitpunkt fest';

  v_zweit := public.record_terms_acceptance(v_a, 'datenschutz-2026-09');
  assert v_zweit = v_wann, 'Dieselbe Version schreibt nicht neu';

  assert (select accepted_terms_at from public.user_profiles where id = v_a) = v_wann,
    'und die Zeile bleibt, wie sie war';
end $$;

/* ═══════════════════════════════════════════════════════
   5 — RECHTE
   ═══════════════════════════════════════════════════════ */
do $$
declare
  v_name text;
  v_oid  oid;
begin
  foreach v_name in array array[
    'set_founding_partner', 'clear_founding_partner', 'record_terms_acceptance'
  ] loop
    select p.oid into v_oid
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_name;

    assert v_oid is not null, format('%s existiert', v_name);
    assert pg_catalog.has_function_privilege('service_role', v_oid, 'execute'),
      format('service_role darf %s ausfuehren', v_name);
    assert not pg_catalog.has_function_privilege('authenticated', v_oid, 'execute'),
      format('authenticated darf %s NICHT ausfuehren', v_name);
    assert not pg_catalog.has_function_privilege('anon', v_oid, 'execute'),
      format('anon darf %s NICHT ausfuehren', v_name);
    assert (select prosecdef from pg_catalog.pg_proc where oid = v_oid),
      format('%s laeuft als security definer', v_name);
  end loop;
end $$;

rollback;
