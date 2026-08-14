// ============================================================================
// Base de conhecimento RAG (inspirada no Khoj).
// Schema para consulta rapida de dados tecnicos dos produtos:
// manuais de placa-mae, especificacoes de fontes, memoria, gabinete e GPU.
// ============================================================================

export interface KnowledgeProduct {
  id: string;
  category: 'motherboard' | 'cpu' | 'psu' | 'memory' | 'case' | 'gpu' | 'storage' | 'other';
  model: string;
  /** Specs normalizadas usadas nas checagens de compatibilidade. */
  specs: {
    socket?: string; // ex: AM5, LGA1700
    chipset?: string;
    memoryType?: string; // ex: DDR4, DDR5
    memorySlots?: number;
    maxMemoryGB?: number;
    tdpW?: number;
    formFactor?: string; // ex: ATX, mATX, ITX
    maxGpuLengthMm?: number;
    maxPsuDepthMm?: number;
    psuWattage?: number; // potencia nominal da fonte
    psuConnectors?: string[];
    gpuLengthMm?: number;
    gpuConnector?: string;
    ramSpeed?: string;
    storageInterface?: string;
    [key: string]: string | number | string[] | undefined;
  };
  source: string;
  updatedAt: string;
}

export interface KnowledgeSearchResult {
  product: KnowledgeProduct;
  score: number;
}

// Seed de dados tecnicos usados nos testes e no desenvolvimento.
export const KNOWLEDGE_SEED: readonly KnowledgeProduct[] = [
  {
    id: 'kb-mb-001',
    category: 'motherboard',
    model: 'Gigabyte B650M Gaming WiFi',
    specs: {
      socket: 'AM5',
      chipset: 'B650',
      memoryType: 'DDR5',
      memorySlots: 4,
      maxMemoryGB: 128,
      formFactor: 'mATX',
    },
    source: 'manual-placa-mae/gigabyte-b650m',
    updatedAt: '2026-01-15T00:00:00.000Z',
  },
  {
    id: 'kb-mb-002',
    category: 'motherboard',
    model: 'ASUS Prime B760M-A',
    specs: {
      socket: 'LGA1700',
      chipset: 'B760',
      memoryType: 'DDR5',
      memorySlots: 4,
      maxMemoryGB: 192,
      formFactor: 'mATX',
    },
    source: 'manual-placa-mae/asus-prime-b760m',
    updatedAt: '2026-01-20T00:00:00.000Z',
  },
  {
    id: 'kb-cpu-001',
    category: 'cpu',
    model: 'AMD Ryzen 5 8600G',
    specs: { socket: 'AM5', tdpW: 65 },
    source: 'specs-cpu/amd-ryzen-8600g',
    updatedAt: '2026-01-10T00:00:00.000Z',
  },
  {
    id: 'kb-cpu-002',
    category: 'cpu',
    model: 'Intel Core i5-13400F',
    specs: { socket: 'LGA1700', tdpW: 65 },
    source: 'specs-cpu/intel-i5-13400f',
    updatedAt: '2026-01-10T00:00:00.000Z',
  },
  {
    id: 'kb-cpu-003',
    category: 'cpu',
    model: 'Intel Core i7-14700KF',
    specs: { socket: 'LGA1700', tdpW: 253 },
    source: 'specs-cpu/intel-i7-14700kf',
    updatedAt: '2026-01-10T00:00:00.000Z',
  },
  {
    id: 'kb-psu-001',
    category: 'psu',
    model: 'Corsair RM650x (650W)',
    specs: { psuWattage: 650, formFactor: 'ATX' },
    source: 'specs-fonte/corsair-rm650x',
    updatedAt: '2026-01-05T00:00:00.000Z',
  },
  {
    id: 'kb-psu-002',
    category: 'psu',
    model: 'Corsair RM850x (850W)',
    specs: { psuWattage: 850, formFactor: 'ATX' },
    source: 'specs-fonte/corsair-rm850x',
    updatedAt: '2026-01-05T00:00:00.000Z',
  },
  {
    id: 'kb-mem-001',
    category: 'memory',
    model: 'Kingston Fury Beast DDR5-6000 16GB',
    specs: { memoryType: 'DDR5', ramSpeed: '6000MHz', capacityGB: 16 },
    source: 'specs-memoria/kingston-fury-ddr5',
    updatedAt: '2026-01-12T00:00:00.000Z',
  },
  {
    id: 'kb-mem-002',
    category: 'memory',
    model: 'Kingston Fury Beast DDR4-3200 16GB',
    specs: { memoryType: 'DDR4', ramSpeed: '3200MHz', capacityGB: 16 },
    source: 'specs-memoria/kingston-fury-ddr4',
    updatedAt: '2026-01-12T00:00:00.000Z',
  },
  {
    id: 'kb-case-001',
    category: 'case',
    model: 'Corsair 4000D Airflow',
    specs: { formFactor: 'ATX', maxGpuLengthMm: 360, maxPsuDepthMm: 220 },
    source: 'specs-gabinete/corsair-4000d',
    updatedAt: '2026-01-08T00:00:00.000Z',
  },
  {
    id: 'kb-gpu-001',
    category: 'gpu',
    model: 'RTX 4060 Ti 16GB',
    specs: { gpuLengthMm: 199, tdpW: 160, gpuConnector: '8-pin PCIe' },
    source: 'specs-gpu/rtx4060ti',
    updatedAt: '2026-01-09T00:00:00.000Z',
  },
  {
    id: 'kb-gpu-002',
    category: 'gpu',
    model: 'RTX 4070 Super 12GB',
    specs: { gpuLengthMm: 267, tdpW: 220, gpuConnector: '12VHPWR' },
    source: 'specs-gpu/rtx4070super',
    updatedAt: '2026-01-09T00:00:00.000Z',
  },
];

