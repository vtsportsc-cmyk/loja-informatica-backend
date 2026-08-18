import { NextResponse } from 'next/server';
import { CATALOG, CATEGORY_LABELS, CATEGORY_ORDER } from '@/lib/catalog';

export const dynamic = 'force-static';

export function GET() {
  const data = {
    categories: CATEGORY_ORDER.map((id) => ({ id, label: CATEGORY_LABELS[id] })),
    products: CATALOG,
  };
  return NextResponse.json(data, {
    headers: {
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}
