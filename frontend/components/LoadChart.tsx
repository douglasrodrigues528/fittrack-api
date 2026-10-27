'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import {
  chartLayout,
  compareWithPrevious,
  comparisonLabel,
  dateAxisLabels,
  fullDateLabel,
  formatKg,
  nearestIndex,
  repsLayout,
  shortDateLabel,
  showAllBarLabels,
  showAllMarkers,
  withSetCounts,
  type ChartBox,
  type ProgressPoint,
  type ProgressSession,
} from '../lib/exercise-progress';
import styles from './LoadChart.module.css';

// O SVG é desenhado na largura REAL do cartão (medida), então textos e traços têm tamanho
// fixo em px em qualquer tela; só a área útil cresce. Dois painéis com o MESMO eixo horizontal.
const FALLBACK_WIDTH = 320;
const LEFT = 34; // números do eixo vertical
const RIGHT = 8;
const INSET = 12; // recuo dos pontos para as barras das pontas não encostarem nos eixos
const LOAD_TOP = 30; // espaço para a unidade do eixo e o valor do ponto selecionado
const PANEL_GAP = 42; // separa os painéis e acomoda a unidade "reps" e o número da barra selecionada
const DATE_AXIS = 28;

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(FALLBACK_WIDTH);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => setWidth(Math.max(260, Math.round(element.getBoundingClientRect().width)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/**
 * Evolução da série mais pesada de cada sessão: a carga (linha) e as repetições DESSA MESMA
 * série (barras alinhadas abaixo de cada ponto). Tocar, passar o cursor ou usar as setas do
 * teclado seleciona uma sessão, destacada nos dois painéis e resumida acima do gráfico.
 */
export default function LoadChart({ points, sessions }: { points: ProgressPoint[]; sessions: ProgressSession[] }) {
  const [selected, setSelected] = useState<number | null>(null);
  const [wrapRef, width] = useWidth();
  const titleId = useId();

  // A altura acompanha a largura (com limites) para a inclinação da linha não achatar no desktop.
  const loadHeight = Math.round(Math.min(240, Math.max(124, width * 0.32)));
  const repsHeight = Math.round(Math.min(96, Math.max(56, width * 0.13)));
  const loadBottom = LOAD_TOP + loadHeight;
  const repsTop = loadBottom + PANEL_GAP;
  const repsBottom = repsTop + repsHeight;
  const height = repsBottom + DATE_AXIS;
  const plotWidth = width - LEFT - RIGHT - 2 * INSET;
  const box: ChartBox = { width, height, left: LEFT + INSET, right: RIGHT + INSET, top: LOAD_TOP, bottom: height - loadBottom };

  const load = chartLayout(points, box);
  const reps = repsLayout(points, load.dots, { top: repsTop, bottom: repsBottom }, plotWidth);
  const rows = withSetCounts(points, sessions);
  const current = Math.min(selected ?? points.length - 1, points.length - 1);
  const row = rows[current];
  const dot = load.dots[current];
  const bar = reps.bars[current];
  const comparison = compareWithPrevious(points, current);
  const dates = dateAxisLabels(points, load.dots, current, 64);
  const allBarLabels = showAllBarLabels(points.length, plotWidth);
  const allMarkers = showAllMarkers(points.length, plotWidth);
  const repsTop1 = reps.ticks[reps.ticks.length - 1];

  function selectAt(event: PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0) return;
    setSelected(nearestIndex(load.dots, ((event.clientX - rect.left) / rect.width) * width));
  }

  function onKeyDown(event: KeyboardEvent<SVGSVGElement>) {
    const moves: Record<string, number> = {
      ArrowLeft: current - 1,
      ArrowRight: current + 1,
      Home: 0,
      End: points.length - 1,
    };
    if (!(event.key in moves)) return;
    event.preventDefault();
    setSelected(Math.max(0, Math.min(points.length - 1, moves[event.key])));
  }

  // Texto que acompanha um x sem sair da área do gráfico.
  const anchorFor = (x: number, room: number) =>
    x - room < LEFT ? 'start' : x + room > width - RIGHT ? 'end' : 'middle';
  const clampX = (x: number, anchor: string) => (anchor === 'start' ? Math.max(x, LEFT) : anchor === 'end' ? Math.min(x, width - RIGHT) : x);

  const weightText = row ? row.weight.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) : '';
  const weightAnchor = dot ? anchorFor(dot.x, 18) : 'middle';
  // Valor acima do ponto; se o ponto estiver no topo, abaixo dele.
  const weightY = dot ? (dot.y - 12 < LOAD_TOP - 2 ? dot.y + 20 : dot.y - 12) : 0;

  return (
    <figure className={styles.figure}>
      {row && (
        <figcaption className={styles.summary} aria-live="polite">
          <span className={styles.summaryDate}>
            {current === points.length - 1 ? 'Última sessão' : 'Sessão selecionada'} ·{' '}
            {fullDateLabel(row.startedAt)}
          </span>
          <span className={styles.summaryValue}>
            <strong>{formatKg(row.weight)}</strong>
            <span className={styles.times} aria-hidden="true">
              ×
            </span>
            <span className={styles.srOnly}>com</span>
            <strong>
              {row.reps} {row.reps === 1 ? 'repetição' : 'repetições'}
            </strong>
          </span>
          <span className={styles.summaryMeta}>
            <span className={styles.chip}>
              {row.setCount} {row.setCount === 1 ? 'série' : 'séries'}
            </span>
            <span className={styles.compare}>
              {comparison
                ? `${comparisonLabel(comparison)} em relação a ${shortDateLabel(comparison.previous.startedAt)}`
                : points.length > 1
                  ? 'Primeira sessão do período'
                  : 'Conclua mais treinos para comparar.'}
            </span>
          </span>
        </figcaption>
      )}

      <div className={styles.legend} aria-hidden="true">
        <span className={styles.legendItem}>
          <span className={styles.swatchLine} />
          Carga (kg)
        </span>
        <span className={styles.legendItem}>
          <span className={styles.swatchBar} />
          Repetições
        </span>
      </div>

      <div ref={wrapRef} className={styles.plot}>
        <svg
          className={styles.svg}
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-labelledby={titleId}
          tabIndex={0}
          onPointerDown={selectAt}
          onPointerMove={selectAt}
          onKeyDown={onKeyDown}
        >
          <title id={titleId}>
            {`Carga e repetições da série mais pesada de cada sessão, ${points.length} ${points.length === 1 ? 'sessão' : 'sessões'}. Use as setas para percorrer as sessões.`}
          </title>

          {/* Painel de carga: grade leve, números à esquerda, unidade no topo do eixo. */}
          <text className={styles.unit} x={LEFT - 6} y={LOAD_TOP - 16} textAnchor="end">
            kg
          </text>
          {load.ticks.map((tick) => (
            <g key={`kg-${tick.value}`}>
              <line className={styles.grid} x1={LEFT} x2={width - RIGHT} y1={tick.y} y2={tick.y} />
              <text className={styles.tick} x={LEFT - 6} y={tick.y} textAnchor="end" dominantBaseline="middle">
                {tick.label}
              </text>
            </g>
          ))}

          {/* Painel de repetições: escala própria a partir de zero; só a base e o topo. */}
          <text className={styles.unit} x={LEFT - 6} y={repsTop - 19} textAnchor="end">
            reps
          </text>
          {repsTop1 && (
            <g>
              <line className={styles.grid} x1={LEFT} x2={width - RIGHT} y1={repsTop1.y} y2={repsTop1.y} />
              <text className={styles.tick} x={LEFT - 6} y={repsTop1.y} textAnchor="end" dominantBaseline="middle">
                {repsTop1.value}
              </text>
            </g>
          )}
          <line className={styles.baseline} x1={LEFT} x2={width - RIGHT} y1={repsBottom} y2={repsBottom} />
          <text className={styles.tick} x={LEFT - 6} y={repsBottom} textAnchor="end" dominantBaseline="middle">
            0
          </text>

          {/* Faixa da sessão selecionada, atravessando os dois painéis. */}
          {dot && bar && (
            <rect
              className={styles.band}
              x={dot.x - Math.max(bar.width / 2 + 4, 8)}
              y={LOAD_TOP - 4}
              width={Math.max(bar.width + 8, 16)}
              height={repsBottom - LOAD_TOP + 4}
              rx={6}
            />
          )}

          {reps.bars.map((b, index) => (
            <rect
              key={`bar-${points[index].sessionId}`}
              className={index === current ? styles.barOn : styles.bar}
              x={b.x}
              y={b.y}
              width={b.width}
              height={b.height}
              rx={Math.min(3, b.width / 2)}
            />
          ))}
          {reps.bars.map((b, index) =>
            allBarLabels || index === current ? (
              <text
                key={`reps-${points[index].sessionId}`}
                className={index === current ? styles.barLabelOn : styles.barLabel}
                x={b.x + b.width / 2}
                y={b.y - 4}
                textAnchor="middle"
              >
                {points[index].reps}
              </text>
            ) : null,
          )}

          <path className={styles.line} d={load.path} />
          {load.dots.map((d, index) =>
            index !== current && allMarkers ? (
              <circle key={`dot-${points[index].sessionId}`} className={styles.dot} cx={d.x} cy={d.y} r={3.5} />
            ) : null,
          )}
          {dot && (
            <g>
              <circle className={styles.dotHalo} cx={dot.x} cy={dot.y} r={9} />
              <circle className={styles.dotOn} cx={dot.x} cy={dot.y} r={5} />
              <text
                className={styles.pointLabel}
                x={clampX(dot.x, weightAnchor)}
                y={weightY}
                textAnchor={weightAnchor}
              >
                {weightText}
              </text>
            </g>
          )}

          {/* Datas: primeira, última e a da sessão selecionada (em destaque). */}
          {dates.map((label) => {
            const anchor = anchorFor(label.x, label.selected ? 30 : 22);
            const x = clampX(label.x, anchor);
            return label.selected ? (
              <g key={`date-${label.index}`}>
                <text className={styles.dateOn} x={x} y={repsBottom + 18} textAnchor={anchor}>
                  {label.label}
                </text>
                <line className={styles.dateTickOn} x1={label.x} x2={label.x} y1={repsBottom} y2={repsBottom + 5} />
              </g>
            ) : (
              <text key={`date-${label.index}`} className={styles.date} x={x} y={repsBottom + 18} textAnchor={anchor}>
                {label.label}
              </text>
            );
          })}
        </svg>
      </div>

      <details className={styles.values}>
        <summary>Ver todos os valores</summary>
        <table className={styles.table}>
          <caption>Série mais pesada de cada sessão, da mais recente para a mais antiga.</caption>
          <thead>
            <tr>
              <th scope="col">Data</th>
              <th scope="col">Carga</th>
              <th scope="col">Repetições</th>
              <th scope="col">Séries</th>
            </tr>
          </thead>
          <tbody>
            {[...rows].reverse().map((item) => (
              <tr key={item.sessionId}>
                <td>{shortDateLabel(item.startedAt, true)}</td>
                <td>{formatKg(item.weight)}</td>
                <td>{item.reps}</td>
                <td>{item.setCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
