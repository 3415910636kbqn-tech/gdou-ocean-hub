import React, { useMemo, useState } from 'react';
import {
  Award,
  BarChart3,
  BookOpen,
  Calculator,
  CheckCircle2,
  GraduationCap,
  Plus,
  Search,
  Sparkles,
  Target,
  Trash2,
  TrendingUp,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { GradeItem } from '../../shared/models';
import { computeGpaSummary, scoreToGdouGpa } from '../../shared/parsers';

interface GradesViewProps {
  grades: GradeItem[];
  graduationCreditTarget: number;
  onUpdateGraduationTarget: (target: number) => void;
}

interface SimCourse {
  id: string;
  name: string;
  credit: number;
  score: number;
}

const TIER_COLORS: Record<string, string> = {
  excellent: 'bg-emerald-500',
  good: 'bg-sky-500',
  medium: 'bg-indigo-500',
  pass: 'bg-amber-500',
  fail: 'bg-rose-500',
};

export const GradesView: React.FC<GradesViewProps> = ({
  grades,
  graduationCreditTarget,
  onUpdateGraduationTarget,
}) => {
  const [subTab, setSubTab] = useState<'overview' | 'details'>('overview');
  const [search, setSearch] = useState('');
  const [termFilter, setTermFilter] = useState('all');
  const [catFilter, setCatFilter] = useState('all');
  const [onlyFailed, setOnlyFailed] = useState(false);
  const [sortBy, setSortBy] = useState<'term' | 'gpa' | 'score' | 'credit'>('term');

  // Tools panel: 'none' | 'sim' | 'goal'
  const [toolPanel, setToolPanel] = useState<'none' | 'sim' | 'goal'>('none');

  // GPA What-If Simulator
  const [simCourses, setSimCourses] = useState<SimCourse[]>([]);
  const [simName, setSimName] = useState('');
  const [simCredit, setSimCredit] = useState('3.0');
  const [simScore, setSimScore] = useState('90');

  // Target GPA Reverse Calculator
  const [goalGpa, setGoalGpa] = useState('3.80');
  const [plannedCredits, setPlannedCredits] = useState('24');

  const summary = useMemo(() => computeGpaSummary(grades), [grades]);

  const terms = useMemo(
    () => Array.from(new Set(grades.map((g) => g.termKey))).sort().reverse(),
    [grades]
  );
  const categories = useMemo(
    () => Array.from(new Set(grades.map((g) => g.courseCategory))).sort(),
    [grades]
  );

  const filteredGrades = useMemo(() => {
    const kw = search.trim().toLowerCase();
    return grades
      .filter((g) => {
        if (termFilter !== 'all' && g.termKey !== termFilter) return false;
        if (catFilter !== 'all' && g.courseCategory !== catFilter) return false;
        if (onlyFailed && g.passed) return false;
        if (
          kw &&
          !g.courseName.toLowerCase().includes(kw) &&
          !g.courseCode.toLowerCase().includes(kw) &&
          !g.teacher.toLowerCase().includes(kw)
        ) {
          return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'gpa') return b.gpa - a.gpa || b.credit - a.credit;
        if (sortBy === 'score') return (b.numericScore ?? -1) - (a.numericScore ?? -1);
        if (sortBy === 'credit') return b.credit - a.credit;
        return b.termKey.localeCompare(a.termKey) || b.gpa - a.gpa;
      });
  }, [grades, search, termFilter, catFilter, onlyFailed, sortBy]);

  const simulatedSummary = useMemo(() => {
    if (simCourses.length === 0) return null;
    const extra: GradeItem[] = simCourses.map((s) => ({
      id: s.id,
      courseName: s.name,
      courseCode: s.id,
      academicYear: '模拟',
      semester: '1',
      termKey: '模拟预测',
      credit: s.credit,
      scoreText: String(s.score),
      numericScore: s.score,
      gpa: scoreToGdouGpa(s.score),
      courseCategory: '模拟课程',
      examNature: '模拟',
      teacher: '',
      passed: s.score >= 60,
    }));
    return computeGpaSummary([...grades, ...extra]);
  }, [grades, simCourses]);

  // Reverse calculation for Target GPA
  const goalAnalysis = useMemo(() => {
    const target = parseFloat(goalGpa);
    const rem = parseFloat(plannedCredits);
    if (!Number.isFinite(target) || target <= 0 || target > 5 || !Number.isFinite(rem) || rem <= 0) {
      return null;
    }
    const curCredits = summary.totalCreditsAttempted;
    const curPoints = summary.weightedGpa * curCredits;
    const neededPoints = target * (curCredits + rem) - curPoints;
    const requiredAvgGpa = neededPoints / rem;
    const requiredAvgScore = Math.max(60, Math.min(100, requiredAvgGpa * 10 + 50));
    const maxPossibleGpa = (curPoints + 5.0 * rem) / (curCredits + rem);
    return {
      requiredAvgGpa,
      requiredAvgScore,
      feasible: requiredAvgGpa <= 5.0,
      alreadyReached: requiredAvgGpa <= 0,
      maxPossibleGpa,
    };
  }, [goalGpa, plannedCredits, summary]);

  const gradTarget = Math.max(10, graduationCreditTarget || 165);
  const gradPercent = Math.min(100, Math.round((summary.totalCreditsEarned / gradTarget) * 1000) / 10);
  const gradRemaining = Math.max(0, Math.round((gradTarget - summary.totalCreditsEarned) * 10) / 10);

  const chartData = useMemo(
    () =>
      summary.byTerm.map((t) => ({
        name: t.termKey.replace('学年', '').replace(' 第', ' S'),
        gpa: t.weightedGpa,
        avg: t.weightedAvgScore,
        credits: t.creditsEarned,
      })),
    [summary.byTerm]
  );

  const handleAddSim = (e: React.FormEvent) => {
    e.preventDefault();
    const credit = parseFloat(simCredit);
    const score = parseFloat(simScore);
    if (!Number.isFinite(credit) || credit <= 0 || !Number.isFinite(score) || score < 0 || score > 100) {
      return;
    }
    setSimCourses((prev) => [
      ...prev,
      {
        id: `sim-${Date.now()}`,
        name: simName.trim() || `模拟课程 ${prev.length + 1}`,
        credit,
        score,
      },
    ]);
    setSimName('');
  };

  return (
    <div className="space-y-5">
      {/* Top GPA Hero Bento */}
      <div className="grid gap-4 lg:grid-cols-12">
        <div className="skin-bg-gradient relative overflow-hidden rounded-3xl p-6 text-white shadow-xl lg:col-span-5">
          <div className="pointer-events-none absolute -right-10 -top-10 h-44 w-44 rounded-full bg-cyan-300/20 blur-3xl" />
          <div className="relative flex h-full flex-col justify-between gap-4">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold backdrop-blur-sm">
                <Award className="h-3.5 w-3.5 text-amber-300" />
                总平均绩点 (5.0制)
              </span>
              {summary.hasEstimatedItems && (
                <span className="rounded-full bg-amber-400/20 px-2.5 py-0.5 text-[11px] font-medium text-amber-200">
                  含本地估算项
                </span>
              )}
            </div>

            <div className="flex items-baseline gap-3">
              <span className="text-5xl font-black tracking-tight">
                {summary.weightedGpa.toFixed(2)}
              </span>
              <span className="text-sm text-sky-200">/ 5.00</span>
            </div>

            <div className="grid grid-cols-2 gap-3 rounded-2xl bg-white/10 p-3 backdrop-blur-xs">
              <div>
                <div className="text-[11px] text-sky-200">必修课 GPA</div>
                <div className="mt-0.5 text-lg font-bold">{summary.requiredGpa.toFixed(2)}</div>
              </div>
              <div>
                <div className="text-[11px] text-sky-200">加权平均分</div>
                <div className="mt-0.5 text-lg font-bold">{summary.weightedAvgScore.toFixed(1)}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:col-span-7">
          <div className="flex flex-col justify-between rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-xs font-medium">已获学分</span>
              <BookOpen className="h-4 w-4 text-sky-500" />
            </div>
            <div className="mt-3">
              <div className="text-2xl font-extrabold text-slate-900 dark:text-white">
                {summary.totalCreditsEarned}
              </div>
              <div className="mt-0.5 text-xs text-slate-400">
                共修读 {summary.totalCreditsAttempted} 学分
              </div>
            </div>
          </div>

          <div className="flex flex-col justify-between rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-xs font-medium">课程通过率</span>
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            </div>
            <div className="mt-3">
              <div className="text-2xl font-extrabold text-emerald-600 dark:text-emerald-400">
                {summary.passRate}%
              </div>
              <div className="mt-0.5 text-xs text-slate-400">
                通过 {summary.passedCourses} / {summary.totalCourses} 门
              </div>
            </div>
          </div>

          <div className="col-span-2 flex flex-col justify-between rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs sm:col-span-1 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-xs font-medium">待补考 / 未过</span>
              <TrendingUp className="h-4 w-4 text-rose-500" />
            </div>
            <div className="mt-3">
              <div
                className={`text-2xl font-extrabold ${
                  summary.failedCourses > 0
                    ? 'text-rose-600 dark:text-rose-400'
                    : 'text-slate-900 dark:text-white'
                }`}
              >
                {summary.failedCourses}
              </div>
              <div className="mt-0.5 text-xs text-slate-400">
                {summary.failedCourses === 0 ? '全科通过，稳如海大灯塔' : '建议尽早安排重修/补考'}
              </div>
            </div>
          </div>

          {/* Graduation Credit Progress Bar */}
          <div className="col-span-2 rounded-2xl border border-slate-200/80 bg-white px-4 py-3 sm:col-span-3 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="inline-flex items-center gap-1.5 font-bold text-slate-800 dark:text-slate-100">
                <GraduationCap className="h-4 w-4 text-sky-500" />
                毕业学分进度 ({gradPercent}%)
              </span>
              <div className="flex items-center gap-2 text-slate-500">
                <span>
                  已获 <strong>{summary.totalCreditsEarned}</strong> / 目标
                </span>
                <input
                  type="number"
                  min={30}
                  max={260}
                  value={graduationCreditTarget}
                  onChange={(e) => onUpdateGraduationTarget(Number(e.target.value) || 165)}
                  className="w-16 rounded-lg border border-slate-200 bg-slate-50 px-2 py-0.5 text-center font-bold text-slate-800 outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
                <span>学分（还差 {gradRemaining}）</span>
              </div>
            </div>
            <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div
                className="h-full rounded-full bg-gradient-to-r from-sky-500 via-blue-500 to-emerald-500 transition-all duration-500"
                style={{ width: `${Math.max(2, gradPercent)}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Sub-Tabs & GPA Calculator Buttons */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200/80 bg-white px-4 py-2.5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-1.5 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
          <button
            onClick={() => setSubTab('overview')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              subTab === 'overview'
                ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-white'
                : 'text-slate-500 hover:text-slate-900 dark:text-slate-400'
            }`}
          >
            <BarChart3 className="h-3.5 w-3.5" />
            成绩学分总览
          </button>
          <button
            onClick={() => setSubTab('details')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              subTab === 'details'
                ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-white'
                : 'text-slate-500 hover:text-slate-900 dark:text-slate-400'
            }`}
          >
            <Search className="h-3.5 w-3.5" />
            课程明细 ({grades.length})
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setToolPanel((p) => (p === 'goal' ? 'none' : 'goal'))}
            className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
              toolPanel === 'goal'
                ? 'bg-emerald-600 text-white'
                : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/60 dark:text-emerald-300'
            }`}
          >
            <Target className="h-3.5 w-3.5" />
            目标绩点反推
          </button>
          <button
            onClick={() => setToolPanel((p) => (p === 'sim' ? 'none' : 'sim'))}
            className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
              toolPanel === 'sim'
                ? 'bg-indigo-600 text-white'
                : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-950/60 dark:text-indigo-300'
            }`}
          >
            <Calculator className="h-3.5 w-3.5" />
            单科绩点模拟器
          </button>
        </div>
      </div>

      {/* Target GPA Reverse Calculator */}
      {toolPanel === 'goal' && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-5 dark:border-emerald-900/60 dark:bg-emerald-950/25">
          <h3 className="flex items-center gap-1.5 text-sm font-bold text-emerald-950 dark:text-emerald-200">
            <Target className="h-4 w-4 text-emerald-600" />
            保研 / 奖学金目标绩点反推器
          </h3>
          <p className="mt-0.5 text-xs text-emerald-700/80 dark:text-emerald-300/80">
            输入你冲刺的总 GPA 目标和接下来预计修读的学分，自动反算平均每门课需要考到多少分
          </p>

          <div className="mt-4 flex flex-wrap items-end gap-3">
            <div className="w-36">
              <label className="mb-1 block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                目标总 GPA (5.0制)
              </label>
              <input
                type="number"
                step="0.05"
                min="1"
                max="5"
                value={goalGpa}
                onChange={(e) => setGoalGpa(e.target.value)}
                className="w-full rounded-xl border border-emerald-200 bg-white px-3 py-2 text-sm font-bold outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-900"
              />
            </div>
            <div className="w-36">
              <label className="mb-1 block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                未来计划修读学分
              </label>
              <input
                type="number"
                step="1"
                min="1"
                max="200"
                value={plannedCredits}
                onChange={(e) => setPlannedCredits(e.target.value)}
                className="w-full rounded-xl border border-emerald-200 bg-white px-3 py-2 text-sm font-bold outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-900"
              />
            </div>

            {goalAnalysis && (
              <div className="min-w-[240px] flex-1 rounded-2xl bg-white p-3.5 shadow-xs dark:bg-slate-900">
                {goalAnalysis.alreadyReached ? (
                  <div className="text-xs font-bold text-emerald-600">
                    🎉 你当前 GPA 已稳稳超越目标！保持正常通过即可达成。
                  </div>
                ) : goalAnalysis.feasible ? (
                  <div className="space-y-1">
                    <div className="text-xs text-slate-500">
                      未来 {plannedCredits} 学分需要保持平均：
                    </div>
                    <div className="flex flex-wrap items-baseline gap-3">
                      <span className="text-xl font-black text-emerald-600 dark:text-emerald-400">
                        GPA {goalAnalysis.requiredAvgGpa.toFixed(2)}
                      </span>
                      <span className="rounded-lg bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                        约百分制 {goalAnalysis.requiredAvgScore.toFixed(1)} 分
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="text-xs font-semibold text-amber-600 dark:text-amber-400">
                    仅靠 {plannedCredits} 学分即便全拿满绩 5.0，总 GPA 最高可达{' '}
                    <strong>{goalAnalysis.maxPossibleGpa.toFixed(2)}</strong>（可增加计划学分或微调目标）
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* GPA What-If Simulator Panel */}
      {toolPanel === 'sim' && (
        <div className="rounded-2xl border border-indigo-200 bg-indigo-50/50 p-5 dark:border-indigo-900/60 dark:bg-indigo-950/25">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="flex items-center gap-1.5 text-sm font-bold text-indigo-950 dark:text-indigo-200">
                <Sparkles className="h-4 w-4 text-indigo-500" />
                单科期末绩点模拟器
              </h3>
              <p className="mt-0.5 text-xs text-indigo-700/80 dark:text-indigo-300/80">
                仅在本地试算，不会修改真实教务成绩单
              </p>
            </div>
            {simulatedSummary && (
              <div className="flex items-center gap-3 rounded-xl bg-white px-4 py-2 shadow-xs dark:bg-slate-900">
                <span className="text-xs text-slate-500">模拟后总 GPA</span>
                <span className="text-xl font-black text-indigo-600 dark:text-indigo-400">
                  {simulatedSummary.weightedGpa.toFixed(2)}
                </span>
                <span
                  className={`rounded-md px-1.5 py-0.5 text-xs font-bold ${
                    simulatedSummary.weightedGpa >= summary.weightedGpa
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                      : 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                  }`}
                >
                  {simulatedSummary.weightedGpa >= summary.weightedGpa ? '+' : ''}
                  {(simulatedSummary.weightedGpa - summary.weightedGpa).toFixed(2)}
                </span>
              </div>
            )}
          </div>

          <form onSubmit={handleAddSim} className="mt-4 flex flex-wrap items-end gap-2.5">
            <div className="min-w-[160px] flex-1">
              <label className="mb-1 block text-[11px] font-medium text-slate-500">模拟课程名</label>
              <input
                value={simName}
                onChange={(e) => setSimName(e.target.value)}
                placeholder="例如：信号与系统"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-900"
              />
            </div>
            <div className="w-24">
              <label className="mb-1 block text-[11px] font-medium text-slate-500">学分</label>
              <input
                type="number"
                step="0.5"
                min="0.5"
                max="12"
                value={simCredit}
                onChange={(e) => setSimCredit(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-900"
              />
            </div>
            <div className="w-24">
              <label className="mb-1 block text-[11px] font-medium text-slate-500">预期分数</label>
              <input
                type="number"
                min="0"
                max="100"
                value={simScore}
                onChange={(e) => setSimScore(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-900"
              />
            </div>
            <button
              type="submit"
              className="inline-flex items-center gap-1 rounded-xl bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-indigo-500"
            >
              <Plus className="h-3.5 w-3.5" />
              加入试算
            </button>
          </form>

          {simCourses.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {simCourses.map((s) => (
                <span
                  key={s.id}
                  className="inline-flex items-center gap-2 rounded-xl bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-2xs dark:bg-slate-900 dark:text-slate-200"
                >
                  {s.name} · {s.credit}学分 · {s.score}分 (GPA {scoreToGdouGpa(s.score).toFixed(1)})
                  <button
                    onClick={() => setSimCourses((prev) => prev.filter((item) => item.id !== s.id))}
                    className="text-slate-400 hover:text-rose-500"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {subTab === 'overview' ? (
        <div className="grid gap-4 lg:grid-cols-12">
          <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs lg:col-span-7 dark:border-slate-800 dark:bg-slate-900">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">各学期绩点趋势</h3>
            <p className="mb-4 text-xs text-slate-400">按学期加权平均绩点变化</p>
            {chartData.length > 0 ? (
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 10, right: 12, left: -18, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gpaGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#0284c7" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="#0284c7" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" strokeOpacity={0.2} />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                    <YAxis domain={[0, 5]} tick={{ fontSize: 11, fill: '#94a3b8' }} />
                    <Tooltip
                      contentStyle={{
                        borderRadius: '12px',
                        border: 'none',
                        boxShadow: '0 10px 25px rgba(0,0,0,0.12)',
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="gpa"
                      name="学期 GPA"
                      stroke="#0284c7"
                      strokeWidth={3}
                      fillOpacity={1}
                      fill="url(#gpaGrad)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="py-16 text-center text-xs text-slate-400">暂无成绩趋势数据</div>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs lg:col-span-5 dark:border-slate-800 dark:bg-slate-900">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">成绩分段分布</h3>
            <p className="mb-4 text-xs text-slate-400">按课程成绩区间统计门数与学分</p>
            <div className="space-y-3">
              {summary.scoreDistribution.map((b) => (
                <div key={b.key} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-700 dark:text-slate-200">
                      {b.label}{' '}
                      <span className="font-normal text-slate-400">({b.rangeText})</span>
                    </span>
                    <span className="font-medium text-slate-600 dark:text-slate-300">
                      {b.count} 门 · {b.credits} 学分
                    </span>
                  </div>
                  <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${TIER_COLORS[b.key]}`}
                      style={{ width: `${Math.max(b.count > 0 ? 4 : 0, Math.round(b.ratio * 100))}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs lg:col-span-7 dark:border-slate-800 dark:bg-slate-900">
            <h3 className="mb-3 text-sm font-bold text-slate-900 dark:text-white">各学期学业表现汇总</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-100 text-slate-400 dark:border-slate-800">
                  <tr>
                    <th className="py-2 font-medium">学期</th>
                    <th className="py-2 font-medium">课程数</th>
                    <th className="py-2 font-medium">已获学分</th>
                    <th className="py-2 font-medium">加权均分</th>
                    <th className="py-2 text-right font-medium">学期 GPA</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {[...summary.byTerm].reverse().map((t) => (
                    <tr
                      key={t.termKey}
                      onClick={() => {
                        setTermFilter(t.termKey);
                        setSubTab('details');
                      }}
                      className="cursor-pointer transition hover:bg-sky-50/60 dark:hover:bg-slate-800/60"
                    >
                      <td className="py-2.5 font-semibold text-slate-800 dark:text-slate-100">
                        {t.termKey}
                      </td>
                      <td className="py-2.5 text-slate-600 dark:text-slate-300">{t.coursesCount} 门</td>
                      <td className="py-2.5 text-slate-600 dark:text-slate-300">
                        {t.creditsEarned} / {t.creditsAttempted}
                      </td>
                      <td className="py-2.5 text-slate-600 dark:text-slate-300">
                        {t.weightedAvgScore.toFixed(1)}
                      </td>
                      <td className="py-2.5 text-right font-bold text-sky-600 dark:text-sky-400">
                        {t.weightedGpa.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs lg:col-span-5 dark:border-slate-800 dark:bg-slate-900">
            <h3 className="mb-3 text-sm font-bold text-slate-900 dark:text-white">课程性质学分构成</h3>
            <div className="space-y-3">
              {summary.byCategory.map((c) => (
                <div key={c.category} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-700 dark:text-slate-200">{c.category}</span>
                    <span className="text-slate-500">
                      {c.credits} 学分 ({Math.round(c.share * 100)}%)
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-sky-500 to-indigo-500"
                      style={{ width: `${Math.max(4, Math.round(c.share * 100))}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2.5 rounded-2xl border border-slate-200/80 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900">
            <div className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索课程名、课程号或教师..."
                className="w-full rounded-xl border border-slate-200 bg-slate-50 py-1.5 pl-9 pr-3 text-xs outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-800"
              />
            </div>

            <select
              value={termFilter}
              onChange={(e) => setTermFilter(e.target.value)}
              className="rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800"
            >
              <option value="all">全部学期</option>
              {terms.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>

            <select
              value={catFilter}
              onChange={(e) => setCatFilter(e.target.value)}
              className="rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800"
            >
              <option value="all">全部性质</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              className="rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800"
            >
              <option value="term">按学期排序</option>
              <option value="gpa">按绩点降序</option>
              <option value="score">按分数降序</option>
              <option value="credit">按学分降序</option>
            </select>

            <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                checked={onlyFailed}
                onChange={(e) => setOnlyFailed(e.target.checked)}
                className="rounded border-slate-300 text-rose-600"
              />
              仅未通过
            </label>
          </div>

          <div className="space-y-2.5">
            {filteredGrades.map((g) => (
              <div
                key={g.id}
                className="flex flex-col justify-between gap-3 rounded-2xl border border-slate-200/80 bg-white p-4 transition hover:shadow-sm sm:flex-row sm:items-center dark:border-slate-800 dark:bg-slate-900"
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                      {g.courseName}
                    </h4>
                    <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      {g.courseCategory}
                    </span>
                    {g.gpaEstimated && (
                      <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-950/60 dark:text-amber-300">
                        估算
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-400">
                    {g.termKey} · {g.credit} 学分 {g.teacher ? `· ${g.teacher}` : ''} · {g.examNature}
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <div
                      className={`text-lg font-extrabold ${
                        !g.passed
                          ? 'text-rose-600 dark:text-rose-400'
                          : (g.numericScore ?? 0) >= 90
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-slate-900 dark:text-white'
                      }`}
                    >
                      {g.scoreText}
                    </div>
                    <div className="text-[11px] text-slate-400">成绩</div>
                  </div>
                  <div className="h-8 w-px bg-slate-200 dark:bg-slate-800" />
                  <div className="min-w-[52px] text-right">
                    <div className="text-lg font-extrabold text-sky-600 dark:text-sky-400">
                      {g.gpa.toFixed(2)}
                    </div>
                    <div className="text-[11px] text-slate-400">绩点</div>
                  </div>
                </div>
              </div>
            ))}
            {filteredGrades.length === 0 && (
              <div className="rounded-2xl border border-dashed border-slate-300 p-10 text-center text-xs text-slate-400 dark:border-slate-700">
                没有匹配当前筛选条件的课程成绩
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
