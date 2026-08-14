'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatBRL } from '@loja/catalog';
import { FUNNEL_STATUSES, FUNNEL_STATUS_LABELS, FUNNEL_STATUS_COLORS } from '@/lib/funnel';

type ModuleId = 'funil' | 'atendimento' | 'pedidos';

interface QuoteItem {
  sku: string | null;
  name: string;
  unitPriceCents: number;
  quantity: number;
}

interface QuoteSummary {
  code: string;
  totalCents: number;
  pixTotalCents: number;
  installments: number;
  monthlyValueCents: number;
  parceledTotalCents: number;
  blingOrderId: string | null;
  blingNumber: string | null;
  blingStatus: string | null;
  items: QuoteItem[];
}

interface Conversation {
  id: string;
  whatsappId: string;
  customerName: string | null;
  funnelStatus: string;
  humanMode: boolean;
  assignedAgentId: string | null;
  unreadCount: number;
  lastMessageAt: string | null;
  quote?: QuoteSummary | null;
}

interface Message {
  id: string;
  direction: 'inbound' | 'outbound';
  type: string;
  text: string | null;
  agentId: string | null;
  createdAt: string;
}

interface DetailResponse {
  conversation: Conversation;
  messages: Message[];
}

const MODULES: Array<{ id: ModuleId; label: string; hint: string }> = [
  { id: 'funil', label: 'Funil de Vendas', hint: 'Kanban de leads' },
  { id: 'atendimento', label: 'Atendimento', hint: 'WhatsApp multi-atendente' },
  { id: 'pedidos', label: 'Pedidos', hint: 'Orçamentos e emissão' },
];

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
}

