// ============================================================================
// Cliente de transcricao de audio (speech-to-text).
// Ordem de resiliencia (mesma logica do roteador de LLM):
//   1. Groq Whisper (primario) - POST {base}/audio/transcriptions (multipart);
//   2. Gemini Audio (fallback) - POST {v1beta}/models/{model}:generateContent
//      com o audio inline (base64), como fallback quando o Groq falha.
// NUNCA lanca excecao para o chamador se desabilitado (no-op) - quem decide
// como reagir a falha e o EvolutionWebhookHandler.
// ============================================================================

export interface AudioTranscriptionInput {
  /** Midia em base64 puro (sem prefixo data:). */
  base64: string;
  mimeType?: string;
  filename?: string;
}

export interface TranscriptionResult {
  text: string;
  provider: 'groq' | 'gemini';
  model: string;
}

export interface TranscriptionClientOptions {
  groqApiKey: string;
  /** Base OpenAI-compativel do Groq (ex.: https://api.groq.com/openai/v1). */
  groqBaseURL: string;
  groqModel: string;
  geminiApiKey: string;
  /** Base NATIVA do Google Generative Language (ex.: https://generativelanguage.googleapis.com/v1beta). */
  geminiBaseURL: string;
  geminiModel: string;
  /** false => transcribe vira no-op (retorna { text: '' }) para dev sem chaves. */
  enabled?: boolean;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  logger?: (message: string) => void;
}

export class TranscriptionClient {
  private readonly groqApiKey: string;
  private readonly groqBaseURL: string;
  private readonly groqModel: string;
  private readonly geminiApiKey: string;
  private readonly geminiBaseURL: string;
  private readonly geminiModel: string;
  private readonly enabled: boolean;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly logger: (message: string) => void;

  constructor(options: TranscriptionClientOptions) {
    this.groqApiKey = options.groqApiKey;
    this.groqBaseURL = options.groqBaseURL.replace(/\/$/, '');
    this.groqModel = options.groqModel;
    this.geminiApiKey = options.geminiApiKey;
    this.geminiBaseURL = options.geminiBaseURL.replace(/\/$/, '');
    this.geminiModel = options.geminiModel;
    this.enabled = options.enabled ?? true;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.logger = options.logger ?? ((m) => console.log(`[transcribe] ${m}`));
  }

  /**
   * Transcreve um audio em texto. Falhas do Groq caem no Gemini; se ambos
   * falharem, lanca o erro agregado (o chamador decide o fallback).
   */
  async transcribe(input: AudioTranscriptionInput): Promise<TranscriptionResult> {
    if (!this.enabled) return { text: '', provider: 'groq', model: this.groqModel };

    const mime = normalizeMime(input.mimeType);
    const filename = input.filename ?? `audio.${extensionForMime(mime)}`;

    const groqErrors: string[] = [];
    try {
      return await this.transcribeWithGroq(input.base64, mime, filename);
    } catch (err) {
      groqErrors.push((err as Error).message);
      this.logger(`groq whisper falhou (${this.groqModel}): ${(err as Error).message}`);
    }

    if (!this.geminiApiKey) {
      throw new Error(`transcricao falhou (groq): ${groqErrors[0]}`);
    }

    try {
      return await this.transcribeWithGemini(input.base64, mime);
    } catch (err) {
      throw new Error(
        `transcricao falhou: groq [${groqErrors[0]}] gemini [${(err as Error).message}]`,
      );
    }
  }

  private async transcribeWithGroq(
    base64: string,
    mimeType: string,
    filename: string,
  ): Promise<TranscriptionResult> {
    const form = new FormData();
    const blob = new Blob([Buffer.from(base64, 'base64')], { type: mimeType });
    form.append('file', blob, filename);
    form.append('model', this.groqModel);
    form.append('response_format', 'json');
    form.append('language', 'pt');

    const res = await this.request(`${this.groqBaseURL}/audio/transcriptions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.groqApiKey}` },
      body: form,
    });
    if (!res.ok) {
      throw new Error(`Groq transcriptions HTTP ${res.status}: ${await res.text().catch(() => '')}`);
    }
    const body = (await res.json().catch(() => ({}))) as { text?: unknown };
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text) throw new Error('Groq retornou transcricao vazia');
    return { text, provider: 'groq', model: this.groqModel };
  }

  private async transcribeWithGemini(
    base64: string,
    mimeType: string,
  ): Promise<TranscriptionResult> {
    const url = `${this.geminiBaseURL}/models/${encodeURIComponent(this.geminiModel)}:generateContent?key=${encodeURIComponent(this.geminiApiKey)}`;
    const res = await this.request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: 'Transcreva o audio desta mensagem de WhatsApp para texto em portugues, fiel ao conteudo falado. Responda apenas com a transcricao.',
              },
              { inlineData: { mimeType, data: base64 } },
            ],
          },
        ],
        generationConfig: { temperature: 0 },
      }),
    });
    if (!res.ok) {
      throw new Error(`Gemini generateContent HTTP ${res.status}: ${await res.text().catch(() => '')}`);
    }
    const body = (await res.json().catch(() => ({}))) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }>;
    };
    const text = body.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== 'string' || !text.trim()) throw new Error('Gemini retornou transcricao vazia');
    return { text: text.trim(), provider: 'gemini', model: this.geminiModel };
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const signal = AbortSignal.timeout(this.timeoutMs);
    return this.fetchImpl(path, { ...init, signal });
  }
}

function normalizeMime(mime?: string): string {
  const known = new Set([
    'audio/ogg',
    'audio/mp3',
    'audio/mpeg',
    'audio/wav',
    'audio/x-wav',
    'audio/m4a',
    'audio/aac',
    'audio/flac',
    'audio/webm',
    'audio/opus',
  ]);
  if (mime && known.has(mime)) return mime;
  // WhatsApp geralmente envia audio/ogg (codec Opus).
  return 'audio/ogg';
}

function extensionForMime(mime: string): string {
  switch (mime) {
    case 'audio/mp3':
    case 'audio/mpeg':
      return 'mp3';
    case 'audio/wav':
    case 'audio/x-wav':
      return 'wav';
    case 'audio/m4a':
      return 'm4a';
    case 'audio/aac':
      return 'aac';
    case 'audio/flac':
      return 'flac';
    case 'audio/webm':
      return 'webm';
    case 'audio/opus':
      return 'opus';
    default:
      return 'ogg';
  }
}
