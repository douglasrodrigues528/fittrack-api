'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { isAxiosError } from 'axios';
import { api } from '../services/api';
import AuthField from '../components/AuthField';
import { loginFailureMessage, validateLogin, type FieldErrors, type LoginField } from '../lib/auth-form';
import styles from './page.module.css';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors<LoginField>>({});
  const [submitted, setSubmitted] = useState(false);
  const [formError, setFormError] = useState('');
  const [loading, setLoading] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  // Depois da primeira tentativa, os erros acompanham a digitação (somem ao corrigir).
  function revalidate(next: { email: string; password: string }) {
    if (submitted) setErrors(validateLogin(next));
  }

  async function handleLogin(event: React.FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    setFormError('');

    const found = validateLogin({ email, password });
    setErrors(found);
    if (found.email || found.password) {
      (found.email ? emailRef : passwordRef).current?.focus();
      return;
    }

    try {
      setLoading(true);
      const response = await api.post('/auth/login', { email: email.trim(), password });
      localStorage.setItem('token', response.data.access_token);
      window.location.href = '/dashboard';
    } catch (error: unknown) {
      const failure = isAxiosError(error)
        ? { status: error.response?.status, message: error.response?.data?.message }
        : {};
      setFormError(loginFailureMessage(failure));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={styles.container}>
      <section className={styles.card} aria-labelledby="login-title">
        <h1 id="login-title" className={styles.title}>
          <span aria-hidden="true">🏋️</span> FitTrack
        </h1>
        <p className={styles.subtitle}>Entre para registrar seus treinos.</p>

        <form onSubmit={handleLogin} className={styles.form} noValidate>
          <AuthField
            ref={emailRef}
            label="E-mail"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={email}
            error={errors.email}
            onChange={(event) => {
              setEmail(event.target.value);
              revalidate({ email: event.target.value, password });
            }}
          />

          <AuthField
            ref={passwordRef}
            label="Senha"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            error={errors.password}
            onChange={(event) => {
              setPassword(event.target.value);
              revalidate({ email, password: event.target.value });
            }}
          />

          {formError && (
            <p className={styles.formError} role="alert">
              {formError}
            </p>
          )}

          <button className={styles.button} type="submit" disabled={loading}>
            {loading ? 'Entrando…' : 'Entrar'}
          </button>
        </form>

        <p className={styles.footerText}>
          Ainda não tem uma conta? <Link href="/register">Criar conta</Link>
        </p>
      </section>
    </main>
  );
}
