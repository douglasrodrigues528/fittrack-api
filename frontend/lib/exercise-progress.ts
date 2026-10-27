/**
 * Evolução por exercício: tipos da resposta de GET /sessions/exercises/:id/progress e a lógica
 * pura do gráfico (escala, rótulos, ponto mais próximo). As datas seguem a regra única do app:
 * o dia LOCAL de início do treino (`sessionDayKey`), como no calendário e no histórico.
 */
import { fromDayKey, sessionDayKey } from './calendar';
import type { SetType } from './session';

export interface ProgressSet {
  type: SetType;
  weight: number;
  reps: number;
}

/** Um ponto do gráfico: a maior carga válida de uma sessão concluída. */
export interface ProgressPoint {
  sessionId: string;
  startedAt: string;
  weight: number;
  reps: number;
}

export interface ProgressSession {
  sessionId: string;
  workoutId: string | null;
  origin: 'planned' | 'free';
  title: string;
  startedAt: string;
  finishedAt: string | null;
  setCount: number;
  sets: ProgressSet[];
  /** Série mais pesada da sessão; null se nenhuma tem carga (ex.: só peso corporal). */
  best: ProgressSet | null;
}

export interface ExerciseProgress {
  exerciseId: string;
  name: string;
  /** Sessões concluídas com o exercício em todo o histórico. */
  totalSessions: number;
  /** Quantas das mais recentes vieram em `sessions` e `points`. */
  limit: number;
  /** Recorde de todo o histórico (não só da janela carregada). */
  record: (ProgressSet & { sessionId: string; title: string; startedAt: string }) | null;
  /** Mais antiga → mais recente. */
  points: ProgressPoint[];
  /** Mais recente → mais antiga. */
  sessions: ProgressSession[];
}

export function progressPath(exerciseId: string): string {
  return `/exercises/progress?id=${encodeURIComponent(exerciseId)}`;
}

/** "72,5 kg". */
export function formatKg(weight: number): string {
  return `${weight.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} kg`;
}

export function repsLabel(reps: number): string {
  return `${reps} ${reps === 1 ? 'repetição' : 'repetições'}`;
}

/** "17/09" (ou "17/09/25" quando o gráfico atravessa anos), pelo dia local de início. */
export function shortDateLabel(startedAt: string, withYear = false): string {
  return fromDayKey(sessionDayKey({ startedAt })).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    ...(withYear ? { year: '2-digit' } : {}),
  });
}

/** "17 de set. de 2026". */
export function fullDateLabel(startedAt: string): string {
  return fromDayKey(sessionDayKey({ startedAt })).toLocaleDateString('pt-BR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function spansYears(points: ProgressPoint[]): boolean {
  if (points.length < 2) return false;
  const year = (p: ProgressPoint) => sessionDayKey(p).slice(0, 4);
  return year(points[0]) !== year(points[points.length - 1]);
}

/** Passo "redondo" (1, 2, 2,5 ou 5 × 10ⁿ) para dividir o intervalo em ~`count` partes. */
function niceStep(range: number, count: number): number {
  const raw = range / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].find((m) => m * magnitude >= raw) ?? 10;
  return step * magnitude;
}

/** Marcas do eixo de carga, cobrindo de `min` a `max` com folga e começando em valor redondo. */
export function loadTicks(min: number, max: number, count = 4): number[] {
  if (!(max > min)) {
    // Um único valor (ou todos iguais): faixa simétrica em volta dele, sem ir abaixo de zero.
    const pad = Math.max(2.5, Math.abs(max) * 0.1);
    return loadTicks(Math.max(0, min - pad), max + pad, count);
  }
  const step = niceStep(max - min, count);
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let value = start; value <= end + step / 1e6; value += step) {
    ticks.push(Math.round(value * 1000) / 1000);
  }
  return ticks;
}

