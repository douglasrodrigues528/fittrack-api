'use client';

import { useSyncExternalStore } from 'react';
import { slowRequests } from '../lib/slow-requests';
import styles from './ServerWakeNotice.module.css';

/**
 * Aviso quando a API demora a responder (no plano gratuito ela dorme sem uso).
 * Só informa: não muda o fluxo da tela nem anuncia sucesso. A região `status` fica sempre
 * no DOM para o leitor de tela anunciar a mensagem quando ela aparece.
 */
export default function ServerWakeNotice() {
  const slow = useSyncExternalStore(
    slowRequests.subscribe,
    slowRequests.getSnapshot,
    () => false,
  );

  return (
    <div className={styles.region} role="status" aria-live="polite">
      {slow && (
        <div className={styles.notice}>
          <span className={styles.spinner} aria-hidden="true" />
          <p className={styles.text}>
            <strong>Conectando ao servidor…</strong> Se ele estava em repouso, a primeira resposta pode levar até
            um minuto.
          </p>
        </div>
      )}
    </div>
  );
}
