import type { BlingClient, BlingCreatedOrder } from './BlingClient.js';
import type { QuoteRecord } from '../../prisma/MessageRepository.js';

// ============================================================================
// Orquestra a criacao do pedido no Bling a partir do orcamento da loja
// (Quote), disparada quando o funil de CRM chega em AGUARDANDO_NF.
// ============================================================================

export interface BlingOrderServiceDeps {
  bling: BlingClient;
  logger?: (message: string) => void;
}

export class BlingOrderService {
  private readonly bling: BlingClient;
  private readonly logger: (message: string) => void;

  constructor(deps: BlingOrderServiceDeps) {
    this.bling = deps.bling;
    this.logger = deps.logger ?? ((m) => console.log(`[bling] ${m}`));
  }

  get enabled(): boolean {
    return this.bling.enabled;
  }

  async createOrderFromQuote(quote: QuoteRecord): Promise<BlingCreatedOrder | null> {
    if (!this.bling.enabled) {
      this.logger(`[${quote.code}] Bling nao configurado (sem BLING_ACCESS_TOKEN); pedido NAO emitido.`);
      return null;
    }

    const order = await this.bling.createSaleOrder({
      numero: quote.code.replace(/^#/, ''),
      customer: {
        name: quote.customer.name,
        phone: quote.customer.phone,
      },
      items: quote.items.map((item) => ({
        sku: item.sku,
        description: item.name,
        quantity: item.quantity,
        unitValueCents: item.unitPriceCents,
      })),
      totalCents: quote.totalCents,
    });

    this.logger(`[${quote.code}] pedido Bling criado id=${order.id} numero=${order.numero}`);
    return order;
  }
}
