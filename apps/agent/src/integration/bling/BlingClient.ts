// ============================================================================
// Bling API v3 - integracao ENXUTA: apenas emissaO de nota fiscal e expedicao.
// A gestao comercial permanece no nosso CRM/banco; o Bling recebe o pedido
// somente quando o lead chega ao status "Aguardando NF".
// Referencia: POST /pedidos/vendas (https://developer.bling.com.br)
// ============================================================================

export interface BlingClientOptions {
  accessToken: string;
  baseURL?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface BlingOrderItem {
  sku?: string | null;
  description: string;
  quantity: number;
  unitValueCents: number;
}

export interface BlingCreateOrderInput {
  numero?: string;
  customer: { name: string | null; document?: string | null; phone?: string | null };
  items: BlingOrderItem[];
  totalCents: number;
}

export interface BlingCreatedOrder {
  id: string;
  numero: string;
}

export class BlingClient {
  private readonly accessToken: string;
  private readonly baseURL: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: BlingClientOptions) {
    this.accessToken = options.accessToken;
    this.baseURL = (options.baseURL ?? 'https://www.bling.com.br/Api/v3').replace(/\/$/, '');
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  get enabled(): boolean {
    return this.accessToken.length > 0;
  }

  async createSaleOrder(input: BlingCreateOrderInput): Promise<BlingCreatedOrder> {
    if (!this.enabled) {
      throw new Error('Bling desabilitado: informe BLING_ACCESS_TOKEN no .env');
    }

    const today = new Date().toISOString().slice(0, 10);
    const payload = {
      numero: input.numero ?? '1',
      data: today,
      cliente: {
        nome: input.customer.name ?? 'Consumidor final',
        ...(input.customer.document ? { numeroDocumento: input.customer.document } : {}),
        ...(input.customer.phone ? { fone: input.customer.phone } : {}),
      },
      itens: input.items.map((item, index) => ({
        codigo: item.sku ?? String(index + 1),
        descricao: item.description,
        unidade: 'UN',
        quantidade: item.quantity,
        valor: item.unitValueCents / 100,
      })),
      total: { varejo: input.totalCents / 100 },
    };

    const res = await this.fetchImpl(`${this.baseURL}/pedidos/vendas`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.accessToken}`,
        accept: 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Bling createSaleOrder HTTP ${res.status}: ${detail}`);
    }

    const body = (await res.json()) as { data?: { id?: string | number; numero?: string } };
    return {
      id: String(body.data?.id ?? ''),
      numero: String(body.data?.numero ?? input.numero ?? '1'),
    };
  }
}
