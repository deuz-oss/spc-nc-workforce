/// <reference types="node" />
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeSurvey, surveyCsvRows } from './survey';
import type { Survey, SurveyResponse } from '../types';

const survey: Survey = {
  id: 'sv1',
  title: 'Kepuasan',
  createdBy: 'a',
  createdAt: 0,
  questions: [
    { id: 'q1', text: 'Puas?', type: 'multiple_choice', options: ['Ya', 'Tidak'] },
    { id: 'q2', text: 'Saran', type: 'free_text' },
  ],
};

const resp = (id: string, t: number, answers: Record<string, string>, surveyId = 'sv1'): SurveyResponse => ({
  id,
  surveyId,
  visitId: null,
  consumerId: null,
  answers,
  createdAt: t,
});

const responses = [
  resp('r1', 1, { q1: 'Ya', q2: 'Bagus' }),
  resp('r2', 2, { q1: 'Ya', q2: '  ' }),
  resp('r3', 3, { q1: 'Tidak' }),
  resp('r4', 4, { q2: 'Tambah stok' }), // skipped q1
  resp('x', 5, { q1: 'Ya' }, 'other_survey'),
];

describe('summarizeSurvey', () => {
  const [q1, q2] = summarizeSurvey(survey, responses);

  it('counts choices among respondents who answered, ignoring other surveys', () => {
    assert.equal(q1.kind, 'choice');
    if (q1.kind !== 'choice') return;
    assert.equal(q1.answered, 3);
    assert.deepEqual(q1.options, [
      { option: 'Ya', count: 2, pct: 67 },
      { option: 'Tidak', count: 1, pct: 33 },
    ]);
  });

  it('keeps an answer that is no longer among the options (survey edited later)', () => {
    const [s] = summarizeSurvey(survey, [resp('r9', 9, { q1: 'Mungkin' })]);
    assert.ok(s.kind === 'choice' && s.options.some((o) => o.option === 'Mungkin' && o.count === 1));
  });

  it('lists non-empty free-text answers newest first', () => {
    assert.equal(q2.kind, 'text');
    if (q2.kind !== 'text') return;
    assert.deepEqual(
      q2.answers.map((a) => a.answer),
      ['Tambah stok', 'Bagus'],
    );
  });
});

describe('surveyCsvRows', () => {
  it('writes a header plus one row per response in time order, blanks for unanswered', () => {
    const rows = surveyCsvRows(survey, responses, () => ({ nc: 'Budi', store: 'Apotek' }));
    assert.deepEqual(rows[0], ['response_id', 'waktu', 'nc', 'toko', 'Puas?', 'Saran']);
    assert.equal(rows.length, 5);
    assert.deepEqual(rows[4].slice(4), ['', 'Tambah stok']);
  });
});
