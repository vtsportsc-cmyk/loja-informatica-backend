'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Box,
  Check,
  CircuitBoard,
  Copy,
  Cpu,
  Fan,
  Gpu,
  HardDrive,
  Lock,
  MemoryStick,
  QrCode,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  formatBRL,
  INSTALLMENT_MONTHLY_RATE,
  MAX_INSTALLMENTS,
  PIX_DISCOUNT_PERCENT,
  platformForSocket,
  validateBuild,
  hasBlocking,
} from '@loja/catalog';
import type {
  BuildSelection,
  CategoryId,
  CpuPlatform,
  CpuProduct,
  HardwareProduct,
  MemoryProduct,
  MotherboardProduct,
} from '@loja/catalog';
import type { QuoteItemJson } from '@/lib/quotes-store';
import { formatPhoneBR, isValidPhoneBR } from '@/lib/phone';

interface ProductsResponse {
  categories: Array<{ id: CategoryId; label: string }>;
  products: HardwareProduct[];
}

const QUANTITY_DEFAULTS: Partial<Record<CategoryId, number>> = { memory: 2 };

/** Categorias cujo catalogo depende da plataforma (AMD/Intel) escolhida no passo 1. */
const PLATFORM_GATED: ReadonlySet<CategoryId> = new Set(['cpu', 'motherboard', 'memory']);

