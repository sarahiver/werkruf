/* ═══════════════════════════════════════════════════════════════════════════
   KI-BEWERTUNGSANTWORTEN

   Eigenständige Function. Bewusst NICHT in google-business hineingebaut:
   diese Aufgabe braucht weder OAuth noch Tokens noch den Google-Client —
   nur Anthropic, die Datenbank und die Session. Getrennt bleibt die
   Datei überschaubar und der Blast-Radius bei Änderungen klein.

   Ersetzt die bestehende Function 'generate-review-reply'.
   Der Antwortkörper bleibt abwärtskompatibel: das Feld `reply` gibt es
   weiterhin, das bestehende Dashboard läuft ohne Änderung weiter.

   ⚠️  "Verify JWT" kann hier AN bleiben — anders als bei google-business
       gibt es keinen Callback von aussen.

   MODELLWAHL: claude-haiku-4-5
   Eine Bewertungsantwort ist kurz, sprachlich anspruchsvoll, aber
   fachlich einfach. Haiku 4.5 kostet $1 / $5 je Million Tokens
   (Ein-/Ausgabe) und ist damit das günstigste aktuelle Modell.
   Rechnung pro Antwort: ~700 Eingabe- und ~250 Ausgabe-Tokens
   ≈ $0,0019. Bei 10.000 Antworten im Monat also rund 19 $.
   Zum Vergleich kostet dieselbe Menge auf Sonnet 5 etwa das Doppelte
   bis Dreifache, ohne dass die Aufgabe davon profitiert.

   Nicht genutzt, aber erwähnenswert:
   - Prompt Caching greift bei Haiku 4.5 erst ab 4.096 Tokens
     Systemprompt. Unserer ist kleiner, also bringt es hier nichts.
   - Die Batch-API halbiert die Kosten, taugt aber nur für
     vorproduzierte Antworten, nicht für den Klick im Dashboard.
═══════════════════════════════════════════════════════════════════════════ */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

/* ═══════════════════════════════════════════════════════════════
   1 — TYPEN
═══════════════════════════════════════════════════════════════ */

export type StarRating = 1 | 2 | 3 | 4 | 5;

/** Anrede. Handwerk siezt, Gastro duzt oft — deshalb konfigurierbar. */
export type Addressing = 'sie' | 'du';

export type ReplyTone =
  | 'entschuldigend'      // 1
  | 'ernstnehmend'        // 2
  | 'ausgleichend'        // 3
  | 'dankend'             // 4
  | 'herzlich';           // 5

/**
 * Fakten, die im Text vorkommen DÜRFEN.
 *
 * Der zentrale Hebel gegen Erfindungen: Das Modell bekommt eine
 * abgeschlossene Liste dessen, was wahr ist. Alles andere ist ihm
 * untersagt. Ohne diese Liste erfindet jedes Sprachmodell früher oder
 * später Öffnungszeiten, Rabatte oder Mitarbeiternamen.
 */
export interface CompanyFacts {
  companyName: string;
  industry?: string;
  contactEmail?: string;
  contactPhone?: string;
  /** Freitext, z.B. "Wir arbeiten mit Festpreisgarantie." */
  additionalFacts?: string[];
}

export interface GenerateReplyInput {
  reviewText: string | null;
  reviewerName: string | null;
  rating: StarRating;
  facts: CompanyFacts;
  addressing?: Addressing;
  /** Wenn gesetzt, wird der Entwurf in review_replies gespeichert. */
  reviewId?: string;
}

/** Strukturierte Antwort — das ist der Vertrag nach aussen. */
export interface GeneratedReply {
  reply: string;
  tone: ReplyTone;
  rating: StarRating;
  characterCount: number;
  /**
   * true, wenn ein Mensch draufschauen sollte, bevor das
   * veröffentlicht wird. Das Modell setzt das selbst, zusätzlich
   * erzwingen wir es bei 1 und 2 Sternen.
   */
  requiresHumanReview: boolean;
  /** Was im Text steckt, das Aufmerksamkeit braucht. */
  detectedIssues: string[];
  language: 'de';
  model: string;
  /** Nur gesetzt, wenn reviewId übergeben wurde. */
  replyId?: string;
  usage: { inputTokens: number; outputTokens: number; estimatedCostUsd: number };
}

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface AnthropicResponse {
  content: Array<{ type: string; text?: string }>;
  usage: { input_tokens: number; output_tokens: number };
  stop_reason: string;
}

/* ═══════════════════════════════════════════════════════════════
   2 — FEHLER
═══════════════════════════════════════════════════════════════ */

type ReplyErrorCode =
  | 'config_error' | 'unauthenticated' | 'bad_request'
  | 'model_error' | 'model_overloaded' | 'rate_limited'
  | 'invalid_model_output' | 'not_found' | 'internal_error';

const STATUS_BY_CODE: Record<ReplyErrorCode, number> = {
  config_error: 500, unauthenticated: 401, bad_request: 400,
  model_error: 502, model_overloaded: 503, rate_limited: 429,
  invalid_model_output: 502, not_found: 404, internal_error: 500,
};

