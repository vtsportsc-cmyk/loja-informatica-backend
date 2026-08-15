import { DEFAULT_FAQS, type FaqEntry } from './faq.js';
import {
  createInstitutionalCache,
  type InstitutionalCache,
} from './institutionalCache.js';

// ============================================================================
// Respostas institucionais frequentes servidas DIRETO do cache (zero tokens de
// LLM). O matching e deterministico (keywords/frases), nunca usa a LLM: se a
// mensagem do cliente casar com uma duvida institucional (endereco, horario,
// formas de pagamento, garantia, prazo de entrega, contato), a resposta e
// recuperada do Redis. Precos/servicos ficam de fora por variarem com estoque.
// ============================================================================

export interface InstitutionalAnswerResult {
  faqId: string;
  category: string;
  text: string;
  /** true quando a resposta veio do cache (Redis); false quando foi populada agora. */
  cached: boolean;
}

export interface InstitutionalAnswerStats {
  matched: number;
  cacheHits: number;
}

export interface InstitutionalAnswerServiceOptions {
  /** FAQs candidatas (default: DEFAULT_FAQS filtrado pelas institucionais). */
  answers?: readonly FaqEntry[];
  cache?: InstitutionalCache;
  /** TTL do cache em segundos (default 12h). */
  ttlSeconds?: number;
  /** Limite de palavras da mensagem para casar como duvida institucional. */
  maxWords?: number;
  /** Pontuacao minima para aceitar o match (evita falso positivo). */
  minScore?: number;
}

/** FAQs com resposta institucional FIXA (seguras para cache direto). */
export const INSTITUTIONAL_ANSWER_IDS = new Set<string>([
  'endereco-loja',
  'atendimento-horario',
  'pagamento-formas',
  'garantia-padrao',
  'entrega-prazo',
  'atendimento-contato',
]);

const DEFAULT_TTL_SECONDS = 43_200; // 12h
const DEFAULT_MAX_WORDS = 12;
const DEFAULT_MIN_SCORE = 2;

export class InstitutionalAnswerService {
  private readonly answers: readonly FaqEntry[];
  private readonly cache: InstitutionalCache;
  private readonly ttlSeconds: number;
  private readonly maxWords: number;
  private readonly minScore: number;
  private matched = 0;
  private cacheHits = 0;

  constructor(options: InstitutionalAnswerServiceOptions = {}) {
    const candidates = options.answers ?? DEFAULT_FAQS;
    this.answers = candidates.filter((f) => INSTITUTIONAL_ANSWER_IDS.has(f.id));
    this.cache = options.cache ?? createInstitutionalCache();
    this.ttlSeconds = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
    this.maxWords = options.maxWords ?? DEFAULT_MAX_WORDS;
    this.minScore = options.minScore ?? DEFAULT_MIN_SCORE;
  }

  /** Tenta responder a mensagem com uma resposta institucional (via cache). */
  async tryAnswer(text: string): Promise<InstitutionalAnswerResult | null> {
    const match = this.match(text);
    if (!match) return null;

    this.matched += 1;
    const faqId = match.faq.id;
    const cachedText = await this.cache.get(faqId);
    if (cachedText) {
      this.cacheHits += 1;
      return { faqId, category: match.faq.category, text: cachedText, cached: true };
    }
    await this.cache.set(faqId, match.faq.answer, this.ttlSeconds);
    return { faqId, category: match.faq.category, text: match.faq.answer, cached: false };
  }

  stats(): InstitutionalAnswerStats {
    return { matched: this.matched, cacheHits: this.cacheHits };
  }

  private match(text: string): { faq: FaqEntry } | null {
    const normalized = normalize(text);
    const words = normalized.split(/\s+/).filter((w) => w.length > 0);
    if (words.length === 0 || words.length > this.maxWords) return null;

    let best: { faq: FaqEntry; score: number } | null = null;
    for (const faq of this.answers) {
      const score = scoreAnswer(normalized, faq);
      if (score < this.minScore) continue;
      if (!best || score > best.score) best = { faq, score };
    }
    return best ? { faq: best.faq } : null;
  }
}

/** Pontua o texto normalizado contra os keywords da FAQ institucional. */
function scoreAnswer(normalizedText: string, faq: FaqEntry): number {
  const seen = new Set<string>();
  let score = 0;
  for (const rawKeyword of faq.keywords) {
    const kw = normalize(rawKeyword);
    if (!kw || seen.has(kw)) continue;
    seen.add(kw);
    if (!normalizedText.includes(kw)) continue;
    if (kw.includes(' ')) score += 5; // frase completa (ex.: "onde fica a loja")
    else if (kw.length >= 4) score += 2; // palavra distintiva (ex.: "pagamento")
    else score += 1; // palavra curta (ex.: "pix", "12x")
  }
  return score;
}

/** Normaliza: lowercase + remove acentos + colapsa espacos/pontuacao. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9À-ÿ\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
