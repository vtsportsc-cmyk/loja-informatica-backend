import { NextRequest, NextResponse } from 'next/server';
import { agentFetch } from '@/lib/agent-server';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const cursor = searchParams.get('cursor') ?? undefined;
  const limit = searchParams.get('limit') ?? undefined;
  const qs = new URLSearchParams();
  if (cursor) qs.set('cursor', cursor);
  if (limit) qs.set('limit', limit);
  const query = qs.toString();
  const path = `/api/conversations${query ? `?${query}` : ''}`;
  const { status, body } = await agentFetch(path);
  return NextResponse.json(body, { status });
}
