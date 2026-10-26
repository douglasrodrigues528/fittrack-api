import { strict as assert } from 'node:assert';
import { after, describe, it } from 'node:test';
import {
  chartLayout,
  compareWithPrevious,
  comparisonLabel,
  dateAxisLabels,
  formatKg,
  showAllBarLabels,
  showAllMarkers,
  fullDateLabel,
  loadTicks,
  nearestIndex,
  repsLayout,
  repsTicks,
  withSetCounts,
  progressPath,
  repsLabel,
  shortDateLabel,
  type ChartBox,
  type ProgressPoint,
  type ProgressSession,
} from '../exercise-progress';

const originalTz = process.env.TZ;
after(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

function inTimeZone(tz: string, run: () => void) {
  const previous = process.env.TZ;
  process.env.TZ = tz;
  try {
    run();
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
}

const BOX: ChartBox = { width: 320, height: 200, left: 40, right: 12, top: 12, bottom: 28 };

const point = (startedAt: string, weight: number, reps = 8, sessionId = startedAt): ProgressPoint => ({
  sessionId,
  startedAt,
  weight,
  reps,
});

describe('formatação', () => {
  it('cargas e repetições em português', () => {
    assert.equal(formatKg(72.5), '72,5 kg');
    assert.equal(formatKg(100), '100 kg');
    assert.equal(repsLabel(1), '1 repetição');
    assert.equal(repsLabel(5), '5 repetições');
  });

  it('a data é o dia LOCAL de início (mesma regra do calendário e do histórico)', () => {
    inTimeZone('America/Sao_Paulo', () => {
      // 23:30 de 18/10 em São Paulo = 02:30 de 19/10 em UTC.
      assert.equal(shortDateLabel('2026-10-19T02:30:00.000Z'), '18/10');
      assert.equal(fullDateLabel('2026-10-19T02:30:00.000Z'), '18 de out. de 2026');
    });
    inTimeZone('Asia/Tokyo', () => {
      assert.equal(shortDateLabel('2026-10-19T02:30:00.000Z'), '19/10');
    });
  });

  it('link da evolução codifica o ID do catálogo', () => {
    assert.equal(progressPath('Barbell_Bench_Press_-_Medium_Grip'), '/exercises/progress?id=Barbell_Bench_Press_-_Medium_Grip');
    assert.equal(progressPath('3/4 Sit-Up'), '/exercises/progress?id=3%2F4%20Sit-Up');
  });
});

describe('loadTicks', () => {
  it('marcas redondas que cobrem o intervalo', () => {
    assert.deepEqual(loadTicks(55, 72.5), [55, 60, 65, 70, 75]);
    assert.deepEqual(loadTicks(20, 100), [20, 40, 60, 80, 100]);
  });

  it('um único valor ganha uma faixa em volta, sem ir abaixo de zero', () => {
    const ticks = loadTicks(60, 60);
    assert.ok(ticks[0] < 60 && ticks[ticks.length - 1] > 60);
    assert.ok(loadTicks(1, 1)[0] >= 0);
  });
});

describe('chartLayout', () => {
  it('pontos da esquerda para a direita na ordem recebida (cronológica), altura pela carga', () => {
    const points = [
      point('2026-09-03T22:00:00.000Z', 55),
      point('2026-09-10T22:00:00.000Z', 70),
      point('2026-09-17T22:00:00.000Z', 72.5),
      point('2026-09-24T22:00:00.000Z', 65),
    ];
    const layout = chartLayout(points, BOX);
    const xs = layout.dots.map((d) => d.x);
    assert.deepEqual([...xs].sort((a, b) => a - b), xs);
    assert.equal(xs[0], BOX.left);
    assert.equal(xs[3], BOX.width - BOX.right);
    // Mais carga = mais alto (y menor no SVG).
    const ys = layout.dots.map((d) => d.y);
    assert.ok(ys[2] < ys[1] && ys[1] < ys[3] && ys[3] < ys[0]);
    // Todos dentro da área do gráfico.
    for (const y of ys) assert.ok(y >= BOX.top && y <= BOX.height - BOX.bottom);
    assert.ok(layout.path.startsWith('M40.0,'));
  });

  it('datas do eixo: primeira, última e a selecionada em destaque; com ano se atravessar anos', () => {
    inTimeZone('America/Sao_Paulo', () => {
      const points = [
        point('2026-09-03T22:00:00.000Z', 50),
        point('2026-09-10T22:00:00.000Z', 55),
        point('2026-09-17T22:00:00.000Z', 60),
        point('2026-09-24T22:00:00.000Z', 65),
        point('2026-10-01T22:00:00.000Z', 70),
      ];
      const { dots } = chartLayout(points, BOX);
      // Selecionada no meio: as três datas, em ordem, só a do meio destacada.
      assert.deepEqual(
        dateAxisLabels(points, dots, 2, 40).map((l) => [l.index, l.label, l.selected]),
        [
          [0, '03/09', false],
          [2, '17/09', true],
          [4, '01/10', false],
        ],
      );
      // Selecionada perto de uma ponta: a ponta vizinha some para não sobrepor.
      assert.deepEqual(
        dateAxisLabels(points, dots, 3, 80).map((l) => [l.index, l.selected]),
        [
          [0, false],
          [3, true],
        ],
      );
      // A última selecionada não se repete.
      assert.deepEqual(dateAxisLabels(points, dots, 4, 40).map((l) => l.index), [0, 4]);

      const twoYears = [point('2025-12-20T15:00:00.000Z', 50), point('2026-01-10T15:00:00.000Z', 55)];
      const yearDots = chartLayout(twoYears, BOX).dots;
      assert.deepEqual(dateAxisLabels(twoYears, yearDots, 1, 40).map((l) => l.label), ['20/12/25', '10/01/26']);
      // 23:30 de 20/08 em São Paulo (02:30 UTC de 21/08) aparece como 20/08.
      const night = [point('2026-08-21T02:30:00.000Z', 60)];
      assert.equal(dateAxisLabels(night, chartLayout(night, BOX).dots, 0, 40)[0].label, '20/08');
    });
  });

  it('um ponto só fica centralizado; sem pontos, nada a desenhar', () => {
    const single = chartLayout([point('2026-09-03T22:00:00.000Z', 40)], BOX);
    assert.equal(single.dots[0].x, BOX.left + (BOX.width - BOX.left - BOX.right) / 2);
    assert.equal(dateAxisLabels([point('2026-09-03T22:00:00.000Z', 40)], single.dots, 0, 40).length, 1);
    assert.deepEqual(chartLayout([], BOX), { dots: [], ticks: [], path: '' });
  });

  it('nearestIndex escolhe o ponto mais próximo do toque', () => {
    const dots = [{ x: 40 }, { x: 140 }, { x: 240 }];
    assert.equal(nearestIndex(dots, 0), 0);
    assert.equal(nearestIndex(dots, 100), 1);
    assert.equal(nearestIndex(dots, 200), 2);
    assert.equal(nearestIndex(dots, 999), 2);
  });
});

describe('repetições associadas à carga', () => {
  const session = (sessionId: string, sets: [number, number][]): ProgressSession => ({
    sessionId,
    workoutId: null,
    origin: 'free',
    title: 'Treino',
    startedAt: '2026-09-01T22:00:00.000Z',
    finishedAt: null,
    setCount: sets.length,
    sets: sets.map(([weight, reps]) => ({ type: 'normal', weight, reps })),
    best: null,
  });

  it('repsTicks: inteiros a partir de zero, cobrindo o máximo', () => {
    assert.deepEqual(repsTicks(12), [0, 5, 10, 15]);
    assert.deepEqual(repsTicks(5), [0, 2, 4, 6]);
    assert.deepEqual(repsTicks(1), [0, 1]);
    for (const max of [1, 3, 8, 12, 20, 37, 100]) {
      const ticks = repsTicks(max);
      assert.equal(ticks[0], 0);
      assert.ok(ticks.every(Number.isInteger));
      assert.ok(ticks[ticks.length - 1] >= max);
    }
  });

  it('cada barra fica sob o ponto de carga da MESMA série, com altura pelas repetições dela', () => {
    // 20 kg × 12 numa sessão e 22 kg × 10 na outra: a carga sobe, as repetições caem.
    const points = [
      point('2026-09-03T22:00:00.000Z', 20, 12, 'a'),
      point('2026-09-10T22:00:00.000Z', 22, 10, 'b'),
    ];
    const load = chartLayout(points, BOX);
    const reps = repsLayout(points, load.dots, { top: 200, bottom: 270 }, BOX.width - BOX.left - BOX.right);

    reps.bars.forEach((bar, index) => assert.equal(bar.x + bar.width / 2, load.dots[index].x));
    // Carga maior (y menor) no 2º ponto; repetições menores (barra mais baixa) no 2º.
    assert.ok(load.dots[1].y < load.dots[0].y);
    assert.ok(reps.bars[1].height < reps.bars[0].height);
    // Escala honesta: base no zero, altura proporcional às repetições.
    assert.equal(reps.ticks[0].value, 0);
    assert.equal(reps.ticks[0].y, 270);
    // Altura proporcional às repetições (escala linear a partir de 0) e folga acima da maior barra.
    assert.ok(Math.abs(reps.bars[1].height / reps.bars[0].height - 10 / 12) < 1e-9);
    assert.ok(reps.bars[0].y > 200);
    for (const bar of reps.bars) assert.ok(Math.abs(bar.y + bar.height - 270) < 1e-9);
  });

  it('barras continuam visíveis e dentro do gráfico com muitas sessões', () => {
    const points = Array.from({ length: 60 }, (_, i) =>
      point(new Date(Date.UTC(2026, 0, 1 + i * 3, 22)).toISOString(), 40 + (i % 7), 5 + (i % 9), `s${i}`),
    );
    const load = chartLayout(points, BOX);
    const reps = repsLayout(points, load.dots, { top: 200, bottom: 270 }, BOX.width - BOX.left - BOX.right);
    assert.equal(reps.bars.length, 60);
    for (const bar of reps.bars) {
      assert.ok(bar.width >= 2);
      assert.ok(bar.x >= BOX.left - bar.width && bar.x + bar.width <= BOX.width - BOX.right + bar.width);
    }
  });

  it('withSetCounts usa a contagem da própria sessão, sem trocar os valores da série', () => {
    const points = [point('2026-09-03T22:00:00.000Z', 22, 10, 'a'), point('2026-09-10T22:00:00.000Z', 20, 12, 'b')];
    const rows = withSetCounts(points, [
      session('b', [[20, 12]]),
      session('a', [
        [20, 12],
        [22, 10],
        [21, 11],
      ]),
    ]);
    assert.deepEqual(
      rows.map((r) => [r.sessionId, r.weight, r.reps, r.setCount]),
      [
        ['a', 22, 10, 3],
        ['b', 20, 12, 1],
      ],
    );
    assert.deepEqual(repsLayout([], [], { top: 0, bottom: 10 }, 100), { bars: [], ticks: [] });
  });
});

describe('comparação e densidade', () => {
  it('compara com a sessão ANTERIOR usando a série mais pesada de cada uma', () => {
    const points = [
      point('2026-09-03T22:00:00.000Z', 20, 12, 'a'),
      point('2026-09-10T22:00:00.000Z', 22, 10, 'b'),
      point('2026-09-17T22:00:00.000Z', 22, 11, 'c'),
      point('2026-09-24T22:00:00.000Z', 19.5, 12, 'd'),
    ];
    assert.equal(compareWithPrevious(points, 0), null);
    const b = compareWithPrevious(points, 1)!;
    assert.equal(b.previous.sessionId, 'a');
    assert.deepEqual([b.weightDelta, b.repsDelta], [2, -2]);
    assert.equal(comparisonLabel(b), '+2 kg · −2 reps');
    assert.equal(comparisonLabel(compareWithPrevious(points, 2)!), 'mesma carga · +1 rep');
    assert.equal(comparisonLabel(compareWithPrevious(points, 3)!), '−2,5 kg · +1 rep');
    assert.equal(compareWithPrevious(points, 9), null);
  });

  it('cargas fracionadas não geram dízimas na diferença', () => {
    const points = [point('2026-09-03T22:00:00.000Z', 22.1, 8), point('2026-09-10T22:00:00.000Z', 22.3, 8)];
    assert.equal(compareWithPrevious(points, 1)!.weightDelta, 0.2);
    assert.equal(comparisonLabel(compareWithPrevious(points, 1)!), '+0,2 kg · mesmas reps');
  });

  it('números em todas as barras e marcadores em todos os pontos só com poucas sessões', () => {
    assert.equal(showAllBarLabels(9, 260), true);
    assert.equal(showAllBarLabels(12, 240), false); // 20 px por sessão: apertado
    assert.equal(showAllBarLabels(60, 1000), false);
    assert.equal(showAllMarkers(20, 600), true);
    assert.equal(showAllMarkers(60, 260), false);
    assert.equal(showAllMarkers(20, 200), false);
  });
});