export class KnowledgeBase {
  private readonly products: KnowledgeProduct[];

  constructor(products: readonly KnowledgeProduct[] = KNOWLEDGE_SEED) {
    this.products = [...products];
  }

  get all(): readonly KnowledgeProduct[] {
    return this.products;
  }

  /** Indexa/atualiza produtos adicionais (ex.: catalogo dinamicamente vindo do ERP). */
  ingest(products: readonly KnowledgeProduct[]): void {
    for (const product of products) {
      const idx = this.products.findIndex((p) => p.id === product.id);
      if (idx >= 0) this.products[idx] = product;
      else this.products.push(product);
    }
  }

  /** Busca por termos livres: modelo, categoria, socket, memoria, etc. */
  search(query: string, limit = 5): KnowledgeSearchResult[] {
    const tokens = query
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 1);

    if (tokens.length === 0) return [];

    const scored = this.products.map((product) => {
      let score = 0;
      const haystack = [
        product.model,
        product.category,
        product.source,
        ...Object.values(product.specs).map(String),
      ]
        .join(' ')
        .toLowerCase();

      for (const token of tokens) {
        if (haystack.includes(token)) {
          score += 1;
          if (product.model.toLowerCase().includes(token)) score += 2;
        }
      }
      return { product, score };
    });

    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /** Busca direta por spec normalizada, ex.: socket='AM5'. */
  findWhere(predicate: (p: KnowledgeProduct) => boolean): KnowledgeProduct[] {
    return this.products.filter(predicate);
  }

  /** Converte itens do catalogo do ERP em KnowledgeProduct (RAG dinamico). */
  static fromStockItems(
    items: ReadonlyArray<{
      sku: string;
      name: string;
      category?: string;
      specs?: Record<string, string>;
    }>,
    now: Date = new Date(),
  ): KnowledgeProduct[] {
    return items.map((item) => {
      const specs: KnowledgeProduct['specs'] = {};
      for (const [key, value] of Object.entries(item.specs ?? {})) {
        specs[key] = value;
      }
      return {
        id: `erp-${item.sku}`,
        category: mapCategory(item.category),
        model: item.name,
        specs,
        source: `erp://stock/${item.sku}`,
        updatedAt: now.toISOString(),
      };
    });
  }
}

function mapCategory(category?: string): KnowledgeProduct['category'] {
  const c = category?.toLowerCase() ?? '';
  if (c.includes('placa') && (c.includes('mae') || c.includes('mother'))) return 'motherboard';
  if (c.includes('cpu') || c.includes('processador')) return 'cpu';
  if (c.includes('fonte') || c.includes('psu')) return 'psu';
  if (c.includes('memoria') || c.includes('ram') || c.includes('memory')) return 'memory';
  if (c.includes('gabinete') || c.includes('case')) return 'case';
  if (c.includes('video') || c.includes('gpu')) return 'gpu';
  if (c.includes('ssd') || c.includes('hdd') || c.includes('storage')) return 'storage';
  return 'other';
}
