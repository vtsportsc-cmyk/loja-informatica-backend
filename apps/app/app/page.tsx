import Link from 'next/link';

const CATEGORIES = [
  'Processador',
  'Placa-Mãe',
  'Memória RAM',
  'Placa de Vídeo',
  'Armazenamento',
  'Fonte',
  'Gabinete',
  'Refrigeração',
];

const STEPS = [
  { title: 'Monte seu PC', text: 'Escolha cada peça com validação de compatibilidade em tempo real.' },
  { title: 'Receba no WhatsApp', text: 'Gere o orçamento e envie direto para o nosso atendimento.' },
  { title: 'Pague do seu jeito', text: 'PIX com 5% de desconto ou parcelado em até 12x.' },
  { title: 'Nota fiscal e envio', text: 'Separamos, emitimos a NF pelo Bling e despachamos.' },
];

export default function HomePage() {
  return (
    <div>
      <section className="mx-auto max-w-6xl px-4 pb-16 pt-16 text-center">
        <h1 className="text-4xl font-black leading-tight tracking-tight sm:text-5xl">
          Monte seu PC do{' '}
          <span className="text-brand">seu jeito</span>
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-zinc-400">
          Compatibilidade garantida, preços em tempo real, desconto no PIX e um time de especialistas
          no WhatsApp para validar a sua configuração.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link href="/builder" className="btn-primary px-6 py-3 text-base">
            Começar a montar
          </Link>
          <Link href="/crm" className="btn-ghost px-6 py-3 text-base">
            Painel do time
          </Link>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-16">
        <h2 className="mb-4 text-xl font-bold">Categorias</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {CATEGORIES.map((c) => (
            <Link
              key={c}
              href="/builder"
              className="card text-center text-sm font-semibold text-zinc-300 transition-colors hover:border-brand/50 hover:text-white"
            >
              {c}
            </Link>
          ))}
        </div>
      </section>

      <section className="border-t border-night-700 bg-night-900/60 py-16">
        <div className="mx-auto grid max-w-6xl gap-6 px-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, i) => (
            <div key={step.title} className="card">
              <div className="mb-2 flex h-7 w-7 items-center justify-center rounded-full bg-brand text-sm font-black text-night-950">
                {i + 1}
              </div>
              <h3 className="font-bold">{step.title}</h3>
              <p className="mt-1 text-sm text-zinc-400">{step.text}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
