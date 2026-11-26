import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Calendar,
  Check,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Clock,
  Compass,
  Copy,
  Download,
  Eye,
  EyeOff,
  Heart,
  Image as ImageIcon,
  MapPin,
  Plus,
  RefreshCw,
  Smartphone,
  Sparkles,
  Square,
  StickyNote,
  Trash2,
  User,
  Users,
  X,
} from 'lucide-react';
import { DAY_FULL_LABELS, DAY_LABELS, getActivePeriods } from '../../shared/gdouTimetable';
import type {
  AppSettings,
  CoupleScheduleProfile,
  CourseItem,
  CourseTodoItem,
  ExamItem,
  ScheduleViewMode,
} from '../../shared/models';
import {
  buildGdouIcsContent,
  computeTermWeek,
  getCourseTimeSpan,
  getDateForWeekAndDay,
  getTodayDayOfWeek,
  parseWeekExpression,
} from '../../shared/parsers';
import { computeCoupleWeekStats, decodeCoupleShareCode, encodeCoupleShareCode } from '../services/coupleCodec';
import { getCoursePalette, THEME_SKINS } from '../services/courseColors';
import { renderSchedulePosterPng } from '../services/schedulePoster';
import { triggerTextDownload } from '../services/storage';

interface ScheduleViewProps {
  courses: CourseItem[];
  exams: ExamItem[];
  courseTodos: CourseTodoItem[];
  coupleSchedule: CoupleScheduleProfile | null;
  settings: AppSettings;
  termLabel: string;
  onOpenSync: () => void;
  onToggleNonCurrentWeek: () => void;
  onCalibrateCurrentWeek: (actualWeek: number) => void;
  onAddManualCourse: (course: CourseItem) => void;
  onDeleteCourse: (id: string) => void;
  onAddTodo: (courseName: string, content: string, dueDate?: string) => void;
  onToggleTodo: (id: string) => void;
  onDeleteTodo: (id: string) => void;
  onSaveCoupleSchedule: (profile: CoupleScheduleProfile | null) => void;
}

interface SlotCluster {
  start: number;
  end: number;
  items: CourseItem[];
  hasActive: boolean;
}

const ROW_HEIGHT = 68;

function buildDayClustersForWeek(
  displayCourses: CourseItem[],
  week: number,
  showNonCurrentWeek: boolean
): Map<number, SlotCluster[]> {
  const map = new Map<number, SlotCluster[]>();
  for (let d = 1; d <= 7; d++) map.set(d, []);

  const valid = displayCourses.filter((c) => !c.parseWarning && c.dayOfWeek >= 1 && c.dayOfWeek <= 7);

  for (let d = 1; d <= 7; d++) {
    const dayAll = valid.filter((c) => c.dayOfWeek === d);
    const activeList = dayAll
      .filter((c) => c.weeks.includes(week))
      .sort((a, b) => a.startSection - b.startSection || a.endSection - b.endSection);

    // 1) First build exact clusters ONLY for active courses this week
    const clusters: SlotCluster[] = [];
    for (const c of activeList) {
      const overlapping = clusters.find(
        (cl) => c.startSection <= cl.end && c.endSection >= cl.start
      );
      if (overlapping) {
        overlapping.items.push(c);
        overlapping.start = Math.min(overlapping.start, c.startSection);
        overlapping.end = Math.max(overlapping.end, c.endSection);
      } else {
        clusters.push({
          start: c.startSection,
          end: c.endSection,
          items: [c],
          hasActive: true,
        });
      }
    }

    // 2) Then add non-current-week courses WITHOUT ever stretching active courses
    if (showNonCurrentWeek) {
      const inactiveList = dayAll
        .filter((c) => !c.weeks.includes(week))
        .sort((a, b) => a.startSection - b.startSection || a.endSection - b.endSection);

      for (const c of inactiveList) {
        const hitActive = clusters.find(
          (cl) => cl.hasActive && c.startSection <= cl.end && c.endSection >= cl.start
        );
        if (hitActive) {
          // Attach into modal switcher only if same/contained slot, NEVER expand active slot bounds
          hitActive.items.push(c);
          continue;
        }
        // Only merge non-current-week courses with identical start/end or direct overlap among inactive ones
        const hitInactive = clusters.find(
          (cl) => !cl.hasActive && c.startSection <= cl.end && c.endSection >= cl.start
        );
        if (hitInactive) {
          hitInactive.items.push(c);
          // Only keep exact bounds of the first inactive course so 1-2 doesn't stretch to 1-4
        } else {
          clusters.push({
            start: c.startSection,
            end: c.endSection,
            items: [c],
            hasActive: false,
          });
        }
      }
    }

    map.set(d, clusters);
  }
  return map;
}

