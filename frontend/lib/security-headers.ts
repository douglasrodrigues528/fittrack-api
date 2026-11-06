/**
 * Cabeçalhos de segurança de todas as páginas (aplicados pelo next.config).
 * CSP fica para depois: precisa liberar as imagens do catálogo (raw.githubusercontent.com)
 * e as fontes, e exige testes próprios.
 */
export const SECURITY_HEADERS = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Envia só a origem para outros sites (ex.: imagens do GitHub), nunca o caminho completo.
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
];
