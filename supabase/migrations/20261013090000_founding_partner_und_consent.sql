-- 20261013090000_founding_partner_und_consent.sql
--
-- founding_partner als echtes Entitlement, und ein Consent-Nachweis.
--
-- ═══════════════════════════════════════════════════════════════
-- WARUM DER CONSTRAINT DER HARTE BLOCKER WAR
-- ═══════════════════════════════════════════════════════════════
--
-- In Produktion abgefragt am 13.10.2026:
--
--   user_profiles_plan_check
--     CHECK ((plan = ANY (ARRAY['free'::text, 'starter'::text, 'pro'::text])))
--
-- Ein "update user_profiles set plan = 'founding_partner'" waere an
-- dieser Zeile gescheitert — nicht an einer Policy, nicht an einem
-- Recht, sondern am Wertebereich der Spalte. Keine der 40 Migrationen
-- ruehrt den Constraint an; er stammt aus der Zeit vor den
-- Migrationen und stand nur im Baseline-Dump.
--
-- Nachgesehen, nicht uebernommen: G2 hat nachgewiesen, dass dieser
-- Dump abgeschnitten und unzuverlaessig ist. Fuer den haertesten
-- Blocker des Pakets war der Produktionszustand die einzige
-- zulaessige Quelle.
--
-- ═══════════════════════════════════════════════════════════════
-- WARUM founding_partner UND NICHT plan = 'pro'
-- ═══════════════════════════════════════════════════════════════
--
-- Ein Founding Partner mit plan = 'pro' waere von einem zahlenden
-- Kunden nicht unterscheidbar. Jede Auswertung ("wie viele zahlen?"),
-- jede Mail ("deine Zahlung ist fehlgeschlagen") und jede
-- Stripe-Logik haette ihn mitgezaehlt. Ein trial_ends_at in ferner
-- Zukunft waere dieselbe Luege mit einem Datum davor.
--
-- Deshalb ein eigener Wert. Funktional gleich einem Pro-Kunden,
-- buchhalterisch und kommunikativ etwas anderes.
--
-- ═══════════════════════════════════════════════════════════════
-- WAS DIESE MIGRATION NICHT TUT
-- ═══════════════════════════════════════════════════════════════
--
-- Sie setzt niemanden auf founding_partner. Der Wert wird moeglich,
-- nicht vergeben — wer ihn bekommt, entscheidet ein Mensch mit
-- set_founding_partner() (unten, nur service_role).
--
-- Sie raeumt 'starter' und den toten 'trial'-Zweig NICHT auf. Beide
-- sind Altlasten mit eigenem Entscheidungsbedarf:
--
--   'starter'  ist im Constraint erlaubt, wird aber von keiner
--              Access-Logik behandelt und von keinem Code gesetzt.
--              Fliegt hier mit, weil ihn zu entfernen bedeutet,
--              einen Wertebereich zu verkleinern, den vielleicht
--              eine alte Zeile noch traegt. Das will geprueft
--              werden, nicht nebenbei gemacht.
--
--   'trial'    ist vom Constraint VERBOTEN, aber drei Stellen
--              fragen danach: schedule_lifecycle_emails (zweimal),
--              update_user_plan und hasPaidAccess. Folge:
--              trial_reminder und trial_ended gehen an niemanden.
--              Das ist ein eigener Befund, nicht Teil von H1.
--
-- Wiederholbar.

begin;

/* ═══════════════════════════════════════════════════════════
   1 — DER WERTEBEREICH
   ═══════════════════════════════════════════════════════════

   drop + add, nicht "alter constraint": einen CHECK aendert man in
   PostgreSQL nicht, man ersetzt ihn.

   Der neue Bereich ist eine Obermenge des alten — jede bestehende
   Zeile erfuellt ihn weiter. Deshalb ist kein Datenumbau noetig und
   kein "not valid" mit spaeterer Validierung.

   Der Name bleibt derselbe. Ein neuer Name waere ein zweiter
   Constraint im Code, der denselben Zweck hat, und in einem Jahr
   wuesste niemand, welcher gilt. */

