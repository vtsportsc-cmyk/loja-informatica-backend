import { describe, it, expect } from 'vitest';
import { HardwareCompatibilitySkill } from '../src/agent/skills/hardwareCompatibilityCheck.js';
import { CartCalculatorSkill } from '../src/agent/skills/cartCalculator.js';
import { ProductSpecResolver } from '../src/agent/skills/resolveProductSpecs.js';
import { KnowledgeBase } from '../src/rag/knowledgeBase.js';
import { MockErpAdapter } from './mocks/erp.js';

describe('HardwareCompatibilitySkill', () => {
  const erp = new MockErpAdapter();

  it('aprova configuracao compativel (AM5/DDR5/TDP/fonte/gabinete)', async () => {
    const skill = new HardwareCompatibilitySkill({
      resolver: new ProductSpecResolver({
        knowledgeBase: new KnowledgeBase(),
        stockBySku: (sku) => erp.stockBySku(sku),
      }),
    });

    const report = await skill.run({
      items: [
        { kind: 'cpu', description: 'AMD Ryzen 5 8600G' },
        { kind: 'motherboard', description: 'Gigabyte B650M Gaming WiFi' },
        { kind: 'memory', description: 'Kingston Fury Beast DDR5 16GB' },
        { kind: 'gpu', description: 'RTX 4060 Ti 16GB' },
        { kind: 'psu', description: 'Corsair RM650x 650W' },
        { kind: 'case', description: 'Corsair 4000D Airflow' },
      ],
    });

    expect(report.compatible).toBe(true);
    expect(report.checks.map((c) => c.id)).toEqual(
      expect.arrayContaining(['cpu_socket', 'memory_type', 'psu_tdp', 'case_gpu']),
    );
    expect(report.checks.every((c) => c.passed)).toBe(true);
  });

  it('reprova configuracao com memoria DDR4 em placa DDR5', async () => {
    const skill = new HardwareCompatibilitySkill({
      resolver: new ProductSpecResolver({
        knowledgeBase: new KnowledgeBase(),
        stockBySku: (sku) => erp.stockBySku(sku),
      }),
    });

    const report = await skill.run({
      items: [
        { kind: 'motherboard', description: 'Gigabyte B650M Gaming WiFi' },
        { kind: 'memory', description: 'Kingston Fury Beast DDR4 16GB' },
      ],
    });

    expect(report.compatible).toBe(false);
    const memCheck = report.checks.find((c) => c.id === 'memory_type');
    expect(memCheck?.passed).toBe(false);
    expect(memCheck?.message).toContain('DDR4');
  });

  it('reprova fonte insuficiente para GPU potente', async () => {
    const skill = new HardwareCompatibilitySkill({});

    const report = await skill.run({
      items: [
        { kind: 'cpu', description: 'Intel Core i7-14700KF' },
        { kind: 'gpu', description: 'RTX 4070 Super 12GB' },
        { kind: 'psu', description: 'Corsair RM650x 650W' },
      ],
    });

    expect(report.compatible).toBe(false);
    const psuCheck = report.checks.find((c) => c.id === 'psu_tdp');
    expect(psuCheck?.passed).toBe(false);
    expect(psuCheck?.message).toContain('Fonte insuficiente');
  });

  it('reprova GPU que nao cabe no gabinete', async () => {
    const skill = new HardwareCompatibilitySkill({});

    const report = await skill.run({
      items: [
        { kind: 'gpu', description: 'RTX 4070 Super 12GB' },
        { kind: 'case', description: 'Corsair 4000D Airflow' },
      ],
    });

    expect(report.compatible).toBe(true); // 267mm < 360mm
  });
});

describe('CartCalculatorSkill', () => {
  const erp = new MockErpAdapter();
  const freight = async (zip: string, subtotal: number) => ({
    freightCents: zip === '01310100' ? 2500 : 4000,
    estimatedDays: 2,
    method: 'PAC',
  });

  it('consulta estoque, calcula frete, trava itens e monta o total', async () => {
    const skill = new CartCalculatorSkill(
      { stockBySku: (s) => erp.stockBySku(s), lockItem: (s, q) => erp.lockItem(s, q) },
      freight,
    );

    const cart = await skill.run({
      skus: [
        { sku: 'CPU-8600G', quantity: 1 },
        { sku: 'MB-B650M', quantity: 1 },
      ],
      zipCode: '01310100',
      lockItems: true,
    });

    expect(cart.outOfStockSkus).toEqual([]);
    expect(cart.subtotalCents).toBe(119990 + 149990);
    expect(cart.freightCents).toBe(2500);
    expect(cart.totalCents).toBe(119990 + 149990 + 2500);
    expect(cart.lines.every((l) => l.available)).toBe(true);
    expect(cart.lines.every((l) => l.lockId)).toBe(true);
    expect(erp.locks.size).toBe(2);
  });

  it('sinaliza SKU sem estoque sem travar', async () => {
    const outErp = new MockErpAdapter([
      {
        sku: 'GPU-RTX4060TI',
        name: 'RTX 4060 Ti 16GB',
        category: 'Placa de video',
        unit: 'un',
        available: 1,
        reserved: 0,
        priceCents: 289990,
        specs: {},
      },
    ]);
    const skill = new CartCalculatorSkill(
      { stockBySku: (s) => outErp.stockBySku(s), lockItem: (s, q) => outErp.lockItem(s, q) },
      freight,
    );

    const cart = await skill.run({
      skus: [{ sku: 'GPU-RTX4060TI', quantity: 3 }],
      zipCode: '01310100',
      lockItems: true,
    });

    expect(cart.outOfStockSkus).toEqual(['GPU-RTX4060TI']);
    expect(cart.lines[0]?.outOfStock).toBe(true);
    expect(cart.lines[0]?.lockId).toBeUndefined();
    expect(outErp.locks.size).toBe(0);
  });
});