export default function CrmPage() {
  const [module, setModule] = useState<ModuleId>('funil');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [agentName, setAgentName] = useState('');
  const [draft, setDraft] = useState('');
  const [statusDraft, setStatusDraft] = useState<string>('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setAgentName(localStorage.getItem('crm-agent-name') ?? '');
  }, []);

  const refreshList = useCallback(async () => {
    const res = await fetch('/api/crm/conversations');
    const body = await res.json();
    if (!res.ok) {
      setError(body.error ?? 'falha ao listar conversas');
      return;
    }
    setConversations(body.conversations ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  const openConversation = useCallback(async (id: string) => {
    setSelectedId(id);
    const res = await fetch(`/api/crm/conversations/${encodeURIComponent(id)}`);
    const body = await res.json();
    if (res.ok) {
      setDetail(body);
      setStatusDraft(body.conversation.funnelStatus);
    } else {
      setError(body.error ?? 'falha ao carregar a conversa');
    }
  }, []);

  async function openConversationInChat(id: string) {
    setModule('atendimento');
    await openConversation(id);
  }

  async function sendMessage() {
    if (!selectedId || !draft.trim()) return;
    const res = await fetch('/api/crm/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conversationId: selectedId, agentId: agentName || null, text: draft.trim() }),
    });
    if (res.ok) {
      setDraft('');
      await openConversation(selectedId);
    } else {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? 'falha ao enviar mensagem');
    }
  }

  async function handoff(action: 'assume' | 'release') {
    if (!selectedId) return;
    if (action === 'assume' && !agentName.trim()) {
      setError('informe seu nome (agente) para assumir o atendimento');
      return;
    }
    const res = await fetch(`/api/crm/conversations/${encodeURIComponent(selectedId)}/handoff`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, agentId: agentName.trim() || undefined }),
    });
    if (res.ok) {
      await openConversation(selectedId);
      await refreshList();
    } else {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? 'falha ao alternar o atendimento');
    }
  }

  async function changeStatus() {
    if (!selectedId || !statusDraft) return;
    const res = await fetch(`/api/crm/conversations/${encodeURIComponent(selectedId)}/status`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: statusDraft }),
    });
    if (res.ok) {
      await openConversation(selectedId);
      await refreshList();
    } else {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? 'falha ao atualizar o funil');
    }
  }

  async function emitOrder(id: string) {
    const res = await fetch(`/api/crm/conversations/${encodeURIComponent(id)}/status`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'AGUARDANDO_NF' }),
    });
    if (res.ok) {
      setError(null);
      await refreshList();
    } else {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? 'falha ao emitir o pedido');
    }
  }

  const selected = detail?.conversation ?? null;
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter(
      (c) =>
        (c.customerName ?? '').toLowerCase().includes(q) ||
        c.whatsappId.includes(q) ||
        (c.quote?.code ?? '').toLowerCase().includes(q),
    );
  }, [conversations, search]);

  const orders = useMemo(() => conversations.filter((c) => c.quote), [conversations]);
  const ordersStats = useMemo(() => {
    const totalPix = orders.reduce((sum, c) => sum + (c.quote?.pixTotalCents ?? 0), 0);
    return {
      count: orders.length,
      totalPix,
      awaitingNf: orders.filter((c) => c.funnelStatus === 'AGUARDANDO_NF').length,
      blingEmitted: orders.filter((c) => c.quote?.blingNumber).length,
    };
  }, [orders]);

  return (
    <div className="flex flex-col gap-3 p-4 lg:h-[calc(100vh-120px)]">
      {/* Barra superior */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-black tracking-tight">Painel de Operações</h1>
          <nav className="flex gap-1">
            {MODULES.map((m) => (
              <button
                key={m.id}
                onClick={() => setModule(m.id)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                  module === m.id
                    ? 'bg-brand text-night-950'
                    : 'bg-night-800 text-zinc-300 hover:text-white'
                }`}
              >
                {m.label}
              </button>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <input
            className="input w-52"
            placeholder="Seu nome (agente)"
            value={agentName}
            onChange={(e) => {
              setAgentName(e.target.value);
              localStorage.setItem('crm-agent-name', e.target.value);
            }}
          />
          <button className="btn-ghost !px-3 !py-1.5 !text-xs" onClick={() => void refreshList()}>
            Atualizar
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-900/60 bg-red-950/60 px-4 py-2 text-xs text-red-300">
          {error}
          <button className="ml-2 font-bold" onClick={() => setError(null)}>
            fechar
          </button>
        </div>
      )}

      {loading ? (
        <p className="py-16 text-center text-sm text-zinc-500">Carregando operações...</p>
      ) : module === 'funil' ? (
        <Kanban conversations={conversations} onOpen={openConversationInChat} />
      ) : module === 'atendimento' ? (
        <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[300px_1fr_320px]">
          <div className="card flex min-h-0 flex-col overflow-hidden !p-0">
            <div className="border-b border-night-700 p-2">
              <input
                className="input !py-1.5 !text-xs"
                placeholder="Buscar conversa ou pedido..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
              {filtered.length === 0 && (
                <p className="px-2 py-6 text-center text-xs text-zinc-500">
                  Nenhuma conversa encontrada.
                </p>
              )}
              {filtered.map((c) => (
                <button
                  key={c.id}
                  onClick={() => void openConversation(c.id)}
                  className={`w-full rounded-lg px-2 py-1.5 text-left transition-colors ${
                    selectedId === c.id ? 'bg-brand/15' : 'hover:bg-night-800'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-semibold">
                      {c.customerName || c.whatsappId}
                    </span>
                    <span className="shrink-0 text-[10px] text-zinc-500">
                      {fmtTime(c.lastMessageAt)}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1 text-[10px]">
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${FUNNEL_STATUS_COLORS[c.funnelStatus as keyof typeof FUNNEL_STATUS_COLORS] ?? 'bg-zinc-500'}`}
                    />
                    <span className="truncate text-zinc-400">{c.whatsappId}</span>
                    {c.quote && (
                      <span className="ml-auto font-mono text-zinc-500">{c.quote.code}</span>
                    )}
                  </div>
                  {(c.unreadCount > 0 || c.humanMode) && (
                    <div className="mt-0.5 flex items-center gap-1 text-[10px]">
                      {c.unreadCount > 0 && (
                        <span className="rounded bg-red-500 px-1 font-bold text-white">
                          {c.unreadCount}
                        </span>
                      )}
                      <span
                        className={`rounded px-1 ${
                          c.humanMode
                            ? 'bg-brand/20 text-brand'
                            : 'bg-blue-500/20 text-blue-300'
                        }`}
                      >
                        {c.humanMode
                          ? `humano${c.assignedAgentId ? `:${c.assignedAgentId}` : ''}`
                          : 'IA'}
                      </span>
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="card flex min-h-0 flex-col overflow-hidden !p-0">
            {!selected ? (
              <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">
                Selecione uma conversa à esquerda.
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between border-b border-night-700 px-3 py-2">
                  <div>
                    <h2 className="text-sm font-bold">{selected.customerName || selected.whatsappId}</h2>
                    <p className="text-[10px] text-zinc-500">
                      {selected.whatsappId} · atualizado {fmtDate(selected.lastMessageAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {selected.humanMode ? (
                      <button
                        className="btn-ghost !px-2 !py-1 !text-[11px]"
                        onClick={() => void handoff('release')}
                      >
                        Liberar para a IA
                      </button>
                    ) : (
                      <button
                        className="btn-primary !px-2 !py-1 !text-[11px]"
                        onClick={() => void handoff('assume')}
                      >
                        Assumir (humano)
                      </button>
                    )}
                    <span className="text-[10px] text-zinc-500">
                      {selected.humanMode ? 'atendimento humano' : 'IA respondendo'}
                    </span>
                  </div>
                </div>

                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
                  {detail?.messages.length === 0 && (
                    <p className="text-center text-xs text-zinc-500">Sem mensagens ainda.</p>
                  )}
                  {detail?.messages.map((m) => (
                    <div
                      key={m.id}
                      className={`flex ${m.direction === 'inbound' ? 'justify-start' : 'justify-end'}`}
                    >
                      <div
                        className={`max-w-[75%] rounded-xl px-3 py-1.5 text-xs ${
                          m.direction === 'inbound'
                            ? 'bg-night-700 text-zinc-100'
                            : 'bg-brand/20 text-brand-dark'
                        }`}
                      >
                        <p className="whitespace-pre-wrap">{m.text}</p>
                        <p className="mt-0.5 text-[9px] opacity-70">
                          {m.direction === 'inbound' ? 'cliente' : m.agentId ? m.agentId : 'IA'} ·{' '}
                          {fmtTime(m.createdAt)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="border-t border-night-700 p-3">
                  <div className="flex gap-2">
                    <input
                      className="input !py-1.5 !text-xs"
                      placeholder="Mensagem para o cliente..."
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void sendMessage();
                      }}
                    />
                    <button className="btn-primary !px-3 !py-1.5 !text-xs" onClick={() => void sendMessage()}>
                      Enviar
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="card min-h-0 overflow-y-auto !p-0">
            {!selected ? (
              <p className="p-4 text-xs text-zinc-500">Contexto do cliente aparecerá aqui.</p>
            ) : (
              <div className="space-y-3 p-3">
                <div>
                  <h3 className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                    Funil
                  </h3>
                  <div className="mt-1.5 flex items-center gap-2">
                    <select
                      className="select !py-1.5 !text-xs"
                      value={statusDraft}
                      onChange={(e) => setStatusDraft(e.target.value)}
                    >
                      {FUNNEL_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {FUNNEL_STATUS_LABELS[s]}
                        </option>
                      ))}
                    </select>
                    <button className="btn-ghost !px-2 !py-1 !text-[11px]" onClick={() => void changeStatus()}>
                      Salvar
                    </button>
                  </div>
                </div>

                <div>
                  <h3 className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                    Pedido
                  </h3>
                  {selected.quote ? (
                    <OrderSummary quote={selected.quote} status={selected.funnelStatus} onEmit={() => void emitOrder(selected.id)} />
                  ) : (
                    <p className="mt-1.5 text-xs text-zinc-500">
                      Nenhum orçamento do Monte seu PC vinculado a esta conversa.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <OrdersTable
          orders={orders}
          stats={ordersStats}
          onOpen={openConversationInChat}
          onEmit={(id) => void emitOrder(id)}
        />
      )}
    </div>
  );
}

function Kanban({
  conversations,
  onOpen,
}: {
  conversations: Conversation[];
  onOpen: (id: string) => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto">
      {FUNNEL_STATUSES.map((status) => {
        const cards = conversations.filter((c) => c.funnelStatus === status);
        return (
          <div key={status} className="card flex min-w-[250px] flex-col !p-0">
            <div className="sticky top-0 flex items-center justify-between border-b border-night-700 px-3 py-2">
              <div className="flex items-center gap-2">
                <span
                  className={`h-2 w-2 rounded-full ${FUNNEL_STATUS_COLORS[status] ?? 'bg-zinc-500'}`}
                />
                <span className="text-xs font-bold">{FUNNEL_STATUS_LABELS[status]}</span>
              </div>
              <span className="rounded bg-night-700 px-1.5 text-[10px] text-zinc-400">
                {cards.length}
              </span>
            </div>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
              {cards.length === 0 && (
                <p className="px-2 py-6 text-center text-[10px] text-zinc-600">vazio</p>
              )}
              {cards.map((c) => (
                <button
                  key={c.id}
                  onClick={() => onOpen(c.id)}
                  className="w-full rounded-lg border border-night-700 bg-night-800 p-2 text-left transition-colors hover:border-brand/50"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-semibold">
                      {c.customerName || c.whatsappId}
                    </span>
                    <span className="shrink-0 text-[10px] text-zinc-500">
                      {fmtTime(c.lastMessageAt)}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-zinc-400">
                    {c.quote && (
                      <>
                        <span className="rounded bg-brand/15 px-1 font-mono text-brand">
                          {c.quote.code}
                        </span>
                        <span className="font-semibold text-brand">
                          {formatBRL(c.quote.pixTotalCents)}
                        </span>
                      </>
                    )}
                    {c.unreadCount > 0 && (
                      <span className="rounded bg-red-500 px-1 font-bold text-white">
                        {c.unreadCount}
                      </span>
                    )}
                    <span
                      className={`ml-auto rounded px-1 ${
                        c.humanMode ? 'bg-brand/20 text-brand' : 'bg-blue-500/20 text-blue-300'
                      }`}
                    >
                      {c.humanMode ? 'humano' : 'IA'}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function OrderSummary({
  quote,
  status,
  onEmit,
}: {
  quote: QuoteSummary;
  status: string;
  onEmit: () => void;
}) {
  const emitted = Boolean(quote.blingNumber);
  return (
    <div className="mt-1.5 space-y-2 rounded-lg border border-night-700 bg-night-800 p-2">
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs font-bold text-brand">{quote.code}</span>
        <span className="text-[10px] text-zinc-400">{quote.items.length} itens</span>
      </div>
      <ul className="space-y-1 text-[11px] text-zinc-300">
        {quote.items.slice(0, 6).map((item, i) => (
          <li key={i} className="flex justify-between gap-2">
            <span className="truncate">
              {item.quantity}x {item.name}
            </span>
            <span className="shrink-0 text-zinc-400">
              {formatBRL(item.unitPriceCents * item.quantity)}
            </span>
          </li>
        ))}
        {quote.items.length > 6 && (
          <li className="text-[10px] text-zinc-500">+ {quote.items.length - 6} itens...</li>
        )}
      </ul>
      <dl className="space-y-0.5 border-t border-night-700 pt-1.5 text-[11px]">
        <div className="flex justify-between">
          <dt className="text-zinc-400">Subtotal</dt>
          <dd>{formatBRL(quote.totalCents)}</dd>
        </div>
        <div className="flex justify-between text-brand">
          <dt>PIX</dt>
          <dd>{formatBRL(quote.pixTotalCents)}</dd>
        </div>
        <div className="flex justify-between text-zinc-500">
          <dt>ou {quote.installments}x de</dt>
          <dd>{formatBRL(quote.monthlyValueCents)}</dd>
        </div>
      </dl>
      {emitted ? (
        <p className="rounded bg-emerald-500/15 px-2 py-1 text-[10px] text-emerald-300">
          Pedido Bling #{quote.blingNumber}
          {quote.blingStatus ? ` · ${quote.blingStatus}` : ''} — emissão/expedição iniciada.
        </p>
      ) : status === 'AGUARDANDO_NF' ? (
        <p className="rounded bg-amber-500/15 px-2 py-1 text-[10px] text-amber-300">
          Aguardando emissão da NF (Bling).
        </p>
      ) : (
        <button className="btn-primary w-full !px-2 !py-1.5 !text-[11px]" onClick={onEmit}>
          Emitir pedido (NF/expedição)
        </button>
      )}
    </div>
  );
}

function OrdersTable({
  orders,
  stats,
  onOpen,
  onEmit,
}: {
  orders: Conversation[];
  stats: { count: number; totalPix: number; awaitingNf: number; blingEmitted: number };
  onOpen: (id: string) => void;
  onEmit: (id: string) => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-4">
        <StatCard label="Pedidos (orçamentos)" value={String(stats.count)} />
        <StatCard label="Soma total PIX" value={formatBRL(stats.totalPix)} />
        <StatCard label="Aguardando NF" value={String(stats.awaitingNf)} />
        <StatCard label="Emitidos no Bling" value={String(stats.blingEmitted)} />
      </div>

      <div className="card min-h-0 flex-1 overflow-auto !p-0">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-night-800 text-[10px] uppercase tracking-wider text-zinc-400">
            <tr>
              <th className="px-3 py-2">Código</th>
              <th className="px-3 py-2">Cliente</th>
              <th className="px-3 py-2">Atualizado</th>
              <th className="px-3 py-2 text-right">Itens</th>
              <th className="px-3 py-2 text-right">Total PIX</th>
              <th className="px-3 py-2 text-right">Parcelado</th>
              <th className="px-3 py-2">Funil</th>
              <th className="px-3 py-2">Bling</th>
              <th className="px-3 py-2 text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {orders.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-10 text-center text-zinc-500">
                  Nenhum pedido vinculado ainda. Os orçamentos confirmados pelo WhatsApp aparecem aqui.
                </td>
              </tr>
            )}
            {orders.map((c) => {
              const q = c.quote!;
              return (
                <tr key={c.id} className="border-t border-night-800 hover:bg-night-800/60">
                  <td className="px-3 py-2 font-mono font-bold text-brand">{q.code}</td>
                  <td className="px-3 py-2">
                    <span className="font-semibold">{c.customerName || c.whatsappId}</span>
                    <span className="block text-[10px] text-zinc-500">{c.whatsappId}</span>
                  </td>
                  <td className="px-3 py-2 text-zinc-400">{fmtDate(c.lastMessageAt)}</td>
                  <td className="px-3 py-2 text-right">{q.items.length}</td>
                  <td className="px-3 py-2 text-right font-semibold text-brand">
                    {formatBRL(q.pixTotalCents)}
                  </td>
                  <td className="px-3 py-2 text-right text-zinc-400">
                    {q.installments}x de {formatBRL(q.monthlyValueCents)}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        FUNNEL_STATUS_COLORS[c.funnelStatus as keyof typeof FUNNEL_STATUS_COLORS] ?? 'bg-zinc-500'
                      } bg-opacity-20 text-zinc-100`}
                    >
                      {FUNNEL_STATUS_LABELS[c.funnelStatus as keyof typeof FUNNEL_STATUS_LABELS] ?? c.funnelStatus}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-zinc-400">
                    {q.blingNumber ? `#${q.blingNumber}` : q.blingStatus ?? '—'}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1">
                      <button className="btn-ghost !px-2 !py-1 !text-[10px]" onClick={() => onOpen(c.id)}>
                        Conversa
                      </button>
                      {!q.blingNumber && c.funnelStatus !== 'AGUARDANDO_NF' && (
                        <button className="btn-primary !px-2 !py-1 !text-[10px]" onClick={() => onEmit(c.id)}>
                          Emitir
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="card">
      <p className="text-[10px] uppercase tracking-wider text-zinc-400">{label}</p>
      <p className="mt-0.5 text-lg font-black text-zinc-100">{value}</p>
    </div>
  );
}
