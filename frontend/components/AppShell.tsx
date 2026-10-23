'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { TOKEN_KEY } from '../lib/use-workout-draft';
import { useLiveSession } from '../lib/use-live-session';
import { useSessionSync } from '../lib/session-sync';
import styles from './AppShell.module.css';

const ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: '🏠' },
  { href: '/exercises', label: 'Catálogo', icon: '📚' },
  { href: '/train', label: 'Treinar', icon: '🏋️' },
  { href: '/history', label: 'Histórico', icon: '📈' },
] as const;

/**
 * Layout compartilhado da área autenticada: barra superior fixa (marca + Sair) e navegação.
 * Mobile: abas fixas no rodapé, ao alcance do polegar. Desktop/tablet: links na barra superior.
 */
export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const live = useLiveSession();
  // Mantém o treino em andamento salvo no servidor em qualquer página autenticada.
  useSessionSync();

  function handleLogout() {
    // O rascunho e o treino em andamento continuam guardados (separados por usuário).
    localStorage.removeItem(TOKEN_KEY);
    window.location.href = '/';
  }

  return (
    <div className={styles.shell}>
      <a href="#conteudo" className={styles.skip}>
        Pular para o conteúdo
      </a>
      <header className={styles.topbar}>
        <div className={styles.topbarInner}>
          <Link href="/dashboard" className={styles.brand}>
            <span aria-hidden="true">🏋️</span> FitTrack
          </Link>

          <nav className={styles.nav} aria-label="Navegação principal">
            {ITEMS.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              const inProgress = item.href === '/train' && live !== null;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`${styles.item} ${active ? styles.active : ''}`}
                  aria-current={active ? 'page' : undefined}
                >
                  <span className={styles.icon} aria-hidden="true">
                    {item.icon}
                    {inProgress && <span className={styles.dot} />}
                  </span>
                  <span className={styles.label}>
                    {item.label}
                    {inProgress && <span className={styles.srOnly}> (treino em andamento)</span>}
                  </span>
                </Link>
              );
            })}
          </nav>

          <button type="button" className={styles.logout} onClick={handleLogout}>
            Sair
          </button>
        </div>
      </header>

      <main id="conteudo" tabIndex={-1} className={styles.content}>
        {children}
      </main>
    </div>
  );
}
