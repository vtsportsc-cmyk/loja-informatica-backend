import { z } from 'zod';
import { ProductSpecResolver, toNumber } from './resolveProductSpecs.js';
import type { CompatibilityCheck, CompatibilityReport } from '../types.js';

// ============================================================================
// Skill: hardware_compatibility_check
// Analisa se o hardware desejado pelo cliente e compativel:
//  - soquete do processador x soquete da placa-mae (AMD/Intel)
//  - TDP (CPU+GPU) x potencia da fonte de alimentacao
//  - tipo de memoria DDR4/DDR5 x placa-mae
//  - tamanho do gabinete (max GPU/PSU) x placa de video / fonte
// ============================================================================

export const hardwareCompatibilityRequestSchema = z.object({
  items: z
    .array(
      z.object({
        kind: z.enum(['cpu', 'motherboard', 'gpu', 'psu', 'memory', 'case']),
        description: z.string().min(2).describe('descricao do modelo, ex: "Ryzen 5 8600G"'),
        sku: z.string().optional(),
        quantity: z.number().int().min(1).default(1),
      }),
    )
    .min(1),
});
export type HardwareCompatibilityRequest = z.infer<typeof hardwareCompatibilityRequestSchema>;

export interface HardwareCompatibilitySkillDeps {
  resolver?: ProductSpecResolver;
}

export class HardwareCompatibilitySkill {
  private readonly resolver: ProductSpecResolver;

  constructor(deps: HardwareCompatibilitySkillDeps = {}) {
    this.resolver = deps.resolver ?? new ProductSpecResolver();
  }

  async run(request: HardwareCompatibilityRequest): Promise<CompatibilityReport> {
    const checks: CompatibilityCheck[] = [];

    const resolved = new Map<string, { kind: string; specs: NonNullable<Awaited<ReturnType<ProductSpecResolver['resolve']>>>['specs'] }>();
    for (const item of request.items) {
      const hit = await this.resolver.resolve(item.description, item.sku);
      if (hit) {
        resolved.set(item.kind, { kind: item.kind, specs: hit.specs });
      } else {
        checks.push({
          id: 'other',
          label: `Identificacao de "${item.description}"`,
          expected: 'produto conhecido na base',
          actual: 'nao encontrado',
          passed: false,
          message: `Nao encontrei especificacoes de "${item.description}" na base tecnica.`,
        });
      }
    }

    const get = (kind: string) => resolved.get(kind);

    const cpu = get('cpu');
    const mb = get('motherboard');
    const mem = get('memory');
    const gpu = get('gpu');
    const psu = get('psu');
    const case_ = get('case');

    // 1) Soquete: processador x placa-mae
    if (cpu && mb) {
      const cpuSocket = cpu.specs.socket;
      const mbSocket = mb.specs.socket;
      if (cpuSocket && mbSocket) {
        checks.push({
          id: 'cpu_socket',
          label: 'Soquete do processador',
          expected: mbSocket,
          actual: cpuSocket,
          passed: cpuSocket === mbSocket,
          message:
            cpuSocket === mbSocket
              ? `Compativel: soquete ${cpuSocket} em ambos.`
              : `Incompativel: processador e ${cpuSocket}, mas a placa-mae usa ${mbSocket}.`,
        });
      }
    }

    // 2) Memoria DDR4/DDR5: memoria x placa-mae
    if (mem && mb) {
      const memType = mem.specs.memoryType;
      const mbMemType = mb.specs.memoryType;
      if (memType && mbMemType) {
        checks.push({
          id: 'memory_type',
          label: 'Tipo de memoria',
          expected: mbMemType,
          actual: memType,
          passed: memType === mbMemType,
          message:
            memType === mbMemType
              ? `Compativel: ${memType}.`
              : `Incompativel: memoria ${memType}, mas a placa-mae aceita ${mbMemType}.`,
        });
      }
    }

    // 3) Fonte: TDP total (CPU+GPU+folga) x wattagem da fonte
    if (psu && (cpu || gpu)) {
      const psuWattage = toNumber(psu.specs, 'psuWattage');
      const cpuTdp = cpu ? toNumber(cpu.specs, 'tdpW') ?? 0 : 0;
      const gpuTdp = gpu ? toNumber(gpu.specs, 'tdpW') ?? 0 : 0;
      const requiredW = Math.ceil((cpuTdp + gpuTdp) * 1.5);
      if (psuWattage && requiredW > 0) {
        checks.push({
          id: 'psu_tdp',
          label: 'TDP x Fonte de alimentacao',
          expected: `fonte >= ${requiredW}W (folga 50% sobre ${cpuTdp + gpuTdp}W)`,
          actual: `${psuWattage}W`,
          passed: psuWattage >= requiredW,
          message:
            psuWattage >= requiredW
              ? `A fonte de ${psuWattage}W atende o consumo estimado de ${requiredW}W.`
              : `Fonte insuficiente: ${psuWattage}W para um consumo estimado de ${requiredW}W. Recomendo trocar a fonte.`,
        });
      }
    }

    // 4) Gabinete x placa de video
    if (case_ && gpu) {
      const maxGpu = toNumber(case_.specs, 'maxGpuLengthMm');
      const gpuLen = toNumber(gpu.specs, 'gpuLengthMm');
      if (maxGpu && gpuLen) {
        checks.push({
          id: 'case_gpu',
          label: 'Tamanho do gabinete x placa de video',
          expected: `GPU <= ${maxGpu}mm`,
          actual: `${gpuLen}mm`,
          passed: gpuLen <= maxGpu,
          message:
            gpuLen <= maxGpu
              ? `A GPU de ${gpuLen}mm cabe no gabinete (limite ${maxGpu}mm).`
              : `GPU de ${gpuLen}mm nao cabe: o gabinete suporta ate ${maxGpu}mm.`,
        });
      }
    }

    if (checks.length === 0) {
      checks.push({
        id: 'other',
        label: 'Compatibilidade',
        expected: 'informacoes suficientes',
        actual: 'sem dados suficientes',
        passed: false,
        message: 'Nao ha dados suficientes para validar a compatibilidade. Descreva modelo do processador, placa-mae, memoria e fonte.',
      });
    }

    const compatible = checks.every((c) => c.passed);
    const failed = checks.filter((c) => !c.passed);
    const summary = compatible
      ? 'Todos os componentes sao compativeis entre si.'
      : `Encontrei ${failed.length} incompatibilidade(s). ${failed.map((f) => f.message).join(' ')}`;

    return { compatible, checks, summary };
  }
}
