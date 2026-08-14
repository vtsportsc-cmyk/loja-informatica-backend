import { describe, it, expect } from 'vitest';
import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { PaymentClient, verifySignature } from '../src/integration/payment/PaymentClient.js';
import { paymentNotificationSchema } from '../src/types/index.js';
import { pixApprovedNotification } from './mocks/events.js';

describe('verifySignature - validacao HMAC do webhook', () => {
  const secret = 'segredo-teste';

  it('aceita assinatura valida', () => {
    const payload = JSON.stringify(pixApprovedNotification());
    const sig = `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`;
    expect(verifySignature(payload, sig, secret)).toBe(true);
  });

  it('rejeita assinatura invalida', () => {
    const payload = JSON.stringify(pixApprovedNotification());
    expect(verifySignature(payload, 'sha256=0'.repeat(64), secret)).toBe(false);
  });
});

describe('paymentNotificationSchema', () => {
  it('valida notificacao de PIX aprovado', () => {
    const parsed = paymentNotificationSchema.parse(pixApprovedNotification());
    expect(parsed.event).toBe('payment.confirmed');
    expect(parsed.method).toBe('pix');
    expect(parsed.pix?.txid).toBe('TXID-ABC123');
  });

  it('rejeita payment.confirmed sem paidAt', () => {
    const bad = pixApprovedNotification({ paidAt: undefined });
    expect(() => paymentNotificationSchema.parse(bad)).toThrow();
  });
});

describe('PaymentClient - criacao de cobranca', () => {
  function gateway() {
    return createServer((req, res) => {
      void (async () => {
        let body = '';
        for await (const chunk of req) body += chunk;
        const parsed = JSON.parse(body);
        res.writeHead(200, { 'content-type': 'application/json' });
        if (req.url === '/charges/pix') {
          res.end(
            JSON.stringify({
              chargeId: 'CHARGE-PIX-1',
              orderId: parsed.orderId,
              status: 'pending',
              qrCode: 'data:image/png;base64,AAA',
              qrCodeBase64: 'AAA',
              emv: '00020126580014BR.GOV.BCB.PIX0136abc',
              expiresAt: '2026-08-06T12:00:00.000Z',
            }),
          );
        } else {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              chargeId: 'CHARGE-PIX-1',
              orderId: 'ORDER-7001',
              status: 'pending',
              qrCode: 'data:image/png;base64,AAA',
              qrCodeBase64: 'AAA',
              emv: '00020126580014BR.GOV.BCB.PIX0136abc',
              expiresAt: '2026-08-06T12:00:00.000Z',
            }),
          );
        }
      })();
    });
  }

  async function listen(server: ReturnType<typeof gateway>): Promise<string> {
    return new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const { port } = server.address() as AddressInfo;
        resolve(`http://127.0.0.1:${port}`);
      });
    });
  }

  it('cria cobranca PIX e retorna QR Code + copia e cola', async () => {
    const server = gateway();
    const baseURL = await listen(server);
    try {
      const client = new PaymentClient({ baseURL, apiKey: 'k' });
      const charge = await client.createPixCharge({
        ticketId: 'TKT-1001',
        orderId: 'ORDER-7001',
        amountCents: 599990,
        description: 'PC Gamer',
        expiresInMinutes: 30,
      });
      expect(charge.status).toBe('pending');
      expect(charge.emv).toContain('PIX');
      expect(charge.qrCodeBase64).toBe('AAA');
    } finally {
      server.close();
    }
  });
});
