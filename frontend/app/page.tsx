'use client';

import { useState } from 'react';
import Link from 'next/link';
import { isAxiosError } from 'axios';
import { api } from '../services/api';
import styles from './page.module.css';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleLogin(event: React.FormEvent) {
    event.preventDefault();

    try {
      setLoading(true);
      setError('');

      const response = await api.post('/auth/login', {
        email,
        password,
      });

      const token = response.data.access_token;

      localStorage.setItem('token', token);

      window.location.href = '/dashboard';
    } catch (error: unknown) {
      const message = isAxiosError(error) ? error.response?.data?.message : undefined;
      setError(typeof message === 'string' && message ? message : 'Erro ao fazer login');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={styles.container}>
      <section className={styles.card}>
        <h1 className={styles.title}>🏋️ FitTrack</h1>

        <p className={styles.subtitle}>
          Gerencie seus treinos com facilidade
        </p>

        <form
          onSubmit={handleLogin}
          className={styles.form}
        >
          <input
            className={styles.input}
            placeholder="E-mail"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) =>
              setEmail(event.target.value)
            }
          />

          <input
            className={styles.input}
            placeholder="Senha"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) =>
              setPassword(event.target.value)
            }
          />

          <button
            className={styles.button}
            type="submit"
            disabled={loading}
          >
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>

        {error && (
          <p className={styles.error}>{error}</p>
        )}

        <div className={styles.footerText}>
          <p>Ainda não possui uma conta?</p>

          <Link href="/register">Criar uma conta</Link>
        </div>
      </section>
    </main>
  );
}