/*
 * Anbieterangaben — EINE Quelle fuer Impressum, Datenschutzerklaerung
 * (verantwortliche Stelle) und alle weiteren Rechtsseiten.
 *
 * Werte entsprechen dem bisherigen Impressum. Vor dem Merge von Iver zu
 * bestaetigen bzw. zu ergaenzen (siehe PR „Paket A").
 *
 * Felder mit null erscheinen nicht.
 */
export const ANBIETER = Object.freeze({
  name: 'Iver Bohnes',
  namensZusatz: 'geb. Gentz',
  /* Ein Einzelunternehmen ohne Registereintrag fuehrt keinen Firmennamen;
     „WERKRUF" ist der Name des Angebots. */
  angebot: 'WERKRUF',
  strasse: 'Große Freiheit 82',
  plz: '22767',
  ort: 'Hamburg',
  land: 'Deutschland',
  telefon: '+49 176 66631237',
  email: 'info@werkruf.com',
  /* § 19 UStG — Kleinunternehmer. Bei USt-Pflicht: ustIdNr setzen und
     kleinunternehmer auf false. */
  kleinunternehmer: true,
  ustIdNr: null,
  wirtschaftsIdNr: null,
  /* Inhaltlich Verantwortlicher nach § 18 Abs. 2 MStV */
  inhaltlichVerantwortlich: 'Iver Bohnes',
  aufsichtsbehoerdeDatenschutz: {
    name: 'Der Hamburgische Beauftragte für Datenschutz und Informationsfreiheit',
    url: 'https://datenschutz-hamburg.de',
  },
});

export function vollerName(a = ANBIETER) {
  return a.namensZusatz ? `${a.name} (${a.namensZusatz})` : a.name;
}

export function telefonHref(nummer) {
  return `tel:${String(nummer).replace(/[^\d+]/g, '')}`;
}
