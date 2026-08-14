import type {
  BuildSelection,
  CaseProduct,
  CoolerProduct,
  CpuProduct,
  GpuProduct,
  HardwareProduct,
  MemoryProduct,
  MotherboardProduct,
  PsuProduct,
  StorageProduct,
} from './types.js';

export type CompatibilityLevel = 'blocking' | 'warning';

export interface CompatibilityIssue {
  level: CompatibilityLevel;
  category: HardwareProduct['category'];
  message: string;
}

const HEADROOM_WATTS = 150;
const COMFORT_MARGIN_WATTS = 250;

// ============================================================================
// Validacao dinamica de compatibilidade (tempo real, no frontend).
// Regras:
//   1. Socket do processador deve bater com o da placa-mae.
//   2. Tipo de memoria (DDR4/DDR5) deve bater com o suportado pela placa-mae.
//   3. Fonte deve entregar potencia suficiente para CPU + GPU + margem.
//   4. Placa de video deve caber no gabinete (comprimento).
//   5. Form factor da placa-mae deve ser suportado pelo gabinete.
//   6. Quantidade de SSDs M.2/SATA deve respeitar os slots da placa-mae.
//   7. Cooler deve suportar o socket do processador.
// ============================================================================
export function validateBuild(selection: BuildSelection): CompatibilityIssue[] {
  const issues: CompatibilityIssue[] = [];
  const cpu = selection.cpu as CpuProduct | undefined;
  const motherboard = selection.motherboard as MotherboardProduct | undefined;
  const memory = selection.memory as MemoryProduct | undefined;
  const gpu = selection.gpu as GpuProduct | undefined;
  const storage = selection.storage as StorageProduct | undefined;
  const psu = selection.psu as PsuProduct | undefined;
  const pcCase = selection.case as CaseProduct | undefined;
  const cooler = selection.cooler as CoolerProduct | undefined;

  // 1. CPU <-> Placa-Mae (socket)
  if (cpu && motherboard && cpu.socket !== motherboard.socket) {
    issues.push({
      level: 'blocking',
      category: 'motherboard',
      message: `Socket incompatível: processador ${cpu.socket} não encaixa na placa-mãe ${motherboard.socket}.`,
    });
  }

  // 2. Memoria <-> Placa-Mae (DDR)
  if (memory && motherboard && memory.memoryType !== motherboard.memoryType) {
    issues.push({
      level: 'blocking',
      category: 'memory',
      message: `Memória ${memory.memoryType} não é compatível com a placa-mãe (slots ${motherboard.memoryType}).`,
    });
  }

  // 3. Fonte <-> CPU + GPU (wattage)
  if (psu && (cpu || gpu)) {
    const cpuTdp = cpu?.tdpW ?? 0;
    const gpuTdp = gpu?.tdpW ?? 0;
    const needed = cpuTdp + gpuTdp;
    if (psu.wattage < needed + HEADROOM_WATTS) {
      const shortBy = needed + HEADROOM_WATTS - psu.wattage;
      issues.push({
        level: 'blocking',
        category: 'psu',
        message: `Fonte de ${psu.wattage}W insuficiente para este conjunto (CPU ${cpuTdp}W + GPU ${gpuTdp}W + margem). Recomendado: ${needed + HEADROOM_WATTS}W.`,
      });
    } else if (psu.wattage < needed + COMFORT_MARGIN_WATTS) {
      issues.push({
        level: 'warning',
        category: 'psu',
        message: `Fonte de ${psu.wattage}W é suficiente, mas sem folga para upgrades futuros. Considere ${needed + COMFORT_MARGIN_WATTS}W.`,
      });
    }
  }

  // 4. GPU <-> Gabinete (comprimento)
  if (gpu && pcCase && gpu.lengthMm > pcCase.maxGpuLengthMm) {
    issues.push({
      level: 'blocking',
      category: 'case',
      message: `A GPU de ${gpu.lengthMm}mm não cabe no gabinete (máximo ${pcCase.maxGpuLengthMm}mm).`,
    });
  }

  // 5. Placa-Mae <-> Gabinete (form factor)
  if (motherboard && pcCase && !pcCase.formFactors.includes(motherboard.formFactor)) {
    issues.push({
      level: 'blocking',
      category: 'case',
      message: `Gabinete não suporta placa-mãe no formato ${motherboard.formFactor}.`,
    });
  }

  // 6. Armazenamento <-> Placa-Mae (slots)
  if (storage && motherboard) {
    if (storage.interface === 'NVMe' && motherboard.m2Slots < 1) {
      issues.push({
        level: 'blocking',
        category: 'storage',
        message: 'A placa-mãe não possui slot M.2 para SSD NVMe.',
      });
    }
    if (storage.interface === 'SATA' && storage.formFactor === '3.5"' && motherboard.sataPorts < 1) {
      issues.push({
        level: 'blocking',
        category: 'storage',
        message: 'A placa-mãe não possui portas SATA para este HD.',
      });
    }
  }

  // 7. Cooler <-> CPU (socket)
  if (cooler && cpu && !cooler.sockets.includes(cpu.socket)) {
    issues.push({
      level: 'blocking',
      category: 'cooler',
      message: `Cooler não suporta o socket ${cpu.socket}.`,
    });
  }

  return issues;
}

export function countBlocking(issues: CompatibilityIssue[]): number {
  return issues.filter((i) => i.level === 'blocking').length;
}

export function hasBlocking(issues: CompatibilityIssue[]): boolean {
  return countBlocking(issues) > 0;
}
