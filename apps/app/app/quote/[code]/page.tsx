'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { toast } from 'sonner';
import { formatBRL } from '@loja/catalog';
import type { QuoteItemJson } from '@/lib/quotes-store';

interface QuoteResponse {
  quote?: {
    code: string;
    customerName: string | null;
    items: QuoteItemJson[];
    subtotalCents: number;
    discountCents: number;
    pixTotalCents: number;
    installments: number;
    monthlyValueCents: number;
    parceledTotalCents: number;
  };
  waLink?: string;
  error?: string;
}

export default function QuotePage() {
  const { code } = useParams<{ code: string }>();
  const [data, setData] = useState<QuoteResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!code) return;
    fetch(`/api/quotes/${encodeURIComponent(code)}`)
      .then((res) => res.json())
      .then((body) => {
        if (body.error) setError(body.error);
        else setData(body);
      })
      .catch(() => setError('falha ao carregar o orçamento'));
  }, [code]);

  if (error) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 className="text-2xl font-black">Orçamento não encontrado</h1>
        <p className="mt-2 text-zinc-400">{error}</p>
        <Link href="/builder" className="btn-primary mt-6">
          Voltar para o Monte seu PC
        </Link>
      </main>
    );
  }

  const quote = data?.quote;
  if (!quote) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-8">
        <div className="skeleton h-8 w-48" />
        <div className="skeleton mt-2 h-4 w-32" />
        <div className="card mt-6">
          <div className="space-y-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center justify-between gap-3">
                <div className="skeleton h-4 w-48" />
                <div className="skeleton h-4 w-20" />
              </div>
            ))}
          </div>
          <div className="divider mt-4" />
          <div className="space-y-2 pt-2">
            <div className="flex justify-between"><div className="skeleton h-4 w-20" /><div className="skeleton h-4 w-24" /></div>
            <div className="flex justify-between"><div className="skeleton h-4 w-24" /><div className="skeleton h-4 w-24" /></div>
            <div className="flex justify-between"><div className="skeleton h-5 w-20" /><div className="skeleton h-5 w-28" /></div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-3xl font-black">Orçamento {quote.code}</h1>
      {quote.customerName && <p className="mt-1 text-zinc-400">para {quote.customerName}</p>}

      <div className="card mt-6">
        <ul className="space-y-2">
          {quote.items.map((item, i) => (
            <li key={i} className="flex items-center justify-between gap-3 text-sm">
              <span className="text-zinc-300">
                {item.quantity}x {item.name}
                {item.specSummary ? <span className="text-zinc-500"> — {item.specSummary}</span> : null}
              </span>
              <span className="whitespace-nowrap text-zinc-400">
                {formatBRL(item.unitPriceCents * item.quantity)}
              </span>
            </li>
          ))}
        </ul>

        <dl className="mt-4 space-y-1 border-t border-night-700 pt-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-zinc-400">Subtotal</dt>
            <dd>{formatBRL(quote.subtotalCents)}</dd>
          </div>
          <div className="flex justify-between text-brand">
            <dt>Desconto PIX</dt>
            <dd>-{formatBRL(quote.discountCents)}</dd>
          </div>
          <div className="flex justify-between border-t border-night-700 pt-2 text-lg font-bold">
            <dt>Total PIX</dt>
            <dd className="text-brand">{formatBRL(quote.pixTotalCents)}</dd>
          </div>
          <div className="flex justify-between text-xs text-zinc-400">
            <dt>ou {quote.installments}x de</dt>
            <dd>{formatBRL(quote.monthlyValueCents)}</dd>
          </div>
          <div className="flex justify-between text-xs text-zinc-500">
            <dt>Total parcelado</dt>
            <dd>{formatBRL(quote.parceledTotalCents)}</dd>
          </div>
        </dl>

        {data?.waLink && (
          <a href={data.waLink} target="_blank" rel="noopener noreferrer" className="btn-primary mt-5 w-full">
            Confirmar no WhatsApp
          </a>
        )}
        <button
          className="btn-ghost mt-2 w-full border border-night-600 text-xs"
          onClick={() => {
            const url = window.location.href;
            navigator.clipboard.writeText(url).then(
              () => toast.success('Link copiado!', { description: url }),
              () => toast.error('Falha ao copiar link'),
            );
          }}
        >
          Copiar link do orçamento
        </button>
      </div>

      <Link href="/builder" className="btn-ghost mt-4">
        Montar outro PC
      </Link>
    </main>
  );
}
