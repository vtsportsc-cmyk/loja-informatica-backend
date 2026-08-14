import { PrismaClient, FunnelStatus } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  console.log('[seed] iniciando...');

  const agents = [
    { name: 'Ana Vendedora', role: 'Vendedora', email: 'ana@loja.com', avatarColor: '#f472b6' },
    { name: 'Bruno Tech', role: 'Montagem/Orçamentos', email: 'bruno@loja.com', avatarColor: '#38bdf8' },
    { name: 'Carla Admin', role: 'Financeiro/NF', email: 'carla@loja.com', avatarColor: '#34d399' },
  ];

  for (const a of agents) {
    await prisma.agent.upsert({
      where: { email: a.email! },
      update: {},
      create: a,
    });
  }

  const bruno = await prisma.agent.findUnique({ where: { email: 'bruno@loja.com' } });
  const brunoId = bruno?.id;

  const customer = await prisma.customer.upsert({
    where: { whatsappId: '5511999991111' },
    update: {},
    create: {
      whatsappId: '5511999991111',
      name: 'Cliente Demonstração',
    },
  });

  await prisma.conversation.upsert({
    where: { id: 'demo-conversation' },
    update: {},
    create: {
      id: 'demo-conversation',
      customerId: customer.id,
      funnelStatus: FunnelStatus.CARRINHO,
      assignedAgentId: brunoId,
      lastMessageAt: new Date(),
      messages: {
        create: [
          {
            direction: 'inbound',
            type: 'text',
            text: 'Opa! Quero montar um PC gamer até R$ 6.000.',
            createdAt: new Date(Date.now() - 3_600_000),
          },
          {
            direction: 'outbound',
            type: 'text',
            text: 'Perfeito! Posso montar um Ryzen 5 8600G + RTX 4060 dentro do orçamento. Já validei a compatibilidade.',
            createdAt: new Date(Date.now() - 3_300_000),
          },
          {
            direction: 'inbound',
            type: 'text',
            text: 'Boa! Quanto fica com frete pra São Paulo?',
            createdAt: new Date(Date.now() - 1_800_000),
          },
        ],
      },
    },
  });

  console.log('[seed] agentes e conversa demo criados.');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (err: unknown) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
