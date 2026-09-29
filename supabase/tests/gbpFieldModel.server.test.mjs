/* Serverseitige Feldpruefung — fuehrt die echten Funktionen aus.
 *
 * Die Oberflaeche sperrt Felder anhand desselben Modells. Verbindlich
 * ist aber diese Seite: Wer die Oberflaeche umgeht, muss hier
 * scheitern. */
import {
  istBearbeitbar, schreibbarePfade, nurGanzeObjekte, unterpfadErlaubt,
} from '../../src/utils/gbpFieldModel.js';

let fehler = 0;
const pruefe = (name, ok) => {
  console.log(`  ${ok ? 'ok    ' : 'FEHLER'} ${name}`);
  if (!ok) fehler++;
};

const standort = (metadata = {}) => ({
  google_profile: {
    regularHours: { periods: [] },
    metadata: { hasVoiceOfMerchant: true, canModifyServiceList: true, ...metadata },
  },
});

/* ── Die Listen, aus denen sanitizeLocationPatch seine Regeln zieht ── */
pruefe('title nicht schreibbar (Produktentscheidung)',
  !schreibbarePfade().includes('title'));
pruefe('name nicht schreibbar (von Google vergeben)',
  !schreibbarePfade().includes('name'));
pruefe('phoneNumbers nur als Ganzes',
  nurGanzeObjekte().includes('phoneNumbers'));
pruefe('categories nur als Ganzes',
  nurGanzeObjekte().includes('categories'));
pruefe('profile.description als Unterpfad erlaubt',
  unterpfadErlaubt().includes('profile.description'));
pruefe('kein Telefon-Unterpfad in der Erlaubnisliste',
  !unterpfadErlaubt().includes('phoneNumbers.primaryPhone'));

/* ── Betriebsspezifisch ── */
pruefe('websiteUri bei vollen Rechten erlaubt',
  istBearbeitbar('websiteUri', standort()).erlaubt === true);
pruefe('ohne Voice of Merchant gesperrt',
  istBearbeitbar('websiteUri', standort({ hasVoiceOfMerchant: false })).code === 'keine_voice_of_merchant');
pruefe('serviceItems ohne canModifyServiceList gesperrt',
  istBearbeitbar('serviceItems', standort({ canModifyServiceList: false })).code === 'voraussetzung_fehlt');
pruefe('title mit eigenem Code gesperrt',
  istBearbeitbar('title', standort()).code === 'nicht_in_werkruf');
pruefe('unbekanntes Feld abgewiesen',
  istBearbeitbar('__angriff__', standort()).code === 'unbekannt');
pruefe('fehlende Metadaten sperren nicht',
  istBearbeitbar('websiteUri', {}).erlaubt === true);

/* ── Abhaengigkeit ── */
const ohneRegular = { google_profile: { metadata: { hasVoiceOfMerchant: true } } };
pruefe('specialHours ohne regularHours gesperrt',
  istBearbeitbar('specialHours', ohneRegular).code === 'abhaengigkeit_fehlt');
pruefe('specialHours mit regularHours erlaubt',
  istBearbeitbar('specialHours', standort()).erlaubt === true);

console.log(fehler === 0 ? '\nAlle Zusicherungen erfuellt' : `\n${fehler} fehlgeschlagen`);
process.exit(fehler === 0 ? 0 : 1);
