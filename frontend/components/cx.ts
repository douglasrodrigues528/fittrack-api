/** Junta nomes de classe ignorando valores vazios: cx(a, cond && b). */
export function cx(...names: (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(' ');
}
