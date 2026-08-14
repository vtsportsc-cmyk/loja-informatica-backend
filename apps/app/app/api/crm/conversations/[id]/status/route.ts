import { NextResponse } from 'next/server';
import { agentFetch } from '@/lib/agent-server';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const { status, body: result } = await agentFetch(
    `/api/conversations/${encodeURIComponent(id)}/status`,
    { method: 'POST', body: JSON.stringify(body) },
  );
  return NextResponse.json(result, { status });
}
