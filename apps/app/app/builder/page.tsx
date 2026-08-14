'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  CATEGORY_LABELS,
  formatBRL,
  INSTALLMENT_MONTHLY_RATE,
  MAX_INSTALLMENTS,
  PIX_DISCOUNT_PERCENT,
  validateBuild,
  hasBlocking,
} from '@loja/catalog';
import type { BuildSelection, CategoryId, HardwareProduct } from '@loja/catalog';
import type { QuoteItemJson } from '@/lib/quotes-store';

interface ProductsResponse {
  categories: Array<{ id: CategoryId; label: string }>;
  products: HardwareProduct[];
}

const QUANTITY_DEFAULTS: Partial<Record<CategoryId, number>> = { memory: 2 };

function specSummary(p: HardwareProduct): string | null {
  switch (p.category) {
    case 'cpu':
      return `${p.socket} | ${p.cores}C/${p.threads}T | ${p.baseClockGhz}–${p.boostClockGhz}GHz`;
    case 'motherboard':
      return `${p.socket} | ${p.memoryType} | ${p.formFactor} | ${p.m2Slots}xM.2`;
    case 'memory':
      return `${p.memoryType} ${p.capacityGb}GB ${p.speedMhz}MHz`;
    case 'gpu':
      return `${p.vramGb}GB | ${p.lengthMm}mm | ${p.tdpW}W`;
    case 'storage':
      return `${p.interface} ${p.formFactor} ${p.capacityGb}GB`;
    case 'psu':
      return `${p.wattage}W ${p.modular ? 'modular' : ''}`;
    case 'case':
      return `GPUs até ${p.maxGpuLengthMm}mm`;
    case 'cooler':
      return `${p.type.toUpperCase()} ${p.tdpW}W`;
    default:
      return null;
  }
}

