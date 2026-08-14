import type { StockItem, StockLock } from '../src/types/index.js';

// ============================================================================
// Mock do ERP: estoque em memoria usado nos testes de skills e do agente.
// ============================================================================

export const MOCK_CATALOG: readonly StockItem[] = [
  {
    sku: 'CPU-8600G',
    name: 'AMD Ryzen 5 8600G',
    category: 'CPU',
    unit: 'un',
    available: 5,
    reserved: 0,
    priceCents: 119990,
    specs: { socket: 'AM5', tdpW: '65' },
  },
  {
    sku: 'MB-B650M',
    name: 'Gigabyte B650M Gaming WiFi',
    category: 'Placa-mae',
    unit: 'un',
    available: 3,
    reserved: 0,
    priceCents: 149990,
    specs: { socket: 'AM5', memoryType: 'DDR5', formFactor: 'mATX' },
  },
  {
    sku: 'MEM-DDR5-16',
    name: 'Kingston Fury Beast DDR5-6000 16GB',
    category: 'Memoria',
    unit: 'un',
    available: 10,
    reserved: 0,
    priceCents: 34990,
    specs: { memoryType: 'DDR5' },
  },
  {
    sku: 'MEM-DDR4-16',
    name: 'Kingston Fury Beast DDR4-3200 16GB',
    category: 'Memoria',
    unit: 'un',
    available: 7,
    reserved: 0,
    priceCents: 24990,
    specs: { memoryType: 'DDR4' },
  },
  {
    sku: 'PSU-650',
    name: 'Corsair RM650x (650W)',
    category: 'Fonte',
    unit: 'un',
    available: 4,
    reserved: 0,
    priceCents: 79990,
    specs: { psuWattage: '650' },
  },
  {
    sku: 'PSU-850',
    name: 'Corsair RM850x (850W)',
    category: 'Fonte',
    unit: 'un',
    available: 2,
    reserved: 0,
    priceCents: 99990,
    specs: { psuWattage: '850' },
  },
  {
    sku: 'GPU-RTX4060TI',
    name: 'RTX 4060 Ti 16GB',
    category: 'Placa de video',
    unit: 'un',
    available: 2,
    reserved: 0,
    priceCents: 289990,
    specs: { gpuLengthMm: '199', tdpW: '160' },
  },
  {
    sku: 'CASE-4000D',
    name: 'Corsair 4000D Airflow',
    category: 'Gabinete',
    unit: 'un',
    available: 3,
    reserved: 0,
    priceCents: 59990,
    specs: { formFactor: 'ATX', maxGpuLengthMm: '360' },
  },
];

export class MockErpAdapter {
  private readonly items: Map<string, StockItem>;
  readonly locks: Map<string, StockLock> = new Map();
  private lockCounter = 0;
  ordersCreated: unknown[] = [];

  constructor(catalog: readonly StockItem[] = MOCK_CATALOG) {
    this.items = new Map(catalog.map((i) => [i.sku, { ...i }]));
  }

  async stockBySku(sku: string): Promise<StockItem | null> {
    const item = this.items.get(sku);
    return item ? { ...item, active: item.active ?? true } : null;
  }

  async lockItem(sku: string, quantity: number): Promise<StockLock> {
    const item = this.items.get(sku);
    if (!item) throw new Error(`SKU inexistente: ${sku}`);
    if (item.available < quantity) throw new Error(`Estoque insuficiente para ${sku}`);
    item.available -= quantity;
    item.reserved += quantity;

    const lockId = `LOCK-${++this.lockCounter}`;
    const lock: StockLock = {
      lockId,
      sku,
      quantity,
      status: 'active',
      expiresAt: new Date(Date.now() + 900_000).toISOString(),
    };
    this.locks.set(lockId, lock);
    return lock;
  }

  async releaseLock(lockId: string): Promise<void> {
    const lock = this.locks.get(lockId);
    if (!lock) return;
    lock.status = 'released';
    const item = this.items.get(lock.sku);
    if (item) {
      item.available += lock.quantity;
      item.reserved = Math.max(0, item.reserved - lock.quantity);
    }
  }

  async createOrder(request: unknown): Promise<{ orderId: string; status: string }> {
    this.ordersCreated.push(request);
    const orderId = `ORDER-${7000 + this.ordersCreated.length}`;
    return { orderId, status: 'awaiting_nf' };
  }

  get catalogSnapshot(): StockItem[] {
    return [...this.items.values()];
  }
}
