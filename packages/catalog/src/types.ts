export type CategoryId =
  | 'cpu'
  | 'motherboard'
  | 'memory'
  | 'gpu'
  | 'storage'
  | 'psu'
  | 'case'
  | 'cooler';

export type CpuSocket = 'AM4' | 'AM5' | 'LGA1700';
export type MemoryType = 'DDR4' | 'DDR5';
export type FormFactor = 'ATX' | 'mATX' | 'ITX';

export interface BaseProduct {
  id: string;
  sku: string;
  brand: string;
  name: string;
  priceCents: number;
  highlight?: string;
}

export interface CpuProduct extends BaseProduct {
  category: 'cpu';
  socket: CpuSocket;
  cores: number;
  threads: number;
  baseClockGhz: number;
  boostClockGhz: number;
  tdpW: number;
}

export interface MotherboardProduct extends BaseProduct {
  category: 'motherboard';
  socket: CpuSocket;
  memoryType: MemoryType;
  formFactor: FormFactor;
  m2Slots: number;
  sataPorts: number;
}

export interface MemoryProduct extends BaseProduct {
  category: 'memory';
  memoryType: MemoryType;
  capacityGb: number;
  sticks: number;
  speedMhz: number;
}

export interface GpuProduct extends BaseProduct {
  category: 'gpu';
  tdpW: number;
  lengthMm: number;
  vramGb: number;
}

export interface StorageProduct extends BaseProduct {
  category: 'storage';
  interface: 'NVMe' | 'SATA';
  formFactor: 'M.2' | '2.5"' | '3.5"';
  capacityGb: number;
}

export interface PsuProduct extends BaseProduct {
  category: 'psu';
  wattage: number;
  modular: boolean;
}

export interface CaseProduct extends BaseProduct {
  category: 'case';
  formFactors: FormFactor[];
  maxGpuLengthMm: number;
}

export interface CoolerProduct extends BaseProduct {
  category: 'cooler';
  sockets: CpuSocket[];
  type: 'air' | 'aio';
  tdpW: number;
}

export type HardwareProduct =
  | CpuProduct
  | MotherboardProduct
  | MemoryProduct
  | GpuProduct
  | StorageProduct
  | PsuProduct
  | CaseProduct
  | CoolerProduct;

export type BuildSelection = Partial<Record<CategoryId, HardwareProduct>>;
