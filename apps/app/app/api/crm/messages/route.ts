import { NextResponse } from 'next/server';
import { agentFetch } from '@/lib/agent-server';

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { status, body: result } = await agentFetch('/api/messages', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return NextResponse.json(result, { status });
}
