-- Abnahme: Stoerfall-Tabelle und Alarm fuer gescheiterte Kontoloeschungen (WP1, 22.10.2026)
--
--   scripts/test-db/run.sh kontoloeschungStoerfall
--
-- Gemessen wird Wirkung: Ein offener Stoerfall erscheint in
-- ops_alerts() als critical mit Stripe-Bezug; ein geloester nicht
-- mehr. Browser-Rollen sehen die Tabelle nicht. Die Abschiedsmail
-- laesst sich ohne Nutzer einreihen.

begin;

do $$
declare
  v_id      uuid;
  v_alerts  jsonb;
  v_item    jsonb;
  v_treffer jsonb := null;
  v_mail    uuid;
begin
  /* ─────────────────────────────────────────────────────────────
     A — Vorher: kein Alarm dieser Art
     ───────────────────────────────────────────────────────────── */
  v_alerts := public.ops_alerts();
  for v_item in select * from jsonb_array_elements(v_alerts) loop
    if v_item ->> 'key' = 'account.deletion_failed' then
      raise exception 'A: Alarm ohne Stoerfall';
    end if;
  end loop;
  raise notice 'A: ohne Stoerfall kein Alarm';

  /* ─────────────────────────────────────────────────────────────
     B — Stoerfall anlegen (so wie delete-account es tut)
     ───────────────────────────────────────────────────────────── */
  insert into public.account_deletion_incidents
    (user_id, email, stage, error_code, error_message, stripe_customer_id, stripe_subscription_id, stripe_cancelled)
  values (gen_random_uuid(), 'kunde@werkruf.test', 'database', '23503',
          'insert or update on table violates foreign key constraint', 'cus_TEST123', 'sub_TEST456', true)
  returning id into v_id;

  v_alerts := public.ops_alerts();
  for v_item in select * from jsonb_array_elements(v_alerts) loop
    if v_item ->> 'key' = 'account.deletion_failed' then v_treffer := v_item; end if;
  end loop;
  if v_treffer is null then
    raise exception 'B: offener Stoerfall erzeugt keinen Alarm';
  end if;
  if v_treffer ->> 'severity' <> 'critical' then
    raise exception 'B: Alarm ist % statt critical', v_treffer ->> 'severity';
  end if;
  if position('cus_TEST123' in v_treffer::text) = 0 or position('sub_TEST456' in v_treffer::text) = 0 then
    raise exception 'B: Alarm traegt die Stripe-Bezuege nicht: %', v_treffer;
  end if;
  if position('kunde@werkruf.test' in v_treffer::text) = 0 then
    raise exception 'B: Alarm nennt die Kundenadresse nicht';
  end if;
  raise notice 'B: offener Stoerfall → critical mit Stripe-Bezug und Adresse';

  /* ─────────────────────────────────────────────────────────────
     C — Geloest → kein Alarm mehr
     ───────────────────────────────────────────────────────────── */
  update public.account_deletion_incidents
     set resolved_at = now(), resolved_note = 'Stripe geprueft, Konto manuell entfernt'
   where id = v_id;
  v_treffer := null;
  v_alerts := public.ops_alerts();
  for v_item in select * from jsonb_array_elements(v_alerts) loop
    if v_item ->> 'key' = 'account.deletion_failed' then v_treffer := v_item; end if;
  end loop;
  if v_treffer is not null then
    raise exception 'C: geloester Stoerfall alarmiert weiter';
  end if;
  raise notice 'C: geloest → kein Alarm';

  /* ─────────────────────────────────────────────────────────────
     D — Ungueltige Stufe und ueberlange Meldung werden abgewiesen
     ───────────────────────────────────────────────────────────── */
  begin
    insert into public.account_deletion_incidents (user_id, stage) values (gen_random_uuid(), 'irgendwas');
    raise exception 'D: unbekannte Stufe angenommen';
  exception when check_violation then null;
  end;
  begin
    insert into public.account_deletion_incidents (user_id, stage, error_message)
    values (gen_random_uuid(), 'stripe', repeat('x', 501));
    raise exception 'D: 501 Zeichen Fehlermeldung angenommen';
  exception when check_violation then null;
  end;
  raise notice 'D: Stufe und Laenge geprueft';

  /* ─────────────────────────────────────────────────────────────
     E — Abschiedsmail ohne Nutzer einreihbar, genau einmal
     ───────────────────────────────────────────────────────────── */
  v_mail := public.enqueue_email('account_deleted', 'kunde@werkruf.test', 'account_deleted:test', null, 'Kunde',
                                 '{"companyName":"Test","stripeCancelled":true}'::jsonb);
  if v_mail is null then raise exception 'E: Abschiedsmail nicht eingereiht'; end if;
  if public.enqueue_email('account_deleted', 'kunde@werkruf.test', 'account_deleted:test', null, 'Kunde', '{}'::jsonb) is not null then
    raise exception 'E: zweite Abschiedsmail mit gleichem Schluessel eingereiht';
  end if;
  if (select user_id from public.email_queue where id = v_mail) is not null then
    raise exception 'E: Mail traegt eine user_id';
  end if;
  raise notice 'E: Abschiedsmail ohne Nutzer, idempotent';
end $$;

/* ═══════════════════════════════════════════════════════════════
   F — Rechte, als Wirkung gemessen
   ═══════════════════════════════════════════════════════════════ */
do $$
begin
  if has_table_privilege('authenticated', 'public.account_deletion_incidents', 'SELECT')
     or has_table_privilege('anon', 'public.account_deletion_incidents', 'SELECT')
     or has_table_privilege('authenticated', 'public.account_deletion_incidents', 'INSERT') then
    raise exception 'F: Stoerfalltabelle fuer Browser-Rollen offen';
  end if;
  if not has_table_privilege('service_role', 'public.account_deletion_incidents', 'INSERT') then
    raise exception 'F: service_role darf nicht schreiben — delete-account koennte nichts melden';
  end if;
  raise notice 'F: nur service_role';
end $$;

rollback;
