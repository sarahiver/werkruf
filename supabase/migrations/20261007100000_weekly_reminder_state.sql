-- 20261007100000_weekly_reminder_state.sql
--
-- Wann verdient dieselbe Aufgabe wieder Aufmerksamkeit?
--
-- DAS PROBLEM
--
-- "5 Fotos hochladen" erscheint jede Woche, solange die Aufgabe offen
-- ist. Nach der dritten Mail liest sie niemand mehr — und die Mail
-- verliert ihre Glaubwuerdigkeit fuer den Fall, in dem wirklich etwas
-- ansteht.
--
-- VIER DINGE, DIE NICHT DASSELBE SIND
--
--   fachlich offen        die Aufgabe besteht
--   im Dashboard sichtbar immer, solange sie offen ist
--   fuer Mail erlaubt     in_weekly_email
--   diese Woche faellig   NEU — entscheidet nur ueber die Mail
--
-- WARUM NICHT cooldown_until
--
-- Das bedeutet "fachlich pausiert", etwa nach einem Wegklicken. Eine
-- Aufgabe, die nur diese Woche nicht gemailt wird, ist etwas anderes:
-- Sie steht weiter im Dashboard und ist weiter zu erledigen.
--
-- WANN DER ZAEHLER STEIGT
--
-- Erst in finish_email, nach bestaetigtem Versand. Nicht beim
-- Einreihen, nicht beim Rendern. Scheitert Brevo, bleibt alles
-- unveraendert — sonst waere eine Aufgabe wochenlang unterdrueckt,
-- obwohl nie eine Mail ankam.
--
-- Und nur die Aufgaben, die in DIESER Mail standen.
--
-- Wiederholbar. Aendert keine Daten.

begin;

/* ═══════════════════════════════════════════════════════════════
   1 — ZUSTAND
   ═══════════════════════════════════════════════════════════════ */

alter table public.events
  add column if not exists weekly_first_sent_at  timestamptz,
  add column if not exists weekly_last_sent_at   timestamptz,
  add column if not exists weekly_reminder_count smallint not null default 0,
  add column if not exists weekly_next_due_at    timestamptz;

comment on column public.events.weekly_reminder_count is
  'Wie oft diese Aufgabe in einer Wochenmail stand. 0 = noch nie. Der Erstversand zaehlt mit, nicht erst die Wiederholung.';

comment on column public.events.weekly_next_due_at is
  'Fruehestens wieder faellig. NULL bei weekly_reminder_count = 0: noch nie gezeigt heisst sofort faellig.';

comment on column public.events.weekly_last_sent_at is
  'Gesetzt NUR in finish_email nach bestaetigtem Versand. Ein gescheiterter Versand laesst alles unveraendert.';

/* Fuer die Auswahl: faellige Aufgaben eines Betriebs. */
create index if not exists events_weekly_faellig_idx
  on public.events (user_id, location_id, weekly_next_due_at)
  where lifecycle in ('new', 'seen', 'opened') and in_weekly_email;

/* ═══════════════════════════════════════════════════════════════
   2 — WANN WIEDER
   ═══════════════════════════════════════════════════════════════ */

/*
 * Der Abstand bis zur naechsten Erinnerung.
 *
 * An einem Ort, damit Auswahl, Fortschreibung und Tests dieselbe
 * Regel verwenden. Die Staffelung wird laenger, weil eine Aufgabe,
 * die dreimal ignoriert wurde, beim vierten Mal nicht dringender
 * geworden ist.
 *
 *   problem, ab Prioritaet 60
 *     Tag 0, +7, dann alle 14
 *     Kuerzer, weil etwas kaputt ist. Kritische Faelle laufen ohnehin
 *     ueber die Sofortmeldung — das hier ist der Nachklang.
 *
 *   growth, ab Prioritaet 40
 *     Tag 0, +7, +14, dann alle 30
 *     Also Tag 0, 7, 21, 51, 81 …
 *
 *   alles darunter ("wenn du Zeit hast")
 *     Tag 0, dann alle 60
 *     Einmal zeigen, dann lange Ruhe. Wer eine Aufgabe mit
 *     Prioritaet 29 woechentlich mailt, erzieht zum Ignorieren.
 */
