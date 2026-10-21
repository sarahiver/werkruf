-- Abnahme fuer den Direkten Draht der Founding Partner
--
--   scripts/test-db/run.sh supportAnfragen
--
-- ═══════════════════════════════════════════════════════════════
-- WARUM ES DIESEN TEST GIBT
-- ═══════════════════════════════════════════════════════════════
--
-- Migration 20261021140000 legt support_requests an. Die Karte im
-- Dashboard ist nur fuer Founding Partner sichtbar — aber Sichtbarkeit
-- ist keine Regel. Die Regel steht in der Insert-Policy, und ob sie
-- wirkt, laesst sich nur durch Versuchen pruefen: als Founding Partner,
-- als normaler Kunde, als Admin, mit echtem Rollenwechsel.
--
-- ═══════════════════════════════════════════════════════════════
-- WARUM NICHT UEBER TEXTMUSTER
-- ═══════════════════════════════════════════════════════════════
--
-- Eine Pruefung "Policy enthaelt founding_partner" waere wertlos: Sie
-- bestaende auch, wenn die Bedingung mit OR statt AND verknuepft
-- waere. Hier wird eingefuegt, gelesen und geaendert — und gemessen,
-- was durchkommt.
--
-- ═══════════════════════════════════════════════════════════════
-- DIE TRAGENDEN PRUEFUNGEN SIND DIE GEGENPROBEN
-- ═══════════════════════════════════════════════════════════════
--
--   D  ein normaler Kunde kann KEINE Anfrage anlegen
--   E  ein Founding Partner sieht fremde Anfragen NICHT
--   F  der Eigentuemer kann seine Anfrage NICHT aendern
--   B  eine Anfrage kann nicht als "beantwortet" geboren werden

\set ON_ERROR_STOP on

begin;

/* Produktionsfassung von auth.uid() und auth.jwt(). Rollen mit zurueck.
   Beide lesen request.jwt.claims — so, wie PostgREST sie setzt. */
create or replace function auth.uid()
returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid
$$;

create or replace function auth.jwt()
returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;

/* Drei Nutzer. Die Bezeichner sind nicht vorregistriert — test.id()
   wirft bei unbekannten Namen, mit Absicht. Hier in der Transaktion
   eintragen; rollt mit zurueck. */
insert into test.bezeichner (name, id) values
  ('fp',    '77777777-7777-7777-7777-777777777771'),
  ('kunde', '77777777-7777-7777-7777-777777777772'),
  ('chef',  '77777777-7777-7777-7777-777777777773')
on conflict (name) do update set id = excluded.id;

select test.benutzer('fp');
select test.benutzer('kunde');
select test.benutzer('chef');

update public.user_profiles set plan = 'founding_partner' where id = test.id('fp');
update public.user_profiles set plan = 'free'             where id = test.id('kunde');