alter table public.user_profiles
  drop constraint if exists user_profiles_plan_check;

alter table public.user_profiles
  add constraint user_profiles_plan_check
  check (plan = any (array['free', 'starter', 'pro', 'founding_partner']));

/* ═══════════════════════════════════════════════════════════
   2 — WER SEIT WANN UND WARUM
   ═══════════════════════════════════════════════════════════

   §16 des Auftrags nennt founding_partner_since und
   founding_partner_note als "zusaetzlich sinnvoll, nur wenn
   weiterhin passend zum aktuellen Schema". Sie passen: beide sind
   nullable, keine Spalte wird NOT NULL, kein Default erzwingt etwas.

   Der Grund, sie zu haben: ein Entitlement ohne Datum ist nach drei
   Monaten nicht mehr nachvollziehbar. "Seit wann ist dieser Betrieb
   dabei?" ist die erste Frage im Feedbackgespraech (Tag 7-14, Tag
   30-45), und die Antwort soll in der Datenbank stehen und nicht in
   einer Mail. */

alter table public.user_profiles
  add column if not exists founding_partner_since timestamptz,
  add column if not exists founding_partner_note  text,
  add column if not exists accepted_terms_version text,
  add column if not exists accepted_terms_at      timestamptz;

comment on column public.user_profiles.founding_partner_since is
  'Beginn der Founding-Partner-Teilnahme. Wird von set_founding_partner() gesetzt, nie vom Client.';
comment on column public.user_profiles.founding_partner_note is
  'Interne Notiz zur Aufnahme (wer, warum). Nicht fuer Kundenaugen.';
comment on column public.user_profiles.accepted_terms_version is
  'Version der zugestimmten Vertragsbedingungen. Serverseitig gesetzt; der Client kann sie nicht schreiben.';
comment on column public.user_profiles.accepted_terms_at is
  'Zeitpunkt der Zustimmung.';

/* ═══════════════════════════════════════════════════════════
   3 — RECHTE: NICHTS ZU TUN, UND WARUM DAS GEPRUEFT WIRD
   ═══════════════════════════════════════════════════════════

   Migration 20260928160000 vergibt Schreibrechte als SPALTENLISTE:

     revoke insert, update, delete on public.user_profiles
       from anon, authenticated;
     grant update (full_name, company_name, phone, trade, city,
                   avatar_url, industry_key, email_opt_out)
       on public.user_profiles to authenticated;

   Eine neue Spalte ist damit automatisch nicht schreibbar — eine
   Whitelist waechst nicht mit. Das ist genau richtig, aber es ist
   ein Verhalten, auf das man sich verlaesst, ohne es zu sehen.
   Deshalb wird es hier geprueft und nicht angenommen.

   Dieselbe Pruefung in supabase/tests/entitlement.test.sql, damit
   eine spaetere Migration, die "grant update on user_profiles"
   schreibt statt die Spaltenliste zu erweitern, in CI auffaellt. */

do $$
declare
  v_offen text[];
begin
  select pg_catalog.array_agg(g.column_name order by g.column_name)
    into v_offen
    from information_schema.column_privileges g
   where g.table_schema = 'public'
     and g.table_name   = 'user_profiles'
     and g.grantee      in ('anon', 'authenticated')
     and g.privilege_type in ('UPDATE', 'INSERT')
     and g.column_name in ('plan', 'founding_partner_since',
                           'founding_partner_note',
                           'accepted_terms_version', 'accepted_terms_at',
                           'trial_ends_at', 'trial_started_at');

  if v_offen is not null then
    raise exception
      E'Der Client darf Entitlement-Spalten schreiben: %\n'
      '  plan und die Founding-/Consent-Spalten gehoeren ausschliesslich\n'
      '  dem Server. Ein Kunde, der plan setzen kann, schenkt sich Pro.',
      pg_catalog.array_to_string(v_offen, ', ');
  end if;

  raise notice 'Rechte: der Client kann keine Entitlement-Spalte schreiben';
end $$;

