import React, { useMemo, useState } from 'react';
import {
  Armchair,
  CalendarClock,
  Clock,
  Download,
  MapPin,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { getActivePeriods } from '../../shared/gdouTimetable';
import type { AppSettings, CourseItem, ExamItem } from '../../shared/models';
import { buildGdouIcsContent, getExamCountdown } from '../../shared/parsers';
import { triggerTextDownload } from '../services/storage';

interface ExamsViewProps {
  exams: ExamItem[];
  courses: CourseItem[];
  settings: AppSettings;
  onAddManualExam: (exam: ExamItem) => void;
  onDeleteExam: (id: string) => void;
}

export const ExamsView: React.FC<ExamsViewProps> = ({
  exams,
  courses,
  settings,
  onAddManualExam,
  onDeleteExam,
}) => {
  const [filter, setFilter] = useState<'upcoming' | 'all' | 'past'>('upcoming');
  const [showAdd, setShowAdd] = useState(false);

  const [courseName, setCourseName] = useState('');
  const [dateText, setDateText] = useState('');
  const [startTimeText, setStartTimeText] = useState('09:00');
  const [endTimeText, setEndTimeText] = useState('11:00');
  const [location, setLocation] = useState('');
  const [seatNumber, setSeatNumber] = useState('');

  const enriched = useMemo(
    () => exams.map((ex) => ({ exam: ex, cd: getExamCountdown(ex) })),
    [exams]
  );

  const upcomingList = useMemo(
    () => enriched.filter((e) => e.cd.status !== 'past'),
    [enriched]
  );

  const nearestExam = upcomingList[0];

  const displayed = useMemo(() => {
    if (filter === 'upcoming') return upcomingList;
    if (filter === 'past') return enriched.filter((e) => e.cd.status === 'past');
    return enriched;
  }, [enriched, upcomingList, filter]);

  const handleExportExamsIcs = () => {
    const ics = buildGdouIcsContent([], exams, settings.termStartDate, getActivePeriods(settings));
    triggerTextDownload('gdou-exams.ics', ics, 'text/calendar;charset=utf-8');
  };

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!courseName.trim()) return;
    const startIso = dateText && startTimeText ? `${dateText}T${startTimeText}:00` : null;
    const endIso = dateText && endTimeText ? `${dateText}T${endTimeText}:00` : null;
    onAddManualExam({
      id: `manual-exam-${Date.now()}`,
      courseName: courseName.trim(),
      courseCode: 'CUSTOM',
      examType: '自定义考试',
      dateText,
      startTimeText,
      endTimeText,
      startIso,
      endIso,
      rawTimeText: dateText ? `${dateText}(${startTimeText}-${endTimeText})` : '时间待定',
      location: location.trim() || '待定考场',
      seatNumber: seatNumber.trim(),
      campus: '',
      invigilator: '',
      isManual: true,
    });
    setShowAdd(false);
    setCourseName('');
    setLocation('');
    setSeatNumber('');
  };

  return (
    <div className="space-y-5">
      {/* Hero Next Exam Countdown */}
      {nearestExam ? (
        <div className="relative overflow-hidden rounded-3xl border border-indigo-200/70 bg-gradient-to-br from-slate-900 via-sky-950 to-indigo-950 p-6 text-white shadow-xl">
          <div className="pointer-events-none absolute -right-12 -top-12 h-48 w-48 rounded-full bg-sky-400/20 blur-3xl" />
          <div className="relative flex flex-col justify-between gap-5 sm:flex-row sm:items-center">
            <div className="space-y-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-500/25 px-3 py-1 text-xs font-semibold text-sky-200">
                <CalendarClock className="h-3.5 w-3.5" />
                最近一场考试
              </span>
              <h2 className="text-2xl font-bold tracking-tight">{nearestExam.exam.courseName}</h2>
              <div className="flex flex-wrap items-center gap-4 text-sm text-slate-300">
                <span className="inline-flex items-center gap-1.5">
                  <Clock className="h-4 w-4 text-sky-400" />
                  {nearestExam.exam.rawTimeText}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="h-4 w-4 text-sky-400" />
                  {nearestExam.exam.location}
                </span>
                {nearestExam.exam.seatNumber && (
                  <span className="inline-flex items-center gap-1.5 rounded-lg bg-amber-400/20 px-2.5 py-0.5 font-bold text-amber-300">
                    <Armchair className="h-4 w-4" />
                    座位号 {nearestExam.exam.seatNumber}
                  </span>
                )}
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-3 rounded-2xl border border-white/10 bg-white/10 px-5 py-3.5 backdrop-blur-md">
              <div className="text-center">
                <div className="text-3xl font-black text-sky-300">
                  {nearestExam.cd.status === 'tbd' ? '待定' : nearestExam.cd.daysLeft}
                </div>
                <div className="text-xs text-slate-300">
                  {nearestExam.cd.status === 'today' ? '今天开考' : '剩余天数'}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-3xl border border-slate-200 bg-white p-8 text-center dark:border-slate-800 dark:bg-slate-900">
          <CalendarClock className="mx-auto mb-3 h-10 w-10 text-sky-500" />
          <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">暂无待考安排</h3>
          <p className="mt-1 text-xs text-slate-500">点击右上角“教务无痕同步”拉取最新考试安排，或手动添加随堂测验</p>
        </div>
      )}

      {/* Filter & Actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 rounded-xl bg-slate-200/70 p-1 dark:bg-slate-800/80">
          {(
            [
              ['upcoming', `即将到来 (${upcomingList.length})`],
              ['all', `全部 (${enriched.length})`],
              ['past', `已结束 (${enriched.length - upcomingList.length})`],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                filter === key
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleExportExamsIcs}
            disabled={exams.length === 0}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            <Download className="h-3.5 w-3.5" />
            导出考试 .ics
          </button>
          <button
            onClick={() => setShowAdd(true)}
            className="inline-flex items-center gap-1 rounded-xl bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-sky-500"
          >
            <Plus className="h-3.5 w-3.5" />
            添加考试
          </button>
        </div>
      </div>

      {/* Exam Cards */}
      <div className="grid gap-3 md:grid-cols-2">
        {displayed.map(({ exam, cd }) => {
          const badgeStyle =
            cd.status === 'today'
              ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/70 dark:text-rose-300'
              : cd.status === 'upcoming' && cd.daysLeft <= 3
                ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/70 dark:text-amber-300'
                : cd.status === 'past'
                  ? 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                  : 'bg-sky-100 text-sky-700 dark:bg-sky-950/70 dark:text-sky-300';

          return (
            <div
              key={exam.id}
              className={`flex flex-col justify-between rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs transition hover:shadow-md dark:border-slate-800 dark:bg-slate-900 ${
                cd.status === 'past' ? 'opacity-65' : ''
              }`}
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-base font-bold text-slate-900 dark:text-white">
                      {exam.courseName}
                    </h3>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {exam.examType} {exam.courseCode ? `· ${exam.courseCode}` : ''}
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${badgeStyle}`}>
                    {cd.label}
                  </span>
                </div>

                <div className="mt-3.5 space-y-2 text-xs text-slate-600 dark:text-slate-300">
                  <div className="flex items-center gap-2">
                    <Clock className="h-3.5 w-3.5 text-sky-500" />
                    <span className="font-medium">{exam.rawTimeText}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <MapPin className="h-3.5 w-3.5 text-sky-500" />
                      <span>
                        {exam.location} {exam.campus ? `· ${exam.campus}` : ''}
                      </span>
                    </div>
                    {exam.seatNumber && (
                      <span className="inline-flex items-center gap-1 rounded-lg bg-amber-50 px-2 py-0.5 font-bold text-amber-700 ring-1 ring-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:ring-amber-800">
                        <Armchair className="h-3 w-3" />
                        {exam.seatNumber} 号座
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {exam.isManual && (
                <div className="mt-3 flex justify-end border-t border-slate-100 pt-2.5 dark:border-slate-800">
                  <button
                    onClick={() => onDeleteExam(exam.id)}
                    className="inline-flex items-center gap-1 text-xs font-medium text-rose-500 hover:text-rose-600"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    删除
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Add Manual Exam Modal */}
      {showAdd && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-xs"
          onClick={() => setShowAdd(false)}
        >
          <form
            onSubmit={handleAdd}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900 dark:text-white">手动添加考试 / 测验</h3>
              <button type="button" onClick={() => setShowAdd(false)} className="text-slate-400">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-3 text-sm">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">考试科目 *</label>
                <input
                  required
                  value={courseName}
                  onChange={(e) => setCourseName(e.target.value)}
                  placeholder="例如：大学物理期中测验"
                  list="gdou-course-suggestions"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-800"
                />
                <datalist id="gdou-course-suggestions">
                  {Array.from(new Set(courses.map((c) => c.name))).map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-3 sm:col-span-1">
                  <label className="mb-1 block text-xs font-medium text-slate-500">日期</label>
                  <input
                    type="date"
                    value={dateText}
                    onChange={(e) => setDateText(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-2 dark:border-slate-700 dark:bg-slate-800"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">开始</label>
                  <input
                    type="time"
                    value={startTimeText}
                    onChange={(e) => setStartTimeText(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-2 dark:border-slate-700 dark:bg-slate-800"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">结束</label>
                  <input
                    type="time"
                    value={endTimeText}
                    onChange={(e) => setEndTimeText(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-2 dark:border-slate-700 dark:bg-slate-800"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">考场地点</label>
                  <input
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="钟海楼02018"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-800"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">座位号</label>
                  <input
                    value={seatNumber}
                    onChange={(e) => setSeatNumber(e.target.value)}
                    placeholder="选填"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-800"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAdd(false)}
                className="rounded-xl px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                取消
              </button>
              <button
                type="submit"
                className="rounded-xl bg-sky-600 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-500"
              >
                保存考试
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
