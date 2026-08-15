import { describe, it, expect, vi } from 'vitest';
import { TranscriptionClient } from '../src/integration/audio/TranscriptionClient.js';

// ============================================================================
// Transcricao de audio por IA (Groq Whisper primario / Gemini Audio fallback)
// ============================================================================

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function buildClient(fetchImpl: typeof fetch, overrides: Record<string, unknown> = {}) {
  return new TranscriptionClient({
    groqApiKey: 'groq-key',
    groqBaseURL: 'https://api.groq.com/openai/v1',
    groqModel: 'whisper-large-v3-turbo',
    geminiApiKey: 'gemini-key',
    geminiBaseURL: 'https://generativelanguage.googleapis.com/v1beta',
    geminiModel: 'gemini-2.0-flash',
    fetchImpl,
    logger: () => {},
    ...overrides,
  });
}

describe('TranscriptionClient', () => {
  it('transcreve com Groq Whisper (primario)', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ text: 'Quero montar um PC gamer' }));
    const client = buildClient(fetchMock as unknown as typeof fetch);

    const result = await client.transcribe({ base64: Buffer.from('audio-bytes').toString('base64'), mimeType: 'audio/ogg' });

    expect(result).toEqual({ text: 'Quero montar um PC gamer', provider: 'groq', model: 'whisper-large-v3-turbo' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.groq.com/openai/v1/audio/transcriptions');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer groq-key');
    expect(init.body).toBeInstanceOf(FormData);
  });

  it('cai para Gemini Audio quando o Groq falha', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'rate limit' }, 429))
      .mockResolvedValueOnce(
        jsonResponse({
          candidates: [{ content: { parts: [{ text: 'Transcricao do Gemini' }] } }],
        }),
      );
    const client = buildClient(fetchMock as unknown as typeof fetch);

    const result = await client.transcribe({ base64: Buffer.from('a').toString('base64'), mimeType: 'audio/ogg' });

    expect(result).toEqual({ text: 'Transcricao do Gemini', provider: 'gemini', model: 'gemini-2.0-flash' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const url = (fetchMock.mock.calls[1] as [string])[0];
    expect(url).toContain('models/gemini-2.0-flash:generateContent');
    expect(url).toContain('gemini-key');
  });

  it('lanca erro agregado quando ambos os provedores falham', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ error: 'boom' }, 500));
    const client = buildClient(fetchMock as unknown as typeof fetch);

    await expect(client.transcribe({ base64: 'eA==', mimeType: 'audio/ogg' })).rejects.toThrow(
      /transcricao falhou: groq .* gemini/,
    );
  });

  it('retorna texto vazio quando desabilitado', async () => {
    const fetchMock = vi.fn();
    const client = buildClient(fetchMock as unknown as typeof fetch, { enabled: false });
    const result = await client.transcribe({ base64: 'eA==' });
    expect(result.text).toBe('');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