/* ═══════════════════════════════════════════════════════════
   4 — SETZEN UND ENTZIEHEN
   ═══════════════════════════════════════════════════════════

   §21: "Fuer die ersten 5-10 Partner reicht eine sichere
   Admin-/SQL-Moeglichkeit. Kein grosses Admin-UI noetig."

   Warum eine Funktion und nicht ein handgeschriebenes UPDATE im
   SQL-Editor:

     - sie prueft, dass der Nutzer existiert (ein Tippfehler in der
       uuid traefe sonst keine Zeile und meldete Erfolg)
     - sie setzt founding_partner_since mit, statt es zu vergessen
     - sie ist der einzige Ort, an dem der Wert entsteht, also auch
       der einzige, den man lesen muss, um ihn zu verstehen
     - sie laesst sich service_role vorbehalten; ein UPDATE im Editor
       laeuft als postgres und waere von aussen nicht unterscheidbar

   §22: der Planwechsel darf nichts verlieren. Diese Funktionen
   fassen ausschliesslich plan und die beiden founding_*-Spalten an —
   Google-Konto, Standorte, Bewertungen, Events, Reminder, Action
   Tokens und Einstellungen haengen an user_id und bleiben
   unberuehrt. Deshalb kein delete, kein Umschreiben von
   Fremdschluesseln, kein Zuruecksetzen von trial_*.

   Stripe-Felder werden NICHT geleert. Wer von pro auf
   founding_partner wechselt, behaelt seine Stripe-Historie, damit
   die Buchhaltung sie noch findet. Dass der Zugang trotzdem gilt,
   entscheidet die Access-Regel, die founding_partner VOR dem
   Stripe-Zweig prueft — siehe src/utils/subscription.js. */

