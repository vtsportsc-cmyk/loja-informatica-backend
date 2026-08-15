import { NextResponse } from 'next/server';
import { createQuote } from '@/lib/quotes-store';
import type { QuoteItemJson } from '@/lib/quotes-store';
import { formatBRL, PIX_DISCOUNT_PERCENT } from '@loja/catalog';

const STORE_WHATSAPP_NUMBER = process.env.STORE_WHATSAPP_NUMBER ?? '5511999990000';

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    customerName?: string;
    customerPhone?: string;
    items?: QuoteItemJson[];
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
  } | null;

  const items = Array.isArray(body?.items)
    ? body.items.filter((item) => item && item.name && item.unitPriceCents > 0)
    : [];
  if (items.length === 0) {
    return NextResponse.json({ error: 'selecione ao menos uma peca para gerar o orcamento' }, { status: 400 });
  }

  const quote = await createQuote({
    customerName: body?.customerName,
    customerPhone: body?.customerPhone,
    items,
    utmSource: body?.utmSource,
    utmMedium: body?.utmMedium,
    utmCampaign: body?.utmCampaign,
  });

  const summaryText = items
    .map((item) => {
      const spec = item.specSummary ? ` (${item.specSummary})` : '';
      return `• ${item.quantity}x ${item.name}${spec} — ${formatBRL(item.unitPriceCents * item.quantity)}`;
    })
    .join('\n');
  const clientLine = quote.customerName ? `\nCliente: ${quote.customerName}` : '';
  const message =
    `Olá! Montei este PC no Monte Seu PC e quero confirmar o orçamento.\n\n` +
    `Código do orçamento: ${quote.code}${clientLine}\n\n${summaryText}\n\n` +
    `Subtotal: ${formatBRL(quote.subtotalCents)}\n` +
    `Desconto PIX (-${PIX_DISCOUNT_PERCENT}%): ${formatBRL(quote.discountCents)}\n` +
    `Total à vista (PIX): ${formatBRL(quote.pixTotalCents)}\n` +
    `ou ${quote.installments}x de ${formatBRL(quote.monthlyValueCents)} (total ${formatBRL(quote.parceledTotalCents)})`;
  const waLink = `https://wa.me/${STORE_WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;

  return NextResponse.json({ quote, waLink }, { status: 201 });
}
