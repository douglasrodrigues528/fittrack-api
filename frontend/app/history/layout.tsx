import type { ReactNode } from 'react';
import AppShell from '../../components/AppShell';

/** Barra de navegação compartilhada da área autenticada (mesma em todas as páginas). */
export default function Layout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
