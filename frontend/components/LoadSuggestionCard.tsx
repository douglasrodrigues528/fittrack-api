'use client';

import {
  suggestionState,
  weightRangeLabel,
  type LoadSuggestion,
} from '../lib/load-suggestion';
import type { LiveExercise } from '../lib/session';
import styles from './LoadSuggestionCard.module.css';

/**
 * Sugestão de carga de um exercício na tela do treino. Nada muda sozinho: aplicar só acontece
 * no botão, e "Manter" apenas esconde a sugestão (as cargas ficam como estão).
 */
export default function LoadSuggestionCard({
  exercise,
  suggestion,
  onApply,
  onUndo,
  onDismiss,
}: {
  exercise: Pick<LiveExercise, 'name' | 'sets'>;
  suggestion: LoadSuggestion;
  onApply: () => void;
  onUndo: () => void;
  onDismiss: () => void;
}) {
  const last = weightRangeLabel(suggestion.lastWeights);

  if (suggestion.kind === 'maintain') {
    // Manter a carga: aviso discreto, sem ação (a carga atual já é a do último treino).
    return (
      <p className={styles.maintain} role="note">
        <strong>Manter {last}.</strong> {suggestion.reason}
      </p>
    );
  }

  const state = suggestionState(exercise, suggestion);
  if (state === 'done') return null;
  const next = weightRangeLabel(suggestion.suggestedWeights);
  const increment = suggestion.increment.toLocaleString('pt-BR', { maximumFractionDigits: 2 });

  return (
    <div className={styles.card} role="group" aria-label={`Sugestão de carga para ${exercise.name}`}>
      <p className={styles.title}>
        <span aria-hidden="true">↗</span> Sugestão de carga
      </p>
      <dl className={styles.values}>
        <div>
          <dt>Último treino</dt>
          <dd>{last}</dd>
        </div>
        <div>
          <dt>Sugerida</dt>
          <dd className={styles.next}>
            {next} <small>(+{increment} kg por série)</small>
          </dd>
        </div>
      </dl>
      <p className={styles.reason}>{suggestion.reason}</p>
      <p className={styles.note}>Ajuste ao peso disponível no seu equipamento.</p>

      {state === 'applied' ? (
        <div className={styles.actions}>
          <span className={styles.applied} role="status">
            ✓ Sugestão aplicada às séries pendentes
          </span>
          <button type="button" className={styles.link} onClick={onUndo}>
            Voltar para {last}
          </button>
        </div>
      ) : (
        <div className={styles.actions}>
          <button type="button" className={styles.apply} onClick={onApply}>
            Aplicar {next}
          </button>
          <button type="button" className={styles.keep} onClick={onDismiss}>
            Manter {last}
          </button>
        </div>
      )}
    </div>
  );
}
