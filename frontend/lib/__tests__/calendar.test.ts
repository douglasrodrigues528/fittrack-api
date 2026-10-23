import { strict as assert } from 'node:assert';
import { after, describe, it } from 'node:test';
import {
  addDays,
  addMonths,
  compareMonths,
  countTrainedDays,
  dayKey,
  earliestMonth,
  groupByDay,
  isFutureDay,
  monthGrid,
  monthNavigation,
  monthTitle,
  rangeFor,
  sessionDateLabel,
  sessionDayKey,
  weekDays,
  weekNavigation,
  type CalendarSession,
} from '../calendar';

const originalTz = process.env.TZ;
after(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

/** Roda o bloco com o fuso do processo trocado (o Node relê process.env.TZ). */
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

const session = (id: string, startedAt: string): CalendarSession => ({
  id,
  workoutId: null,
  origin: 'free',
  title: id,
  startedAt,
  finishedAt: null,
  durationSeconds: 3600,
});

describe('calendário: datas no fuso local', () => {
  it('treino às 23:30 em São Paulo fica no próprio dia, não no seguinte (que já é 1º em UTC)', () => {
    inTimeZone('America/Sao_Paulo', () => {
      const groups = groupByDay([session('noturno', '2026-09-01T02:30:00.000Z')]);
      assert.deepEqual([...groups.keys()], ['2026-08-31']);
    });
  });

  it('o mesmo instante cai em dias diferentes conforme o fuso de quem consulta', () => {
    const instant = '2026-09-10T23:30:00.000Z';
    inTimeZone('America/Sao_Paulo', () => assert.equal(dayKey(new Date(instant)), '2026-09-10'));
    inTimeZone('Asia/Tokyo', () => assert.equal(dayKey(new Date(instant)), '2026-09-11'));
    inTimeZone('UTC', () => assert.equal(dayKey(new Date(instant)), '2026-09-10'));
  });

  it('o período pedido à API começa e termina na meia-noite LOCAL', () => {
    inTimeZone('America/Sao_Paulo', () => {
      const week = weekDays(new Date(2026, 9, 22));
      assert.deepEqual(rangeFor(week), { from: '2026-10-18T03:00:00.000Z', to: '2026-10-25T03:00:00.000Z' });
    });
    inTimeZone('Asia/Tokyo', () => {
      const week = weekDays(new Date(2026, 9, 22));
      assert.deepEqual(rangeFor(week), { from: '2026-10-17T15:00:00.000Z', to: '2026-10-24T15:00:00.000Z' });
    });
  });

  it('mudança de horário de verão não pula nem repete dias', () => {
    inTimeZone('America/New_York', () => {
      // 2026-03-08: os relógios adiantam 1h em Nova York.
      const days = weekDays(new Date(2026, 2, 10)).map((d) => d.key);
      assert.deepEqual(days, ['2026-03-08', '2026-03-09', '2026-03-10', '2026-03-11', '2026-03-12', '2026-03-13', '2026-03-14']);
      assert.equal(dayKey(addDays(new Date(2026, 10, 1), 1)), '2026-11-02'); // fim do horário de verão
    });
  });
});

describe('calendário: semana e mês', () => {
  it('a semana vai de domingo a sábado e contém o dia de referência', () => {
    const week = weekDays(new Date(2026, 9, 22)); // quinta, 22/10/2026
    assert.equal(week.length, 7);
    assert.equal(week[0].date.getDay(), 0);
    assert.deepEqual([week[0].key, week[6].key], ['2026-10-18', '2026-10-24']);
  });

  it('a grade mensal alinha o dia 1º no dia da semana certo e fecha semanas completas', () => {
    const october = monthGrid(2026, 9); // 1º/10/2026 é quinta-feira
    assert.equal(october.length % 7, 0);
    const firstIndex = october.findIndex((d) => d.key === '2026-10-01');
    assert.equal(firstIndex, 4);
    assert.equal(october.filter((d) => d.inMonth).length, 31);
    assert.equal(october[0].key, '2026-09-27');
    assert.equal(october[october.length - 1].key, '2026-10-31');

    const february = monthGrid(2026, 1); // 1º/02/2026 é domingo: 4 semanas exatas
    assert.equal(february.length, 28);
    assert.ok(monthGrid(2026, 7).length === 42, 'agosto/2026 precisa de 6 linhas');
  });

  it('o período mensal cobre a grade inteira (dias vizinhos também mostram treinos) e respeita o limite da API', () => {
    const grid = monthGrid(2026, 7);
    const { from, to } = rangeFor(grid);
    const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
    assert.ok(days >= 41 && days <= 43 && days < 62);
  });

  it('navega entre meses atravessando o ano', () => {
    assert.deepEqual(addMonths(2026, 0, -1), { year: 2025, month: 11 });
    assert.deepEqual(addMonths(2026, 11, 1), { year: 2027, month: 0 });
    assert.equal(monthTitle(2026, 9), 'Outubro de 2026');
  });

  it('o histórico começa no mês do primeiro treino; sem treinos, no mês atual', () => {
    const today = new Date(2026, 9, 22);
    assert.deepEqual(earliestMonth('2026-03-05T12:00:00.000Z', today), { year: 2026, month: 2 });
    assert.deepEqual(earliestMonth(null, today), { year: 2026, month: 9 });
    assert.ok(compareMonths({ year: 2026, month: 2 }, { year: 2026, month: 9 }) < 0);
  });
});

describe('calendário: marcadores', () => {
  const sessions = [
    session('tarde', '2026-10-20T19:00:00.000Z'),
    session('manha', '2026-10-20T10:00:00.000Z'),
    session('outro', '2026-10-22T12:00:00.000Z'),
  ];

  it('vários treinos no mesmo dia: um dia marcado, todos os treinos em ordem de horário', () => {
    inTimeZone('America/Sao_Paulo', () => {
      const groups = groupByDay(sessions);
      assert.deepEqual(groups.get('2026-10-20')?.map((s) => s.id), ['manha', 'tarde']);
      assert.equal(countTrainedDays(groups, weekDays(new Date(2026, 9, 22))), 2);
    });
  });

  it('dias sem sessão não são marcados (nada é inventado)', () => {
    inTimeZone('America/Sao_Paulo', () => {
      const groups = groupByDay(sessions);
      const week = weekDays(new Date(2026, 9, 22));
      const marked = week.filter((d) => groups.has(d.key)).map((d) => d.key);
      assert.deepEqual(marked, ['2026-10-20', '2026-10-22']);
      assert.equal(countTrainedDays(groupByDay([]), week), 0);
    });
  });

  it('datas futuras são identificadas (não podem ser selecionadas como treinadas)', () => {
    assert.equal(isFutureDay('2026-10-23', '2026-10-22'), true);
    assert.equal(isFutureDay('2026-10-22', '2026-10-22'), false);
    assert.equal(isFutureDay('2026-09-30', '2026-10-22'), false);
  });
});

describe('calendário: navegação respeita o histórico e não vai para o futuro', () => {
  const today = new Date(2026, 9, 22); // quinta, semana de 18/10

  it('semana: sem histórico fica na atual; com histórico volta até a semana do 1º treino', () => {
    assert.deepEqual(weekNavigation('2026-10-18', today, null), { canGoBack: false, canGoForward: false });
    const first = new Date(2026, 9, 6, 12).toISOString(); // terça, semana de 04/10
    assert.deepEqual(weekNavigation('2026-10-18', today, first), { canGoBack: true, canGoForward: false });
    assert.deepEqual(weekNavigation('2026-10-11', today, first), { canGoBack: true, canGoForward: true });
    assert.deepEqual(weekNavigation('2026-10-04', today, first), { canGoBack: false, canGoForward: true });
  });

  it('mês: volta até o mês do 1º treino e não passa do mês atual', () => {
    const first = new Date(2026, 6, 15, 12).toISOString(); // julho
    assert.deepEqual(monthNavigation({ year: 2026, month: 9 }, today, first), { canGoBack: true, canGoForward: false });
    assert.deepEqual(monthNavigation({ year: 2026, month: 6 }, today, first), { canGoBack: false, canGoForward: true });
    assert.deepEqual(monthNavigation({ year: 2026, month: 9 }, today, null), { canGoBack: false, canGoForward: false });
  });
});

describe('mesma data no calendário e no histórico (data local de início)', () => {
  // Domingo 18/10/2026 23:30 em São Paulo (= segunda 02:30 UTC), terminando segunda 00:20.
  const crossMidnight = { ...session('virada', '2026-10-19T02:30:00.000Z'), finishedAt: '2026-10-19T03:20:00.000Z' };
  const sameDay = { ...session('tarde', '2026-10-20T19:00:00.000Z'), finishedAt: '2026-10-20T20:00:00.000Z' };
  const september = { ...session('setembro', '2026-09-10T21:00:00.000Z'), finishedAt: '2026-09-10T22:00:00.000Z' };

  it('treino que atravessa a meia-noite fica no domingo nas duas telas', () => {
    inTimeZone('America/Sao_Paulo', () => {
      assert.equal(sessionDayKey(crossMidnight), '2026-10-18');
      assert.equal(sessionDateLabel(crossMidnight), 'dom., 18 de out.');
      assert.deepEqual([...groupByDay([crossMidnight]).keys()], ['2026-10-18']);
      // A data de término é segunda: ela NÃO define o dia.
      assert.equal(dayKey(new Date(crossMidnight.finishedAt!)), '2026-10-19');
    });
  });

  it('início e fim no mesmo dia, e meses anteriores', () => {
    inTimeZone('America/Sao_Paulo', () => {
      assert.equal(sessionDateLabel(sameDay), 'ter., 20 de out.');
      assert.equal(sessionDateLabel(september), 'qui., 10 de set.');
      assert.deepEqual([...groupByDay([september, sameDay]).keys()], ['2026-09-10', '2026-10-20']);
    });
  });

  it('em qualquer fuso, histórico e calendário concordam entre si', () => {
    for (const tz of ['America/Sao_Paulo', 'Asia/Tokyo', 'UTC', 'America/New_York', 'Pacific/Auckland']) {
      inTimeZone(tz, () => {
        for (const s of [crossMidnight, sameDay, september]) {
          const [calendarDay] = [...groupByDay([s]).keys()];
          assert.equal(sessionDayKey(s), calendarDay, `${tz} ${s.id}`);
          const label = sessionDateLabel(s);
          const expected = new Date(s.startedAt).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' });
          assert.equal(label, expected, `${tz} ${s.id}`);
        }
      });
    }
    // Mudança de fuso: o mesmo treino é domingo em São Paulo e segunda em Tóquio (nas duas telas).
    inTimeZone('Asia/Tokyo', () => assert.equal(sessionDateLabel(crossMidnight), 'seg., 19 de out.'));
  });
});