create or replace function public.weekly_next_due_at(
  p_class    text,
  p_priority smallint,
  p_count    smallint,
  p_last     timestamptz
)
returns timestamptz
language sql
immutable
as $$
  select case
    /* Noch nie gezeigt: sofort faellig. */
    when coalesce(p_count, 0) = 0 or p_last is null then null

    when p_class = 'problem' and coalesce(p_priority, 0) >= 60 then
      p_last + (case when p_count = 1 then interval '7 days'
                     else interval '14 days' end)

    when coalesce(p_priority, 0) >= 40 then
      p_last + (case when p_count = 1 then interval '7 days'
                     when p_count = 2 then interval '14 days'
                     else interval '30 days' end)

    else p_last + interval '60 days'
  end;
$$;

comment on function public.weekly_next_due_at is
  'Wann darf diese Aufgabe wieder in eine Wochenmail? NULL heisst sofort. Eine Definition fuer Auswahl, Fortschreibung und Tests.';

/*
 * Ist sie jetzt faellig?
 *
 * Getrennt von der Berechnung, damit die Auswahl nicht jedes Mal den
 * Abstand neu ausrechnen muss — der gespeicherte Wert genuegt.
 */
create or replace function public.weekly_event_is_due(
  p_next_due timestamptz,
  p_count    smallint
)
returns boolean
language sql
stable
as $$
  select coalesce(p_count, 0) = 0
      or p_next_due is null
      or p_next_due <= pg_catalog.now();
$$;

comment on function public.weekly_event_is_due is
  'Darf diese Aufgabe diese Woche in die Mail? Noch nie gezeigt heisst immer ja.';

/* ═══════════════════════════════════════════════════════════════
   3 — FORTSCHREIBEN
   ═══════════════════════════════════════════════════════════════ */

/*
 * Haelt fest, dass diese Aufgaben in einer Mail standen.
 *
 * Bekommt das Payload der versendeten Mail und liest die Kennungen
 * aus `actions` — nur die, die wirklich drinstanden. Sind fuenf
 * offen und drei in der Mail, bleiben zwei unberuehrt.
 *
 * Eine Mail ohne Aufgaben (ruhige Woche) veraendert nichts: Die
 * Schleife laeuft dann ueber eine leere Liste.
 */
