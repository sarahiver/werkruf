/**
 * Mailvorlagen — Datenbank und send-email kennen dieselbe Liste
 *
 * 22.10.2026: Zwei neue Vorlagen in zwei Migrationen. Jede Migration
 * endet mit der Warnung "WIRKUNGSLOS, bis send-email die Vorlage
 * kennt" — denn enqueue_email() nimmt an, was der Check-Constraint
 * erlaubt, und der Worker scheitert dann erst beim Rendern. Dieser
 * Test macht aus der Warnung eine Pruefung: Die JUENGSTE Fassung des
 * Constraints und der TypeScript-Union muessen uebereinstimmen.
 */
import fs from 'fs';
import path from 'path';

const WURZEL = path.resolve(__dirname, '..');

function juengsterConstraint() {
  const ordner = path.join(WURZEL, 'supabase/migrations');
  const dateien = fs.readdirSync(ordner).filter((d) => d.endsWith('.sql')).sort();
  let letzte = null;
  for (const datei of dateien) {
    const text = fs.readFileSync(path.join(ordner, datei), 'utf8');
    const m = text.match(/add constraint email_queue_template_check check \(template = any \(array\[([\s\S]*?)\]\)\)/i);
    if (m) letzte = { datei, liste: [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]) };
  }
  return letzte;
}

function tsUnion() {
  const text = fs.readFileSync(path.join(WURZEL, 'supabase/functions/send-email/index.ts'), 'utf8');
  const m = text.match(/(?:export )?type EmailTemplate =([\s\S]*?);/);
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
}

function renderFaelle() {
  const text = fs.readFileSync(path.join(WURZEL, 'supabase/functions/send-email/index.ts'), 'utf8');
  return [...text.matchAll(/case '([a-z_]+)':/g)].map((x) => x[1]);
}

describe('Mailvorlagen', () => {
  const db = juengsterConstraint();

  it('findet den Check-Constraint in einer Migration', () => {
    expect(db).not.toBeNull();
    expect(db.liste.length).toBeGreaterThan(5);
  });

  it('Datenbank-Constraint und EmailTemplate-Union sind dieselbe Menge', () => {
    expect([...tsUnion()].sort()).toEqual([...db.liste].sort());
  });

  it('jede Vorlage hat einen render()-Fall', () => {
    const faelle = new Set(renderFaelle());
    for (const vorlage of db.liste) expect(faelle.has(vorlage)).toBe(true);
  });

  it('die neuen Vorlagen vom 22.10.2026 sind beidseitig da', () => {
    expect(db.liste).toEqual(expect.arrayContaining(['support_reply', 'consent_reminder']));
  });
});