create or replace function public.set_founding_partner(
  p_user_id uuid,
  p_note    text default null
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seit timestamptz;
  v_plan text;
begin
  select plan into v_plan
    from public.user_profiles where id = p_user_id;

  if not found then
    raise exception 'Kein Profil mit id % — nichts geaendert', p_user_id;
  end if;

  if v_plan = 'founding_partner' then
    select founding_partner_since into v_seit
      from public.user_profiles where id = p_user_id;
    raise notice 'Bereits Founding Partner seit % — unveraendert', v_seit;
    return v_seit;
  end if;

  update public.user_profiles
     set plan                   = 'founding_partner',
         founding_partner_since = coalesce(founding_partner_since, now()),
         founding_partner_note  = coalesce(p_note, founding_partner_note)
   where id = p_user_id
  returning founding_partner_since into v_seit;

  raise notice 'Founding Partner gesetzt: % (vorher %)', p_user_id, v_plan;
  return v_seit;
end $$;

comment on function public.set_founding_partner(uuid, text) is
  'Nimmt einen Betrieb ins Founding-Partner-Programm auf. Nur service_role. Aendert ausschliesslich plan und die founding_*-Spalten.';

create or replace function public.clear_founding_partner(
  p_user_id uuid,
  p_plan    text default 'free'
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare v_vorher text;
begin
  if p_plan not in ('free', 'pro') then
    raise exception
      'Zielplan % ist hier nicht vorgesehen — erlaubt sind free und pro', p_plan;
  end if;

  select plan into v_vorher
    from public.user_profiles where id = p_user_id;

  if not found then
    raise exception 'Kein Profil mit id % — nichts geaendert', p_user_id;
  end if;

  if v_vorher <> 'founding_partner' then
    raise notice 'Profil % ist kein Founding Partner (plan = %) — unveraendert',
      p_user_id, v_vorher;
    return v_vorher;
  end if;

  /* founding_partner_since bleibt stehen: dass jemand dabei WAR, ist
     eine Tatsache und keine Einstellung. Die Notiz bleibt auch —
     sie erklaert, warum er aufgenommen wurde, und das bleibt wahr. */
  update public.user_profiles
     set plan = p_plan
   where id = p_user_id;

  raise notice 'Founding Partner entzogen: % → %', p_user_id, p_plan;
  return v_vorher;
end $$;

comment on function public.clear_founding_partner(uuid, text) is
  'Beendet die Founding-Partner-Teilnahme. Nur service_role. founding_partner_since bleibt als Historie stehen.';

/* Rechte wie bei jeder anderen Serverfunktion im Repo: public,
   anon und authenticated bekommen nichts, auch nicht ueber PUBLIC. */
revoke all on function public.set_founding_partner(uuid, text)
  from public, anon, authenticated;
revoke all on function public.clear_founding_partner(uuid, text)
  from public, anon, authenticated;
grant execute on function public.set_founding_partner(uuid, text)   to service_role;
grant execute on function public.clear_founding_partner(uuid, text) to service_role;

/* ═══════════════════════════════════════════════════════════
   5 — CONSENT SERVERSEITIG FESTHALTEN
   ═══════════════════════════════════════════════════════════

   §38: "Version/Zeitpunkt serverseitig speichern. Nicht nur
   LocalStorage." §39: derselbe Nachweis gilt fuer Founding Partner —
   kostenlos heisst nicht ohne Vertragsverhaeltnis.

   Warum eine Funktion und nicht ein Spalten-Grant fuer den Client:
   wenn authenticated accepted_terms_version schreiben darf, kann er
   jede Version behaupten, auch eine, die es nie gab. Der Nachweis
   waere dann wertlos. Hier bestimmt der SERVER die Version; der
   Client sagt nur, dass er zugestimmt hat.

   Die gueltige Version kommt als Parameter und nicht aus einer
   Tabelle: ein Versionsarchiv ist ausdruecklich nicht Teil von H1
   (§40). Der Aufrufer — die Edge Function — kennt sie aus ihrer
   Umgebung.

   Idempotent: eine zweite Zustimmung zur selben Version aendert
   nichts. Eine Zustimmung zu einer NEUEN Version ueberschreibt, und
   das ist gewollt — H1 fuehrt kein Re-Consent-System ein, es haelt
   den AKTUELLEN Nachweis. */

create or replace function public.record_terms_acceptance(
  p_user_id uuid,
  p_version text
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bisher text;
  v_wann   timestamptz;
begin
  if p_version is null or pg_catalog.btrim(p_version) = '' then
    raise exception 'Keine Version angegeben — ein Nachweis ohne Version ist keiner';
  end if;
  if pg_catalog.length(p_version) > 64 then
    raise exception 'Version zu lang (% Zeichen)', pg_catalog.length(p_version);
  end if;

  select accepted_terms_version, accepted_terms_at
    into v_bisher, v_wann
    from public.user_profiles where id = p_user_id;

  if not found then
    raise exception 'Kein Profil mit id % — nichts geaendert', p_user_id;
  end if;

  if v_bisher = p_version then
    return v_wann;
  end if;

  update public.user_profiles
     set accepted_terms_version = p_version,
         accepted_terms_at      = now()
   where id = p_user_id
  returning accepted_terms_at into v_wann;

  return v_wann;
end $$;

comment on function public.record_terms_acceptance(uuid, text) is
  'Haelt die Zustimmung zu den Vertragsbedingungen fest. Die Version bestimmt der Server, nicht der Client. Nur service_role.';

revoke all on function public.record_terms_acceptance(uuid, text)
  from public, anon, authenticated;
grant execute on function public.record_terms_acceptance(uuid, text) to service_role;

/* ═══════════════════════════════════════════════════════════
   6 — SELBSTPRUEFUNG
   ═══════════════════════════════════════════════════════════

   Nicht die Anweisungen von oben wiederholen, sondern die Wirkung
   messen: laesst der Constraint den neuen Wert zu und den Unsinn
   nicht? Faellt die Pruefung, rollt begin/commit alles zurueck. */

do $$
declare
  v_fehl text[] := array[]::text[];
  v_kennt_wert boolean;
begin
  /* Der Constraint IST der zu pruefende Gegenstand, deshalb wird
     seine Definition gelesen und nicht eine Probezeile eingefuegt:
     ohne passende auth.users-Zeile verbietet der Fremdschluessel das
     Einfuegen, und der Test wuerde am falschen Grund scheitern. */
  select pg_catalog.pg_get_constraintdef(c.oid) like '%founding_partner%'
    into v_kennt_wert
    from pg_catalog.pg_constraint c
    join pg_catalog.pg_class t on t.oid = c.conrelid
    join pg_catalog.pg_namespace n on n.oid = t.relnamespace
   where n.nspname = 'public' and t.relname = 'user_profiles'
     and c.conname = 'user_profiles_plan_check';

  if v_kennt_wert is not true then
    v_fehl := v_fehl || 'user_profiles_plan_check kennt founding_partner nicht'::text;
  end if;

  if pg_catalog.to_regprocedure('public.set_founding_partner(uuid,text)') is null then
    v_fehl := v_fehl || 'set_founding_partner fehlt'::text;
  end if;
  if pg_catalog.to_regprocedure('public.clear_founding_partner(uuid,text)') is null then
    v_fehl := v_fehl || 'clear_founding_partner fehlt'::text;
  end if;
  if pg_catalog.to_regprocedure('public.record_terms_acceptance(uuid,text)') is null then
    v_fehl := v_fehl || 'record_terms_acceptance fehlt'::text;
  end if;

  /* Die drei Funktionen sind SECURITY DEFINER und setzen plan. Darf
     authenticated eine davon ausfuehren, ist das Entitlement
     wertlos — dann schenkt sich der Kunde Founding Partner. */
  if pg_catalog.has_function_privilege(
       'authenticated', 'public.set_founding_partner(uuid,text)', 'EXECUTE') then
    v_fehl := v_fehl || 'authenticated darf set_founding_partner ausfuehren'::text;
  end if;
  if pg_catalog.has_function_privilege(
       'anon', 'public.set_founding_partner(uuid,text)', 'EXECUTE') then
    v_fehl := v_fehl || 'anon darf set_founding_partner ausfuehren'::text;
  end if;
  if pg_catalog.has_function_privilege(
       'authenticated', 'public.record_terms_acceptance(uuid,text)', 'EXECUTE') then
    v_fehl := v_fehl || 'authenticated darf record_terms_acceptance ausfuehren'::text;
  end if;

  if not pg_catalog.has_function_privilege(
       'service_role', 'public.set_founding_partner(uuid,text)', 'EXECUTE') then
    v_fehl := v_fehl || 'service_role darf set_founding_partner NICHT ausfuehren — der Serverweg ist zu'::text;
  end if;

  if pg_catalog.array_length(v_fehl, 1) > 0 then
    raise exception E'Migration unvollstaendig:\n  %',
      pg_catalog.array_to_string(v_fehl, E'\n  ');
  end if;

  raise notice 'Selbstpruefung: Wertebereich erweitert, drei Serverfunktionen da, Client hat keinen Zugriff, service_role kommt durch';
end $$;

commit;

-- ═══════════════════════════════════════════════════════════════
-- BEDIENUNG (§21)
-- ═══════════════════════════════════════════════════════════════
--
-- Aufnehmen, im SQL-Editor:
--
--   select public.set_founding_partner(
--     '00000000-0000-0000-0000-000000000000',
--     'Pilot, Zusage per Mail vom 13.10.2026');
--
-- Beenden:
--
--   select public.clear_founding_partner('00000000-...');
--
-- Kontrollabfrage — der SQL-Editor zeigt kein NOTICE, deshalb eine,
-- die Zeilen zurueckgibt:
--
--   select id, plan, founding_partner_since, founding_partner_note,
--          accepted_terms_version, accepted_terms_at,
--          stripe_subscription_status
--     from public.user_profiles
--    where plan = 'founding_partner';
--
-- ACHTUNG, Reihenfolge bei einem bestehenden Stripe-Kunden (§23):
-- erst die Subscription in Stripe beenden, den Webhook abwarten
-- (plan steht dann auf 'free'), DANN set_founding_partner. Umgekehrt
-- wuerde das naechste customer.subscription.updated den Wert
-- ueberschreiben — solange der Webhook-Guard aus diesem Paket nicht
-- deployt ist.
