import { NextResponse } from 'next/server';
import { agentFetch } from '@/lib/agent-server';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { status, body } = await agentFetch(`/api/conversations/${encodeURIComponent(id)}`);
  return NextResponse.json(body, { status });
}
