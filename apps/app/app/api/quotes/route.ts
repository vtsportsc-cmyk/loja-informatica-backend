import { NextResponse } from 'next/server';
import { createQuote } from '@/lib/quotes-store';
import type { QuoteItemJson } from '@/lib/quotes-store';
import { formatBRL } from '@loja/catalog';

const STORE_WHATSAPP_NUMBER = process.env.STORE_WHATSAPP_NUMBER ?? '5511999990000';

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    customerName?: string;
    customerPhone?: string;
    items?: QuoteItemJson[];
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
  });

  const summaryText = items
    .map((item) => `• ${item.quantity}x ${item.name} — ${formatBRL(item.unitPriceCents * item.quantity)}`)
    .join('\n');
  const message =
    `Olá! Montei este PC na LojaTech e quero confirmar o orçamento.\n\n` +
    `Código: ${quote.code}\n\n${summaryText}\n\n` +
    `Total à vista (PIX): ${formatBRL(quote.pixTotalCents)}`;
  const waLink = `https://wa.me/${STORE_WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;

  return NextResponse.json({ quote, waLink }, { status: 201 });
}
