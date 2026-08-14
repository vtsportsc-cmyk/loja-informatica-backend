import {
  CATALOG,
  CATEGORY_LABELS,
  productsByCategory,
} from '@loja/catalog';
import type { CategoryId, HardwareProduct } from '@loja/catalog';

export const CATEGORY_ORDER: CategoryId[] = [
  'cpu',
  'motherboard',
  'memory',
  'gpu',
  'storage',
  'psu',
  'case',
  'cooler',
];

export { CATALOG, CATEGORY_LABELS, productsByCategory };
export type { CategoryId, HardwareProduct };
