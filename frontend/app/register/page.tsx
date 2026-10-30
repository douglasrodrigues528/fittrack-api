'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { isAxiosError } from 'axios';
import { api } from '../../services/api';
import AuthField from '../../components/AuthField';
import {
  PASSWORD_MIN,
  registerFailure,
  validateRegister,
  type FieldErrors,
  type RegisterField,
} from '../../lib/auth-form';
import styles from '../page.module.css';

export default function RegisterPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors<RegisterField>>({});
  const [submitted, setSubmitted] = useState(false);
  const [formError, setFormError] = useState('');
  const [loading, setLoading] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  /** Leva o foco ao primeiro campo com erro (na ordem do formulário). */
  function focusFirst(found: FieldErrors<RegisterField>) {
    if (found.name) nameRef.current?.focus();
    else if (found.email) emailRef.current?.focus();
    else if (found.password) passwordRef.current?.focus();
  }

  // Depois da primeira tentativa, os erros acompanham a digitação (somem ao corrigir).
  function revalidate(next: { name: string; email: string; password: string }) {
    if (submitted) setErrors(validateRegister(next));
  }

  async function handleRegister(event: React.FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    setFormError('');

    const found = validateRegister({ name, email, password });
    setErrors(found);
    if (Object.keys(found).length > 0) {
      focusFirst(found);
      return;
    }

    try {
      setLoading(true);
      await api.post('/users', { name: name.trim(), email: email.trim(), password });

      // Entra direto: o primeiro acesso cai nas boas-vindas do dashboard.
      try {
        const response = await api.post('/auth/login', { email: email.trim(), password });
        localStorage.setItem('token', response.data.access_token);
        window.location.href = '/dashboard';
      } catch {
        alert('Conta criada! Entre com seu e-mail e senha.');
        window.location.href = '/';
      }
    } catch (error: unknown) {
      const failure = isAxiosError(error)
        ? { status: error.response?.status, message: error.response?.data?.message }
        : {};
      const result = registerFailure(failure);
      setErrors(result.fields);
      setFormError(result.form ?? '');
      focusFirst(result.fields);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={styles.container}>
      <section className={styles.card} aria-labelledby="register-title">
        <h1 id="register-title" className={styles.title}>
          <span aria-hidden="true">🏋️</span> FitTrack
        </h1>
        <p className={styles.subtitle}>Crie sua conta para registrar seus treinos.</p>

        <form onSubmit={handleRegister} className={styles.form} noValidate>
          <AuthField
            ref={nameRef}
            label="Nome"
            autoComplete="name"
            required
            value={name}
            error={errors.name}
            onChange={(event) => {
              setName(event.target.value);
              revalidate({ name: event.target.value, email, password });
            }}
          />

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
              revalidate({ name, email: event.target.value, password });
            }}
          />

          <AuthField
            ref={passwordRef}
            label="Senha"
            type="password"
            autoComplete="new-password"
            required
            minLength={PASSWORD_MIN}
            hint={`Use pelo menos ${PASSWORD_MIN} caracteres.`}
            value={password}
            error={errors.password}
            onChange={(event) => {
              setPassword(event.target.value);
              revalidate({ name, email, password: event.target.value });
            }}
          />

          {formError && (
            <p className={styles.formError} role="alert">
              {formError}
            </p>
          )}

          <button className={styles.button} type="submit" disabled={loading}>
            {loading ? 'Criando conta…' : 'Criar conta'}
          </button>
        </form>

        <p className={styles.footerText}>
          Já tem uma conta? <Link href="/">Entrar</Link>
        </p>
      </section>
    </main>
  );
}
