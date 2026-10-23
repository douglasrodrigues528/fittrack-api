'use client';

import { cx } from './cx';
import ui from './ui.module.css';
import styles from './StartChoices.module.css';
import { describeQuota, type WorkoutQuota } from '../lib/journey';

interface StartChoicesProps {
  /** `welcome`: primeira entrada (cartões grandes, com explicação). `compact`: atalhos no dashboard. */
  variant: 'welcome' | 'compact';
  quota: WorkoutQuota | null;
  /** Título do treino em andamento, se houver (o cartão vira "Continuar treino"). */
  liveTitle: string | null;
  /** Há um rascunho de treino planejado sendo montado. */
  hasDraft?: boolean;
  busy?: 'routine' | 'free' | null;
  onCreateRoutine: () => void;
  onStartFree: () => void;
}

/** As duas formas de começar: montar a rotina ou treinar agora (treino livre). */
export default function StartChoices({
  variant,
  quota,
  liveTitle,
  hasDraft = false,
  busy = null,
  onCreateRoutine,
  onStartFree,
}: StartChoicesProps) {
  const welcome = variant === 'welcome';
  const full = quota !== null && quota.remaining === 0;

  return (
    <div className={cx(styles.grid, welcome && styles.gridWelcome)}>
      <article className={cx(ui.card, styles.choice, styles.routine)}>
        <span className={styles.icon} aria-hidden="true">
          📋
        </span>
        <div className={styles.body}>
          <h2 className={styles.title}>{welcome ? 'Criar minha rotina' : 'Treino planejado'}</h2>
          {welcome ? (
            <p className={styles.text}>
              Monte os treinos que você costuma fazer, com exercícios, séries, pesos e repetições. Pode começar com
              um só e definir os dias da semana quando quiser.
            </p>
          ) : (
            <p className={styles.text}>
              {quota ? (
                <>
                  <strong>
                    {quota.used} de {quota.limit}
                  </strong>{' '}
                  treinos salvos · {describeQuota(quota)}
                </>
              ) : (
                'Monte um treino para repetir sempre que quiser.'
              )}
            </p>
          )}
          {full && (
            <p className={styles.limit}>
              Para criar outro, exclua um treino que não usa mais ou edite um existente. Treinos livres não ocupam
              vaga.
            </p>
          )}
        </div>
        <button
          type="button"
          className={cx(ui.btn, ui.btnPrimary, styles.action)}
          onClick={onCreateRoutine}
          disabled={busy !== null || (full && !hasDraft)}
        >
          {busy === 'routine'
            ? 'Abrindo…'
            : welcome
              ? 'Criar minha rotina'
              : hasDraft
                ? 'Continuar montando'
                : full
                  ? 'Limite atingido'
                  : 'Montar novo treino'}
        </button>
      </article>

      <article className={cx(ui.card, styles.choice, styles.free)}>
        <span className={styles.icon} aria-hidden="true">
          ⚡
        </span>
        <div className={styles.body}>
          <h2 className={styles.title}>{liveTitle ? 'Treino em andamento' : 'Começar treino livre'}</h2>
          <p className={styles.text}>
            {liveTitle ? (
              <>
                <strong>{liveTitle}</strong> está salvo. Continue de onde parou.
              </>
            ) : welcome ? (
              'Treine agora, sem montar nada antes. Escolha exercícios do catálogo, registre cada série e, ao terminar, o treino vai para o histórico.'
            ) : (
              'Treine agora escolhendo os exercícios na hora. Não ocupa vaga de treino planejado.'
            )}
          </p>
        </div>
        <button
          type="button"
          className={cx(ui.btn, styles.action, styles.freeBtn)}
          onClick={onStartFree}
          disabled={busy !== null}
        >
          {busy === 'free' ? 'Abrindo…' : liveTitle ? 'Continuar treino' : 'Começar treino livre'}
        </button>
      </article>
    </div>
  );
}
