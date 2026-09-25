import type { Survey, SurveyResponse } from '../types';

export interface ChoiceSummary {
  kind: 'choice';
  questionId: string;
  text: string;
  answered: number;
  /** One entry per configured option (in order), plus any answer not among them. */
  options: Array<{ option: string; count: number; pct: number }>;
}

export interface TextSummary {
  kind: 'text';
  questionId: string;
  text: string;
  answered: number;
  /** Non-empty answers, newest first. */
  answers: Array<{ answer: string; createdAt: number; responseId: string }>;
}

export type QuestionSummary = ChoiceSummary | TextSummary;

const pct = (n: number, total: number) => (total ? Math.round((100 * n) / total) : 0);

/** Per-question aggregation of a survey's responses (PRD §5.7). Percentages
 * are of respondents who answered that question, not of all responses. */
export function summarizeSurvey(survey: Survey, responses: SurveyResponse[]): QuestionSummary[] {
  const mine = responses.filter((r) => r.surveyId === survey.id).sort((a, b) => b.createdAt - a.createdAt);
  return survey.questions.map((q) => {
    const given = mine
      .map((r) => ({ answer: (r.answers[q.id] ?? '').trim(), createdAt: r.createdAt, responseId: r.id }))
      .filter((a) => a.answer !== '');
    if (q.type === 'multiple_choice') {
      const counts = new Map<string, number>((q.options ?? []).map((o) => [o, 0]));
      for (const a of given) counts.set(a.answer, (counts.get(a.answer) ?? 0) + 1);
      return {
        kind: 'choice',
        questionId: q.id,
        text: q.text,
        answered: given.length,
        options: [...counts].map(([option, count]) => ({ option, count, pct: pct(count, given.length) })),
      };
    }
    return { kind: 'text', questionId: q.id, text: q.text, answered: given.length, answers: given };
  });
}

/** CSV export rows: one row per response, one column per question (in survey order). */
export function surveyCsvRows(
  survey: Survey,
  responses: SurveyResponse[],
  context: (r: SurveyResponse) => { nc: string; store: string },
): Array<Array<string>> {
  const mine = responses.filter((r) => r.surveyId === survey.id).sort((a, b) => a.createdAt - b.createdAt);
  return [
    ['response_id', 'waktu', 'nc', 'toko', ...survey.questions.map((q) => q.text)],
    ...mine.map((r) => {
      const c = context(r);
      return [r.id, new Date(r.createdAt).toISOString(), c.nc, c.store, ...survey.questions.map((q) => r.answers[q.id] ?? '')];
    }),
  ];
}
