export type FaqCategory =
  | 'atendimento'
  | 'precos'
  | 'servicos'
  | 'garantia'
  | 'entrega'
  | 'pagamento';

export interface FaqEntry {
  id: string;
  category: FaqCategory;
  question: string;
  answer: string;
  keywords: string[];
}

export const DEFAULT_FAQS: readonly FaqEntry[] = [
  {
    id: 'atendimento-horario',
    category: 'atendimento',
    question: 'Qual e o horario de atendimento?',
    answer:
      'Atendemos de segunda a sexta das 9h as 18h e sabados das 9h as 13h. O suporte pelo WhatsApp funciona ate as 22h nos dias uteis.',
    keywords: ['horario', 'funcionamento', 'aberto', 'abre', 'fecha', 'atendimento'],
  },
  {
    id: 'endereco-loja',
    category: 'atendimento',
    question: 'Qual e o endereco da loja?',
    answer:
      'Estamos na Av. Paulista, 1000 - Bela Vista, Sao Paulo - SP. Atendimento presencial de segunda a sexta das 9h as 18h e sabados das 9h as 13h.',
    keywords: [
      'endereco',
      'endereço',
      'localizacao',
      'local da loja',
      'onde fica a loja',
      'fica a loja',
      'cep da loja',
    ],
  },
  {
    id: 'atendimento-contato',
    category: 'atendimento',
    question: 'Como falo com um atendente?',
    answer:
      'Posso resolver a maioria das duvidas aqui mesmo. Se voce precisar de um atendimento presencial ou de agendamento com a equipe comercial, basta pedir que eu encaminho.',
    keywords: ['atendente', 'humano', 'vendedor', 'pessoal', 'loja', 'contato', 'agendar', 'agendamento'],
  },
  {
    id: 'precos-tabela',
    category: 'precos',
    question: 'Quais sao os precos de referencia?',
    answer:
      'Kit PC gamer de entrada a partir de R$ 3.999,00; estacao de trabalho a partir de R$ 6.999,00; upgrades de memoria a partir de R$ 249,90; frete a partir de R$ 25,00. Os precos podem variar conforme a disponibilidade em estoque.',
    keywords: ['preco', 'precos', 'tabela', 'valor', 'quanto', 'custa', 'orcamento', 'kits', 'promocao'],
  },
  {
    id: 'servicos-catalogo',
    category: 'servicos',
    question: 'Quais servicos a loja oferece?',
    answer:
      'Montagem de PC sob medida, diagnostico e manutencao, upgrades de hardware, formatacao e limpeza, alem de atendimento presencial e consultoria online.',
    keywords: ['servicos', 'montagem', 'manutencao', 'diagnostico', 'upgrade', 'formatacao', 'limpeza', 'reparo', 'conserto'],
  },
  {
    id: 'servicos-prazo',
    category: 'servicos',
    question: 'Quanto tempo leva o servico?',
    answer:
      'Montagem e upgrades costumam ficar prontos entre 1 e 3 dias uteis, dependendo da disponibilidade das pecas. Servicos de manutencao tem prazo avaliado no diagnostico.',
    keywords: ['prazo', 'tempo', 'quanto tempo', 'demora', 'entrega servico', 'pronto'],
  },
  {
    id: 'garantia-padrao',
    category: 'garantia',
    question: 'Qual e a garantia dos produtos?',
    answer:
      'Garantia de 90 dias em servicos e a garantia de fabrica nas pecas e montagens (podendo chegar a 1 ano em componentes selecionados). A assistencia tecnica e propria.',
    keywords: ['garantia', 'defeito', 'troca', 'devolucao', 'cobertura', 'assistencia'],
  },
  {
    id: 'entrega-prazo',
    category: 'entrega',
    question: 'Qual o prazo e o custo da entrega?',
    answer:
      'Enviamos por PAC ou SEDEX com prazo de 2 a 7 dias uteis, dependendo da regiao. Voce tambem pode retirar na loja sem custo.',
    keywords: ['entrega', 'frete', 'prazo', 'sedex', 'pac', 'envio', 'retirada', 'endereco', 'cep'],
  },
  {
    id: 'pagamento-formas',
    category: 'pagamento',
    question: 'Quais formas de pagamento sao aceitas?',
    answer:
      'Aceitamos PIX (com desconto), cartao de credito em ate 12x e boleto. No PIX o pagamento e confirmado na hora e a separacao e a emissao da NF sao feitas pelo vendedor.',
    keywords: [
      'pagamento',
      'pix',
      'cartao',
      'credito',
      'boleto',
      'parcelamento',
      'parcelar',
      '12x',
      'desconto',
      'formas de pagamento',
      'aceitam pix',
    ],
  },
];

export class FaqService {
  private readonly entries: FaqEntry[];

  constructor(entries: readonly FaqEntry[] = DEFAULT_FAQS) {
    this.entries = [...entries];
  }

  get all(): readonly FaqEntry[] {
    return this.entries;
  }

  /** Busca FAQs relacionadas ao texto do cliente, ranqueadas por relevancia. */
  search(query: string, limit = 3): FaqEntry[] {
    const tokens = query.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1);
    if (tokens.length === 0) return [];

    const scored = this.entries
      .map((entry) => {
        const haystack = [entry.question, entry.answer, entry.category, ...entry.keywords]
          .join(' ')
          .toLowerCase();
        let score = 0;
        for (const token of tokens) {
          if (haystack.includes(token)) {
            score += 1;
            if (entry.keywords.some((k) => k.toLowerCase() === token)) score += 2;
            if (entry.question.toLowerCase().includes(token)) score += 2;
          }
        }
        return { entry, score };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => s.entry);

    return scored;
  }
}
