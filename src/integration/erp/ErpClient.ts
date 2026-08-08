import {
  orderSchema,
  stockLockRequestSchema,
  stockLockSchema,
  stockQueryResponseSchema,
  stockReleaseRequestSchema,
} from '../../types/index.js';
import type {
  Order,
  OrderCreateRequest,
  StockItem,
  StockLock,
  StockLockRequest,
  StockReleaseRequest,
} from '../../types/index.js';
import { ErpRequestError } from './errors.js';

export interface ErpClientOptions {
  baseURL: string;
  apiToken: string;
  fetchImpl?: typeof fetch;
}

// Cliente HTTP da API do ERP (estoque, trava temporaria e pedidos).
export class ErpClient {
  private readonly baseURL: string;
  private readonly apiToken: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ErpClientOptions) {
    this.baseURL = options.baseURL.replace(/\/$/, '');
    this.apiToken = options.apiToken;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async stockBySku(sku: string): Promise<StockItem | null> {
    const url = `${this.baseURL}/stock/${encodeURIComponent(sku)}`;
    const res = await this.request(url, { method: 'GET' });
    if (res.status === 404) return null;
    if (!res.ok) throw await this.toError('GET /stock/:sku', res);
    const body = stockQueryResponseSchema.parse(await res.json());
    return body.item;
  }

  async lockItem(sku: string, quantity: number, opts: Partial<StockLockRequest> = {}): Promise<StockLock> {
    const payload = stockLockRequestSchema.parse({
      sku,
      quantity,
      ttlSeconds: opts.ttlSeconds ?? 900,
      reason: opts.reason ?? 'checkout',
      ...(opts.lockToken ? { lockToken: opts.lockToken } : {}),
    });
    const res = await this.request(`${this.baseURL}/stock/lock`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw await this.toError('POST /stock/lock', res);
    return stockLockSchema.parse(await res.json());
  }

  async releaseLock(lockId: string, reason: StockReleaseRequest['reason'] = 'cancelled'): Promise<void> {
    const payload = stockReleaseRequestSchema.parse({ lockId, reason });
    const res = await this.request(`${this.baseURL}/stock/lock/${encodeURIComponent(lockId)}/release`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw await this.toError('POST /stock/lock/:id/release', res);
  }

  async createOrder(request: OrderCreateRequest): Promise<Order> {
    const res = await this.request(`${this.baseURL}/orders`, {
      method: 'POST',
      body: JSON.stringify(request),
    });
    if (!res.ok) throw await this.toError('POST /orders', res);
    return orderSchema.parse(await res.json());
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      authorization: `Bearer ${this.apiToken}`,
      ...(init.headers as Record<string, string> | undefined),
    };
    return this.fetchImpl(url, { ...init, headers });
  }

  private async toError(action: string, res: Response): Promise<ErpRequestError> {
    const body = await res.text().catch(() => '');
    return new ErpRequestError(action, res.status, body);
  }
}
