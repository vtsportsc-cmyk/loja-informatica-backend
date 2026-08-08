export class LlmError extends Error {
  readonly provider: string;
  readonly code: 'timeout' | 'rate_limit' | 'http' | 'auth' | 'network' | 'invalid_response' | 'aborted';
  readonly status?: number;

  constructor(
    provider: string,
    code: LlmError['code'],
    message: string,
    status?: number,
  ) {
    super(message);
    this.name = 'LlmError';
    this.provider = provider;
    this.code = code;
    this.status = status;
  }
}

export class LlmProviderTimeoutError extends LlmError {
  constructor(provider: string, timeoutMs: number) {
    super(provider, 'timeout', `Provider "${provider}" nao respondeu em ${timeoutMs}ms`, undefined);
    this.name = 'LlmProviderTimeoutError';
  }
}

export class LlmRateLimitError extends LlmError {
  constructor(provider: string, status = 429) {
    super(provider, 'rate_limit', `Provider "${provider}" retornou limite de requisicao (${status})`, status);
    this.name = 'LlmRateLimitError';
  }
}

export class LlmAuthError extends LlmError {
  constructor(provider: string, status = 401) {
    super(provider, 'auth', `Provider "${provider}" rejeitou a autenticacao (${status})`, status);
    this.name = 'LlmAuthError';
  }
}

export class LlmHttpError extends LlmError {
  constructor(provider: string, status: number, body: string) {
    super(provider, 'http', `Provider "${provider}" retornou HTTP ${status}: ${body.slice(0, 200)}`, status);
    this.name = 'LlmHttpError';
  }
}

export class LlmNetworkError extends LlmError {
  constructor(provider: string, cause: unknown) {
    super(provider, 'network', `Provider "${provider}" falhou na rede: ${String(cause)}`, undefined);
    this.name = 'LlmNetworkError';
  }
}

export class LlmAllProvidersFailedError extends LlmError {
  readonly errors: LlmError[];
  constructor(errors: LlmError[]) {
    super(
      errors[0]?.provider ?? 'all',
      errors[0]?.code ?? 'network',
      `Todos os providers de LLM falharam. Ultimo: ${errors[errors.length - 1]?.message}`,
      errors[errors.length - 1]?.status,
    );
    this.name = 'LlmAllProvidersFailedError';
    this.errors = errors;
  }
}
