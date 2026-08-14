export interface AgentConfig {
  baseUrl: string;
  apiKey: string;
}

export function agentConfig(): AgentConfig {
  return {
    baseUrl: (process.env.AGENT_API_URL ?? 'http://localhost:3000').replace(/\/$/, ''),
    apiKey: process.env.AGENT_API_KEY ?? 'dev_agent_key',
  };
}

export async function agentFetch(
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: unknown }> {
  const { baseUrl, apiKey } = agentConfig();
  const headers = {
    'content-type': 'application/json',
    'x-agent-key': apiKey,
    ...((init?.headers as Record<string, string>) ?? {}),
  };
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
    cache: 'no-store',
  });
  const text = await res.text();
  let body: unknown = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = text;
  }
  return { status: res.status, body };
}
