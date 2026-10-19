-- Abnahme fuer die Kontoloeschung (append-only mit enger Ausnahme).
--
--   psql -f kontoloeschung.test.sql
--
-- Setzt 20261019120000_leads_status_geloescht.sql und
-- 20261019130000_kontoloeschung_append_only.sql voraus.
-- Bricht beim ersten fehlgeschlagenen assert ab.
--
-- ═══════════════════════════════════════════════════════════════
-- WAS GEPRUEFT WIRD
-- ═══════════════════════════════════════════════════════════════
--
-- Eine Ausnahme von einer Sicherheitskontrolle ist nur so viel wert
-- wie der Nachweis, dass sie eng ist. Deshalb prueft diese Datei
-- beide Richtungen, und die verbietende Richtung zuerst:
--
--   1  Normales UPDATE auf audit_logs            muss scheitern
--   2  Normales DELETE auf audit_logs            muss scheitern
--   3  Normales UPDATE auf recommendation_events muss scheitern
--   4  Normales DELETE auf recommendation_events muss scheitern
--   5  Kontoloeschung laeuft durch
--   6  CASCADE  — recommendation_events des Nutzers sind weg
--   7  SET NULL — audit_logs bleibt, ohne Personenbezug
--   8  ip_address und user_agent sind geleert
--   9  leads anonymisiert, nicht geloescht
--  10  Ein ZWEITER Nutzer ist voellig unberuehrt
--  11  Nach der Loeschung greift append-only sofort wieder
--  12  Die Markierung ueberlebt die Transaktion nicht
--
-- Pruefung 11 ist die wichtigste. Sie beantwortet die Frage, an der
-- die ganze Konstruktion haengt: Bleibt die Tuer offen stehen?
--
-- Pruefung 12 steht ausserhalb der Transaktion — innerhalb liesse
-- sich das Gegenteil gar nicht zeigen.

begin;

-- ═══════════════════════════════════════════════════════════════
-- AUFBAU
-- ═══════════════════════════════════════════════════════════════
--
-- Zwei Nutzer. Nur der erste wird geloescht; der zweite ist die
-- Gegenprobe gegen eine zu weit greifende Bereinigung.

insert into auth.users (id, email)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'loeschkandidat@example.invalid'),
       ('bbbbbbbb-0000-0000-0000-00000000000b', 'unbeteiligt@example.invalid');

insert into public.user_profiles (id, plan)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'free'),
       ('bbbbbbbb-0000-0000-0000-00000000000b', 'free');

insert into public.audit_logs (user_id, action, ip_address, user_agent)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'test.loeschkandidat',
        '203.0.113.7'::inet, 'Mozilla/5.0 Testbrowser'),
       ('bbbbbbbb-0000-0000-0000-00000000000b', 'test.unbeteiligt',
        '198.51.100.9'::inet, 'Mozilla/5.0 Anderer');

insert into public.events (id, user_id, type, category, priority, title, summary)
values ('eeeeeeee-0000-0000-0000-00000000000a',
        'aaaaaaaa-0000-0000-0000-00000000000a',
        'reviews.none_yet', 'reviews', 50, 'Testereignis', 'Zusammenfassung'),
       ('eeeeeeee-0000-0000-0000-00000000000b',
        'bbbbbbbb-0000-0000-0000-00000000000b',
        'reviews.none_yet', 'reviews', 50, 'Testereignis', 'Zusammenfassung');

insert into public.recommendation_events (event_id, user_id, action)
values ('eeeeeeee-0000-0000-0000-00000000000a',
        'aaaaaaaa-0000-0000-0000-00000000000a', 'created'),
       ('eeeeeeee-0000-0000-0000-00000000000b',
        'bbbbbbbb-0000-0000-0000-00000000000b', 'created');

insert into public.leads (company_name, email, phone, contact_person, status)
values ('Testbetrieb', 'loeschkandidat@example.invalid', '040 123', 'Max Muster', 'converted');


-- ═══════════════════════════════════════════════════════════════
-- 1-4 — VORHER: append-only verbietet alles
-- ═══════════════════════════════════════════════════════════════

do $$
declare
  v_fehler boolean;
begin
  assert coalesce(current_setting('werkruf.konto_loeschung', true), '') <> 'an',
         'Vorbedingung: Markierung ist nicht gesetzt';

  v_fehler := false;
  begin
    update public.audit_logs set action = 'manipuliert'
     where user_id = 'aaaaaaaa-0000-0000-0000-00000000000a';
  exception when others then v_fehler := true;
  end;
  assert v_fehler, '1 — UPDATE auf audit_logs muss scheitern';

  v_fehler := false;
  begin
    delete from public.audit_logs
     where user_id = 'aaaaaaaa-0000-0000-0000-00000000000a';
  exception when others then v_fehler := true;
  end;
  assert v_fehler, '2 — DELETE auf audit_logs muss scheitern';

  v_fehler := false;
  begin
    update public.recommendation_events set action = 'dismissed'
     where user_id = 'aaaaaaaa-0000-0000-0000-00000000000a';
  exception when others then v_fehler := true;
  end;
  assert v_fehler, '3 — UPDATE auf recommendation_events muss scheitern';

  v_fehler := false;
  begin
    delete from public.recommendation_events
     where user_id = 'aaaaaaaa-0000-0000-0000-00000000000a';
  exception when others then v_fehler := true;
  end;
  assert v_fehler, '4 — DELETE auf recommendation_events muss scheitern';

  raise notice '1-4 append-only greift vor der Loeschung';
end $$;