const SAFE_MESSAGES: Partial<Record<ReplyErrorCode, string>> = {
  unauthenticated: 'Nicht eingeloggt.',
  bad_request: 'Die Anfrage war unvollständig.',
  model_overloaded: 'Die KI ist gerade ausgelastet. Bitte gleich noch einmal versuchen.',
  rate_limited: 'Zu viele Anfragen. Bitte einen Moment warten.',
  not_found: 'Die Bewertung wurde nicht gefunden.',
};

class ReplyError extends Error {
  constructor(
    readonly code: ReplyErrorCode,
    message: string,
    readonly options: { cause?: unknown; context?: Record<string, unknown> } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'ReplyError';
  }

  get status(): number { return STATUS_BY_CODE[this.code]; }

  toPublic() {
    return {
      error: {
        code: this.code,
        message: SAFE_MESSAGES[this.code] ?? 'Es ist ein Fehler aufgetreten. Bitte später erneut versuchen.',
        retryable: this.status >= 500 || this.status === 429,
      },
    };
  }
}

/* ═══════════════════════════════════════════════════════════════
   3 — KONFIGURATION & LOGGING
═══════════════════════════════════════════════════════════════ */

const MODEL = 'claude-haiku-4-5';
const ANTHROPIC_VERSION = '2023-06-01';
const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';

/** Preis je Million Tokens, für die Kostenschätzung in der Antwort. */
const PRICE_INPUT_PER_MTOK = 1.00;
const PRICE_OUTPUT_PER_MTOK = 5.00;

/** Harte Obergrenze aus der Anforderung. */
const MAX_REPLY_CHARS = 1000;
/** Zielkorridor — darunter wirkt eine Antwort abgefertigt. */
const MIN_REPLY_CHARS = 120;

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new ReplyError('config_error', `Fehlende Umgebungsvariable: ${name}`);
  return value;
}

interface Logger {
  debug(event: string, data?: Record<string, unknown>): void;
  warn(event: string, data?: Record<string, unknown>): void;
  error(event: string, data?: Record<string, unknown>): void;
}

/**
 * Strukturierte Logs. Enthalten NIE den Bewertungstext oder den
 * generierten Entwurf — das sind personenbezogene Daten Dritter,
 * die nichts in Betriebsprotokollen zu suchen haben.
 */
function createLogger(scope: string): Logger {
  const emit = (level: string, event: string, data: Record<string, unknown> = {}) =>
    console[level === 'debug' ? 'log' : level as 'warn' | 'error'](
      JSON.stringify({ scope, level, event, ts: new Date().toISOString(), ...data }),
    );
  return {
    debug: (e, d) => emit('debug', e, d),
    warn:  (e, d) => emit('warn',  e, d),
    error: (e, d) => emit('error', e, d),
  };
}

/* ═══════════════════════════════════════════════════════════════
   4 — ANTHROPIC-CLIENT

   Dünne Hülle um den Messages-Endpunkt. Kennt keine Bewertungen,
   nur Nachrichten hinein und Text heraus.
═══════════════════════════════════════════════════════════════ */

class AnthropicClient {
  private static readonly MAX_ATTEMPTS = 3;

  constructor(
    private readonly apiKey: string,
    private readonly log: Logger,
  ) {}

  async complete(params: {
    system: string;
    messages: AnthropicMessage[];
    maxTokens?: number;
    temperature?: number;
    /** Erzwingt einen JSON-Start und spart das Vorgeplänkel. */
    prefill?: string;
  }): Promise<{ text: string; usage: { inputTokens: number; outputTokens: number } }> {
    const messages = params.prefill
      ? [...params.messages, { role: 'assistant' as const, content: params.prefill }]
      : params.messages;

    let lastError: ReplyError | null = null;

    for (let attempt = 1; attempt <= AnthropicClient.MAX_ATTEMPTS; attempt++) {
      let response: Response;

      try {
        response = await fetch(ANTHROPIC_ENDPOINT, {
          method: 'POST',
          headers: {
            'x-api-key': this.apiKey,
            'anthropic-version': ANTHROPIC_VERSION,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: MODEL,
            max_tokens: params.maxTokens ?? 700,
            // Niedrig, aber nicht null: Antworten sollen nicht bei
            // jedem Kunden wortgleich klingen, aber auch nicht
            // ausufern. 0.6 trifft das gut.
            temperature: params.temperature ?? 0.6,
            system: params.system,
            messages,
          }),
        });
      } catch (cause) {
        lastError = new ReplyError('model_error', 'Anthropic nicht erreichbar', { cause });
        this.log.warn('network_error', { attempt });
        await this.sleep(attempt);
        continue;
      }

      if (response.ok) {
        const body = (await response.json()) as AnthropicResponse;

        if (body.stop_reason === 'max_tokens') {
          // Abgeschnittene Antwort ist unbrauchbar — lieber Fehler als
          // ein halber Satz, der veröffentlicht wird.
          throw new ReplyError('invalid_model_output', 'Antwort wurde abgeschnitten');
        }

        const text = body.content
          .filter((block) => block.type === 'text')
          .map((block) => block.text ?? '')
          .join('');

        return {
          text: params.prefill ? params.prefill + text : text,
          usage: { inputTokens: body.usage.input_tokens, outputTokens: body.usage.output_tokens },
        };
      }

      const detail = await this.readError(response);
      this.log.warn('model_call_failed', { status: response.status, attempt, detail });

      if (response.status === 429 || response.status === 529 || response.status >= 500) {
        lastError = new ReplyError(
          response.status === 429 ? 'rate_limited' : 'model_overloaded',
          `Anthropic antwortete mit ${response.status}`,
          { context: { detail } },
        );
        if (attempt < AnthropicClient.MAX_ATTEMPTS) {
          await this.sleep(attempt, response.headers.get('retry-after'));
          continue;
        }
        break;
      }

      // 400/401/403 — Konfigurationsfehler, Wiederholung sinnlos.
      throw new ReplyError('model_error', `Anthropic ${response.status}: ${detail}`, {
        context: { status: response.status },
      });
    }