const CATEGORY_ICON: Record<CategoryId, LucideIcon> = {
  cpu: Cpu,
  motherboard: CircuitBoard,
  memory: MemoryStick,
  gpu: Gpu,
  storage: HardDrive,
  psu: Zap,
  case: Box,
  cooler: Fan,
};

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
  const [platform, setPlatform] = useState<CpuPlatform | null>(null);
  const [selection, setSelection] = useState<Partial<Record<CategoryId, string>>>({});
  const [quantities, setQuantities] = useState<Partial<Record<CategoryId, number>>>({});
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ quote: { code: string; pixTotalCents: number }; waLink: string } | null>(null);
  const [utm, setUtm] = useState<{ source: string; medium: string; campaign: string } | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const source = params.get('utm_source') ?? '';
    const medium = params.get('utm_medium') ?? '';
    const campaign = params.get('utm_campaign') ?? '';
    if (source || medium || campaign) setUtm({ source, medium, campaign });
  }, []);

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

  /** Catalogo compativel com a plataforma escolhida — elimina erros de socket/chipset na raiz. */
  const compatibleMotherboards = useMemo(() => {
    if (!data || !platform) return [];
    return (data.products.filter((p) => p.category === 'motherboard') as MotherboardProduct[]).filter(
      (mb) => platformForSocket(mb.socket) === platform,
    );
  }, [data, platform]);

  function productsForCategory(categoryId: CategoryId): HardwareProduct[] {
    if (!data) return [];
    const all = data.products.filter((p) => p.category === categoryId);
    if (!platform) return PLATFORM_GATED.has(categoryId) ? [] : all;
    if (categoryId === 'cpu') {
      return (all as CpuProduct[]).filter((p) => platformForSocket(p.socket) === platform);
    }
    if (categoryId === 'motherboard') {
      return compatibleMotherboards;
    }
    if (categoryId === 'memory') {
      const memoryTypes = new Set(compatibleMotherboards.map((mb) => mb.memoryType));
      return (all as MemoryProduct[]).filter((m) => memoryTypes.has(m.memoryType));
    }
    return all;
  }

  function choosePlatform(next: CpuPlatform) {
    if (next === platform) return;
    setPlatform(next);
    setSelection((sel) => {
      const copy = { ...sel };
      delete copy.cpu;
      delete copy.motherboard;
      delete copy.memory;
      return copy;
    });
    setQuantities((q) => {
      const copy = { ...q };
      delete copy.cpu;
      delete copy.motherboard;
      delete copy.memory;
      return copy;
    });
  }

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
    if (customerPhone && !isValidPhoneBR(customerPhone)) {
      toast.error('Número de telefone inválido', {
        description: 'Use o formato: (11) 99999-9999',
      });
      return;
    }
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
        body: JSON.stringify({
          customerName,
          customerPhone: customerPhone || undefined,
          items,
          utmSource: utm?.source ?? null,
          utmMedium: utm?.medium ?? null,
          utmCampaign: utm?.campaign ?? null,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'falha ao gerar orçamento');
      setResult(body);
      toast.success('Orçamento gerado!', {
        description: `Código: ${body.quote.code}`,
      });
    } catch (err) {
      const msg = (err as Error).message;
      setError(msg);
      toast.error('Erro ao gerar orçamento', { description: msg });
    } finally {
      setGenerating(false);
    }
  }

  if (error && !data) {
    return <main className="mx-auto max-w-6xl px-4 py-16 text-center text-red-400">{error}</main>;
  }

  if (!data) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-6">
          <div className="skeleton h-8 w-48" />
          <div className="skeleton mt-2 h-4 w-80" />
        </div>
        <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
          <div className="space-y-4">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
              <div key={i} className="glass-panel">
                <div className="skeleton h-4 w-28" />
                <div className="skeleton mt-2 h-9 w-full" />
              </div>
            ))}
          </div>
          <aside className="space-y-4">
            <div className="glass-panel sticky top-16">
              <div className="skeleton h-5 w-20" />
              <div className="skeleton mt-3 h-4 w-full" />
              <div className="skeleton mt-1 h-4 w-3/4" />
              <div className="skeleton mt-1 h-4 w-1/2" />
              <div className="divider mt-4" />
              <div className="skeleton mt-3 h-4 w-full" />
              <div className="skeleton mt-2 h-10 w-full" />
            </div>
          </aside>
        </div>
      </main>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-black tracking-tight">Monte seu PC</h1>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-zinc-400">
          Selecione uma peça por categoria.
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-300 ring-1 ring-inset ring-emerald-500/25">
            <ShieldCheck className="h-3 w-3" strokeWidth={2.25} />
            Compatibilidade validada em tempo real
          </span>
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          {/* ── Passo 1: Plataforma (obrigatorio) ── */}
          <div className="glass-panel">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 font-bold">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-night-700 text-[11px] font-black">1</span>
                Plataforma do processador
              </h2>
              {platform && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 ring-1 ring-inset ring-emerald-500/25">
                  <Check className="h-3 w-3" strokeWidth={2.5} /> Selecionada
                </span>
              )}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => choosePlatform('AMD')}
                className={`group relative overflow-hidden rounded-xl border p-4 text-left transition-all ${
                  platform === 'AMD'
                    ? 'border-red-500/50 bg-red-500/10 shadow-lg shadow-red-500/10'
                    : 'border-zinc-800/60 bg-night-900/40 hover:border-red-500/30 hover:bg-red-500/5'
                }`}
              >
                <div className="flex items-center gap-2 text-base font-bold text-red-300">
                  <span aria-hidden>🔴</span> AMD
                </div>
                <p className="mt-1 text-xs text-zinc-400">Sockets AM4 / AM5</p>
                {platform === 'AMD' && (
                  <Check className="absolute right-3 top-3 h-4 w-4 text-red-300" strokeWidth={2.5} />
                )}
              </button>
              <button
                type="button"
                onClick={() => choosePlatform('Intel')}
                className={`group relative overflow-hidden rounded-xl border p-4 text-left transition-all ${
                  platform === 'Intel'
                    ? 'border-blue-500/50 bg-blue-500/10 shadow-lg shadow-blue-500/10'
                    : 'border-zinc-800/60 bg-night-900/40 hover:border-blue-500/30 hover:bg-blue-500/5'
                }`}
              >
                <div className="flex items-center gap-2 text-base font-bold text-blue-300">
                  <span aria-hidden>🔵</span> INTEL
                </div>
                <p className="mt-1 text-xs text-zinc-400">Sockets LGA1700 / LGA1851</p>
                {platform === 'Intel' && (
                  <Check className="absolute right-3 top-3 h-4 w-4 text-blue-300" strokeWidth={2.5} />
                )}
              </button>
            </div>
            {!platform && (
              <p className="mt-3 text-xs text-zinc-500">
                Escolha a plataforma para liberar processadores, placas-mãe e memórias 100% compatíveis.
              </p>
            )}
          </div>

          {/* ── Categorias ── */}
          {data.categories.map((category) => {
            const gated = PLATFORM_GATED.has(category.id);
            const locked = gated && !platform;
            const products = productsForCategory(category.id);
            const selectedId = selection[category.id];
            const Icon = CATEGORY_ICON[category.id];

            if (locked) {
              return (
                <div key={category.id} className="glass-panel !border-dashed opacity-60">
                  <div className="flex items-center gap-2 text-zinc-500">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-night-800 text-zinc-600">
                      <Lock className="h-4 w-4" strokeWidth={2} />
                    </span>
                    <div>
                      <h2 className="font-bold text-zinc-400">{category.label}</h2>
                      <p className="text-xs">Selecione a plataforma no passo 1 para liberar.</p>
                    </div>
                  </div>
                </div>
              );
            }

            return (
              <div key={category.id} className="glass-panel">
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="flex items-center gap-2 font-bold">
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-night-800 text-zinc-400">
                      <Icon className="h-3.5 w-3.5" strokeWidth={2} />
                    </span>
                    {category.label}
                  </h2>
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
                {gated && platform && (
                  <p className="mt-1.5 text-[10px] text-zinc-600">
                    Filtrado para plataforma {platform === 'AMD' ? '🔴 AMD' : '🔵 Intel'} — {products.length} compatíve{products.length === 1 ? 'l' : 'is'}.
                  </p>
                )}
                {selectedId && (
                  <p className="mt-2 text-xs text-zinc-400">{specSummary(byId.get(selectedId)!)}</p>
                )}
              </div>
            );
          })}
        </div>

        <aside className="space-y-4">
          <div className="glass-panel sticky top-16">
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

            <dl className="space-y-1 border-t border-zinc-800/60 pt-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-zinc-400">Subtotal</dt>
                <dd>{formatBRL(subtotalCents)}</dd>
              </div>
              <div className="flex justify-between text-brand">
                <dt>PIX (-{PIX_DISCOUNT_PERCENT}%)</dt>
                <dd>-{formatBRL(discountCents)}</dd>
              </div>
              <div className="flex justify-between border-t border-zinc-800/60 pt-2 text-base font-bold">
                <dt>Total PIX</dt>
                <dd className="text-brand">{formatBRL(pixTotalCents)}</dd>
              </div>
              <div className="flex justify-between text-xs text-zinc-400">
                <dt>ou {MAX_INSTALLMENTS}x de (ref.)</dt>
                <dd>{formatBRL(monthlyValueCents)}</dd>
              </div>
              <div className="flex justify-between text-xs text-zinc-500">
                <dt>Total parcelado (ref.)</dt>
                <dd>{formatBRL(parceledTotalCents)}</dd>
              </div>
            </dl>

            {/* Aviso: pagamento exclusivo via PIX */}
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
              <QrCode className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-300" strokeWidth={2} />
              <p className="text-[10px] leading-snug text-emerald-200/80">
                Pagamento online <span className="font-semibold text-emerald-300">exclusivo via PIX</span>. Cartão de crédito é aceito
                EXCLUSIVAMENTE em compras presenciais em nossa loja física.
              </p>
            </div>

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
                onBlur={(e) => {
                  const formatted = formatPhoneBR(e.target.value);
                  if (formatted) setCustomerPhone(formatted);
                }}
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
            <div className="glass-panel !border-brand/40 !bg-brand/5">
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
              <button
                className="btn-ghost mt-2 w-full !border-zinc-800/60 text-xs"
                onClick={() => {
                  const url = `${window.location.origin}/quote/${result.quote.code}`;
                  navigator.clipboard.writeText(url).then(
                    () => toast.success('Link copiado!', { description: url }),
                    () => toast.error('Falha ao copiar link'),
                  );
                }}
              >
                <Copy className="mr-1.5 inline h-3 w-3" strokeWidth={2} />
                Copiar link do orçamento
              </button>
              <p className="mt-2 text-center text-xs text-zinc-500">
                Link do orçamento: <span className="font-mono">/quote/{result.quote.code}</span>
              </p>
              {utm && (utm.source || utm.medium || utm.campaign) && (
                <p className="mt-1 text-center text-[10px] text-zinc-600">
                  Origem:{' '}
                  <span className="font-mono text-zinc-500">
                    {utm.source || '—'}{utm.medium ? ` / ${utm.medium}` : ''}{utm.campaign ? ` / ${utm.campaign}` : ''}
                  </span>
                </p>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
