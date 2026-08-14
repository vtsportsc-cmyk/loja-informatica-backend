'use client';

import { useCallback, useEffect, useState } from 'react';

const FUNNEL_STATUSES = [
  'NOVO',
  'MONTANDO_PC',
  'EM_QUALIFICACAO',
  'CARRINHO',
  'PIX_GERADO',
  'AGUARDANDO_NF',
  'CONCLUIDO',
] as const;

interface Conversation {
  id: string;
  whatsappId: string;
  customerName: string | null;
  funnelStatus: string;
  humanMode: boolean;
  assignedAgentId: string | null;
  unreadCount: number;
  lastMessageAt: string | null;
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

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
}

export default function CrmPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [agentName, setAgentName] = useState('');
  const [draft, setDraft] = useState('');
  const [statusDraft, setStatusDraft] = useState<string>('');
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

  async function openConversation(id: string) {
    setSelectedId(id);
    const res = await fetch(`/api/crm/conversations/${encodeURIComponent(id)}`);
    const body = await res.json();
    if (res.ok) {
      setDetail(body);
      setStatusDraft(body.conversation.funnelStatus);
    }
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

  const selected = detail?.conversation;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black">Painel de Atendimento</h1>
          <p className="mt-1 text-zinc-400">
            CRM multi-atendente: acompanhe o funil, assuma conversas e responda pelo WhatsApp.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            className="input w-56"
            placeholder="Seu nome (agente)"
            value={agentName}
            onChange={(e) => {
              setAgentName(e.target.value);
              localStorage.setItem('crm-agent-name', e.target.value);
            }}
          />
          <button className="btn-ghost" onClick={() => void refreshList()}>
            Atualizar
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-red-950/60 px-4 py-2 text-sm text-red-300">
          {error}
          <button className="ml-2 font-bold" onClick={() => setError(null)}>
            fechar
          </button>
        </div>
      )}

      {loading ? (
        <p className="py-16 text-center text-zinc-500">Carregando conversas...</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
          <div className="space-y-2">
            {conversations.length === 0 && (
              <p className="card text-sm text-zinc-500">
                Nenhuma conversa ainda. As mensagens do WhatsApp (Evolution API) aparecem aqui.
              </p>
            )}
            {conversations.map((c) => (
              <button
                key={c.id}
                onClick={() => void openConversation(c.id)}
                className={`card w-full text-left transition-colors ${
                  selectedId === c.id ? 'border-brand' : 'hover:border-night-500'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-semibold">
                    {c.customerName || c.whatsappId}
                  </span>
                  <span className="text-xs text-zinc-500">{fmtTime(c.lastMessageAt)}</span>
                </div>
                <div className="mt-1 flex items-center gap-2 text-xs">
                  <span className="rounded-full bg-night-700 px-2 py-0.5 text-zinc-300">
                    {c.funnelStatus}
                  </span>
                  {c.humanMode ? (
                    <span className="rounded-full bg-brand/20 px-2 py-0.5 text-brand">
                      humano {c.assignedAgentId ? `· ${c.assignedAgentId}` : ''}
                    </span>
                  ) : (
                    <span className="rounded-full bg-blue-500/20 px-2 py-0.5 text-blue-300">IA</span>
                  )}
                  {c.unreadCount > 0 && (
                    <span className="ml-auto rounded-full bg-red-500 px-2 py-0.5 font-bold text-white">
                      {c.unreadCount}
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>

          <div className="card flex min-h-[480px] flex-col">
            {!selected ? (
              <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">
                Selecione uma conversa para ver o histórico.
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between border-b border-night-700 pb-3">
                  <div>
                    <h2 className="font-bold">{selected.customerName || selected.whatsappId}</h2>
                    <p className="text-xs text-zinc-500">
                      {selected.whatsappId} · atualizado {fmtDate(selected.lastMessageAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <select
                      className="select !w-40"
                      value={statusDraft}
                      onChange={(e) => setStatusDraft(e.target.value)}
                    >
                      {FUNNEL_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                    <button className="btn-ghost !px-2 !py-1" onClick={() => void changeStatus()}>
                      Salvar
                    </button>
                  </div>
                </div>

                <div className="flex-1 space-y-2 overflow-y-auto py-3" style={{ maxHeight: 420 }}>
                  {detail?.messages.length === 0 && (
                    <p className="text-center text-xs text-zinc-500">Sem mensagens ainda.</p>
                  )}
                  {detail?.messages.map((m) => (
                    <div
                      key={m.id}
                      className={`flex ${m.direction === 'inbound' ? 'justify-start' : 'justify-end'}`}
                    >
                      <div
                        className={`max-w-[75%] rounded-xl px-3 py-2 text-sm ${
                          m.direction === 'inbound'
                            ? 'bg-night-700 text-zinc-100'
                            : 'bg-brand/20 text-brand-dark'
                        }`}
                      >
                        <p className="whitespace-pre-wrap">{m.text}</p>
                        <p className="mt-0.5 text-[10px] opacity-70">
                          {m.direction === 'inbound' ? 'cliente' : m.agentId ? m.agentId : 'IA'} ·{' '}
                          {fmtTime(m.createdAt)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="border-t border-night-700 pt-3">
                  <div className="flex gap-2">
                    <input
                      className="input"
                      placeholder="Escreva a mensagem para o cliente..."
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void sendMessage();
                      }}
                    />
                    <button className="btn-primary" onClick={() => void sendMessage()}>
                      Enviar
                    </button>
                  </div>
                  <div className="mt-2 flex gap-2 text-xs">
                    {selected.humanMode ? (
                      <button className="btn-ghost !px-3 !py-1" onClick={() => void handoff('release')}>
                        Liberar para a IA
                      </button>
                    ) : (
                      <button className="btn-ghost !px-3 !py-1" onClick={() => void handoff('assume')}>
                        Assumir atendimento
                      </button>
                    )}
                    <span className="text-zinc-500">
                      {selected.humanMode
                        ? `Atendimento humano ativo${selected.assignedAgentId ? ` (${selected.assignedAgentId})` : ''}`
                        : 'IA respondendo automaticamente'}
                    </span>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
