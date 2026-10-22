-- Abnahme fuer die Antwort auf Supportanfragen (22.10.2026)
--
--   scripts/test-db/run.sh supportAntwort
--
-- ═══════════════════════════════════════════════════════════════
-- WARUM ES DIESEN TEST GIBT
-- ═══════════════════════════════════════════════════════════════
--
-- Migration 20261022120000: Der Anbieter antwortet im Admin. Die
-- Antwort steht beim Kunden und geht als Mail raus — in EINER
-- Transaktion ueber reply_support_request(). Was hier gemessen wird,
-- ist Wirkung: Zeile veraendert, genau eine Mail eingereiht, Empfaenger
-- stimmt, Kunde liest die Antwort, Kunde kann sie nicht faelschen.
--
-- ═══════════════════════════════════════════════════════════════
-- DIE TRAGENDEN PRUEFUNGEN SIND DIE GEGENPROBEN
-- ═══════════════════════════════════════════════════════════════
--
--   C  ein Kunde kann KEINE Anfrage mit vorgefertigter Antwort anlegen
--   D  die Mail geht an den Eigentuemer der Anfrage — nicht an den,
--      der zufaellig zuletzt ein Profil angelegt hat
--   E  leere Antwort, fremde ID: nichts passiert, keine Mail

begin;

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

insert into test.bezeichner (name, id) values
  ('fp',    '77777777-7777-7777-7777-777777777781'),
  ('fp2',   '77777777-7777-7777-7777-777777777782')
on conflict (name) do update set id = excluded.id;

select test.benutzer('fp',  'fp@werkruf.test',  'Sanitär Müller', 'handwerk');
select test.benutzer('fp2', 'fp2@werkruf.test', 'Zweiter Partner', 'handwerk');

update public.user_profiles set plan = 'founding_partner' where id in (test.id('fp'), test.id('fp2'));

