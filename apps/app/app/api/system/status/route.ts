import { NextResponse } from 'next/server';
import { agentFetch } from '@/lib/agent-server';

export async function GET() {
  const { status, body } = await agentFetch('/api/system/status');
  return NextResponse.json(body, { status });
}