export default function BuilderPage() {
  const [data, setData] = useState<ProductsResponse | null>(null);
  const [selection, setSelection] = useState<Partial<Record<CategoryId, string>>>({});
  const [quantities, setQuantities] = useState<Partial<Record<CategoryId, number>>>({});
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ quote: { code: string; pixTotalCents: number }; waLink: string } | null>(null);

  useEffect(() => {
    fetch('/api/products')
      .then((res) => res.json())
      .then(setData)
      .catch(() => setError('falha ao carregar o catálogo'));
  }, []);

  const byId = useMemo(() => {
    const map = new Map<string, HardwareProduct>();
    for (const p of data?.products ?? []) map.set(p.id, p);
    return map;
  }, [data]);

  const buildSelection: BuildSelection = useMemo(() => {
    const sel: BuildSelection = {};
    for (const [category, id] of Object.entries(selection)) {
      const product = id ? byId.get(id) : undefined;
      if (product) sel[category as CategoryId] = product;
    }
    return sel;
  }, [selection, byId]);

  const issues = useMemo(() => validateBuild(buildSelection), [buildSelection]);
  const blocked = hasBlocking(issues);

  const selectedProducts = Object.entries(selection)
    .map(([category, id]) => (id ? { category: category as CategoryId, product: byId.get(id) } : null))
    .filter((x): x is { category: CategoryId; product: HardwareProduct } => Boolean(x?.product));

  const subtotalCents = useMemo(
    () =>
      selectedProducts.reduce(
        (sum, { category, product }) => sum + product.priceCents * (quantities[category] ?? QUANTITY_DEFAULTS[category] ?? 1),
        0,
      ),
    [selectedProducts, quantities],
  );
  const pixTotalCents = Math.round(subtotalCents * (1 - PIX_DISCOUNT_PERCENT / 100));
  const discountCents = subtotalCents - pixTotalCents;
  const factor = Math.pow(1 + INSTALLMENT_MONTHLY_RATE, MAX_INSTALLMENTS);
  const parceledTotalCents = Math.round(subtotalCents * factor);
  const monthlyValueCents = Math.round(parceledTotalCents / MAX_INSTALLMENTS);

  async function generateQuote() {
    setGenerating(true);
    setError(null);
    try {
      const items: QuoteItemJson[] = selectedProducts.map(({ category, product }) => ({
        category,
        name: product.name,
        brand: product.brand,
        model: product.name,
        sku: product.sku,
        specSummary: specSummary(product),
        unitPriceCents: product.priceCents,
        quantity: quantities[category] ?? QUANTITY_DEFAULTS[category] ?? 1,
      }));
      const res = await fetch('/api/quotes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ customerName, customerPhone, items }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'falha ao gerar orçamento');
      setResult(body);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  if (error && !data) {
    return <main className="mx-auto max-w-6xl px-4 py-16 text-center text-red-400">{error}</main>;
  }

  if (!data) {
    return <main className="mx-auto max-w-6xl px-4 py-16 text-center text-zinc-500">Carregando catálogo...</main>;
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-black">Monte seu PC</h1>
        <p className="mt-1 text-zinc-400">
          Selecione uma peça por categoria. Compatibilidade e preços são validados em tempo real.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          {data.categories.map((category) => {
            const products = data.products.filter((p) => p.category === category.id);
            const selectedId = selection[category.id];
            return (
              <div key={category.id} className="card">
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="font-bold">{category.label}</h2>
                  {selectedId && (
                    <span className="text-xs text-zinc-500">
                      {quantities[category.id] ?? QUANTITY_DEFAULTS[category.id] ?? 1}x
                    </span>
                  )}
                </div>
                <select
                  className="select"
                  value={selectedId ?? ''}
                  onChange={(e) => {
                    const next = { ...selection, [category.id]: e.target.value };
                    setSelection(next);
                    if (e.target.value) {
                      setQuantities((q) => ({ ...q, [category.id]: q[category.id] ?? QUANTITY_DEFAULTS[category.id] ?? 1 }));
                    }
                  }}
                >
                  <option value="">— selecione —</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.brand} {p.name} — {formatBRL(p.priceCents)}
                      {p.highlight ? ` (${p.highlight})` : ''}
                    </option>
                  ))}
                </select>
                {selectedId && (
                  <p className="mt-2 text-xs text-zinc-400">{specSummary(byId.get(selectedId)!)}</p>
                )}
              </div>
            );
          })}
        </div>

        <aside className="space-y-4">
          <div className="card sticky top-16">
            <h2 className="mb-3 font-bold">Resumo</h2>
            {selectedProducts.length === 0 ? (
              <p className="text-sm text-zinc-500">Nenhuma peça selecionada ainda.</p>
            ) : (
              <ul className="mb-4 space-y-1 text-sm">
                {selectedProducts.map(({ category, product }) => {
                  const qty = quantities[category] ?? QUANTITY_DEFAULTS[category] ?? 1;
                  return (
                    <li key={category} className="flex items-center justify-between gap-2">
                      <span className="truncate text-zinc-300">{qty}x {product.name}</span>
                      <span className="whitespace-nowrap text-zinc-400">
                        {formatBRL(product.priceCents * qty)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}

            <dl className="space-y-1 border-t border-night-700 pt-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-zinc-400">Subtotal</dt>
                <dd>{formatBRL(subtotalCents)}</dd>
              </div>
              <div className="flex justify-between text-brand">
                <dt>PIX (-{PIX_DISCOUNT_PERCENT}%)</dt>
                <dd>-{formatBRL(discountCents)}</dd>
              </div>
              <div className="flex justify-between border-t border-night-700 pt-2 text-base font-bold">
                <dt>Total PIX</dt>
                <dd className="text-brand">{formatBRL(pixTotalCents)}</dd>
              </div>
              <div className="flex justify-between text-xs text-zinc-400">
                <dt>ou {MAX_INSTALLMENTS}x de</dt>
                <dd>{formatBRL(monthlyValueCents)}</dd>
              </div>
              <div className="flex justify-between text-xs text-zinc-500">
                <dt>Total parcelado</dt>
                <dd>{formatBRL(parceledTotalCents)}</dd>
              </div>
            </dl>

            {issues.length > 0 && (
              <div className="mt-4 space-y-1">
                {issues.map((issue, i) => (
                  <p
                    key={i}
                    className={`rounded-lg px-3 py-2 text-xs ${
                      issue.level === 'blocking'
                        ? 'bg-red-950/60 text-red-300'
                        : 'bg-amber-950/60 text-amber-300'
                    }`}
                  >
                    {issue.message}
                  </p>
                ))}
              </div>
            )}

            <div className="mt-4 space-y-2">
              <input
                className="input"
                placeholder="Seu nome (opcional)"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
              />
              <input
                className="input"
                placeholder="WhatsApp com DDD (opcional)"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
              />
              <button
                className="btn-primary w-full"
                disabled={selectedProducts.length === 0 || blocked || generating}
                onClick={generateQuote}
              >
                {generating ? 'Gerando...' : 'Gerar orçamento'}
              </button>
              {blocked && (
                <p className="text-center text-xs text-red-400">
                  Corrija as incompatibilidades para gerar o orçamento.
                </p>
              )}
            </div>
          </div>

          {result && (
            <div className="card border-brand/50 bg-brand/5">
              <h3 className="font-bold text-brand">Orçamento gerado!</h3>
              <p className="mt-1 text-sm">
                Código: <span className="font-mono font-bold">{result.quote.code}</span>
              </p>
              <p className="mt-1 text-sm">
                Total PIX: <span className="font-bold">{formatBRL(result.quote.pixTotalCents)}</span>
              </p>
              <a
                href={result.waLink}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-primary mt-3 w-full"
              >
                Enviar pelo WhatsApp
              </a>
              <p className="mt-2 text-center text-xs text-zinc-500">
                Link do orçamento: <span className="font-mono">/quote/{result.quote.code}</span>
              </p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