create or replace function test.als(p_name text, p_admin boolean default false)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object(
      'sub', test.id(p_name), 'role', 'authenticated',
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

grant usage on schema test to authenticated;
grant execute on all functions in schema test to authenticated;
grant select on test.bezeichner to authenticated;

do $$
declare
  v_fp       uuid := test.id('fp');
  v_fp2      uuid := test.id('fp2');
  v_anfrage  uuid;
  v_anfrage2 uuid;
  v_zeile    public.support_requests;
  v_mails    integer;
  v_mail     public.email_queue;
  v_antwort  text;
  v_wann     timestamptz;
begin
  /* ─────────────────────────────────────────────────────────────
     A — Anfragen anlegen (als die Kunden selbst)
     ───────────────────────────────────────────────────────────── */
  perform test.als('fp');
  insert into public.support_requests (user_id, subject, body)
  values (v_fp, 'Feiertage eintragen', 'Wie trage ich Feiertage in die Öffnungszeiten ein?')
  returning id into v_anfrage;
  perform test.als_niemand();

  perform test.als('fp2');
  insert into public.support_requests (user_id, subject, body)
  values (v_fp2, 'Zweite Frage', 'Eine andere Frage eines anderen Partners.')
  returning id into v_anfrage2;
  perform test.als_niemand();

  select count(*) into v_mails from public.email_queue where template = 'support_reply';
  if v_mails <> 0 then
    raise exception 'A: schon % support_reply-Mails vor der ersten Antwort', v_mails;
  end if;
  raise notice 'A: zwei Anfragen, noch keine Mail';

  /* ─────────────────────────────────────────────────────────────
     B — Antworten: Zeile, Status, genau eine Mail
     ───────────────────────────────────────────────────────────── */
  v_zeile := public.reply_support_request(v_anfrage, '  Unter Öffnungszeiten → Sonderzeiten.  ');

  if v_zeile.admin_reply <> 'Unter Öffnungszeiten → Sonderzeiten.' then
    raise exception 'B: Antwort nicht getrimmt gespeichert: [%]', v_zeile.admin_reply;
  end if;
  if v_zeile.status <> 'answered' or v_zeile.answered_at is null or v_zeile.replied_at is null then
    raise exception 'B: Status/Zeiten nicht gesetzt (% / % / %)', v_zeile.status, v_zeile.answered_at, v_zeile.replied_at;
  end if;
  v_wann := v_zeile.replied_at;

  select count(*) into v_mails from public.email_queue where template = 'support_reply';
  if v_mails <> 1 then
    raise exception 'B: % Mails statt genau einer', v_mails;
  end if;

  select * into v_mail from public.email_queue where template = 'support_reply';
  if v_mail.to_email <> 'fp@werkruf.test' then
    raise exception 'B: Mail an % statt an den Fragesteller', v_mail.to_email;
  end if;
  if v_mail.user_id <> v_fp then
    raise exception 'B: Mail traegt user_id % statt %', v_mail.user_id, v_fp;
  end if;
  if v_mail.payload ->> 'antwort' <> 'Unter Öffnungszeiten → Sonderzeiten.' then
    raise exception 'B: Antworttext fehlt in der Mail: %', v_mail.payload;
  end if;
  if v_mail.payload ->> 'betreff' <> 'Feiertage eintragen'
     or v_mail.payload ->> 'companyName' <> 'Sanitär Müller'
     or (v_mail.payload ->> 'requestId')::uuid <> v_anfrage then
    raise exception 'B: Payload unvollstaendig: %', v_mail.payload;
  end if;
  raise notice 'B: Antwort gespeichert, answered, genau eine Mail an den Fragesteller';

  /* Zweite Antwort auf dieselbe Anfrage (Nachtrag): zweite Mail,
     answered_at bleibt. Absichtlich OHNE Pause und in derselben
     Transaktion — genau so ist der erste Entwurf (now() im
     dedupe_key) hier durchgefallen. */
  v_zeile := public.reply_support_request(v_anfrage, 'Nachtrag: Du kannst auch ganze Wochen schliessen.');
  if v_zeile.answered_at <> coalesce((select answered_at from public.support_requests where id = v_anfrage), v_zeile.answered_at) then
    raise exception 'B2: answered_at inkonsistent';
  end if;
  if v_zeile.replied_at <= v_wann then
    raise exception 'B2: replied_at nicht neu gesetzt';
  end if;
  select count(*) into v_mails from public.email_queue where template = 'support_reply';
  if v_mails <> 2 then
    raise exception 'B2: Nachtrag hat keine zweite Mail erzeugt (% Mails)', v_mails;
  end if;
  raise notice 'B2: Nachtrag erzeugt zweite Mail, Antwort ersetzt';

  /* ─────────────────────────────────────────────────────────────
     C — GEGENPROBE: Kunde kann keine Antwort mitbringen
     ───────────────────────────────────────────────────────────── */
  perform test.als('fp');
  begin
    insert into public.support_requests (user_id, subject, body, admin_reply)
    values (v_fp, 'Geschummelt', 'Ich bringe meine Antwort gleich mit.', 'Alles bestens, bezahlt.');
    raise exception 'C: Anfrage mit vorgefertigter Antwort wurde angenommen';
  exception
    when insufficient_privilege then null;
  end;
  begin
    insert into public.support_requests (user_id, subject, body, replied_at)
    values (v_fp, 'Geschummelt 2', 'Ich bringe einen Zeitstempel mit.', now());
    raise exception 'C: Anfrage mit replied_at wurde angenommen';
  exception
    when insufficient_privilege then null;
  end;
  perform test.als_niemand();
  raise notice 'C: vorgefertigte Antwort abgewiesen';

  /* ─────────────────────────────────────────────────────────────
     D — Kunde liest seine Antwort, nicht die fremde
     ───────────────────────────────────────────────────────────── */
  perform test.als('fp');
  select admin_reply into v_antwort from public.support_requests where id = v_anfrage;
  if v_antwort is distinct from 'Nachtrag: Du kannst auch ganze Wochen schliessen.' then
    raise exception 'D: Eigentuemer sieht seine Antwort nicht: [%]', v_antwort;
  end if;
  if exists (select 1 from public.support_requests where id = v_anfrage2) then
    raise exception 'D: Eigentuemer sieht die fremde Anfrage';
  end if;
  perform test.als_niemand();

  /* Antwort auf die zweite Anfrage: Mail an fp2, nicht an fp. */
  perform public.reply_support_request(v_anfrage2, 'Antwort fuer den zweiten Partner.');
  select * into v_mail from public.email_queue
   where template = 'support_reply' and (payload ->> 'requestId')::uuid = v_anfrage2;
  if v_mail.to_email <> 'fp2@werkruf.test' or v_mail.user_id <> v_fp2 then
    raise exception 'D: Mail fuer Anfrage 2 ging an % (%)', v_mail.to_email, v_mail.user_id;
  end if;
  raise notice 'D: Eigentuemer liest nur seine Antwort; Mail an den richtigen Empfaenger';

  /* ─────────────────────────────────────────────────────────────
     E — GEGENPROBE: leer, zu lang, unbekannt → nichts, keine Mail
     ───────────────────────────────────────────────────────────── */
  select count(*) into v_mails from public.email_queue where template = 'support_reply';

  begin
    perform public.reply_support_request(v_anfrage, '   ');
    raise exception 'E: leere Antwort wurde angenommen';
  exception when check_violation then null;
  end;
  begin
    perform public.reply_support_request(v_anfrage, repeat('x', 4001));
    raise exception 'E: 4001 Zeichen wurden angenommen';
  exception when check_violation then null;
  end;
  begin
    perform public.reply_support_request(gen_random_uuid(), 'An niemanden.');
    raise exception 'E: unbekannte Anfrage wurde angenommen';
  exception when no_data_found then null;
  end;

  if (select count(*) from public.email_queue where template = 'support_reply') <> v_mails then
    raise exception 'E: Fehlversuche haben Mails eingereiht';
  end if;
  raise notice 'E: Fehlversuche ohne Wirkung';
end $$;

/* ═══════════════════════════════════════════════════════════════
   F — Rechte, als Wirkung gemessen
   ═══════════════════════════════════════════════════════════════ */
do $$
begin
  if has_function_privilege('authenticated', 'public.reply_support_request(uuid, text)', 'execute')
     or has_function_privilege('anon', 'public.reply_support_request(uuid, text)', 'execute') then
    raise exception 'F: reply_support_request fuer Browser-Rollen offen';
  end if;
  if not has_function_privilege('service_role', 'public.reply_support_request(uuid, text)', 'execute') then
    raise exception 'F: service_role darf reply_support_request nicht — admin-ops waere lahm';
  end if;
  if has_column_privilege('authenticated', 'public.support_requests', 'admin_reply', 'UPDATE') then
    raise exception 'F: authenticated darf admin_reply schreiben';
  end if;
  raise notice 'F: Rechte zu fuer Browser-Rollen, offen fuer service_role';
end $$;

rollback;
