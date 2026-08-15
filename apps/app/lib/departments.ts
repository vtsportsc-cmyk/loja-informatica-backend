// Metadados dos departamentos (filas) do CRM, client-safe (nao importa
// @loja/db, que instancia o PrismaClient no modulo). Mantido em sintonia com
// packages/db/src/index.ts.
export const DEPARTMENTS = ['VENDAS', 'SUPORTE', 'MONTAGEM'] as const;

export type Department = (typeof DEPARTMENTS)[number];

export const DEPARTMENT_LABELS: Record<Department, string> = {
  VENDAS: 'Vendas',
  SUPORTE: 'Suporte',
  MONTAGEM: 'Montagem',
};

export const DEPARTMENT_COLORS: Record<Department, string> = {
  VENDAS: 'bg-brand',
  SUPORTE: 'bg-blue-500',
  MONTAGEM: 'bg-violet-500',
};

export function isDepartment(value: string): value is Department {
  return (DEPARTMENTS as readonly string[]).includes(value);
}