export interface ChartBox {
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface ChartLayout {
  /** Coordenadas de cada ponto, na mesma ordem de `points`. */
  dots: { x: number; y: number }[];
  ticks: { value: number; y: number; label: string }[];
  path: string;
}

/**
 * Posiciona os pontos: um por sessão, igualmente espaçados na ordem cronológica (o eixo
 * horizontal é a sequência de sessões, rotulada pela data); a altura é proporcional à carga.
 */
export function chartLayout(points: ProgressPoint[], box: ChartBox): ChartLayout {
  if (points.length === 0) return { dots: [], ticks: [], path: '' };

  const weights = points.map((p) => p.weight);
  const ticks = loadTicks(Math.min(...weights), Math.max(...weights));
  const low = ticks[0];
  const high = ticks[ticks.length - 1];
  const plotW = box.width - box.left - box.right;
  const plotH = box.height - box.top - box.bottom;
  const y = (value: number) => box.top + plotH - ((value - low) / (high - low)) * plotH;
  const x = (index: number) =>
    points.length === 1 ? box.left + plotW / 2 : box.left + (index / (points.length - 1)) * plotW;

  const dots = points.map((point, index) => ({ x: x(index), y: y(point.weight) }));

  return {
    dots,
    ticks: ticks.map((value) => ({
      value,
      y: y(value),
      label: value.toLocaleString('pt-BR', { maximumFractionDigits: 2 }),
    })),
    path: dots.map((dot, index) => `${index === 0 ? 'M' : 'L'}${dot.x.toFixed(1)},${dot.y.toFixed(1)}`).join(' '),
  };
}

/** Marcas inteiras do eixo de repetições, sempre a partir de zero (barras não podem enganar). */
export function repsTicks(max: number, count = 3): number[] {
  const top = Math.max(1, Math.ceil(max));
  const raw = top / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(1, ([1, 2, 5, 10].find((m) => m * magnitude >= raw) ?? 10) * magnitude);
  const ticks: number[] = [];
  for (let value = 0; value < top + step; value += step) ticks.push(value);
  return ticks;
}

/** Faixa vertical (em coordenadas do SVG) do painel de repetições. */
export interface RepsPanel {
  top: number;
  bottom: number;
}

export interface RepsLayout {
  /** Uma barra por ponto, alinhada exatamente abaixo do ponto de carga da mesma série. */
  bars: { x: number; y: number; width: number; height: number }[];
  ticks: { value: number; y: number }[];
}

/**
 * Barras das repetições da MESMA série de cada ponto de carga (nunca o maior número de
 * repetições de outra série). Compartilham o eixo horizontal com o gráfico de carga.
 */
export function repsLayout(points: ProgressPoint[], dots: { x: number }[], panel: RepsPanel, plotWidth: number): RepsLayout {
  if (points.length === 0) return { bars: [], ticks: [] };
  const ticks = repsTicks(Math.max(...points.map((p) => p.reps)));
  // Folga acima da maior barra para o número de repetições não encostar no topo (escala continua linear, a partir de 0).
  const high = Math.max(ticks[ticks.length - 1], Math.max(...points.map((p) => p.reps)) * 1.2);
  const height = panel.bottom - panel.top;
  const y = (value: number) => panel.bottom - (value / high) * height;
  const width = Math.max(2, Math.min(18, (plotWidth / points.length) * 0.6));
  return {
    bars: points.map((point, index) => ({
      x: dots[index].x - width / 2,
      y: y(point.reps),
      width,
      height: panel.bottom - y(point.reps),
    })),
    ticks: ticks.map((value) => ({ value, y: y(value) })),
  };
}

/** Linha da tabela de valores: a série mais pesada da sessão e quantas séries a sessão teve. */
export interface PointRow extends ProgressPoint {
  setCount: number;
}

/** Junta a cada ponto a quantidade de séries da sessão (do histórico detalhado da mesma resposta). */
export function withSetCounts(points: ProgressPoint[], sessions: ProgressSession[]): PointRow[] {
  const counts = new Map(sessions.map((session) => [session.sessionId, session.setCount]));
  return points.map((point) => ({ ...point, setCount: counts.get(point.sessionId) ?? 1 }));
}

/** Índice do ponto mais próximo de uma posição horizontal (toque ou cursor). */
export function nearestIndex(dots: { x: number }[], x: number): number {
  let best = 0;
  for (let index = 1; index < dots.length; index += 1) {
    if (Math.abs(dots[index].x - x) < Math.abs(dots[best].x - x)) best = index;
  }
  return best;
}

export interface DateAxisLabel {
  index: number;
  x: number;
  label: string;
  /** Data da sessão selecionada (destacada no eixo). */
  selected: boolean;
}

/**
 * Datas do eixo horizontal: a primeira e a última sessão (para situar o período) e a da sessão
 * selecionada, em destaque. Como as sessões são igualmente espaçadas (não é uma escala de
 * tempo), não há datas intermediárias que sugiram intervalos regulares. Uma data de ponta que
 * ficaria a menos de `minGap` da selecionada é omitida para não se sobrepor.
 */
export function dateAxisLabels(
  points: ProgressPoint[],
  dots: { x: number }[],
  selected: number,
  minGap: number,
): DateAxisLabel[] {
  if (points.length === 0) return [];
  const withYear = spansYears(points);
  const make = (index: number, isSelected: boolean): DateAxisLabel => ({
    index,
    x: dots[index].x,
    label: shortDateLabel(points[index].startedAt, withYear),
    selected: isSelected,
  });
  const ends = [...new Set([0, points.length - 1])].filter(
    (index) => index !== selected && Math.abs(dots[index].x - dots[selected].x) >= minGap,
  );
  return [...ends.map((index) => make(index, false)), make(selected, true)].sort((a, b) => a.index - b.index);
}

export interface Comparison {
  previous: ProgressPoint;
  weightDelta: number;
  repsDelta: number;
}

/** Diferença para a sessão anterior (a série mais pesada de cada uma), ou null na primeira. */
export function compareWithPrevious(points: ProgressPoint[], index: number): Comparison | null {
  if (index <= 0 || index >= points.length) return null;
  const previous = points[index - 1];
  const current = points[index];
  return {
    previous,
    weightDelta: Math.round((current.weight - previous.weight) * 100) / 100,
    repsDelta: current.reps - previous.reps,
  };
}

const signed = (value: number) =>
  `${value > 0 ? '+' : '−'}${Math.abs(value).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}`;

/** "+2,5 kg · −1 repetição" / "mesma carga · +2 repetições": sinais e palavras, não só cor. */
export function comparisonLabel(comparison: Comparison): string {
  const { weightDelta, repsDelta } = comparison;
  const weight = weightDelta === 0 ? 'mesma carga' : `${signed(weightDelta)} kg`;
  const reps =
    repsDelta === 0
      ? 'mesmas repetições'
      : `${signed(repsDelta)} ${Math.abs(repsDelta) === 1 ? 'repetição' : 'repetições'}`;
  return `${weight} · ${reps}`;
}

/** Números sobre todas as barras só quando cabem com folga; senão, só na sessão selecionada. */
export function showAllBarLabels(count: number, plotWidth: number): boolean {
  return count <= 12 && plotWidth / count >= 24;
}

/** Marcadores em todos os pontos só com poucas sessões; com muitas, a linha basta (e o selecionado). */
export function showAllMarkers(count: number, plotWidth: number): boolean {
  return count <= 20 && plotWidth / count >= 14;
}