    throw lastError ?? new ReplyError('model_error', 'Modellaufruf fehlgeschlagen');
  }

  private async readError(response: Response): Promise<string> {
    try {
      const body = await response.json();
      return body?.error?.message ?? `HTTP ${response.status}`;
    } catch {
      return `HTTP ${response.status}`;
    }
  }

  private sleep(attempt: number, retryAfter?: string | null): Promise<void> {
    if (retryAfter) {
      const seconds = Number(retryAfter);
      if (Number.isFinite(seconds)) {
        return new Promise((r) => setTimeout(r, Math.min(seconds * 1000, 8000)));
      }
    }
    // Voller Jitter, damit nicht alle Wiederholungen im Gleichtakt laufen.
    const ceiling = Math.min(400 * 2 ** (attempt - 1), 6000);
    return new Promise((r) => setTimeout(r, Math.random() * ceiling));
  }
}

/* ═══════════════════════════════════════════════════════════════
   5 — PROMPTBAU

   Pro Sternzahl eine eigene Haltung. Der Unterschied zwischen einer
   brauchbaren und einer peinlichen Antwort liegt fast vollständig
   hier, nicht im Modell.
═══════════════════════════════════════════════════════════════ */

interface ToneProfile {
  tone: ReplyTone;
  /** Anweisung an das Modell — bewusst konkret, nicht "sei freundlich". */
  guidance: string;
  targetChars: [number, number];
  forceHumanReview: boolean;
}

const TONE_PROFILES: Record<StarRating, ToneProfile> = {
  1: {
    tone: 'entschuldigend',
    targetChars: [250, 500],
    forceHumanReview: true,
    guidance: `
Die Bewertung ist vernichtend. Ziel ist NICHT, den Kunden umzustimmen —
das gelingt öffentlich fast nie. Ziel ist, dass jemand, der diese
Bewertung in sechs Monaten liest, den Betrieb trotzdem anruft.

- Bedauern ausdrücken, ohne sich zu verbiegen.
- KEINE Rechtfertigungen, keine Gegendarstellung, kein "aber".
- KEIN Schuldeingeständnis zu konkreten Vorwürfen — was tatsächlich
  passiert ist, weisst du nicht.
- Den Vorfall nicht in eigenen Worten nacherzählen.
- Zur Klärung ausserhalb der Öffentlichkeit einladen; Kontaktweg nur
  nennen, wenn er in den Fakten steht.
- Nicht anbiedern, nicht betteln, keine Rabatte oder Entschädigungen
  anbieten.`,
  },
  2: {
    tone: 'ernstnehmend',
    targetChars: [250, 500],
    forceHumanReview: true,
    guidance: `
Deutliche Unzufriedenheit, aber kein Totalverriss. Meist steckt ein
konkreter Punkt dahinter.

- Die Kritik als berechtigt behandeln, ohne sie zu bewerten.
- Wenn ein konkreter Punkt genannt wird, ihn aufgreifen — aber nur
  benennen, nicht erklären oder entkräften.
- Keine Versprechen für die Zukunft ("das wird nie wieder vorkommen").
- Zum direkten Gespräch einladen.`,
  },
  3: {
    tone: 'ausgleichend',
    targetChars: [200, 450],
    forceHumanReview: false,
    guidance: `
Gemischt. Etwas hat gepasst, etwas nicht.

- Für die ehrliche Rückmeldung danken — die ist wertvoller als jede
  Fünf-Sterne-Bewertung ohne Text.
- Das Positive kurz aufgreifen, wenn es benannt wurde.
- Den Kritikpunkt annehmen, ohne ihn kleinzureden.
- Nicht so klingen, als sei man mit drei Sternen zufrieden.`,
  },
  4: {
    tone: 'dankend',
    targetChars: [150, 350],
    forceHumanReview: false,
    guidance: `
Zufrieden mit kleinem Vorbehalt.

- Kurz halten. Vier Sterne brauchen keinen Aufsatz.
- Danken und, falls ein Verbesserungspunkt genannt wurde, ihn
  freundlich aufnehmen.
- NICHT nach dem fehlenden Stern fragen. Das wirkt fordernd.`,
  },
  5: {
    tone: 'herzlich',
    targetChars: [120, 300],
    forceHumanReview: false,
    guidance: `
Rundum zufrieden.

- Kurz, warm, konkret. Wenn etwas Bestimmtes gelobt wurde, darauf
  eingehen — das unterscheidet eine echte Antwort von einem Baustein.
- Keine Werbung, kein Leistungskatalog, keine Aufforderung zum
  Weiterempfehlen.
- Nicht überschwänglich. Übertriebener Dank wirkt unecht.`,
  },
};

