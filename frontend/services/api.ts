import axios from 'axios';

const TOKEN_KEY = 'token';

export const api = axios.create({
  // Em produção, defina NEXT_PUBLIC_API_URL (ex.: https://fittrack-api.onrender.com).
  baseURL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000',
});

api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem(TOKEN_KEY);

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }

  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
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
