import { NextResponse } from 'next/server';
import { CATALOG, CATEGORY_LABELS, CATEGORY_ORDER } from '@/lib/catalog';

export const dynamic = 'force-static';

export function GET() {
  return NextResponse.json({
    categories: CATEGORY_ORDER.map((id) => ({ id, label: CATEGORY_LABELS[id] })),
    products: CATALOG,
  });
}
