/* Prueft sanitizeLocationPatch, indem es die echte Funktion ausfuehrt. */
import fs from 'fs';
const quelle = fs.readFileSync('supabase/functions/google-business/google-api-helpers.ts', 'utf8');
const start = quelle.indexOf('export const EDITABLE_LOCATION_FIELDS');
const ende  = quelle.indexOf('export function sanitizeLocationPatch');
const fn    = quelle.slice(ende, quelle.indexOf('\n}\n', ende) + 3);
const rest  = quelle.slice(start, ende);
const js = (rest + fn)
  .replace(/export /g, '')
  .replace(/: Record<string, unknown>/g, '')
  .replace(/: string\[\]/g, '').replace(/: unknown/g, '').replace(/: string/g, '')
  .replace(/: void/g, '').replace(/ as Record<string, unknown>/g, '');

const mod = await import('data:text/javascript,' + encodeURIComponent(js + '\nexport { sanitizeLocationPatch };'));
const { sanitizeLocationPatch } = mod;

let fehler = 0;
const pruefe = (name, bedingung) => {
  console.log(`  ${bedingung ? 'ok    ' : 'FEHLER'} ${name}`);
  if (!bedingung) fehler++;
};

let r = sanitizeLocationPatch({ 'profile.description': 'Neu' });
pruefe('Punktpfad ergibt feine Maske', r.updateMask === 'profile.description');
pruefe('Punktpfad baut verschachtelt auf', r.patch.profile?.description === 'Neu');
pruefe('kein anderes Feld im Patch', Object.keys(r.patch).length === 1);

r = sanitizeLocationPatch({ 'phoneNumbers.primaryPhone': '+49 40 1' });
pruefe('Telefon einzeln', r.updateMask === 'phoneNumbers.primaryPhone');
pruefe('additionalPhones unberuehrt', r.patch.phoneNumbers.additionalPhones === undefined);

r = sanitizeLocationPatch({ 'profile.description': 'A', websiteUri: 'https://x' });
pruefe('mehrere Felder sortiert', r.updateMask === 'profile.description,websiteUri');

r = sanitizeLocationPatch({ title: 'Gehackt', name: 'x', latlng: {} });
pruefe('schreibgeschuetzte Felder verworfen', r.updateMask === '' && Object.keys(r.patch).length === 0);

r = sanitizeLocationPatch({ 'profile.gefaehrlich': 'x' });
pruefe('unbekannter Unterpfad verworfen', r.updateMask === '');

r = sanitizeLocationPatch({ websiteUri: undefined, 'profile.description': 'A' });
pruefe('undefined ignoriert', r.updateMask === 'profile.description');

r = sanitizeLocationPatch({ 'profile.description': null });
pruefe('null wird uebertragen (Loeschen erlaubt)', r.patch.profile.description === null);

console.log(fehler === 0 ? '\nAlle Zusicherungen erfuellt' : `\n${fehler} fehlgeschlagen`);
process.exit(fehler === 0 ? 0 : 1);