class PromptBuilder {
  buildSystem(input: GenerateReplyInput): string {
    const profile = TONE_PROFILES[input.rating];
    const addressing = input.addressing ?? 'sie';
    const facts = this.renderFacts(input.facts);

    return `Du schreibst öffentliche Antworten auf Google-Bewertungen für ${input.facts.companyName}${input.facts.industry ? `, ${input.facts.industry}` : ''}.

SPRACHE UND FORM
- Deutsch. ${addressing === 'sie' ? 'Siezen.' : 'Duzen.'}
- Schreibe wie ein Mensch, der den Betrieb führt — nicht wie eine
  Marketingabteilung. Kurze Sätze. Keine Floskeln wie "Ihr Feedback
  ist uns wichtig" oder "wir bedauern die Unannehmlichkeiten".
- Keine Emojis, keine Ausrufezeichenketten, keine Hashtags.
- Kein Textbaustein-Klang: die Antwort muss zu DIESER Bewertung passen.
- Zielumfang: ${profile.targetChars[0]}–${profile.targetChars[1]} Zeichen.
  Absolute Obergrenze: ${MAX_REPLY_CHARS} Zeichen.

WAS DU WISSEN DARFST
${facts}

Das ist alles. Du darfst NICHTS erfinden, was nicht oben steht oder in
der Bewertung selbst vorkommt. Keine Namen von Mitarbeitenden, keine
Termine, keine Preise, keine Öffnungszeiten, keine Zusagen, keine
Rabatte, keine Details zum geschilderten Vorgang. Wenn dir etwas fehlt,
schreibe allgemeiner — niemals konkreter, als du belegen kannst.

HALTUNG BEI ${input.rating} ${input.rating === 1 ? 'STERN' : 'STERNEN'}
${profile.guidance}

AUSGABEFORMAT
Antworte ausschliesslich mit einem JSON-Objekt, ohne Markdown-Zäune,
ohne Vor- oder Nachtext:

{
  "reply": "<die fertige Antwort auf Deutsch>",
  "requiresHumanReview": <true|false>,
  "detectedIssues": ["<kurze Stichworte>"]
}

requiresHumanReview auf true setzen, wenn die Bewertung eines der
folgenden Merkmale hat: Vorwurf einer Straftat, rechtliche Drohung,
Gesundheits- oder Sicherheitsthema, Verdacht auf eine gefälschte
Bewertung, Nennung namentlich genannter Personen, oder etwas, das
ohne interne Kenntnis nicht beantwortbar ist.

detectedIssues enthält kurze deutsche Stichworte dazu, sonst [].`;
  }

  buildUser(input: GenerateReplyInput): string {
    const name = input.reviewerName?.trim();
    const text = input.reviewText?.trim();

    const parts = [
      `Sterne: ${input.rating} von 5`,
      `Name: ${name || '(nicht angegeben)'}`,
    ];

    if (text) {
      parts.push(`Bewertungstext:\n"""\n${text}\n"""`);
    } else {
      // Häufiger Fall: Sternbewertung ohne Text. Das Modell muss
      // wissen, dass da nichts fehlt, sonst halluziniert es Inhalte.
      parts.push(
        'Bewertungstext: (keiner — der Kunde hat nur Sterne vergeben)\n' +
        'Halte die Antwort entsprechend allgemein und kurz. Gehe auf ' +
        'nichts Konkretes ein, es wurde nichts geschildert.',
      );
    }

    return parts.join('\n');
  }

  private renderFacts(facts: CompanyFacts): string {
    const lines = [`- Name des Betriebs: ${facts.companyName}`];
    if (facts.industry)     lines.push(`- Branche: ${facts.industry}`);
    if (facts.contactEmail) lines.push(`- E-Mail für Rückfragen: ${facts.contactEmail}`);
    if (facts.contactPhone) lines.push(`- Telefon für Rückfragen: ${facts.contactPhone}`);
    for (const fact of facts.additionalFacts ?? []) lines.push(`- ${fact}`);
    return lines.join('\n');
  }
}