create or replace function public.weekly_mark_sent(p_payload jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_anzahl integer := 0;
begin
  if p_payload is null or p_payload -> 'actions' is null then
    return 0;
  end if;

  with gesendet as (
    select (x ->> 'id')::uuid as id
    from pg_catalog.jsonb_array_elements(p_payload -> 'actions') x
    where x ->> 'id' is not null
  )
  update public.events e
     set weekly_first_sent_at  = coalesce(e.weekly_first_sent_at, pg_catalog.now()),
         weekly_last_sent_at   = pg_catalog.now(),
         weekly_reminder_count = e.weekly_reminder_count + 1,
         weekly_next_due_at    = public.weekly_next_due_at(
                                   e.recommendation_class,
                                   e.priority,
                                   (e.weekly_reminder_count + 1)::smallint,
                                   pg_catalog.now())
    from gesendet g
   where e.id = g.id
     /* Eine inzwischen erledigte Aufgabe bekommt keinen neuen
        Zeitpunkt — sie wird ohnehin nicht mehr ausgespielt. */
     and e.lifecycle in ('new', 'seen', 'opened');

  get diagnostics v_anzahl = row_count;
  return v_anzahl;
end;
$$;

comment on function public.weekly_mark_sent is
  'Schreibt den Erinnerungszustand fort — nur fuer die Aufgaben, die in dieser Mail standen. Wird ausschliesslich aus finish_email aufgerufen.';

revoke all on function public.weekly_mark_sent(jsonb) from public, anon, authenticated;
grant execute on function public.weekly_mark_sent(jsonb) to service_role;

/* ═══════════════════════════════════════════════════════════════
   4 — VERSANDABSCHLUSS
   ═══════════════════════════════════════════════════════════════ */

/* CREATE OR REPLACE, nicht CREATE: Der Schema-Abzug, aus dem diese
   Definition stammt, legt Funktionen neu an. Beim zweiten Einspielen
   scheitert das mit "already exists". */
CREATE OR REPLACE FUNCTION public.finish_email(p_id uuid, p_success boolean, p_provider_id text DEFAULT NULL::text, p_error_code text DEFAULT NULL::text, p_error_message text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_row public.email_queue;
begin
  select * into v_row from public.email_queue where id = p_id for update;
  if not found then return; end if;

  /*
   * Schon versendet?
   *
   * Der Worker kann dieselbe Zeile erneut verarbeiten — bei einem
   * Neustart, bei einer abgelaufenen Sperre, bei einem doppelten
   * Lauf. Ohne diese Pruefung stiege der Erinnerungszaehler mehrfach,
   * und eine Aufgabe verschwaende fuer Wochen aus der Mail, obwohl sie
   * nur einmal verschickt wurde.
   *
   * Der Statuswechsel ist die Idempotenz: Was schon 'sent' ist, wird
   * nicht noch einmal fortgeschrieben.
   */
  if p_success and v_row.status = 'sent' then
    return;
  end if;

  if p_success then
    update public.email_queue
       set status = 'sent', sent_at = now(), provider_id = p_provider_id,
           error_code = null, error_message = null, locked_by = null, locked_at = null
     where id = p_id;

    /*
     * Erst jetzt die Erinnerungen fortschreiben.
     *
     * Nicht beim Einreihen, nicht beim Rendern: Scheitert der Versand,
     * bliebe eine Aufgabe sonst wochenlang unterdrueckt, obwohl nie
     * eine Mail ankam.
     *
     * Und nur die Aufgaben, die TATSAECHLICH in dieser Mail standen.
     * Sind fuenf offen und drei in der Mail, bleiben die anderen zwei
     * unberuehrt — sie gelten weiterhin als nie gezeigt.
     */
    if v_row.template = 'weekly_summary' then
      perform public.weekly_mark_sent(v_row.payload);
    end if;

  elsif v_row.attempts >= v_row.max_attempts then
    update public.email_queue
       set status = 'failed', error_code = p_error_code,
           error_message = left(p_error_message, 1000),
           locked_by = null, locked_at = null
     where id = p_id;

  else
    -- Zurück in die Schlange, mit wachsendem Abstand.
    update public.email_queue
       set status = 'queued',
           scheduled_for = now() + (power(v_row.attempts, 2) * interval '5 minutes'),
           error_code = p_error_code, error_message = left(p_error_message, 1000),
           locked_by = null, locked_at = null
     where id = p_id;
  end if;
end;
$$;

commit;

-- ═══════════════════════════════════════════════════════════════
-- PRUEFUNG
-- ═══════════════════════════════════════════════════════════════
--
-- Wer ist faellig?
--   select title, recommendation_class, priority,
--          weekly_reminder_count as mails, weekly_next_due_at,
--          public.weekly_event_is_due(weekly_next_due_at, weekly_reminder_count) as faellig
--   from public.events
--   where lifecycle in ('new','seen','opened') and in_weekly_email
--   order by priority desc;
--
-- Nach einem Versand:
--   select title, weekly_reminder_count, weekly_last_sent_at, weekly_next_due_at
--   from public.events where weekly_last_sent_at is not null
--   order by weekly_last_sent_at desc;
--
-- Die Staffelung nachrechnen:
--   select n, public.weekly_next_due_at('growth', 60::smallint, n::smallint, now())
--   from generate_series(1,4) n;
--   → +7, +14, +30, +30
