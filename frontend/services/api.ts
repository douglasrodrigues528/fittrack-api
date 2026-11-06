import axios from 'axios';

import { DEV_API_URL, normalizeApiUrl } from '../lib/api-url';
import { slowRequests } from '../lib/slow-requests';

const TOKEN_KEY = 'token';

declare module 'axios' {
  interface InternalAxiosRequestConfig {
    /** Identificador no rastreador de requisições lentas (aviso de servidor iniciando). */
    slowRequestId?: number;
  }
}

export const api = axios.create({
  // Em produção NEXT_PUBLIC_API_URL é obrigatória: o `next build` falha sem ela (next.config.ts).
  // O localhost vale só fora do build de produção (`next dev`); no build ele nem entra no código.
  baseURL:
    normalizeApiUrl(process.env.NEXT_PUBLIC_API_URL) ??
    (process.env.NODE_ENV === 'production' ? undefined : DEV_API_URL),
});

api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem(TOKEN_KEY);

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    config.slowRequestId = slowRequests.start();
  }

  return config;
});

api.interceptors.response.use(
  (response) => {
    slowRequests.end(response.config.slowRequestId);
    return response;
  },
  (error: unknown) => {
    if (axios.isAxiosError(error)) slowRequests.end(error.config?.slowRequestId);

    // Sessão expirada ou token inválido em rota autenticada: volta para o login.
    // (Não se aplica ao próprio login, que também responde 401 para senha errada.)
    if (
      typeof window !== 'undefined' &&
      axios.isAxiosError(error) &&
      error.response?.status === 401 &&
      !error.config?.url?.includes('/auth/login') &&
      localStorage.getItem(TOKEN_KEY)
    ) {
      localStorage.removeItem(TOKEN_KEY);
      window.location.href = '/';
    }
    return Promise.reject(error);
  },
);