/* ═══════════════════════════════════════════════════════════════
   6 — PRÜFUNG

   Zweite Verteidigungslinie. Der Prompt sagt dem Modell, was es nicht
   tun soll; der Validator prüft, ob es sich daran gehalten hat.
═══════════════════════════════════════════════════════════════ */

interface ValidationResult {
  ok: boolean;
  problems: string[];
  /** Bereinigter Text (Zäune entfernt, Leerraum normalisiert). */
  cleaned: string;
}

class ReplyValidator {
  constructor(private readonly facts: CompanyFacts) {}

  validate(reply: string): ValidationResult {
    const cleaned = reply
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```\s*$/, '')
      .replace(/[ \t]+\n/g, '\n')
      .trim();

    const problems: string[] = [];

    if (cleaned.length === 0) problems.push('leer');
    if (cleaned.length > MAX_REPLY_CHARS) problems.push(`zu lang (${cleaned.length} Zeichen)`);
    if (cleaned.length > 0 && cleaned.length < MIN_REPLY_CHARS) problems.push('zu kurz');

    // Nicht ersetzte Platzhalter — passiert, wenn das Modell in einen
    // Vorlagenmodus kippt.
    if (/\[[^\]]{2,40}\]|\{\{[^}]+\}\}|<[A-ZÄÖÜ][a-zäöü]+>/.test(cleaned)) {
      problems.push('enthält Platzhalter');
    }

    /* Erfundene Kontaktdaten.
       Der wirksamste automatisch prüfbare Test gegen Halluzinationen:
       Telefonnummern, E-Mail-Adressen und URLs dürfen nur vorkommen,
       wenn sie in den übergebenen Fakten stehen. Alles andere hat das
       Modell erfunden. */
    for (const match of cleaned.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) ?? []) {
      if (match !== this.facts.contactEmail) problems.push(`erfundene E-Mail: ${match}`);
    }
    for (const match of cleaned.match(/(?:\+49|0)[\d\s/()-]{7,}\d/g) ?? []) {
      const normalize = (value: string) => value.replace(/[^\d]/g, '');
      if (!this.facts.contactPhone || normalize(match) !== normalize(this.facts.contactPhone)) {
        problems.push('erfundene Telefonnummer');
      }
    }
    if (/https?:\/\/|www\./i.test(cleaned)) problems.push('enthält eine URL');

    // Preise und Prozentangaben — fast immer erfunden.
    if (/\d+\s?(?:€|EUR|Euro|Prozent|%)/i.test(cleaned)) {
      problems.push('nennt Beträge oder Prozente');
    }

    if (/als (?:KI|AI|Sprachmodell)/i.test(cleaned)) problems.push('bricht die Rolle');

    return { ok: problems.length === 0, problems, cleaned };
  }
}

/* ═══════════════════════════════════════════════════════════════
   7 — REPOSITORY
═══════════════════════════════════════════════════════════════ */

/** Ausschnitt aus google_reviews, den der Entwurf braucht. */
interface ReviewContext {
  id: string;
  location_id: string;
  star_rating: number;
  comment: string | null;
  reviewer_display_name: string | null;
}

let cachedAdmin: SupabaseClient | null = null;

function adminClient(): SupabaseClient {
  if (cachedAdmin) return cachedAdmin;
  cachedAdmin = createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cachedAdmin;
}

class ReplyRepository {
  constructor(private readonly db = adminClient()) {}

  /**
   * Bewertung samt Standort laden — und dabei prüfen, dass sie diesem
   * Nutzer gehört. Die Service Role umgeht RLS, also muss die
   * Zugriffsprüfung hier im Code stehen.
   */
  async getReviewForUser(reviewId: string, userId: string): Promise<ReviewContext> {
    const { data, error } = await this.db
      .from('google_reviews')
      .select('id, location_id, star_rating, comment, reviewer_display_name')
      .eq('id', reviewId).eq('user_id', userId).maybeSingle();

    if (error) throw new ReplyError('internal_error', 'Bewertung nicht ladbar', { cause: error });
    if (!data) throw new ReplyError('not_found', 'Bewertung nicht gefunden');
    return data as ReviewContext;
  }

  /**
   * Entwurf speichern. Immer als 'draft' — veröffentlicht wird
   * ausschliesslich über den separaten publish_reply-Job, nachdem ein
   * Mensch zugestimmt hat.
   */
  async saveDraft(input: {
    reviewId: string; locationId: string; userId: string;
    body: string; model: string;
  }): Promise<string> {
    const { data, error } = await this.db.from('review_replies').insert({
      review_id: input.reviewId,
      location_id: input.locationId,
      user_id: input.userId,
      body: input.body,
      source: 'ai',
      model: input.model,
      status: 'draft',
      created_by: input.userId,
    }).select('id').single();

    if (error) throw new ReplyError('internal_error', 'Entwurf nicht speicherbar', { cause: error });
    return (data as { id: string }).id;
  }

  async writeAuditLog(entry: {
    userId: string; action: string; entityId: string;
    metadata: Record<string, unknown>;
  }): Promise<void> {
    try {
      await this.db.from('audit_logs').insert({
        user_id: entry.userId,
        actor_type: 'user',
        actor_id: entry.userId,
        action: entry.action,
        entity_type: 'review_reply',
        entity_id: entry.entityId,
        metadata: entry.metadata,
      });
    } catch (err) {
      console.warn(JSON.stringify({ scope: 'audit', message: String(err) }));
    }
  }
}

/* ═══════════════════════════════════════════════════════════════
   8 — SERVICE
═══════════════════════════════════════════════════════════════ */

class ReviewReplyService {
  private readonly prompts = new PromptBuilder();

  constructor(
    private readonly model: AnthropicClient,
    private readonly repo: ReplyRepository,
    private readonly log: Logger,
  ) {}

  async generate(input: GenerateReplyInput, userId: string): Promise<GeneratedReply> {
    const profile = TONE_PROFILES[input.rating];
    const validator = new ReplyValidator(input.facts);

    const system = this.prompts.buildSystem(input);
    const user = this.prompts.buildUser(input);

    let attempt = 0;
    let messages: AnthropicMessage[] = [{ role: 'user', content: user }];
    let totalInput = 0, totalOutput = 0;

    // Höchstens zwei Anläufe: der zweite bekommt die Beanstandungen
    // des ersten mitgeteilt. Mehr lohnt nicht — wenn es zweimal
    // schiefgeht, stimmt etwas Grundsätzliches nicht.
    while (attempt < 2) {
      attempt++;

      const { text, usage } = await this.model.complete({
        system,
        messages,
        maxTokens: 700,
        prefill: '{',   // erzwingt JSON statt Einleitungssatz
      });

      totalInput += usage.inputTokens;
      totalOutput += usage.outputTokens;

      const parsed = this.parse(text);
      const validation = validator.validate(parsed.reply);

      if (validation.ok) {
        return this.finalize({
          input, userId, profile, validation, parsed,
          usage: { inputTokens: totalInput, outputTokens: totalOutput },
        });
      }

      this.log.warn('validation_failed', {
        attempt, rating: input.rating, problems: validation.problems,
      });

      if (attempt >= 2) {
        // Zweiter Versuch ebenfalls beanstandet. Wir liefern trotzdem
        // etwas, aber mit erzwungener Freigabe durch einen Menschen —
        // besser ein markierter Entwurf als gar keiner.
        const truncated = validation.cleaned.slice(0, MAX_REPLY_CHARS);
        return this.finalize({
          input, userId, profile,
          validation: { ...validation, cleaned: truncated },
          parsed: {
            ...parsed,
            requiresHumanReview: true,
            detectedIssues: [...parsed.detectedIssues, ...validation.problems],
          },
          usage: { inputTokens: totalInput, outputTokens: totalOutput },
        });
      }

      messages = [
        ...messages,
        { role: 'assistant', content: text },
        {
          role: 'user',
          content:
            `Der Entwurf wurde beanstandet: ${validation.problems.join('; ')}.\n` +
            `Schreibe ihn neu und behebe genau diese Punkte. ` +
            `Halte dich strikt an ${profile.targetChars[0]}–${profile.targetChars[1]} Zeichen ` +
            `und an die Regel, nichts zu erfinden. Antworte wieder nur mit dem JSON-Objekt.`,
        },
      ];
    }

    throw new ReplyError('invalid_model_output', 'Kein verwertbarer Entwurf');
  }

  /** Modellausgabe in ein Objekt überführen. */
  private parse(text: string): { reply: string; requiresHumanReview: boolean; detectedIssues: string[] } {
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();

    try {
      const parsed = JSON.parse(cleaned);
      if (typeof parsed.reply !== 'string') {
        throw new Error('Feld reply fehlt oder ist kein String');
      }
      return {
        reply: parsed.reply,
        requiresHumanReview: parsed.requiresHumanReview === true,
        detectedIssues: Array.isArray(parsed.detectedIssues)
          ? parsed.detectedIssues.filter((i: unknown) => typeof i === 'string').slice(0, 8)
          : [],
      };
    } catch (cause) {
      this.log.error('parse_failed', { length: cleaned.length });
      throw new ReplyError('invalid_model_output', 'Modellantwort war kein gültiges JSON', { cause });
    }
  }

  private async finalize(args: {
    input: GenerateReplyInput;
    userId: string;
    profile: ToneProfile;
    validation: ValidationResult;
    parsed: { requiresHumanReview: boolean; detectedIssues: string[] };
    usage: { inputTokens: number; outputTokens: number };
  }): Promise<GeneratedReply> {
    const { input, userId, profile, validation, parsed, usage } = args;

    // Bei 1 und 2 Sternen immer Freigabe durch einen Menschen —
    // unabhängig davon, was das Modell meint. Eine unglücklich
    // formulierte Antwort auf eine schlechte Bewertung richtet mehr
    // Schaden an als die Bewertung selbst.
    const requiresHumanReview = parsed.requiresHumanReview || profile.forceHumanReview;

    const estimatedCostUsd =
      (usage.inputTokens / 1_000_000) * PRICE_INPUT_PER_MTOK +
      (usage.outputTokens / 1_000_000) * PRICE_OUTPUT_PER_MTOK;

    const result: GeneratedReply = {
      reply: validation.cleaned,
      tone: profile.tone,
      rating: input.rating,
      characterCount: validation.cleaned.length,
      requiresHumanReview,
      detectedIssues: parsed.detectedIssues,
      language: 'de',
      model: MODEL,
      usage: { ...usage, estimatedCostUsd: Number(estimatedCostUsd.toFixed(6)) },
    };

    if (input.reviewId) {
      const review = await this.repo.getReviewForUser(input.reviewId, userId);
      result.replyId = await this.repo.saveDraft({
        reviewId: review.id,
        locationId: review.location_id,
        userId,
        body: validation.cleaned,
        model: MODEL,
      });

      await this.repo.writeAuditLog({
        userId, action: 'reply.generated', entityId: result.replyId,
        metadata: {
          rating: input.rating, tone: profile.tone,
          characterCount: result.characterCount,
          requiresHumanReview, model: MODEL,
          inputTokens: usage.inputTokens, outputTokens: usage.outputTokens,
        },
      });
    }

    this.log.debug('reply_generated', {
      rating: input.rating, tone: profile.tone,
      chars: result.characterCount, requiresHumanReview,
      inputTokens: usage.inputTokens, outputTokens: usage.outputTokens,
    });

    return result;
  }
}

/* ═══════════════════════════════════════════════════════════════
   9 — HTTP
═══════════════════════════════════════════════════════════════ */

function corsHeaders(request: Request): Record<string, string> {
  const allowed = (Deno.env.get('GBP_ALLOWED_ORIGINS') ?? '')
    .split(',').map((o: string) => o.trim().replace(/\/$/, '')).filter(Boolean);
  const origin = request.headers.get('Origin');
  const match = origin && allowed.includes(origin.replace(/\/$/, '')) ? origin : (allowed[0] ?? '*');

  return {
    'Access-Control-Allow-Origin': match,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

function jsonResponse(request: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

async function requireUser(request: Request): Promise<{ id: string; email: string | null }> {
  const header = request.headers.get('Authorization');
  if (!header?.startsWith('Bearer ')) throw new ReplyError('unauthenticated', 'Kein Bearer-Token');

  const { data, error } = await adminClient().auth.getUser(header.slice(7).trim());
  if (error || !data?.user) throw new ReplyError('unauthenticated', 'Session ungültig', { cause: error });

  return { id: data.user.id, email: data.user.email ?? null };
}

/** Kürzt und säubert Freitext aus dem Request. */
function clampText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  // Steuerzeichen entfernen — die haben in einem Bewertungstext
  // nichts zu suchen und können Prompt-Strukturen vortäuschen.
  const cleaned = trimmed.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  return cleaned.slice(0, maxLength);
}

/**
 * Betriebsdaten aus dem Profil des Nutzers.
 *
 * Nur was hier steht, darf im generierten Text vorkommen — der
 * Validator prüft Kontaktdaten dagegen. Deshalb NICHT vom Client
 * entgegennehmen.
 */
/**
 * Betriebsdaten für die Antwort.
 *
 * WICHTIG: Die Identität kommt aus dem STANDORT, nicht aus dem Profil.
 *
 * user_profiles hat genau ein company_name — eine Annahme aus der Zeit
 * vor der Google-Anbindung. Führt jemand zwei Betriebe über dasselbe
 * Google-Konto, stünde sonst unter jeder Antwort derselbe Name, und
 * die Antwort auf eine Café-Bewertung würde "Müller Sanitär" sagen.
 *
 * google_locations führt Name, Adresse und Telefon je Standort — das
 * ist die richtige Quelle. Das Profil greift nur als Rückfallebene,
 * solange noch kein Standort synchronisiert ist.
 */
async function loadCompanyFacts(
  userId: string,
  sessionEmail: string | null,
  reviewId?: string,
): Promise<CompanyFacts> {
  /* ── Weg 1: über die Bewertung zum Standort ── */
  if (reviewId) {
    const { data } = await adminClient()
      .from('google_reviews')
      .select('google_locations(title, locality, primary_phone, primary_category)')
      .eq('id', reviewId).eq('user_id', userId)
      .maybeSingle();

    // PostgREST liefert die eingebettete Relation als Objekt oder Array.
    const raw = (data as { google_locations?: unknown } | null)?.google_locations;
    const location = (Array.isArray(raw) ? raw[0] : raw) as {
      title?: string | null; locality?: string | null;
      primary_phone?: string | null; primary_category?: string | null;
    } | null | undefined;

    if (location?.title) {
      return {
        companyName:  location.title,
        industry:     location.primary_category ?? undefined,
        contactEmail: sessionEmail ?? undefined,
        contactPhone: location.primary_phone ?? undefined,
      };
    }
  }

  /* ── Weg 2: Rückfall aufs Profil ──
     Greift, solange kein Standort synchronisiert ist oder die Antwort
     ohne reviewId erzeugt wird (Vorschau im Dashboard). */
  const { data, error } = await adminClient()
    .from('user_profiles')
    .select('company_name, industry_key')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    throw new ReplyError('internal_error', 'Profil nicht ladbar', { cause: error });
  }

  const profile = (data ?? {}) as { company_name?: string | null; industry_key?: string | null };
  const companyName = (profile.company_name ?? '').trim();

  if (!companyName) {
    throw new ReplyError('bad_request', 'Kein Betriebsname hinterlegt');
  }

  let trade: string | undefined;
  let phone: string | undefined;

  if (sessionEmail) {
    const { data: lead } = await adminClient()
      .from('leads').select('trade, phone')
      .eq('email', sessionEmail)
      .order('created_at', { ascending: false })
      .limit(1).maybeSingle();

    const row = lead as { trade?: string | null; phone?: string | null } | null;
    trade = row?.trade ?? undefined;
    // "-" ist der Platzhalter aus saveManualLead — keine echte Nummer.
    phone = row?.phone && row.phone !== '-' ? row.phone : undefined;
  }

  return {
    companyName,
    industry:     trade ?? profile.industry_key ?? undefined,
    contactEmail: sessionEmail ?? undefined,
    contactPhone: phone,
    // additionalFacts kommt bewusst NICHT vom Client: es landet
    // wörtlich im Systemprompt und wäre ein offenes Tor für
    // eingeschleuste Anweisungen.
  };
}

/** Aufrufbremse, in der Datenbank gezählt — siehe Migration 007. */
async function enforceRateLimit(key: string, limit: number, windowInterval = '1 hour'): Promise<void> {
  const { data, error } = await adminClient().rpc('check_rate_limit', {
    p_key: key, p_limit: limit, p_window: windowInterval,
  });

  // Bei einem Fehler in der Bremse nicht durchlassen.
  if (error) throw new ReplyError('internal_error', 'Limitprüfung fehlgeschlagen', { cause: error });

  if (!(data as { allowed: boolean }).allowed) {
    throw new ReplyError('rate_limited', 'Limit erreicht');
  }
}

function parseRating(value: unknown): StarRating {
  const rating = Number(value);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new ReplyError('bad_request', 'rating muss zwischen 1 und 5 liegen');
  }
  return rating as StarRating;
}

/* ═══════════════════════════════════════════════════════════════
   10 — EINSTIEG
═══════════════════════════════════════════════════════════════ */

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }
  if (request.method !== 'POST') {
    return jsonResponse(request, {
      error: { code: 'bad_request', message: 'Nur POST.', retryable: false },
    }, 405);
  }

  const log = createLogger('review-reply');

  try {
    const user = await requireUser(request);

    /* ── Bremse ──
       Ohne die kann jeder eingeloggte Nutzer den Endpunkt in einer
       Schleife aufrufen und entweder Anthropic-Kosten verbrennen oder
       ihn schlicht als kostenloses Sprachmodell zweckentfremden. */
    await enforceRateLimit(`review_reply:${user.id}`, 60);

    const body = await request.json();

    /* ── Fakten SERVERSEITIG bestimmen ──
       Vorher kamen companyName, industry und Kontaktdaten vom Client
       und gingen ungeprüft in den Systemprompt. Damit liess sich der
       Prompt beliebig erweitern — und der Validator, der erfundene
       Kontaktdaten erkennt, war ausgehebelt: was in den Fakten steht,
       gilt als wahr. Jetzt stammen sie aus dem Profil des Nutzers. */
    const reviewId = typeof body.reviewId === 'string' && body.reviewId.length <= 64
      ? body.reviewId : undefined;

    const facts = await loadCompanyFacts(user.id, user.email, reviewId);

    const service = new ReviewReplyService(
      new AnthropicClient(requireEnv('ANTHROPIC_API_KEY'), log),
      new ReplyRepository(),
      log,
    );

    const result = await service.generate({
      // Längen begrenzen. Eine Google-Bewertung ist auf 4096 Zeichen
      // gedeckelt; alles darüber ist kein Bewertungstext, sondern ein
      // Versuch, Tokens zu verbrennen oder den Prompt zu kapern.
      reviewText:   clampText(body.reviewText, 4096),
      reviewerName: clampText(body.reviewerName, 120),
      rating:       parseRating(body.rating),
      facts,
      addressing:   body.addressing === 'du' ? 'du' : 'sie',
      reviewId,
    }, user.id);

    return jsonResponse(request, result);
  } catch (err) {
    const error = err instanceof ReplyError
      ? err
      : new ReplyError('internal_error', err instanceof Error ? err.message : String(err), { cause: err });

    log.error('request_failed', {
      code: error.code, status: error.status, message: error.message, ...error.options.context,
    });

    return jsonResponse(request, error.toPublic(), error.status);
  }
});