-- ═══════════════════════════════════════════════════════════════
-- 5 — DIE LOESCHUNG
-- ═══════════════════════════════════════════════════════════════

delete from auth.users where id = 'aaaaaaaa-0000-0000-0000-00000000000a';


-- ═══════════════════════════════════════════════════════════════
-- 6-10 — NACHHER: was blieb, was ging
-- ═══════════════════════════════════════════════════════════════

do $$
declare
  v_zeile public.audit_logs;
  v_lead  public.leads;
begin
  assert (select count(*) from auth.users
           where id = 'aaaaaaaa-0000-0000-0000-00000000000a') = 0,
         '5 — der Nutzer ist geloescht';

  assert (select count(*) from public.recommendation_events
           where user_id = 'aaaaaaaa-0000-0000-0000-00000000000a') = 0,
         '6 — CASCADE: recommendation_events sind mitgegangen';

  select * into v_zeile from public.audit_logs
   where action = 'test.loeschkandidat';

  assert v_zeile.id is not null,
         '7 — SET NULL: die Audit-Zeile ist NICHT geloescht worden';
  assert v_zeile.user_id is null,
         '7 — SET NULL: user_id ist entkoppelt';
  assert v_zeile.action = 'test.loeschkandidat',
         '7 — der Vorgang selbst ist unveraendert nachweisbar';
  assert v_zeile.ip_address is null,
         '8 — ip_address ist geleert';
  assert v_zeile.user_agent is null,
         '8 — user_agent ist geleert';

  select * into v_lead from public.leads
   where company_name = 'Testbetrieb';

  assert v_lead.id is not null,       '9 — der Lead existiert noch';
  assert v_lead.email = 'deleted@werkruf.com',
                                      '9 — die E-Mail ist anonymisiert';
  assert v_lead.status = 'deleted',   '9 — der Status ist deleted';
  assert v_lead.company_name = 'Testbetrieb',
                                      '9 — der Firmenname bleibt (Vertriebshistorie)';

  /* Der zweite Nutzer. Haette die Ausnahme zu weit gegriffen oder
     eine Bedingung die falsche Zeile getroffen, faellt es hier auf. */
  assert (select count(*) from auth.users
           where id = 'bbbbbbbb-0000-0000-0000-00000000000b') = 1,
         '10 — der zweite Nutzer existiert noch';
  assert (select count(*) from public.recommendation_events
           where user_id = 'bbbbbbbb-0000-0000-0000-00000000000b') = 1,
         '10 — seine recommendation_events sind unberuehrt';

  select * into v_zeile from public.audit_logs
   where action = 'test.unbeteiligt';
  assert v_zeile.user_id = 'bbbbbbbb-0000-0000-0000-00000000000b',
         '10 — seine Audit-Zeile haengt noch am Nutzer';
  assert v_zeile.ip_address is not null,
         '10 — seine ip_address wurde NICHT geleert';
  assert v_zeile.user_agent is not null,
         '10 — sein user_agent wurde NICHT geleert';

  raise notice '5-10 Loeschung vollstaendig, Nachbar unberuehrt';
end $$;


-- ═══════════════════════════════════════════════════════════════
-- 11 — BLEIBT DIE TUER OFFEN?
-- ═══════════════════════════════════════════════════════════════
--
-- Die entscheidende Pruefung. Wir sind noch in DERSELBEN
-- Transaktion wie die Loeschung, die Markierung ist hier also
-- bewusst noch gesetzt — das ist die dokumentierte Grenze der
-- Konstruktion.
--
-- Geprueft wird deshalb der Fall, der zaehlt: Was passiert in einer
-- Transaktion, in der NICHT geloescht wurde? Dafuer wird die
-- Markierung hier auf ihren Ruhezustand zurueckgesetzt — genau das,
-- was beim COMMIT von selbst geschieht.

do $$
declare
  v_fehler boolean;
begin
  perform set_config('werkruf.konto_loeschung', '', true);

  v_fehler := false;
  begin
    update public.audit_logs set action = 'manipuliert'
     where action = 'test.unbeteiligt';
  exception when others then v_fehler := true;
  end;
  assert v_fehler, '11 — ohne Markierung ist audit_logs wieder unveraenderlich';

  v_fehler := false;
  begin
    delete from public.recommendation_events
     where user_id = 'bbbbbbbb-0000-0000-0000-00000000000b';
  exception when others then v_fehler := true;
  end;
  assert v_fehler, '11 — ohne Markierung ist recommendation_events wieder unveraenderlich';

  raise notice '11 append-only greift nach der Loeschung sofort wieder';
end $$;

rollback;


-- ═══════════════════════════════════════════════════════════════
-- 12 — UEBERLEBT DIE MARKIERUNG DIE TRANSAKTION?
-- ═══════════════════════════════════════════════════════════════
--
-- Ausserhalb der Transaktion, weil sich innerhalb nicht zeigen
-- liesse, was ihr Ende bewirkt. set_config(..., true) ist
-- transaktionslokal; waere das dritte Argument versehentlich false,
-- wuerde die Markierung fuer die gesamte Sitzung stehenbleiben und
-- append-only waere bis zum Verbindungsende ausgehebelt.

do $$
begin
  assert current_setting('werkruf.konto_loeschung', true) is null
      or current_setting('werkruf.konto_loeschung', true) <> 'an',
         '12 — die Markierung ist nach der Transaktion nicht mehr gesetzt';
  raise notice '12 Markierung ueberlebt die Transaktion nicht';
  raise notice 'ALLE PRUEFUNGEN BESTANDEN';
end $$;
