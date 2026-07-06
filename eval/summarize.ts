import { file, write } from "bun";

type Condition = "baseline" | "chart" | "recall";

type Case = {
  id: string;
  subsystem?: string;
  difficulty?: string;
};

type CasesFile = {
  commit: string;
  cases: Case[];
};

type ResultRow = {
  caseId: string;
  condition: Condition;
  tokens: {
    total_tokens: number;
  };
  correct: boolean;
  chartHit: boolean | null;
  chartHitAnyRank?: boolean | null;
  chartHitTopRank?: boolean;
};

type CaseSummary = {
  caseId: string;
  label: string | null;
  difficulty: string | null;
  baselineTokens: number;
  chartTokens: number;
  recallTokens: number;
  baselineCorrect: boolean;
  chartCorrect: boolean;
  recallCorrect: boolean;
  chartHit: boolean;
  chartHitTopRank: boolean;
  savingsPct: number;
};

const REPOS = ["dub", "polar", "posthog", "twenty", "documenso"] as const;
const CONDITIONS = ["baseline", "chart", "recall"] as const;
const CASES_PER_REPO = 12;

const round = (value: number, decimals: number): number => {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
};

const readJSON = async <T>(path: string): Promise<T> => {
  const text = await file(path).text();
  return JSON.parse(text) as T;
};

const readResults = async (slug: string): Promise<ResultRow[]> => {
  const path = `eval/runs/${slug}/results.jsonl`;
  const text = await file(path).text();
  return text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ResultRow);
};

const mean = (values: number[]): number =>
  values.reduce((total, value) => total + value, 0) / values.length;

const isChartHit = (row: ResultRow): boolean => row.chartHit === true;

const isChartHitTopRank = (row: ResultRow): boolean =>
  row.chartHitTopRank === true;

const byCondition = (
  rows: ResultRow[],
  caseId: string,
  condition: Condition
): ResultRow => {
  const matches = rows.filter(
    (row) => row.caseId === caseId && row.condition === condition
  );
  if (matches.length !== 1) {
    throw new Error(
      `Expected one ${condition} row for ${caseId}, found ${matches.length}`
    );
  }
  return matches[0];
};

const summarizeRepo = async (slug: (typeof REPOS)[number]) => {
  const casesFile = await readJSON<CasesFile>(`eval/cases/${slug}.json`);
  const rows = await readResults(slug);

  if (rows.length !== CASES_PER_REPO * CONDITIONS.length) {
    throw new Error(
      `Expected 36 result rows for ${slug}, found ${rows.length}`
    );
  }

  const cases = [...casesFile.cases].sort((a, b) => a.id.localeCompare(b.id));
  if (cases.length !== CASES_PER_REPO) {
    throw new Error(`Expected 12 cases for ${slug}, found ${cases.length}`);
  }

  const caseSummaries: CaseSummary[] = cases.map((testCase) => {
    const baseline = byCondition(rows, testCase.id, "baseline");
    const chart = byCondition(rows, testCase.id, "chart");
    const recall = byCondition(rows, testCase.id, "recall");
    const baselineTokens = baseline.tokens.total_tokens;
    const recallTokens = recall.tokens.total_tokens;

    return {
      caseId: testCase.id,
      label: testCase.subsystem ?? null,
      difficulty: testCase.difficulty ?? null,
      baselineTokens,
      chartTokens: chart.tokens.total_tokens,
      recallTokens,
      baselineCorrect: baseline.correct,
      chartCorrect: chart.correct,
      recallCorrect: recall.correct,
      chartHit: isChartHit(recall),
      chartHitTopRank: isChartHitTopRank(recall),
      savingsPct: round(
        ((baselineTokens - recallTokens) / baselineTokens) * 100,
        1
      ),
    };
  });

  const armMeans = Object.fromEntries(
    CONDITIONS.map((condition) => {
      const values = rows
        .filter((row) => row.condition === condition)
        .map((row) => row.tokens.total_tokens);
      return [condition, Math.round(mean(values))];
    })
  ) as Record<Condition, number>;

  const correctnessRates = Object.fromEntries(
    CONDITIONS.map((condition) => {
      const correct = rows.filter(
        (row) => row.condition === condition && row.correct
      ).length;
      return [condition, correct / CASES_PER_REPO];
    })
  ) as Record<Condition, number>;

  const hitRate =
    rows.filter((row) => row.condition === "recall" && isChartHit(row)).length /
    CASES_PER_REPO;
  const hitRateTopRank =
    rows.filter((row) => row.condition === "recall" && isChartHitTopRank(row))
      .length / CASES_PER_REPO;

  return {
    slug,
    commit: casesFile.commit,
    cases: caseSummaries,
    armMeans,
    savingsPct: round(
      ((armMeans.baseline - armMeans.recall) / armMeans.baseline) * 100,
      1
    ),
    correctnessRates,
    hitRate,
    hitRateAnyRank: hitRate,
    hitRateTopRank,
    breakEvenRecalls: round(
      armMeans.chart / (armMeans.baseline - armMeans.recall),
      2
    ),
  };
};

const repos = await Promise.all(REPOS.map((slug) => summarizeRepo(slug)));
const totalRuns = repos.length * CASES_PER_REPO * CONDITIONS.length;
const baselineTotal = repos.reduce(
  (total, repo) =>
    total +
    repo.cases.reduce((sum, testCase) => sum + testCase.baselineTokens, 0),
  0
);
const recallTotal = repos.reduce(
  (total, repo) =>
    total +
    repo.cases.reduce((sum, testCase) => sum + testCase.recallTokens, 0),
  0
);

const allCases = repos.flatMap((repo) => repo.cases);
const overallCorrectness = {
  baseline:
    allCases.filter((testCase) => testCase.baselineCorrect).length /
    allCases.length,
  chart:
    allCases.filter((testCase) => testCase.chartCorrect).length /
    allCases.length,
  recall:
    allCases.filter((testCase) => testCase.recallCorrect).length /
    allCases.length,
};

const summary = {
  generatedAt: new Date().toISOString(),
  repos,
  crossRepo: {
    totalRuns,
    repoCount: repos.length,
    casesPerRepo: CASES_PER_REPO,
    unweightedMeanSavingsPct: round(
      mean(repos.map((repo) => repo.savingsPct)),
      1
    ),
    weightedMeanSavingsPct: round(
      ((baselineTotal - recallTotal) / baselineTotal) * 100,
      1
    ),
    overallCorrectness,
    overallHitRate:
      allCases.filter((testCase) => testCase.chartHit).length / allCases.length,
    overallHitRateAnyRank:
      allCases.filter((testCase) => testCase.chartHit).length / allCases.length,
    overallHitRateTopRank:
      allCases.filter((testCase) => testCase.chartHitTopRank).length /
      allCases.length,
    meanBreakEvenRecalls: round(
      mean(repos.map((repo) => repo.breakEvenRecalls)),
      2
    ),
  },
};

await write("eval/runs/summary.json", `${JSON.stringify(summary, null, 2)}\n`);
