-- Abnahme fuer den Zwischenspeicher der Kategorie-Metadaten (Paket C).
--
--   psql -f gbpCategoryMetadata.test.sql
--
-- Setzt voraus, dass 20260930080000_gbp_category_metadata.sql
-- eingespielt ist. Bricht beim ersten fehlgeschlagenen assert ab.

\set ON_ERROR_STOP on

begin;

/* ═══════════════════════════════════════════════════════
   1 — Leerer Cache liefert nichts
   ═══════════════════════════════════════════════════════ */
do $$
begin
  assert public.gbp_category_metadata_get('gcid:plumber', 'de', 'DE') is null,
    'Ohne Eintrag darf nichts zurueckkommen';
end $$;

/* ═══════════════════════════════════════════════════════
   2 — Abgelegter Stand kommt zurueck
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb;
begin
  perform public.gbp_category_metadata_put(
    'gcid:plumber', 'de', 'DE', 'Klempner',
    '[{"serviceTypeId":"job_type_id:leak_repair"}]'::jsonb,
    '[{"hoursTypeId":"ONLINE_SERVICE_HOURS"}]'::jsonb);

  v := public.gbp_category_metadata_get('gcid:plumber', 'de', 'DE');

  assert v is not null, 'Der Stand muss zurueckkommen';
  assert v ->> 'display_name' = 'Klempner', 'Anzeigename';
  assert (v -> 'more_hours_types')::jsonb = '[{"hoursTypeId":"ONLINE_SERVICE_HOURS"}]'::jsonb,
    'moreHoursTypes muessen erhalten bleiben';
  assert (v ->> 'abruf_erfolgreich')::boolean = true, 'Erfolgreich abgelegt';
end $$;

/* ═══════════════════════════════════════════════════════
   3 — Sprache und Region trennen die Staende
   ═══════════════════════════════════════════════════════ */
do $$
declare v_de jsonb; v_en jsonb;
begin
  perform public.gbp_category_metadata_put(
    'gcid:plumber', 'en', 'DE', 'Plumber', '[]'::jsonb, '[]'::jsonb);

  v_de := public.gbp_category_metadata_get('gcid:plumber', 'de', 'DE');
  v_en := public.gbp_category_metadata_get('gcid:plumber', 'en', 'DE');

  assert v_de ->> 'display_name' = 'Klempner', 'Deutscher Stand unveraendert';
  assert v_en ->> 'display_name' = 'Plumber', 'Englischer Stand getrennt';

  assert public.gbp_category_metadata_get('gcid:plumber', 'de', 'AT') is null,
    'Eine andere Region hat einen eigenen Stand';
end $$;

/* ═══════════════════════════════════════════════════════
   4 — Ein veralteter Stand gilt nicht mehr
   ═══════════════════════════════════════════════════════ */
do $$
begin
  update public.gbp_category_metadata
     set geholt_am = now() - interval '8 days'
   where category_name = 'gcid:plumber' and language_code = 'de';

  assert public.gbp_category_metadata_get('gcid:plumber', 'de', 'DE') is null,
    'Nach sieben Tagen muss neu geholt werden';
  assert public.gbp_category_metadata_get('gcid:plumber', 'de', 'DE', '30 days') is not null,
    'Mit laengerer Frist gilt er noch';
end $$;

/* ═══════════════════════════════════════════════════════
   5 — Ein gescheiterter Abruf loescht keinen echten Stand
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb;
begin
  perform public.gbp_category_metadata_put(
    'gcid:electrician', 'de', 'DE', 'Elektriker',
    '[]'::jsonb, '[{"hoursTypeId":"DRIVE_THROUGH"}]'::jsonb);

  perform public.gbp_category_metadata_fail('gcid:electrician', 'de', 'DE', 'HTTP 503');

  select to_jsonb(m) into v from public.gbp_category_metadata m
   where m.category_name = 'gcid:electrician' and m.language_code = 'de';

  /* Der wichtigste Fall: Ein alter, echter Stand ist besser als eine
     leere Liste. Sonst zeigte die Oberflaeche "keine weiteren Zeiten
     verfuegbar", obwohl Google welche hat. */
  assert (v -> 'more_hours_types')::jsonb = '[{"hoursTypeId":"DRIVE_THROUGH"}]'::jsonb,
    'Ein Fehler darf den vorhandenen Stand NICHT ueberschreiben';
  assert v ->> 'letzter_fehler' = 'HTTP 503', 'Der Fehler wird vermerkt';
  assert (v ->> 'abruf_erfolgreich')::boolean = true,
    'Der bestehende Stand bleibt als erfolgreich gekennzeichnet';
end $$;

/* ═══════════════════════════════════════════════════════
   6 — Ein Fehler ohne vorherigen Stand ist erkennbar
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb;
begin
  perform public.gbp_category_metadata_fail('gcid:roofer', 'de', 'DE', 'HTTP 403');

  select to_jsonb(m) into v from public.gbp_category_metadata m
   where m.category_name = 'gcid:roofer';

  assert (v ->> 'abruf_erfolgreich')::boolean = false,
    'Ohne vorherigen Stand wird der Fehler als solcher festgehalten';
  assert jsonb_array_length(v -> 'more_hours_types') = 0, 'Leere Liste';

  /* Und sie darf NICHT als gueltiger Stand gelten. Nach der kurzen
     Wiederholungsfrist wird erneut versucht. */
  assert public.gbp_category_metadata_get('gcid:roofer', 'de', 'DE') is not null,
    'Innerhalb der Wiederholungsfrist wird nicht sofort erneut gefragt';

  update public.gbp_category_metadata
     set geholt_am = now() - interval '20 minutes'
   where category_name = 'gcid:roofer';

  assert public.gbp_category_metadata_get('gcid:roofer', 'de', 'DE') is null,
    'Ein gescheiterter Abruf wird nach 15 Minuten erneut versucht — nicht erst nach sieben Tagen';
end $$;

/* ═══════════════════════════════════════════════════════
   7 — Kategoriewechsel verwirft den Stand
   ═══════════════════════════════════════════════════════ */
do $$
declare v_anzahl integer;
begin
  v_anzahl := public.gbp_category_metadata_invalidate('gcid:plumber');

  assert v_anzahl = 2, 'Beide Sprachstaende der Kategorie werden verworfen';
  assert public.gbp_category_metadata_get('gcid:plumber', 'de', 'DE', '30 days') is null,
    'Danach ist nichts mehr da';
  assert public.gbp_category_metadata_get('gcid:electrician', 'de', 'DE') is not null,
    'Andere Kategorien bleiben unberuehrt';
end $$;

/* ═══════════════════════════════════════════════════════
   8 — Ein neuer Abruf hebt den Fehlerzustand auf
   ═══════════════════════════════════════════════════════ */
do $$
declare v jsonb;
begin
  perform public.gbp_category_metadata_put(
    'gcid:roofer', 'de', 'DE', 'Dachdecker', '[]'::jsonb, '[]'::jsonb);

  select to_jsonb(m) into v from public.gbp_category_metadata m
   where m.category_name = 'gcid:roofer';

  assert (v ->> 'abruf_erfolgreich')::boolean = true, 'Wieder erfolgreich';
  assert v ->> 'letzter_fehler' is null, 'Der alte Fehler ist weg';

  /* Jetzt heisst die leere Liste tatsaechlich: Google bietet fuer
     diese Kategorie keine weiteren Zeiten an. */
  assert jsonb_array_length(v -> 'more_hours_types') = 0, 'Leer, aber belegt';
end $$;

select 'Alle SQL-Zusicherungen erfuellt' as ergebnis;

rollback;
