'use client';

import { forwardRef, useId, useState, type InputHTMLAttributes } from 'react';
import styles from '../app/page.module.css';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'aria-invalid' | 'aria-describedby'> & {
  label: string;
  /** Orientação mostrada antes de enviar (ex.: regra de senha). */
  hint?: string;
  /** Erro deste campo, exibido logo abaixo dele. */
  error?: string;
};

/**
 * Campo dos formulários de entrada: rótulo visível ligado ao campo, dica e erro anunciados
 * pelo leitor de tela (aria-describedby) e, para senha, botão de mostrar/ocultar.
 */
const AuthField = forwardRef<HTMLInputElement, Props>(function AuthField({ label, hint, error, type, ...input }, ref) {
  const id = useId();
  const hintId = `${id}-dica`;
  const errorId = `${id}-erro`;
  const [visible, setVisible] = useState(false);
  const isPassword = type === 'password';
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;

  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      <div className={styles.inputWrap}>
        <input
          ref={ref}
          id={id}
          className={`${styles.input} ${error ? styles.inputInvalid : ''}`}
          type={isPassword && visible ? 'text' : type}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          {...input}
        />
        {isPassword && (
          <button
            type="button"
            className={styles.reveal}
            aria-pressed={visible}
            aria-controls={id}
            onClick={() => setVisible((value) => !value)}
          >
            {visible ? 'Ocultar' : 'Mostrar'}
            <span className={styles.srOnly}> senha</span>
          </button>
        )}
      </div>
      {hint && (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className={styles.fieldError}>
          {error}
        </p>
      )}
    </div>
  );
});

export default AuthField;
