'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLiveSession } from '../lib/use-live-session';
import styles from './BottomNav.module.css';

const ITEMS = [
  { href: '/dashboard', label: 'Rotinas', icon: '📋' },
  { href: '/exercises', label: 'Catálogo', icon: '📚' },
  { href: '/train', label: 'Treinar', icon: '🏋️' },
  { href: '/history', label: 'Histórico', icon: '📈' },
] as const;

/** Navegação fixa no rodapé, pensada para uso com o polegar. */
export default function BottomNav() {
  const pathname = usePathname();
  const live = useLiveSession();

  return (
    <nav className={styles.nav} aria-label="Navegação principal">
      {ITEMS.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`${styles.item} ${active ? styles.active : ''}`}
            aria-current={active ? 'page' : undefined}
          >
            <span className={styles.icon} aria-hidden="true">
              {item.icon}
              {item.href === '/train' && live && <span className={styles.dot} />}
            </span>
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
