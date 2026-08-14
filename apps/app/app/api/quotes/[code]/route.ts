import { NextResponse } from 'next/server';
import { getQuote } from '@/lib/quotes-store';

export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const quote = await getQuote(code);
  if (!quote) {
    return NextResponse.json({ error: 'orcamento nao encontrado' }, { status: 404 });
  }
  return NextResponse.json({ quote });
}
