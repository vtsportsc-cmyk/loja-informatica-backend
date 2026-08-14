import type { KnowledgeProduct } from '../../rag/knowledgeBase.js';
import { KnowledgeBase } from '../../rag/knowledgeBase.js';
import type { StockItem } from '../../types/index.js';

// Normaliza specs vindas de fontes distintas (RAG / ERP) para um formato unico
// usado pelas checagens de compatibilidade.
export interface NormalizedSpecs {
  model: string;
  socket?: string;
  memoryType?: string;
  tdpW?: number;
  formFactor?: string;
  maxGpuLengthMm?: number;
  psuWattage?: number;
  gpuLengthMm?: number;
  [key: string]: string | number | undefined;
}

export type ResolvedProduct =
  | { source: 'kb'; product: KnowledgeProduct; specs: NormalizedSpecs }
  | { source: 'erp'; item: StockItem; specs: NormalizedSpecs };

export interface ProductSpecResolverDeps {
  knowledgeBase?: KnowledgeBase;
  stockBySku?: (sku: string) => Promise<StockItem | null>;
}

function normalize(specs: Record<string, unknown>, model: string): NormalizedSpecs {
  const out: NormalizedSpecs = { model };
  for (const [key, value] of Object.entries(specs)) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'string' || typeof value === 'number') {
      out[key] = value;
    }
  }
  return out;
}

export function toNumber(specs: NormalizedSpecs, key: string): number | undefined {
  const v = specs[key];
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

export class ProductSpecResolver {
  private readonly knowledgeBase: KnowledgeBase;
  private readonly stockBySku?: (sku: string) => Promise<StockItem | null>;

  constructor(deps: ProductSpecResolverDeps = {}) {
    this.knowledgeBase = deps.knowledgeBase ?? new KnowledgeBase();
    this.stockBySku = deps.stockBySku;
  }

  /** Resolve um item descrito em texto (via RAG) ou por SKU (via ERP + RAG). */
  async resolve(description: string, sku?: string): Promise<ResolvedProduct | null> {
    if (sku && this.stockBySku) {
      try {
        const item = await this.stockBySku(sku);
        if (item) {
          const specs = normalize(item.specs ?? {}, item.name);
          return { source: 'erp', item, specs };
        }
      } catch {
        // cai no RAG
      }
    }

    const kbHits = this.knowledgeBase.search(description, 1);
    const product = kbHits[0]?.product;
    if (!product) return null;

    return { source: 'kb', product, specs: normalize(product.specs, product.model) };
  }
}
