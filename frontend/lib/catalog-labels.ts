/** Rótulos em português para os valores do catálogo (gravados como slugs, ex.: "peso-do-corpo"). */
const LABELS: Record<string, string> = {
  abdominais: 'Abdominais',
  abdutores: 'Abdutores',
  adutores: 'Adutores',
  antebracos: 'Antebraços',
  biceps: 'Bíceps',
  dorsais: 'Dorsais',
  gluteos: 'Glúteos',
  'inferior-das-costas': 'Lombar',
  isquiotibiais: 'Posteriores da coxa',
  'meio-das-costas': 'Meio das costas',
  ombros: 'Ombros',
  panturrilhas: 'Panturrilhas',
  peito: 'Peito',
  pescoco: 'Pescoço',
  quadriceps: 'Quadríceps',
  trapezio: 'Trapézio',
  triceps: 'Tríceps',
  barra: 'Barra',
  'barra-w': 'Barra W',
  'bola-de-exercicio': 'Bola de exercício',
  'bola-medicinal': 'Bola medicinal',
  cabo: 'Cabo / polia',
  faixas: 'Faixas elásticas',
  halteres: 'Halteres',
  kettlebell: 'Kettlebell',
  maquina: 'Máquina',
  outros: 'Outros',
  'peso-do-corpo': 'Peso do corpo',
  'rolo-de-espuma': 'Rolo de espuma',
};

export function catalogLabel(value: string): string {
  const known = LABELS[value];
  if (known) return known;
  const text = value.replace(/-/g, ' ').trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : value;
}

/** Ordena opções pelo rótulo exibido (não pelo slug). */
export function sortByLabel(values: string[]): string[] {
  return [...values].sort((a, b) => catalogLabel(a).localeCompare(catalogLabel(b), 'pt-BR'));
}