export const ScheduleView: React.FC<ScheduleViewProps> = ({
  courses,
  exams,
  courseTodos,
  coupleSchedule,
  settings,
  termLabel,
  onOpenSync,
  onToggleNonCurrentWeek,
  onCalibrateCurrentWeek,
  onAddManualCourse,
  onDeleteCourse,
  onAddTodo,
  onToggleTodo,
  onDeleteTodo,
  onSaveCoupleSchedule,
}) => {
  const realCurrentWeek = useMemo(
    () => Math.min(settings.totalWeeks, Math.max(1, computeTermWeek(settings.termStartDate))),
    [settings.termStartDate, settings.totalWeeks]
  );

  const [selectedWeek, setSelectedWeek] = useState<number>(realCurrentWeek);
  const [viewMode, setViewMode] = useState<'week' | 'today'>('week');
  const [ownerMode, setOwnerMode] = useState<ScheduleViewMode>('mine');
  const [selectedSlotCourses, setSelectedSlotCourses] = useState<CourseItem[] | null>(null);
  const [activeModalIdx, setActiveModalIdx] = useState(0);

  // Horizontal Swipe Carousel Refs
  const pagerRef = useRef<HTMLDivElement | null>(null);
  const scrollSyncTimerRef = useRef<number | null>(null);
  const isProgrammaticScrollRef = useRef(false);

  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [showCalibrateModal, setShowCalibrateModal] = useState(false);
  const [calibrateWeekVal, setCalibrateWeekVal] = useState(realCurrentWeek);
  const [showCoupleModal, setShowCoupleModal] = useState(false);
  const [showPosterModal, setShowPosterModal] = useState(false);

  // Couple share modal state
  const [myNickname, setMyNickname] = useState('我');
  const [shareCodeCopied, setShareCodeCopied] = useState(false);
  const [importCode, setImportCode] = useState('');
  const [coupleErr, setCoupleErr] = useState('');

  // Poster preview state
  const [posterMode, setPosterMode] = useState<'poster' | 'wallpaper'>('wallpaper');
  const [posterUrl, setPosterUrl] = useState<string>('');
  const [posterRendering, setPosterRendering] = useState(false);

  // Todo inline input inside course detail modal
  const [todoText, setTodoText] = useState('');
  const [todoDue, setTodoDue] = useState('');

  // Manual course form state
  const [mName, setMName] = useState('');
  const [mLocation, setMLocation] = useState('');
  const [mTeacher, setMTeacher] = useState('');
  const [mDay, setMDay] = useState(1);
  const [mStart, setMStart] = useState(1);
  const [mEnd, setMEnd] = useState(2);
  const [mWeekText, setMWeekText] = useState('1-16周');

  const scrollToWeek = useCallback((targetWeek: number, smooth = true) => {
    const clamped = Math.min(settings.totalWeeks, Math.max(1, targetWeek));
    setSelectedWeek(clamped);
    const el = pagerRef.current;
    if (!el || el.clientWidth <= 0) return;
    isProgrammaticScrollRef.current = true;
    el.scrollTo({
      left: (clamped - 1) * el.clientWidth,
      behavior: smooth ? 'smooth' : 'auto',
    });
    if (scrollSyncTimerRef.current) window.clearTimeout(scrollSyncTimerRef.current);
    scrollSyncTimerRef.current = window.setTimeout(() => {
      isProgrammaticScrollRef.current = false;
    }, smooth ? 420 : 80);
  }, [settings.totalWeeks]);

  // Snap to current week on mount / calibration / switch back to week view
  useEffect(() => {
    setSelectedWeek(realCurrentWeek);
    setCalibrateWeekVal(realCurrentWeek);
    const raf = requestAnimationFrame(() => {
      const el = pagerRef.current;
      if (el && el.clientWidth > 0) {
        el.scrollTo({ left: (realCurrentWeek - 1) * el.clientWidth, behavior: 'auto' });
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [realCurrentWeek]);

  useEffect(() => {
    if (viewMode !== 'week') return;
    const raf = requestAnimationFrame(() => {
      const el = pagerRef.current;
      if (el && el.clientWidth > 0) {
        el.scrollTo({ left: (selectedWeek - 1) * el.clientWidth, behavior: 'auto' });
      }
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode]);

  // Keep current week aligned on viewport resize / orientation change
  useEffect(() => {
    const onResize = () => {
      const el = pagerRef.current;
      if (el && el.clientWidth > 0) {
        el.scrollTo({ left: (selectedWeek - 1) * el.clientWidth, behavior: 'auto' });
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [selectedWeek]);

  useEffect(() => {
    if (!coupleSchedule && ownerMode !== 'mine') {
      setOwnerMode('mine');
    }
  }, [coupleSchedule, ownerMode]);

  const handlePagerScroll = () => {
    if (isProgrammaticScrollRef.current) return;
    const el = pagerRef.current;
    if (!el || el.clientWidth <= 0) return;
    const pageIdx = Math.round(el.scrollLeft / el.clientWidth);
    const nextWeek = Math.min(settings.totalWeeks, Math.max(1, pageIdx + 1));
    if (nextWeek !== selectedWeek) {
      setSelectedWeek(nextWeek);
    }
  };

  const displayCourses = useMemo(() => {
    const mine = courses.map((c) => ({ ...c, ownerTag: 'mine' as const }));
    if (!coupleSchedule || ownerMode === 'mine') return mine;
    const ta = coupleSchedule.courses.map((c) => ({ ...c, ownerTag: 'partner' as const }));
    if (ownerMode === 'partner') return ta;
    return [...mine, ...ta];
  }, [courses, coupleSchedule, ownerMode]);

  // Auto-fit rows: show 10 periods if no course goes past 10, else 12 periods
  const maxVisibleSection = useMemo(() => {
    let maxSec = 10;
    for (const c of displayCourses) {
      if (!c.parseWarning && c.endSection > maxSec) {
        maxSec = Math.min(12, c.endSection);
      }
    }
    return maxSec;
  }, [displayCourses]);

  const periods = useMemo(
    () => getActivePeriods(settings).slice(0, maxVisibleSection),
    [settings, maxVisibleSection]
  );
  const todayDow = getTodayDayOfWeek();
  const skinMeta = THEME_SKINS[settings.themeSkin] ?? THEME_SKINS.ocean;

  const activeTodoCountByCourse = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of courseTodos) {
      if (!t.done) {
        map.set(t.courseName, (map.get(t.courseName) ?? 0) + 1);
      }
    }
    return map;
  }, [courseTodos]);

  const coupleStats = useMemo(() => {
    if (!coupleSchedule || ownerMode !== 'couple') return null;
    return computeCoupleWeekStats(courses, coupleSchedule.courses, selectedWeek);
  }, [courses, coupleSchedule, ownerMode, selectedWeek]);

  const todayCourses = useMemo(() => {
    return courses
      .filter((c) => !c.parseWarning && c.dayOfWeek === todayDow && c.weeks.includes(realCurrentWeek))
      .sort((a, b) => a.startSection - b.startSection);
  }, [courses, todayDow, realCurrentWeek]);

  const liveClassBanner = useMemo(() => {
    if (todayCourses.length === 0) return null;
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();

    for (const c of todayCourses) {
      const { startText, endText } = getCourseTimeSpan(c, periods);
      const [sh, sm] = startText.split(':').map(Number);
      const [eh, em] = endText.split(':').map(Number);
      const startMin = sh * 60 + sm;
      const endMin = eh * 60 + em;
      if (nowMin >= startMin && nowMin <= endMin) {
        return { state: 'ongoing' as const, course: c, startText, endText, diffMin: endMin - nowMin };
      }
      if (startMin > nowMin) {
        return { state: 'upcoming' as const, course: c, startText, endText, diffMin: startMin - nowMin };
      }
    }
    return { state: 'done' as const, course: todayCourses[todayCourses.length - 1], startText: '', endText: '', diffMin: 0 };
  }, [todayCourses, periods]);

  const weekNumbers = useMemo(
    () => Array.from({ length: settings.totalWeeks }, (_, i) => i + 1),
    [settings.totalWeeks]
  );

  // Precompute clusters for all weeks (fast, keeps swipe 60fps!)
  const allWeeksClusters = useMemo(() => {
    return weekNumbers.map((w) =>
      buildDayClustersForWeek(displayCourses, w, settings.showNonCurrentWeekCourses)
    );
  }, [weekNumbers, displayCourses, settings.showNonCurrentWeekCourses]);

  // Generate poster PNG whenever modal opens or mode toggles
  useEffect(() => {
    if (!showPosterModal) return;
    let cancelled = false;
    setPosterRendering(true);
    renderSchedulePosterPng({
      mode: posterMode,
      courses: displayCourses,
      periods,
      week: selectedWeek,
      termStartDate: settings.termStartDate,
      termLabel,
      skin: settings.themeSkin,
      darkMode: settings.darkMode,
      bgImageDataUrl: settings.scheduleBgImage,
      bgOpacity: settings.scheduleBgOpacity,
    }).then((url) => {
      if (!cancelled) {
        setPosterUrl(url);
        setPosterRendering(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [
    showPosterModal,
    posterMode,
    displayCourses,
    periods,
    selectedWeek,
    settings.termStartDate,
    settings.themeSkin,
    settings.darkMode,
    settings.scheduleBgImage,
    settings.scheduleBgOpacity,
    termLabel,
  ]);

  const handleExportIcs = () => {
    const ics = buildGdouIcsContent(courses, exams, settings.termStartDate, periods);
    triggerTextDownload(`gdou-schedule-w${selectedWeek}.ics`, ics, 'text/calendar;charset=utf-8');
  };

  const handleDownloadPoster = () => {
    if (!posterUrl) return;
    const a = document.createElement('a');
    a.href = posterUrl;
    a.download = `gdou-${posterMode}-week${selectedWeek}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleCopyMyShareCode = async () => {
    const code = encodeCoupleShareCode(myNickname, termLabel, courses);
    try {
      await navigator.clipboard.writeText(code);
      setShareCodeCopied(true);
      setTimeout(() => setShareCodeCopied(false), 2500);
    } catch {
      window.prompt('请长按复制下方课表口令发给 TA：', code);
    }
  };

  const handleImportCoupleCode = (e: React.FormEvent) => {
    e.preventDefault();
    setCoupleErr('');
    try {
      const profile = decodeCoupleShareCode(importCode);
      onSaveCoupleSchedule(profile);
      setOwnerMode('couple');
      setImportCode('');
      setShowCoupleModal(false);
    } catch (err) {
      setCoupleErr(err instanceof Error ? err.message : '导入失败');
    }
  };

  const handleCreateManual = (e: React.FormEvent) => {
    e.preventDefault();
    if (!mName.trim()) return;
    const weeks = parseWeekExpression(mWeekText);
    const course: CourseItem = {
      id: `manual-${Date.now()}`,
      name: mName.trim(),
      code: 'CUSTOM',
      teacher: mTeacher.trim() || '自定义课程',
      location: mLocation.trim() || '未填写地点',
      campus: '',
      dayOfWeek: mDay,
      startSection: Math.min(mStart, mEnd),
      endSection: Math.max(mStart, mEnd),
      weeks: weeks.length > 0 ? weeks : Array.from({ length: 16 }, (_, i) => i + 1),
      weekText: mWeekText.trim() || '1-16周',
      credit: '',
      classGroup: '',
      colorIndex: Math.floor(Math.random() * 8),
      isManual: true,
    };
    onAddManualCourse(course);
    setShowAddModal(false);
    setMName('');
    setMLocation('');
    setMTeacher('');
  };

  return (
    <div className="space-y-3 pb-4">
      {/* Live Today Banner */}
      <div className="skin-bg-gradient relative overflow-hidden rounded-2xl p-4 text-white shadow-lg">
        <div className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full bg-white/15 blur-2xl" />
        <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-white/85">
              <Sparkles className="h-3.5 w-3.5" />
              <span>{termLabel}</span>
              <span className="opacity-60">·</span>
              <span>
                第 {realCurrentWeek} 周 {DAY_FULL_LABELS[todayDow - 1]}
              </span>
            </div>
            {liveClassBanner?.state === 'ongoing' ? (
              <div className="text-base font-semibold sm:text-lg">
                正在上课：{liveClassBanner.course.name}
                <span className="ml-2 inline-flex items-center rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-medium">
                  {liveClassBanner.course.location} · 距下课 {liveClassBanner.diffMin} 分钟
                </span>
              </div>
            ) : liveClassBanner?.state === 'upcoming' ? (
              <div className="text-base font-semibold sm:text-lg">
                下一节：{liveClassBanner.course.name}
                <span className="ml-2 inline-flex items-center rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-medium">
                  {liveClassBanner.startText} · {liveClassBanner.course.location}
                </span>
              </div>
            ) : todayCourses.length > 0 ? (
              <div className="text-base font-semibold sm:text-lg">
                今日 {todayCourses.length} 节课程已全部结束，好好休息吧！
              </div>
            ) : (
              <div className="text-base font-semibold sm:text-lg">今日无排课，享受海大慢时光</div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => setViewMode(viewMode === 'week' ? 'today' : 'week')}
              className="rounded-xl bg-white/15 px-3 py-1.5 text-xs font-medium backdrop-blur-sm transition hover:bg-white/25"
            >
              {viewMode === 'week' ? `今日 (${todayCourses.length})` : '周课表'}
            </button>
            <button
              onClick={() => setShowPosterModal(true)}
              className="inline-flex items-center gap-1 rounded-xl bg-white/15 px-3 py-1.5 text-xs font-medium backdrop-blur-sm transition hover:bg-white/25"
            >
              <ImageIcon className="h-3.5 w-3.5" />
              存课表壁纸
            </button>
            <button
              onClick={handleExportIcs}
              className="inline-flex items-center gap-1 rounded-xl bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50"
            >
              <Download className="h-3.5 w-3.5" />
              .ics日历
            </button>
          </div>
        </div>
      </div>

      {/* Sticky Week & Controls Bar (syncs automatically as you swipe!) */}
      <div className="sticky top-[57px] z-20 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200/80 bg-white/95 px-3 py-2 shadow-sm backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/95">
        <div className="flex flex-wrap items-center gap-1">
          <button
            onClick={() => scrollToWeek(selectedWeek - 1)}
            disabled={selectedWeek <= 1}
            className="rounded-lg p-1.5 text-slate-600 transition hover:bg-slate-100 disabled:opacity-35 dark:text-slate-300 dark:hover:bg-slate-800"
            aria-label="上一周"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <select
            value={selectedWeek}
            onChange={(e) => scrollToWeek(Number(e.target.value))}
            className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-bold text-slate-800 outline-none focus:border-sky-500 sm:text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          >
            {weekNumbers.map((w) => (
              <option key={w} value={w}>
                第 {w} 周{w === realCurrentWeek ? '（本周）' : ''}
              </option>
            ))}
          </select>
          <button
            onClick={() => scrollToWeek(selectedWeek + 1)}
            disabled={selectedWeek >= settings.totalWeeks}
            className="rounded-lg p-1.5 text-slate-600 transition hover:bg-slate-100 disabled:opacity-35 dark:text-slate-300 dark:hover:bg-slate-800"
            aria-label="下一周"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          {selectedWeek !== realCurrentWeek && (
            <button
              onClick={() => scrollToWeek(realCurrentWeek)}
              className="rounded-lg bg-sky-50 px-2 py-1 text-xs font-semibold text-sky-700 hover:bg-sky-100 dark:bg-sky-900/40 dark:text-sky-300"
            >
              回本周
            </button>
          )}
          <button
            onClick={() => {
              setCalibrateWeekVal(realCurrentWeek);
              setShowCalibrateModal(true);
            }}
            className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-100 dark:border-amber-800/70 dark:bg-amber-950/50 dark:text-amber-300"
            title="当前周次不准？一键校准"
          >
            <Compass className="h-3 w-3" />
            校准
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {coupleSchedule ? (
            <div className="flex items-center rounded-xl bg-rose-50 p-0.5 text-[11px] font-semibold dark:bg-rose-950/50">
              {(
                [
                  ['mine', '我的'],
                  ['couple', '双人'],
                  ['partner', coupleSchedule.partnerName.slice(0, 4)],
                ] as const
              ).map(([k, lbl]) => (
                <button
                  key={k}
                  onClick={() => setOwnerMode(k)}
                  className={`rounded-lg px-2 py-1 transition ${
                    ownerMode === k
                      ? 'bg-rose-500 text-white shadow-2xs'
                      : 'text-rose-700 dark:text-rose-300'
                  }`}
                >
                  {lbl}
                </button>
              ))}
              <button
                onClick={() => setShowCoupleModal(true)}
                className="px-1.5 text-rose-500 hover:text-rose-700"
                title="管理双人课表"
              >
                <Users className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowCoupleModal(true)}
              className="inline-flex items-center gap-1 rounded-xl border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-semibold text-rose-600 transition hover:bg-rose-100 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300"
            >
              <Heart className="h-3.5 w-3.5" />
              双人
            </button>
          )}

          <button
            onClick={onToggleNonCurrentWeek}
            className={`inline-flex items-center gap-1 rounded-xl border px-2.5 py-1.5 text-xs font-medium transition ${
              settings.showNonCurrentWeekCourses
                ? 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950/60 dark:text-sky-300'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
            }`}
          >
            {settings.showNonCurrentWeekCourses ? (
              <Eye className="h-3.5 w-3.5" />
            ) : (
              <EyeOff className="h-3.5 w-3.5" />
            )}
            非本周
          </button>

          <button
            onClick={() => setShowAddModal(true)}
            className="inline-flex items-center gap-1 rounded-xl bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-white transition hover:bg-slate-800 dark:bg-sky-600 dark:hover:bg-sky-500"
          >
            <Plus className="h-3.5 w-3.5" />
            加课
          </button>
        </div>
      </div>

      {/* Couple Stats Strip */}
      {coupleStats && coupleSchedule && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-rose-200/80 bg-gradient-to-r from-rose-50 to-pink-50 px-4 py-2.5 text-xs dark:border-rose-900/50 dark:from-rose-950/40 dark:to-pink-950/30">
          <div className="flex items-center gap-2 font-semibold text-rose-700 dark:text-rose-300">
            <Heart className="h-4 w-4 fill-rose-500 text-rose-500" />
            <span>我 & {coupleSchedule.partnerName} · 第 {selectedWeek} 周同屏</span>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-rose-800/90 dark:text-rose-200">
            <span>
              ♡ 工作日共同没课：<strong>{coupleStats.mutualFreeSlots.length}</strong> 大节
            </span>
            <span>
              同堂上课：<strong>{coupleStats.sameClassCount}</strong> 次
            </span>
            <span>
              顺路同楼：<strong>{coupleStats.sameBuildingCount}</strong> 次
            </span>
          </div>
        </div>
      )}

      {/* Main Content: Empty Prompt OR Swipeable Weekly Pager OR Today Agenda */}
      {displayCourses.length === 0 ? (
        <div className="space-y-3">
          <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-sky-300/90 bg-white/90 px-6 py-16 text-center shadow-xs dark:border-sky-800/70 dark:bg-slate-900/80">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-50 text-sky-600 dark:bg-sky-950/70 dark:text-sky-400">
              <RefreshCw className="h-7 w-7" />
            </div>
            <h3 className="mt-4 text-base font-extrabold text-slate-900 dark:text-white">
              请先点右上角进行教务系统导入
            </h3>
            <p className="mt-2 max-w-sm text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              支持免校园网直连海大教务，浏览器端本地 AES-128 加密提交、服务器全程零明文密码，一键拉取课表、考试座位与历年成绩绩点。
            </p>
            <button
              type="button"
              onClick={onOpenSync}
              className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-sky-600 to-blue-600 px-5 py-2.5 text-xs font-bold text-white shadow-lg shadow-sky-500/20 transition hover:from-sky-500 hover:to-blue-500"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              立即进行教务系统导入
            </button>
          </div>
          <p className="px-2 pt-1 text-center text-[11px] leading-relaxed text-slate-400/90 dark:text-slate-500">
            感谢网名“圆头耄耋514”同学提供的SSO协议，为本项目做出了重大贡献。
          </p>
        </div>
      ) : viewMode === 'today' ? (
        <div className="space-y-3">
          {todayCourses.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white/70 p-12 text-center dark:border-slate-700 dark:bg-slate-900/50">
              <Calendar className="mx-auto mb-3 h-10 w-10 text-slate-400" />
              <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
                今天（第 {realCurrentWeek} 周 {DAY_FULL_LABELS[todayDow - 1]}）没有课程安排
              </p>
            </div>
          ) : (
            todayCourses.map((c) => {
              const pal = getCoursePalette(c.colorIndex, settings.themeSkin);
              const span = getCourseTimeSpan(c, periods);
              const todoCnt = activeTodoCountByCourse.get(c.name) ?? 0;
              return (
                <div
                  key={c.id}
                  onClick={() => {
                    setSelectedSlotCourses([c]);
                    setActiveModalIdx(0);
                  }}
                  className={`flex cursor-pointer items-center justify-between rounded-2xl border p-4 transition hover:-translate-y-0.5 hover:shadow-md ${pal.bg} ${pal.border}`}
                >
                  <div className="flex items-start gap-3.5">
                    <div className={`mt-1 h-11 w-1.5 rounded-full ${pal.accent}`} />
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className={`text-base font-bold ${pal.title}`}>{c.name}</h3>
                        {todoCnt > 0 && (
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-bold text-white">
                            <StickyNote className="h-2.5 w-2.5" />
                            {todoCnt} 待办
                          </span>
                        )}
                      </div>
                      <div className={`mt-1.5 flex flex-wrap items-center gap-3 text-xs ${pal.sub}`}>
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5" />
                          第 {c.startSection}-{c.endSection} 节 ({span.startText}-{span.endText})
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="h-3.5 w-3.5" />
                          {c.location}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <User className="h-3.5 w-3.5" />
                          {c.teacher}
                        </span>
                      </div>
                    </div>
                  </div>
                  <span className="rounded-full bg-white/70 px-2.5 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-900/60 dark:text-slate-200">
                    {c.weekText}
                  </span>
                </div>
              );
            })
          )}
        </div>
      ) : (
        <div className="space-y-1.5">
          {/* Swipeable Horizontal Week Pager Container */}
          <div className="relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            {/* Custom Schedule Background Image */}
            {settings.scheduleBgImage && (
              <div
                className="pointer-events-none absolute inset-0 bg-cover bg-center"
                style={{
                  backgroundImage: `url(${settings.scheduleBgImage})`,
                  opacity: settings.scheduleBgOpacity ?? 0.28,
                }}
              />
            )}

            <div
              ref={pagerRef}
              onScroll={handlePagerScroll}
              className="swipe-pager relative z-10 flex w-full snap-x snap-mandatory overflow-x-auto"
            >
              {weekNumbers.map((weekNum, wIdx) => {
                const weekClusters = allWeeksClusters[wIdx];
                const pageDates = Array.from({ length: 7 }, (_, i) => {
                  const dt = getDateForWeekAndDay(settings.termStartDate, weekNum, i + 1);
                  return `${dt.getMonth() + 1}/${dt.getDate()}`;
                });
                const pageCoupleFree =
                  coupleSchedule && ownerMode === 'couple'
                    ? computeCoupleWeekStats(courses, coupleSchedule.courses, weekNum).mutualFreeSlots
                    : [];

                return (
                  <div
                    key={weekNum}
                    className="w-full shrink-0 snap-start snap-always"
                  >
                    {/* Day Header */}
                    <div className="grid grid-cols-[34px_repeat(7,minmax(0,1fr))] border-b border-slate-200/80 bg-slate-50/85 backdrop-blur-xs sm:grid-cols-[54px_repeat(7,minmax(0,1fr))] dark:border-slate-800 dark:bg-slate-900/85">
                      <div className="flex flex-col items-center justify-center py-2 text-[10px] font-bold text-sky-600 sm:text-[11px] dark:text-sky-400">
                        <span>W{weekNum}</span>
                      </div>
                      {DAY_LABELS.map((label, idx) => {
                        const isToday = weekNum === realCurrentWeek && idx + 1 === todayDow;
                        return (
                          <div
                            key={label}
                            className={`flex flex-col items-center justify-center border-l border-slate-100/80 py-1.5 text-center sm:py-2 dark:border-slate-800/80 ${
                              isToday ? 'bg-sky-50/90 dark:bg-sky-950/50' : ''
                            }`}
                          >
                            <span
                              className={`text-[11px] font-bold sm:text-xs ${
                                isToday ? 'text-sky-600 dark:text-sky-400' : 'text-slate-700 dark:text-slate-200'
                              }`}
                            >
                              周{label}
                            </span>
                            <span
                              className={`mt-0.5 text-[9.5px] sm:text-[11px] ${
                                isToday
                                  ? 'rounded-full bg-sky-600 px-1 py-0.2 font-medium text-white sm:px-1.5'
                                  : 'text-slate-400 dark:text-slate-500'
                              }`}
                            >
                              {pageDates[idx]}
                            </span>
                          </div>
                        );
                      })}
                    </div>

                    {/* Grid Body */}
                    <div className="relative grid grid-cols-[34px_repeat(7,minmax(0,1fr))] sm:grid-cols-[54px_repeat(7,minmax(0,1fr))]">
                      {/* Time Column */}
                      <div className="divide-y divide-slate-100/80 bg-slate-50/65 backdrop-blur-xs dark:divide-slate-800/70 dark:bg-slate-900/60">
                        {periods.map((p) => (
                          <div
                            key={p.section}
                            style={{ height: ROW_HEIGHT }}
                            className="flex flex-col items-center justify-center px-0.5 text-center sm:px-1"
                          >
                            <span className="text-[11px] font-bold text-slate-700 sm:text-xs dark:text-slate-300">
                              {p.section}
                            </span>
                            <span className="text-[8.5px] leading-tight text-slate-400 sm:text-[10px] dark:text-slate-500">
                              {p.start}
                            </span>
                            <span className="hidden text-[10px] leading-tight text-slate-300 sm:block dark:text-slate-600">
                              {p.end}
                            </span>
                          </div>
                        ))}
                      </div>

                      {/* 7 Day Columns */}
                      {[1, 2, 3, 4, 5, 6, 7].map((day) => {
                        const clusters = weekClusters.get(day) ?? [];
                        const isTodayCol = weekNum === realCurrentWeek && day === todayDow;
                        const freeSlotsForDay = pageCoupleFree.filter((s) => s.day === day);

                        return (
                          <div
                            key={day}
                            className={`relative border-l border-slate-100/80 dark:border-slate-800/80 ${
                              isTodayCol ? 'bg-sky-50/25 dark:bg-sky-950/15' : ''
                            }`}
                            style={{ height: periods.length * ROW_HEIGHT }}
                          >
                            {/* Horizontal guide lines */}
                            {periods.map((p, idx) => (
                              <div
                                key={p.section}
                                style={{ top: idx * ROW_HEIGHT, height: ROW_HEIGHT }}
                                className="pointer-events-none absolute inset-x-0 border-b border-slate-100/80 dark:border-slate-800/60"
                              />
                            ))}

                            {/* Couple Mutual Free Slots */}
                            {freeSlotsForDay.map((slot) => (
                              <div
                                key={`free-${day}-${slot.start}`}
                                style={{
                                  top: (slot.start - 1) * ROW_HEIGHT + 3,
                                  height: (slot.end - slot.start + 1) * ROW_HEIGHT - 6,
                                }}
                                className="pointer-events-none absolute inset-x-[2px] flex flex-col items-center justify-center rounded-lg border border-dashed border-rose-200/90 bg-rose-50/45 text-center text-[9.5px] font-semibold text-rose-400 dark:border-rose-900/50 dark:bg-rose-950/20 dark:text-rose-400/80"
                              >
                                <span>♡</span>
                                <span className="hidden sm:inline">共同没课</span>
                              </div>
                            ))}

                            {/* Course Cards */}
                            {clusters.map((cl, cIdx) => {
                              const primary = cl.items[0];
                              const isActive = primary.weeks.includes(weekNum);
                              const pal = getCoursePalette(primary.colorIndex, settings.themeSkin);
                              const effStart = cl.start;
                              const effEnd = Math.min(maxVisibleSection, cl.end);
                              const spanCount = Math.max(1, effEnd - effStart + 1);
                              const top = (effStart - 1) * ROW_HEIGHT + 2;
                              const height = spanCount * ROW_HEIGHT - 4;
                              const todoCnt = activeTodoCountByCourse.get(primary.name) ?? 0;
                              const isPartner = primary.ownerTag === 'partner';

                              return (
                                <button
                                  key={`${primary.id}-${cIdx}`}
                                  type="button"
                                  onClick={() => {
                                    setSelectedSlotCourses(cl.items);
                                    setActiveModalIdx(0);
                                  }}
                                  style={{ top, height }}
                                  className={`group absolute inset-x-[1.5px] flex flex-col justify-between overflow-hidden rounded-lg border px-1 py-1 text-left backdrop-blur-xs transition-all duration-150 hover:z-10 hover:shadow-md active:scale-[0.96] sm:inset-x-1 sm:rounded-xl sm:p-2 ${
                                    isActive
                                      ? isPartner
                                        ? 'border-rose-300/90 bg-rose-50/92 dark:border-rose-700/80 dark:bg-rose-950/70'
                                        : `${pal.bg} ${pal.border}`
                                      : 'border-dashed border-slate-300/80 bg-slate-100/80 opacity-70 dark:border-slate-700 dark:bg-slate-800/55'
                                  }`}
                                >
                                  {/* Course Name (clean, never blocked by badges!) */}
                                  <div
                                    className={`break-words text-[10px] font-bold leading-[1.2] sm:text-[12px] sm:leading-snug ${
                                      spanCount >= 3 ? 'line-clamp-5' : spanCount === 2 ? 'line-clamp-4' : 'line-clamp-2'
                                    } ${
                                      isActive
                                        ? isPartner
                                          ? 'text-rose-950 dark:text-rose-100'
                                          : pal.title
                                        : 'text-slate-500 dark:text-slate-400'
                                    }`}
                                  >
                                    {primary.name}
                                  </div>

                                  {/* Classroom + bottom-right clean badges */}
                                  <div
                                    className={`mt-0.5 space-y-0.5 text-[9px] leading-[1.15] sm:text-[11px] ${
                                      isActive
                                        ? isPartner
                                          ? 'text-rose-700 dark:text-rose-300'
                                          : pal.sub
                                        : 'text-slate-400 dark:text-slate-500'
                                    }`}
                                  >
                                    <div className="break-all font-medium">
                                      {primary.location}
                                    </div>
                                    {spanCount >= 2 && (
                                      <div className="hidden truncate opacity-80 sm:block">
                                        {primary.teacher}
                                      </div>
                                    )}
                                  </div>

                                  {/* Subtle corner badges placed neatly without obscuring course title */}
                                  {(cl.items.length > 1 || todoCnt > 0 || ownerMode === 'couple') && (
                                    <div className="pointer-events-none absolute bottom-0.5 right-0.5 flex items-center gap-0.5">
                                      {todoCnt > 0 && (
                                        <span className="rounded bg-amber-500 px-1 text-[8px] font-bold leading-tight text-white">
                                          {todoCnt}
                                        </span>
                                      )}
                                      {ownerMode === 'couple' && (
                                        <span
                                          className={`rounded px-1 text-[8px] font-bold leading-tight text-white ${
                                            isPartner ? 'bg-rose-500' : 'bg-sky-600'
                                          }`}
                                        >
                                          {isPartner ? 'TA' : '我'}
                                        </span>
                                      )}
                                      {cl.items.length > 1 && (
                                        <span className="rounded bg-slate-800/75 px-1 text-[8.5px] font-bold leading-tight text-white dark:bg-sky-500/90">
                                          +{cl.items.length - 1}
                                        </span>
                                      )}
                                    </div>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Subtle Swipe Hint + Progress Dots */}
          <div className="flex items-center justify-between px-1 text-[11px] text-slate-400">
            <span>← 左右滑动课表直接翻周 →</span>
            <span>
              第 {selectedWeek} / {settings.totalWeeks} 周
            </span>
          </div>

          {/* Acknowledgement Footer */}
          <p className="px-2 pt-2 text-center text-[11px] leading-relaxed text-slate-400/90 dark:text-slate-500">
            感谢网名“圆头耄耋514”同学提供的SSO协议，为本项目做出了重大贡献。
          </p>
        </div>
      )}

      {/* Course Detail & Course TODO Modal */}
      {selectedSlotCourses && selectedSlotCourses.length > 0 && (
        <div
          className="animate-modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-xs"
          onClick={() => setSelectedSlotCourses(null)}
        >
          <div
            className="animate-modal-pop max-h-[88vh] w-full max-w-md overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            {selectedSlotCourses.length > 1 && (
              <div className="mb-3 flex flex-wrap gap-1.5">
                {selectedSlotCourses.map((c, idx) => (
                  <button
                    key={c.id}
                    onClick={() => setActiveModalIdx(idx)}
                    className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                      idx === activeModalIdx
                        ? 'bg-sky-600 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
                    }`}
                  >
                    {ownerMode === 'couple' ? `[${c.ownerTag === 'partner' ? 'TA' : '我'}] ` : ''}
                    {c.name.slice(0, 8)}
                    {c.weeks.includes(selectedWeek) ? '' : ' (非本周)'}
                  </button>
                ))}
              </div>
            )}

            {(() => {
              const c = selectedSlotCourses[activeModalIdx] ?? selectedSlotCourses[0];
              const span = getCourseTimeSpan(c, periods);
              const myTodos = courseTodos.filter((t) => t.courseName === c.name);
              return (
                <div className="space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-bold text-slate-900 dark:text-white">{c.name}</h3>
                      {c.code && (
                        <p className="text-xs text-slate-400">
                          课程号：{c.code} {c.credit ? `· ${c.credit} 学分` : ''}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => setSelectedSlotCourses(null)}
                      className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>

                  <div className="space-y-2 rounded-xl bg-slate-50 p-3.5 text-sm dark:bg-slate-800/70">
                    <div className="flex items-center gap-2.5 text-slate-700 dark:text-slate-200">
                      <MapPin className="h-4 w-4 text-sky-500" />
                      <span>
                        {c.location} {c.campus ? `(${c.campus})` : ''}
                      </span>
                    </div>
                    <div className="flex items-center gap-2.5 text-slate-700 dark:text-slate-200">
                      <Clock className="h-4 w-4 text-sky-500" />
                      <span>
                        {DAY_FULL_LABELS[c.dayOfWeek - 1]} 第 {c.startSection}-{c.endSection} 节（
                        {span.startText}-{span.endText}）
                      </span>
                    </div>
                    <div className="flex items-center gap-2.5 text-slate-700 dark:text-slate-200">
                      <Calendar className="h-4 w-4 text-sky-500" />
                      <span>周次：{c.weekText}</span>
                    </div>
                    <div className="flex items-center gap-2.5 text-slate-700 dark:text-slate-200">
                      <User className="h-4 w-4 text-sky-500" />
                      <span>
                        教师：{c.teacher} {c.classGroup ? `· ${c.classGroup}` : ''}
                      </span>
                    </div>
                  </div>

                  {/* Course Homework / Lab DDL Notes */}
                  <div className="rounded-xl border border-amber-200/70 bg-amber-50/40 p-3.5 dark:border-amber-900/50 dark:bg-amber-950/20">
                    <h4 className="flex items-center gap-1.5 text-xs font-bold text-amber-800 dark:text-amber-300">
                      <StickyNote className="h-3.5 w-3.5" />
                      课程作业 / 实验 DDL 小便签
                    </h4>

                    {myTodos.length > 0 && (
                      <div className="mt-2.5 space-y-1.5">
                        {myTodos.map((t) => (
                          <div
                            key={t.id}
                            className="flex items-center justify-between gap-2 rounded-lg bg-white/90 px-2.5 py-1.5 text-xs dark:bg-slate-900/80"
                          >
                            <button
                              type="button"
                              onClick={() => onToggleTodo(t.id)}
                              className="flex flex-1 items-center gap-2 text-left"
                            >
                              {t.done ? (
                                <CheckSquare className="h-4 w-4 shrink-0 text-emerald-500" />
                              ) : (
                                <Square className="h-4 w-4 shrink-0 text-amber-500" />
                              )}
                              <span
                                className={
                                  t.done
                                    ? 'text-slate-400 line-through'
                                    : 'font-medium text-slate-800 dark:text-slate-100'
                                }
                              >
                                {t.content}
                                {t.dueDate && (
                                  <span className="ml-1.5 text-[10px] text-amber-600 dark:text-amber-400">
                                    ({t.dueDate})
                                  </span>
                                )}
                              </span>
                            </button>
                            <button
                              type="button"
                              onClick={() => onDeleteTodo(t.id)}
                              className="text-slate-400 hover:text-rose-500"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (!todoText.trim()) return;
                        onAddTodo(c.name, todoText.trim(), todoDue || undefined);
                        setTodoText('');
                        setTodoDue('');
                      }}
                      className="mt-2.5 flex gap-1.5"
                    >
                      <input
                        value={todoText}
                        onChange={(e) => setTodoText(e.target.value)}
                        placeholder="记一条作业/实验提醒..."
                        className="min-w-0 flex-1 rounded-lg border border-amber-200 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-amber-500 dark:border-slate-700 dark:bg-slate-800"
                      />
                      <input
                        type="date"
                        value={todoDue}
                        onChange={(e) => setTodoDue(e.target.value)}
                        className="w-28 rounded-lg border border-amber-200 bg-white px-1.5 py-1.5 text-[11px] dark:border-slate-700 dark:bg-slate-800"
                      />
                      <button
                        type="submit"
                        className="shrink-0 rounded-lg bg-amber-500 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-amber-600"
                      >
                        记下
                      </button>
                    </form>
                  </div>

                  <div className="flex justify-end gap-2">
                    {c.isManual && (
                      <button
                        onClick={() => {
                          onDeleteCourse(c.id);
                          setSelectedSlotCourses(null);
                        }}
                        className="inline-flex items-center gap-1 rounded-xl bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-100 dark:bg-rose-950/60 dark:text-rose-400"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        删除课程
                      </button>
                    )}
                    <button
                      onClick={() => setSelectedSlotCourses(null)}
                      className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-sky-600 dark:hover:bg-sky-500"
                    >
                      关闭
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Calibrate Current Week Modal */}
      {showCalibrateModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-xs"
          onClick={() => setShowCalibrateModal(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-1.5 text-base font-bold text-slate-900 dark:text-white">
                <Compass className="h-4 w-4 text-amber-500" />
                一键校准当前教学周
              </h3>
              <button onClick={() => setShowCalibrateModal(false)} className="text-slate-400">
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="text-xs text-slate-500">
              如果课表显示大部分课程为灰底“非本周”，只需选一下<strong>这周实际上是第几周</strong>，系统会自动反推出准确的开学第 1 周周一日期！
            </p>
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                今天所在的是本学期：
              </label>
              <select
                value={calibrateWeekVal}
                onChange={(e) => setCalibrateWeekVal(Number(e.target.value))}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-bold outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-800"
              >
                {weekNumbers.map((w) => (
                  <option key={w} value={w}>
                    第 {w} 周
                  </option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowCalibrateModal(false)}
                className="rounded-xl px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                取消
              </button>
              <button
                onClick={() => {
                  onCalibrateCurrentWeek(calibrateWeekVal);
                  scrollToWeek(calibrateWeekVal, false);
                  setShowCalibrateModal(false);
                }}
                className="rounded-xl bg-sky-600 px-4 py-2 text-xs font-bold text-white hover:bg-sky-500"
              >
                确认校准
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Couple / Roommate Schedule Share Modal */}
      {showCoupleModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-xs"
          onClick={() => setShowCoupleModal(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="max-h-[90vh] w-full max-w-md space-y-4 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-base font-bold text-slate-900 dark:text-white">
                <Heart className="h-4 w-4 fill-rose-500 text-rose-500" />
                情侣 / 室友 / 搭子双人课表
              </h3>
              <button onClick={() => setShowCoupleModal(false)} className="text-slate-400">
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="text-xs text-slate-500">
              零服务器纯本地口令互传（绝不含学号密码），导入后自动标出工作日「♡ 共同没课」空闲大节和顺路同楼！
            </p>

            <div className="space-y-2.5 rounded-2xl bg-slate-50 p-3.5 dark:bg-slate-800/70">
              <div className="text-xs font-bold text-slate-700 dark:text-slate-200">
                1. 把我的课表发给 TA
              </div>
              <div className="flex gap-2">
                <input
                  value={myNickname}
                  onChange={(e) => setMyNickname(e.target.value)}
                  placeholder="我的昵称（如：阿海）"
                  maxLength={12}
                  className="w-32 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-rose-400 dark:border-slate-700 dark:bg-slate-900"
                />
                <button
                  type="button"
                  onClick={() => void handleCopyMyShareCode()}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-rose-500 px-3 py-2 text-xs font-bold text-white transition hover:bg-rose-600"
                >
                  {shareCodeCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {shareCodeCopied ? '已复制口令，去微信发给TA吧' : '复制我的课表口令'}
                </button>
              </div>
            </div>

            <form
              onSubmit={handleImportCoupleCode}
              className="space-y-2.5 rounded-2xl border border-rose-200/70 p-3.5 dark:border-rose-900/50"
            >
              <div className="text-xs font-bold text-slate-700 dark:text-slate-200">
                2. 粘贴 TA 发来的课表口令
              </div>
              <textarea
                rows={3}
                value={importCode}
                onChange={(e) => setImportCode(e.target.value)}
                placeholder="粘贴以 GDOU-COUPLE-V1: 开头的口令..."
                className="w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 font-mono text-[11px] outline-none focus:border-rose-400 dark:border-slate-700 dark:bg-slate-800"
              />
              {coupleErr && <p className="text-xs text-rose-500">{coupleErr}</p>}
              <div className="flex items-center justify-between gap-2">
                {coupleSchedule ? (
                  <button
                    type="button"
                    onClick={() => {
                      onSaveCoupleSchedule(null);
                      setShowCoupleModal(false);
                    }}
                    className="text-xs font-medium text-rose-500 hover:underline"
                  >
                    清除 TA 的课表 ({coupleSchedule.partnerName})
                  </button>
                ) : (
                  <span />
                )}
                <button
                  type="submit"
                  className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800 dark:bg-rose-600 dark:hover:bg-rose-500"
                >
                  导入并同屏查看
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* HD Poster & Wallpaper Export Modal */}
      {showPosterModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-sm"
          onClick={() => setShowPosterModal(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[92vh] w-full max-w-md flex-col space-y-3.5 rounded-3xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-base font-bold text-slate-900 dark:text-white">
                <Smartphone className="h-4 w-4 text-sky-500" />
                导出第 {selectedWeek} 周高清课表图
              </h3>
              <button onClick={() => setShowPosterModal(false)} className="text-slate-400">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
              <button
                onClick={() => setPosterMode('wallpaper')}
                className={`rounded-lg py-1.5 text-xs font-bold transition ${
                  posterMode === 'wallpaper'
                    ? 'bg-white text-sky-700 shadow-xs dark:bg-slate-700 dark:text-white'
                    : 'text-slate-500'
                }`}
              >
                手机锁屏壁纸 (留出时间区)
              </button>
              <button
                onClick={() => setPosterMode('poster')}
                className={`rounded-lg py-1.5 text-xs font-bold transition ${
                  posterMode === 'poster'
                    ? 'bg-white text-sky-700 shadow-xs dark:bg-slate-700 dark:text-white'
                    : 'text-slate-500'
                }`}
              >
                标准高清课表长图
              </button>
            </div>

            <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-2xl bg-slate-100 p-2 dark:bg-slate-950">
              {posterRendering || !posterUrl ? (
                <div className="py-20 text-xs text-slate-400">正在高清渲染中...</div>
              ) : (
                <img
                  src={posterUrl}
                  alt="高清课表预览"
                  className="max-h-[54vh] w-auto rounded-xl object-contain shadow-lg"
                />
              )}
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-slate-400">
                手机端也可直接长按上方预览图保存到相册
              </span>
              <button
                onClick={handleDownloadPoster}
                disabled={!posterUrl}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-sky-600 px-4 py-2 text-xs font-bold text-white hover:bg-sky-500 disabled:opacity-50"
              >
                <Download className="h-3.5 w-3.5" />
                下载 PNG
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Manual Course Modal */}
      {showAddModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-xs"
          onClick={() => setShowAddModal(false)}
        >
          <form
            onSubmit={handleCreateManual}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900 dark:text-white">手动添加自定义课程</h3>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-3 text-sm">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">课程名称 *</label>
                <input
                  required
                  value={mName}
                  onChange={(e) => setMName(e.target.value)}
                  placeholder="例如：海洋机器人社团例会"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-800"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">教室 / 地点</label>
                  <input
                    value={mLocation}
                    onChange={(e) => setMLocation(e.target.value)}
                    placeholder="钟海楼02018"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-800"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">任课教师</label>
                  <input
                    value={mTeacher}
                    onChange={(e) => setMTeacher(e.target.value)}
                    placeholder="选填"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-800"
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">星期</label>
                  <select
                    value={mDay}
                    onChange={(e) => setMDay(Number(e.target.value))}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-2 dark:border-slate-700 dark:bg-slate-800"
                  >
                    {DAY_FULL_LABELS.map((d, i) => (
                      <option key={d} value={i + 1}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">开始节次</label>
                  <input
                    type="number"
                    min={1}
                    max={12}
                    value={mStart}
                    onChange={(e) => setMStart(Number(e.target.value))}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-2 dark:border-slate-700 dark:bg-slate-800"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">结束节次</label>
                  <input
                    type="number"
                    min={1}
                    max={12}
                    value={mEnd}
                    onChange={(e) => setMEnd(Number(e.target.value))}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-2 dark:border-slate-700 dark:bg-slate-800"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">周次表达式</label>
                <input
                  value={mWeekText}
                  onChange={(e) => setMWeekText(e.target.value)}
                  placeholder="例如：1-16周 或 1-15周(单)"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-800"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="rounded-xl px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                取消
              </button>
              <button
                type="submit"
                className="rounded-xl bg-sky-600 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-500"
              >
                保存课程
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
