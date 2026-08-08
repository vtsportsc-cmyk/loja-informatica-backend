import { loadDotEnvFile, loadEnv } from '../src/config/env.js';
import type { EnvConfig } from '../src/config/env.js';

// ============================================================================
// Pre-checagem de ambiente antes de subir o servidor em producao.
// Uso: npm run check:env
// Valida TODAS as variaveis com o mesmo schema Zod usado em runtime (loadEnv)
// e imprime um resumo do que esta configurado vs faltando. Sai com codigo 1
// se alguma variavel obrigatoria estiver invalida.
// ============================================================================

interface Row {
  key: string;
  status: 'ok' | 'missing' | 'n/a';
  value: string;
}

function main(): void {
  loadDotEnvFile();
  try {
    const env = loadEnv();

    const rows = buildRows(env);

    const width = Math.max(...rows.map((r) => `${r.key} (${r.status})`.length), 0) + 2;
    console.log('\nloja-informatica-backend - pre-checagem de ambiente');
    console.log('='.repeat(width + 22));
    for (const row of rows) {
      const label = `${row.key} (${row.status})`.padEnd(width);
      console.log(`  ${label}${row.value}`);
    }
    console.log('='.repeat(width + 22));

    const missing = rows.filter((r) => r.status === 'missing');
    if (missing.length > 0) {
      console.error(
        `\n[check:env] FALHOU: ${missing.map((m) => m.key).join(', ')} ${missing.length === 1 ? 'esta' : 'estao'} faltando/invalidas.\n` +
          'Consulte o README.md e o .env.example para configurar.',
      );
      process.exit(1);
    }

    console.log(`\n[check:env] OK - ${env.session.store === 'redis' ? `Redis em ${env.session.redisUrl}` : 'sessao em memoria (SESSION_STORE=memory)'}.`);
    console.log('[check:env] pronta para subir o servidor.\n');
  } catch (err) {
    console.error('\n[check:env] FALHOU na validacao Zod:');
    console.error(`  ${(err as Error).message}`);
    console.error('\nCorrija o .env conforme o .env.example e rode novamente.\n');
    process.exit(1);
  }
}

function buildRows(env: EnvConfig): Row[] {
  const optional = (key: string, present: boolean, whenPresent: string, whenAbsent = 'opcional'): Row => ({
    key,
    status: present ? 'ok' : 'n/a',
    value: present ? whenPresent : whenAbsent,
  });
  const required = (key: string, present: boolean, label: string): Row => ({
    key,
    status: present ? 'ok' : 'missing',
    value: present ? label : 'OBRIGATORIA',
  });

  return [
    required('GROQ_API_KEY', Boolean(env.groq.apiKey), 'configurada'),
    { key: 'GROQ_MODEL', status: 'ok', value: env.groq.model },
    required('GEMINI_API_KEY', Boolean(env.gemini.apiKey), 'configurada'),
    { key: 'GEMINI_MODEL', status: 'ok', value: env.gemini.model },
    { key: 'ERP_BASE_URL', status: 'ok', value: env.erp.baseURL },
    optional('ERP_API_TOKEN', Boolean(env.erp.apiToken), 'configurado'),
    { key: 'SURI_BASE_URL', status: 'ok', value: env.suri.baseURL },
    optional('SURI_WEBHOOK_TOKEN', Boolean(env.suri.webhookToken), 'configurado'),
    { key: 'PAYMENT_BASE_URL', status: 'ok', value: env.payment.baseURL },
    optional('PAYMENT_API_KEY', Boolean(env.payment.apiKey), 'configurado'),
    optional('PAYMENT_WEBHOOK_SECRET', Boolean(env.payment.webhookSecret), 'configurado (webhook assinado)'),
    optional('PIX_MERCHANT_KEY', Boolean(env.payment.pixMerchant.key), 'configurada'),
    { key: 'PIX_EXPIRES_IN_MINUTES', status: 'ok', value: `${env.payment.pixExpiresInMinutes} min` },
    { key: 'SESSION_STORE', status: 'ok', value: env.session.store },
    { key: 'SESSION_TTL_SECONDS', status: 'ok', value: `${env.session.ttlSeconds}s` },
    {
      key: 'REDIS_URL',
      status: env.session.store === 'redis' ? 'ok' : 'n/a',
      value: env.session.redisUrl,
    },
    { key: 'PORT', status: 'ok', value: `${env.port}` },
    { key: 'RAG_INDEX_PATH', status: 'ok', value: env.ragIndexPath },
    { key: 'CRM_API_URL', status: 'ok', value: env.crm.baseURL },
    optional('CRM_API_TOKEN', Boolean(env.crm.apiToken), 'configurado'),
    {
      key: 'CRM_ENABLED',
      status: 'ok',
      value: env.crm.enabled ? 'habilitado (envia eventos)' : 'desabilitado (no-op)',
    },
  ];
}

main();
