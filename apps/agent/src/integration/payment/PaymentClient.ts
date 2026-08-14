import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  chargeCreatedSchema,
  creditCardChargeCreatedSchema,
  creditCardChargeRequestSchema,
  paymentNotificationAckSchema,
  paymentNotificationSchema,
  pixChargeCreatedSchema,
  pixChargeRequestSchema,
} from '../../types/index.js';
import type {
  CreditCardChargeCreated,
  CreditCardChargeRequest,
  PaymentNotification,
  PixChargeCreated,
  PixChargeRequest,
} from '../../types/index.js';

export interface PaymentClientOptions {
  baseURL: string;
  apiKey: string;
  /** Segredo compartilhado para validar a assinatura dos webhooks. */
  webhookSecret?: string;
  fetchImpl?: typeof fetch;
}

// Cliente do gateway de pagamento: PIX (QR Code / copia e cola) e
// cartao de credito (checkout transparente) + tratamento de notificacoes.
export class PaymentClient {
  private readonly baseURL: string;
  private readonly apiKey: string;
  private readonly webhookSecret?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: PaymentClientOptions) {
    this.baseURL = options.baseURL.replace(/\/$/, '');
    this.apiKey = options.apiKey;
    this.webhookSecret = options.webhookSecret;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async createPixCharge(request: PixChargeRequest): Promise<PixChargeCreated> {
    const payload = pixChargeRequestSchema.parse(request);
    const res = await this.request('/charges/pix', payload);
    if (!res.ok) throw new Error(`PIX charge HTTP ${res.status}`);
    return pixChargeCreatedSchema.parse(await res.json());
  }

  async createCreditCardCharge(request: CreditCardChargeRequest): Promise<CreditCardChargeCreated> {
    const payload = creditCardChargeRequestSchema.parse(request);
    const res = await this.request('/charges/credit-card', payload);
    if (!res.ok) throw new Error(`Credit card charge HTTP ${res.status}`);
    return creditCardChargeCreatedSchema.parse(await res.json());
  }

  async getChargeStatus(
    chargeId: string,
  ): Promise<'pending' | 'paid' | 'expired' | 'authorized' | 'refused'> {
    const res = await this.request(`/charges/${encodeURIComponent(chargeId)}`, undefined, 'GET');
    if (!res.ok) throw new Error(`Get charge HTTP ${res.status}`);
    const body = chargeCreatedSchema.parse(await res.json());
    return body.charge.status;
  }

  /** Valida e processa a notificacao de pagamento (webhook). */
  async handleNotification(rawBody: string, signatureHeader?: string): Promise<PaymentNotification> {
    if (this.webhookSecret && signatureHeader) {
      const valid = verifySignature(rawBody, signatureHeader, this.webhookSecret);
      if (!valid) throw new Error('Assinatura do webhook de pagamento invalida');
    }

    const notification = paymentNotificationSchema.parse(JSON.parse(rawBody));

    const res = await this.request('/notifications/ack', { orderId: notification.orderId });
    if (!res.ok) throw new Error(`Ack notification HTTP ${res.status}`);
    paymentNotificationAckSchema.parse(await res.json());

    return notification;
  }

  private async request(
    path: string,
    body?: unknown,
    method: 'POST' | 'GET' = 'POST',
  ): Promise<Response> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      authorization: `Bearer ${this.apiKey}`,
    };
    return this.fetchImpl(`${this.baseURL}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  }
}

export function verifySignature(payload: string, signatureHeader: string, secret: string): boolean {
  const expected = createHmac('sha256', secret).update(payload).digest('hex');
  const provided = signatureHeader.replace(/^sha256=/i, '');
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}
