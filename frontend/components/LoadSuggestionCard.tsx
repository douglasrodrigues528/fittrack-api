'use client';

import {
  suggestionState,
  weightRangeLabel,
  type LoadSuggestion,
} from '../lib/load-suggestion';
import type { LiveExercise } from '../lib/session';
import styles from './LoadSuggestionCard.module.css';

const kgNumber = (value: number) => value.toLocaleString('pt-BR', { maximumFractionDigits: 2 });

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
    // Manter a carga: só um aviso discreto, sem ações (a carga atual já é a da última sessão).
    return (
      <p className={styles.maintain} role="note">
        <strong>Manter {last}.</strong> {suggestion.reason}
      </p>
    );
  }

  const state = suggestionState(exercise, suggestion);
  if (state === 'done') return null;
  const next = weightRangeLabel(suggestion.suggestedWeights);

  if (state === 'applied') {
    return (
      <div className={styles.applied} role="status">
        <span>
          <span aria-hidden="true">✓ </span>
          Carga atualizada para <strong>{next}</strong>
        </span>
        <button type="button" className={styles.undo} onClick={onUndo} aria-label={`Desfazer alteração: voltar para ${last}`}>
          Desfazer alteração
        </button>
      </div>
    );
  }

  return (
    <div className={styles.card} role="group" aria-label={`Sugestão de progressão para ${exercise.name}`}>
      <p className={styles.label}>Sugestão de progressão</p>
      <p className={styles.values}>
        <span className={styles.from}>
          {last} <span aria-hidden="true">→</span>
          <span className={styles.srOnly}> para </span>
        </span>
        <strong className={styles.to}>{next}</strong>
        <span className={styles.delta}>+{kgNumber(suggestion.increment)} kg</span>
      </p>
      <p className={styles.reason}>
        {suggestion.reason} <span className={styles.hint}>Use o peso mais próximo disponível.</span>
      </p>
      <div className={styles.actions}>
        <button type="button" className={styles.apply} onClick={onApply} aria-label={`Aplicar ${next} nas séries pendentes`}>
          Aplicar sugestão
        </button>
        <button type="button" className={styles.keep} onClick={onDismiss} aria-label={`Manter ${last}`}>
          Manter carga
        </button>
      </div>
    </div>
  );
}
