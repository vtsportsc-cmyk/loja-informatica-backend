import {
  PIX_DISCOUNT_PERCENT,
  MAX_INSTALLMENTS,
  INSTALLMENT_MONTHLY_RATE,
} from '@loja/catalog';

export interface QuoteItemJson {
  category: string;
  name: string;
  brand: string;
  model: string;
  sku: string | null;
  specSummary: string | null;
  unitPriceCents: number;
  quantity: number;
}

export interface StoredQuote {
  code: string;
  customerName: string | null;
  customerPhone: string | null;
  items: QuoteItemJson[];
  subtotalCents: number;
  discountCents: number;
  pixTotalCents: number;
  installments: number;
  monthlyValueCents: number;
  parceledTotalCents: number;
  /** Atribuicao de trafego capturada na URL (?utm_source=...&utm_campaign=...). */
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  createdAt: string;
}

export function summarizeItems(items: QuoteItemJson[]) {
  const subtotalCents = items.reduce((sum, i) => sum + i.unitPriceCents * i.quantity, 0);
  const pixTotalCents = Math.round(subtotalCents * (1 - PIX_DISCOUNT_PERCENT / 100));
  const discountCents = subtotalCents - pixTotalCents;
  const factor = Math.pow(1 + INSTALLMENT_MONTHLY_RATE, MAX_INSTALLMENTS);
  const parceledTotalCents = Math.round(subtotalCents * factor);
  return {
    subtotalCents,
    discountCents,
    pixTotalCents,
    installments: MAX_INSTALLMENTS,
    monthlyValueCents: Math.round(parceledTotalCents / MAX_INSTALLMENTS),
    parceledTotalCents,
  };
}

export function makeQuoteCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `Q-${out}`;
}

// ---------------------------------------------------------------------------
// Armazenamento: em memoria (instancia unica) por padrao; quando DATABASE_URL
// esta definido, tambem persiste a Quote/QuoteItem no PostgreSQL via @loja/db
// (best-effort). O GET sempre tenta a memoria primeiro.
// ---------------------------------------------------------------------------
const memoryStore = new Map<string, StoredQuote>();

async function persistToDb(quote: StoredQuote): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return;

  try {
    const { prisma } = await import('@loja/db');
    const cleanPhone = (quote.customerPhone ?? '').replace(/\D/g, '');
    const whatsappId = cleanPhone || `guest:${quote.code}`;

    await prisma.$transaction(async (tx) => {
      const customer = await tx.customer.upsert({
        where: { whatsappId },
        update: quote.customerName ? { name: quote.customerName } : {},
        create: { whatsappId, name: quote.customerName ?? null },
      });

      const conversation = await tx.conversation.upsert({
        where: { customerId: customer.id },
        update: {},
        create: {
          customerId: customer.id,
          leadSource: 'BUILDER',
          utmSource: quote.utmSource,
          utmMedium: quote.utmMedium,
          utmCampaign: quote.utmCampaign,
        },
      });

      await tx.quote.create({
        data: {
          code: quote.code,
          customerId: customer.id,
          conversationId: conversation.id,
          status: 'pending',
          totalCents: quote.subtotalCents,
          discountCents: quote.discountCents,
          pixTotalCents: quote.pixTotalCents,
          installments: quote.installments,
          installmentValueCents: quote.monthlyValueCents,
          parceledTotalCents: quote.parceledTotalCents,
          utmSource: quote.utmSource,
          utmMedium: quote.utmMedium,
          utmCampaign: quote.utmCampaign,
          items: {
            create: quote.items.map((item, index) => ({
              category: item.category,
              name: item.name,
              brand: item.brand,
              model: item.model,
              sku: item.sku,
              specSummary: item.specSummary,
              unitPriceCents: item.unitPriceCents,
              quantity: item.quantity,
              sort: index,
            })),
          },
        },
      });
    });
  } catch (err) {
    console.warn(`[quotes] falha ao persistir ${quote.code} no banco:`, (err as Error).message);
  }
}

export async function createQuote(input: {
  customerName?: string;
  customerPhone?: string;
  items: QuoteItemJson[];
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
}): Promise<StoredQuote> {
  const summary = summarizeItems(input.items);
  const quote: StoredQuote = {
    code: makeQuoteCode(),
    customerName: input.customerName?.trim() || null,
    customerPhone: input.customerPhone?.trim() || null,
    items: input.items,
    subtotalCents: summary.subtotalCents,
    discountCents: summary.discountCents,
    pixTotalCents: summary.pixTotalCents,
    installments: summary.installments,
    monthlyValueCents: summary.monthlyValueCents,
    parceledTotalCents: summary.parceledTotalCents,
    utmSource: input.utmSource?.trim() || null,
    utmMedium: input.utmMedium?.trim() || null,
    utmCampaign: input.utmCampaign?.trim() || null,
    createdAt: new Date().toISOString(),
  };
  memoryStore.set(quote.code, quote);
  void persistToDb(quote);
  return quote;
}

export async function getQuote(code: string): Promise<StoredQuote | null> {
  const found = memoryStore.get(code);
  if (found) return found;

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return null;
  try {
    const { prisma } = await import('@loja/db');
    const row = await prisma.quote.findUnique({
      where: { code },
      include: { items: true, customer: true },
    });
    if (!row) return null;
    return {
      code: row.code,
      customerName: row.customer.name,
      customerPhone: row.customer.whatsappId,
      items: [...row.items]
        .sort((a, b) => a.sort - b.sort)
        .map((item) => ({
          category: item.category,
          name: item.name,
          brand: item.brand,
          model: item.model,
          sku: item.sku,
          specSummary: item.specSummary,
          unitPriceCents: item.unitPriceCents,
          quantity: item.quantity,
        })),
      subtotalCents: row.totalCents,
      discountCents: row.discountCents,
      pixTotalCents: row.pixTotalCents,
      installments: row.installments,
      monthlyValueCents: row.installmentValueCents,
      parceledTotalCents: row.parceledTotalCents,
      utmSource: row.utmSource,
      utmMedium: row.utmMedium,
      utmCampaign: row.utmCampaign,
      createdAt: row.createdAt.toISOString(),
    };
  } catch (err) {
    console.warn(`[quotes] falha ao ler ${code} do banco:`, (err as Error).message);
    return null;
  }
}