/* Helfer: als jemand handeln. Transaktionslokal. */
create or replace function test.als(p_name text, p_admin boolean default false)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object(
      'sub', test.id(p_name),
      'role', 'authenticated',
      'app_metadata', case when p_admin then '{"role":"admin"}'::jsonb else '{}'::jsonb end
    )::text, true);
  perform set_config('request.jwt.claim.sub', test.id(p_name)::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

create or replace function test.als_niemand()
returns void language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

/* Die Helfer werden auch aufgerufen, waehrend die Rolle authenticated
   ist — und die hat auf das Schema test keine Rechte. Transaktions-
   lokal freigeben; rollt mit zurueck. Betrifft nur das Testschema,
   nicht public. */
grant usage on schema test to authenticated;
grant execute on all functions in schema test to authenticated;
grant select on test.bezeichner to authenticated;

do $$
declare
  v_fp      uuid := test.id('fp');
  v_kunde   uuid := test.id('kunde');
  v_anfrage uuid;
  v_fremd   uuid;
  v_zeilen  integer;
  v_status  text;
  v_wann    timestamptz;
  v_wann2   timestamptz;
  v_zeile   public.support_requests;
  v_alerts  jsonb;
  v_item    jsonb;
  v_gefunden boolean := false;
begin

  /* ─────────────────────────────────────────────────────────────
     A — Founding Partner legt eine Anfrage an
     ───────────────────────────────────────────────────────────── */
  perform test.als('fp');
  insert into public.support_requests (user_id, subject, body)
       values (v_fp, 'Frage zu Oeffnungszeiten', 'Wie trage ich Feiertage ein? Danke.')
    returning id into v_anfrage;
  perform test.als_niemand();

  select status into v_status from public.support_requests where id = v_anfrage;
  if v_status <> 'open' then
    raise exception 'A: Status ist % statt open', v_status;
  end if;
  raise notice 'A: Founding Partner kann anlegen — open';

  /* ─────────────────────────────────────────────────────────────
     B — GEGENPROBE: nicht als "beantwortet" geboren
     ───────────────────────────────────────────────────────────── */
  perform test.als('fp');
  begin
    insert into public.support_requests (user_id, subject, body, status)
         values (v_fp, 'Trick', 'Ich stelle mich selbst auf beantwortet.', 'answered');
    raise exception 'B: Anfrage mit status=answered wurde angenommen';
  exception
    when insufficient_privilege or check_violation then
      null; -- erwartet: RLS (42501) weist ab
  end;
  perform test.als_niemand();
  raise notice 'B: status=answered beim Anlegen abgewiesen';

  /* ─────────────────────────────────────────────────────────────
     C — GEGENPROBE: nicht im Namen eines anderen
     ───────────────────────────────────────────────────────────── */
  perform test.als('fp');
  begin
    insert into public.support_requests (user_id, subject, body)
         values (v_kunde, 'Fremd', 'Im Namen des Kunden angelegt.');
    raise exception 'C: Anfrage mit fremder user_id wurde angenommen';
  exception
    when insufficient_privilege then null;
  end;
  perform test.als_niemand();
  raise notice 'C: fremde user_id abgewiesen';

  /* ─────────────────────────────────────────────────────────────
     D — GEGENPROBE: normaler Kunde darf nicht
     ─────────────────────────────────────────────────────────────

     Die Regel dieser Migration. Die Karte ist im Browser fuer ihn
     unsichtbar — hier wird geprueft, dass auch der direkte Weg zu ist. */
  perform test.als('kunde');
  begin
    insert into public.support_requests (user_id, subject, body)
         values (v_kunde, 'Hallo', 'Ich bin kein Founding Partner, aber ich frage trotzdem.');
    raise exception 'D: Ein Nicht-Founding-Partner konnte eine Anfrage anlegen';
  exception
    when insufficient_privilege then null;
  end;
  perform test.als_niemand();
  raise notice 'D: normaler Kunde abgewiesen';

  /* ─────────────────────────────────────────────────────────────
     E — Isolation: eigene ja, fremde nein
     ───────────────────────────────────────────────────────────── */
  /* Eine fremde Anfrage als Eigentuemer der Tabelle anlegen (der
     Kunde selbst duerfte es ja nicht). */
  insert into public.support_requests (user_id, subject, body)
       values (v_kunde, 'Fremde Anfrage', 'Vom Test als postgres angelegt.')
    returning id into v_fremd;

  perform test.als('fp');
  select count(*) into v_zeilen from public.support_requests;
  perform test.als_niemand();

  if v_zeilen <> 1 then
    raise exception 'E: Founding Partner sieht % Anfragen statt genau seiner einen', v_zeilen;
  end if;

  perform test.als('fp');
  select count(*) into v_zeilen from public.support_requests where id = v_fremd;
  perform test.als_niemand();
  if v_zeilen <> 0 then
    raise exception 'E: Founding Partner sieht die fremde Anfrage';
  end if;
  raise notice 'E: sieht genau die eigene, nicht die fremde';

  /* ─────────────────────────────────────────────────────────────
     F — GEGENPROBE: Eigentuemer kann nicht aendern und nicht loeschen
     ───────────────────────────────────────────────────────────── */
  perform test.als('fp');
  begin
    update public.support_requests set status = 'answered' where id = v_anfrage;
    raise exception 'F: Eigentuemer konnte den Status aendern';
  exception
    when insufficient_privilege then null;
  end;
  begin
    delete from public.support_requests where id = v_anfrage;
    raise exception 'F: Eigentuemer konnte loeschen';
  exception
    when insufficient_privilege then null;
  end;
  perform test.als_niemand();
  raise notice 'F: aendern und loeschen abgewiesen';

  /* ─────────────────────────────────────────────────────────────
     G — Admin liest alles, kann aber auch nicht direkt aendern
     ───────────────────────────────────────────────────────────── */
  perform test.als('chef', true);
  select count(*) into v_zeilen from public.support_requests;
  perform test.als_niemand();
  if v_zeilen <> 2 then
    raise exception 'G: Admin sieht % statt 2', v_zeilen;
  end if;

  /* Der Admin aendert ueber die Funktion (Service Role), nicht ueber
     ein UPDATE aus dem Browser. */
  perform test.als('chef', true);
  begin
    update public.support_requests set status = 'answered' where id = v_anfrage;
    raise exception 'G: Admin konnte aus dem Browser direkt aendern';
  exception
    when insufficient_privilege then null;
  end;
  perform test.als_niemand();
  raise notice 'G: Admin liest beide, aendert nicht direkt';

  /* ─────────────────────────────────────────────────────────────
     H — Statuswechsel ueber die Funktion
     ───────────────────────────────────────────────────────────── */
  v_zeile := public.set_support_request_status(v_anfrage, 'answered', 'Per Mail beantwortet');
  if v_zeile.status <> 'answered' or v_zeile.answered_at is null then
    raise exception 'H: answered nicht gesetzt (% / %)', v_zeile.status, v_zeile.answered_at;
  end if;
  v_wann := v_zeile.answered_at;

  v_zeile := public.set_support_request_status(v_anfrage, 'closed');
  if v_zeile.status <> 'closed' then
    raise exception 'H: closed nicht gesetzt';
  end if;
  if v_zeile.answered_at <> v_wann then
    raise exception 'H: answered_at wurde beim zweiten Wechsel ueberschrieben';
  end if;
  if v_zeile.admin_note <> 'Per Mail beantwortet' then
    raise exception 'H: Notiz ging beim zweiten Wechsel verloren';
  end if;

  begin
    perform public.set_support_request_status(v_anfrage, 'erledigt');
    raise exception 'H: unbekannter Status wurde angenommen';
  exception
    when check_violation then null;
  end;

  begin
    perform public.set_support_request_status(gen_random_uuid(), 'answered');
    raise exception 'H: unbekannte Anfrage wurde angenommen';
  exception
    when no_data_found then null;
  end;
  raise notice 'H: Statuswechsel korrekt, answered_at bleibt, Notiz bleibt';

  /* ─────────────────────────────────────────────────────────────
     I — ops_alerts() meldet die offene
     ─────────────────────────────────────────────────────────────

     Nach H ist die FP-Anfrage geschlossen; offen ist nur noch die
     fremde (v_fremd). Erwartung: genau 1. */
  v_alerts := public.ops_alerts();
  for v_item in select * from jsonb_array_elements(v_alerts) loop
    if v_item ->> 'key' = 'support.open' then
      v_gefunden := true;
      if (v_item ->> 'title') not like '1 offene%' then
        raise exception 'I: Titel ist "%" statt "1 offene …"', v_item ->> 'title';
      end if;
      if v_item ->> 'severity' <> 'warning' then
        raise exception 'I: severity ist % — der Mailer kennt nur critical|warning', v_item ->> 'severity';
      end if;
      if (v_item -> 'detail' -> 0 ->> 'id')::uuid <> v_fremd then
        raise exception 'I: Detail zeigt nicht die offene Anfrage';
      end if;
      /* Kein Anfragetext in der Alarm-Mail. */
      if (v_item -> 'detail')::text like '%Vom Test als postgres%' then
        raise exception 'I: Anfragetext steht im Alarm — gehoert in den Admin, nicht in die Mail';
      end if;
    end if;
  end loop;
  if not v_gefunden then
    raise exception 'I: ops_alerts() meldet keine offene Supportanfrage';
  end if;

  /* Alle geschlossen → kein Alarm mehr. */
  perform public.set_support_request_status(v_fremd, 'closed');
  v_alerts := public.ops_alerts();
  if exists (select 1 from jsonb_array_elements(v_alerts) e where e ->> 'key' = 'support.open') then
    raise exception 'I: Alarm bleibt, obwohl nichts mehr offen ist';
  end if;
  raise notice 'I: ops_alerts meldet offene und schweigt bei geschlossenen';

  /* ─────────────────────────────────────────────────────────────
     J — Kontoloeschung nimmt die Anfragen mit
     ───────────────────────────────────────────────────────────── */
  delete from auth.users where id = v_kunde;
  select count(*) into v_zeilen from public.support_requests where user_id = v_kunde;
  if v_zeilen <> 0 then
    raise exception 'J: % Anfrage(n) ueberleben die Kontoloeschung', v_zeilen;
  end if;
  raise notice 'J: Loeschung kaskadiert';

end $$;

/* ═══════════════════════════════════════════════════════════════
   K — Rechte, als Wirkung gemessen
   ═══════════════════════════════════════════════════════════════ */
do $$
begin
  if has_table_privilege('anon', 'public.support_requests', 'SELECT') then
    raise exception 'K: anon darf lesen';
  end if;
  if has_table_privilege('authenticated', 'public.support_requests', 'UPDATE')
     or has_table_privilege('authenticated', 'public.support_requests', 'DELETE') then
    raise exception 'K: authenticated darf aendern oder loeschen';
  end if;
  if has_function_privilege('authenticated',
       'public.set_support_request_status(uuid, text, text)', 'execute') then
    raise exception 'K: set_support_request_status fuer authenticated offen';
  end if;
  if not has_function_privilege('service_role',
       'public.set_support_request_status(uuid, text, text)', 'execute') then
    raise exception 'K: service_role darf set_support_request_status nicht — admin-ops waere lahm';
  end if;
  raise notice 'K: Rechte zu fuer Browser-Rollen, offen fuer service_role';
end $$;

rollback;
