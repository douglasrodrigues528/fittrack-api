'use client';

import { cx } from './cx';
import ui from './ui.module.css';
import styles from './StartChoices.module.css';

interface StartChoicesProps {
  busy?: 'routine' | 'free' | null;
  onCreateRoutine: () => void;
  onStartFree: () => void;
}

/** Primeira entrada: as duas formas de começar, montar a rotina ou treinar agora (treino livre). */
export default function StartChoices({ busy = null, onCreateRoutine, onStartFree }: StartChoicesProps) {
  return (
    <div className={cx(styles.grid, styles.gridWelcome)}>
      <article className={cx(ui.card, styles.choice, styles.routine)}>
        <span className={styles.icon} aria-hidden="true">
          📋
        </span>
        <div className={styles.body}>
          <h2 className={styles.title}>Criar minha rotina</h2>
          <p className={styles.text}>
            Monte os treinos que você costuma fazer, com exercícios, séries, pesos e repetições. Pode começar com um
            só e definir os dias da semana quando quiser.
          </p>
        </div>
        <button
          type="button"
          className={cx(ui.btn, ui.btnPrimary, styles.action)}
          onClick={onCreateRoutine}
          disabled={busy !== null}
        >
          {busy === 'routine' ? 'Abrindo…' : 'Criar minha rotina'}
        </button>
      </article>

      <article className={cx(ui.card, styles.choice, styles.free)}>
        <span className={styles.icon} aria-hidden="true">
          ⚡
        </span>
        <div className={styles.body}>
          <h2 className={styles.title}>Começar treino livre</h2>
          <p className={styles.text}>
            Treine agora, sem montar nada antes. Escolha exercícios do catálogo, registre cada série e, ao terminar, o
            treino vai para o histórico.
          </p>
        </div>
        <button
          type="button"
          className={cx(ui.btn, styles.action, styles.freeBtn)}
          onClick={onStartFree}
          disabled={busy !== null}
        >
          {busy === 'free' ? 'Abrindo…' : 'Começar treino livre'}
        </button>
      </article>
    </div>
  );
}
