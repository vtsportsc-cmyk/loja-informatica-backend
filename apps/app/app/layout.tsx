import type { Metadata } from 'next';
import Link from 'next/link';
import { Toaster } from 'sonner';
import './globals.css';

export const metadata: Metadata = {
  title: 'Loja de Informática — Monte seu PC',
  description:
    'Monte seu PC gamer com o nosso builder, receba o orçamento no WhatsApp e acompanhe no painel CRM.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="flex min-h-screen flex-col">
        <Toaster
          position="bottom-right"
          toastOptions={{
            style: {
              background: '#18181b',
              border: '1px solid #3f3f46',
              color: '#e4e4e7',
              fontSize: '13px',
            },
            classNames: {
              success: 'border-emerald-500/30',
              error: 'border-red-500/30',
            },
          }}
          richColors
          closeButton
        />
        <header className="sticky top-0 z-10 border-b border-night-700 bg-night-900/90 backdrop-blur">
          <nav className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
            <Link href="/" className="flex items-center gap-2 font-bold">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-lg font-black text-night-950">
                P
              </span>
              <span className="text-lg tracking-tight">
                Loja<span className="text-brand">Tech</span>
              </span>
            </Link>
            <div className="flex items-center gap-3">
              <Link href="/builder" className="btn-ghost">
                Monte seu PC
              </Link>
            </div>
          </nav>
        </header>
        <main className="flex-1">{children}</main>
        <footer className="border-t border-night-700 py-6 text-center text-xs text-zinc-500">
          LojaTech — atendimento via WhatsApp (Evolution API), pagamento exclusivo via PIX e NF pelo Bling.
        </footer>
      </body>
    </html>
  );
}
