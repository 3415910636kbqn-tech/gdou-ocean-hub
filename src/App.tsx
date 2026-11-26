import React, { useEffect, useState } from 'react';
import {
  Award,
  CalendarClock,
  CalendarDays,
  Compass,
  Moon,
  RefreshCw,
  Settings,
  ShieldCheck,
  Sun,
  Waves,
} from 'lucide-react';
import {
  getDefaultTermStartDateForTerm,
  matchCampusPresetByName,
} from '../shared/gdouTimetable';
import type {
  AppSettings,
  CoupleScheduleProfile,
  CourseItem,
  ExamItem,
  PersistedAppData,
  SyncResultPayload,
} from '../shared/models';
import { getTodayDayOfWeek } from '../shared/parsers';
import { CampusView } from './components/CampusView';
import { ExamsView } from './components/ExamsView';
import { GradesView } from './components/GradesView';
import { ScheduleView } from './components/ScheduleView';
import { SettingsView } from './components/SettingsView';
import { SyncModal } from './components/SyncModal';
import { WebDownloadHome } from './components/WebDownloadHome';
import { isNativeMobileApp } from './services/nativeHttpBridge';
import {
  clearPersistedData,
  createSampleAppData,
  loadPersistedData,
  savePersistedData,
} from './services/storage';
import { THEME_SKINS } from './services/courseColors';

type TabKey = 'schedule' | 'exams' | 'grades' | 'campus' | 'settings';

const SKIN_THEME_COLORS: Record<string, string> = {
  ocean: '#0284c7',
  morandi: '#5f7d72',
  sakura: '#ec4899',
  mono: '#1e293b',
};

const NAV_ITEMS: { key: TabKey; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'schedule', label: '课表', icon: CalendarDays },
  { key: 'exams', label: '考试', icon: CalendarClock },
  { key: 'grades', label: '成绩绩点', icon: Award },
  { key: 'campus', label: '百宝箱', icon: Compass },
  { key: 'settings', label: '设置', icon: Settings },
];

export default function App() {
  const [data, setData] = useState<PersistedAppData>(() => loadPersistedData());
  const [activeTab, setActiveTab] = useState<TabKey>('schedule');
  const [syncOpen, setSyncOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const isNative = isNativeMobileApp();
  const [webPreviewEntered, setWebPreviewEntered] = useState(false);

  const showToast = (msg: string) => {
    setToast(msg);
  };

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2200);
    return () => window.clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    savePersistedData(data);
  }, [data]);

  useEffect(() => {
    const root = document.documentElement;
    if (data.settings.darkMode) root.classList.add('dark');
    else root.classList.remove('dark');

    const skin = data.settings.themeSkin || 'ocean';
    root.dataset.skin = skin;

    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.setAttribute(
        'content',
        data.settings.darkMode ? '#0f172a' : (SKIN_THEME_COLORS[skin] ?? '#0284c7')
      );
    }
  }, [data.settings.darkMode, data.settings.themeSkin]);

  const updateSettings = (patch: Partial<AppSettings>) => {
    setData((prev) => ({
      ...prev,
      settings: { ...prev.settings, ...patch },
    }));
    if (patch.themeSkin) {
      const label = THEME_SKINS[patch.themeSkin]?.label ?? patch.themeSkin;
      showToast(`已切换为「${label}」主题`);
    } else if (typeof patch.darkMode === 'boolean') {
      showToast(patch.darkMode ? '已开启深色护眼模式' : '已切换为浅色模式');
    }
  };

  const handleCalibrateCurrentWeek = (actualWeek: number) => {
    const now = new Date();
    const todayDow = getTodayDayOfWeek(now);
    const week1Monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    week1Monday.setDate(week1Monday.getDate() - (todayDow - 1) - (actualWeek - 1) * 7);
    const y = week1Monday.getFullYear();
    const m = String(week1Monday.getMonth() + 1).padStart(2, '0');
    const d = String(week1Monday.getDate()).padStart(2, '0');
    updateSettings({ termStartDate: `${y}-${m}-${d}` });
  };

  const handleSyncCompleted = (result: SyncResultPayload) => {
    setData((prev) => {
      const manualCourses = prev.courses.filter((c) => c.isManual);
      const manualExams = prev.exams.filter((e) => e.isManual);

      const nextSettings = { ...prev.settings };
      const derivedStart = getDefaultTermStartDateForTerm(result.academicYear, result.semesterCode);
      if (derivedStart) nextSettings.termStartDate = derivedStart;

      if (result.syncedPeriods && result.syncedPeriods.length >= 8) {
        nextSettings.campusPreset = 'custom';
        nextSettings.customPeriods = result.syncedPeriods;
      } else if (result.detectedCampus) {
        const matched = matchCampusPresetByName(result.detectedCampus);
        if (matched) nextSettings.campusPreset = matched;
      }

      return {
        ...prev,
        courses: [...result.courses, ...manualCourses],
        exams: [...result.exams, ...manualExams],
        grades: result.grades,
        emptyRooms: result.emptyRooms && result.emptyRooms.length > 0 ? result.emptyRooms : prev.emptyRooms,
        termLabel: result.termLabel,
        academicYear: result.academicYear,
        semesterCode: result.semesterCode,
        lastSyncedAt: result.receipt.syncedAtIso,
        lastSyncReceipt: result.receipt,
        settings: nextSettings,
      };
    });
  };

  const handleAddManualCourse = (course: CourseItem) => {
    setData((prev) => ({ ...prev, courses: [...prev.courses, course] }));
  };

  const handleDeleteCourse = (id: string) => {
    setData((prev) => ({ ...prev, courses: prev.courses.filter((c) => c.id !== id) }));
  };

  const handleAddManualExam = (exam: ExamItem) => {
    setData((prev) => ({ ...prev, exams: [...prev.exams, exam] }));
  };

  const handleDeleteExam = (id: string) => {
    setData((prev) => ({ ...prev, exams: prev.exams.filter((e) => e.id !== id) }));
  };

  const handleAddTodo = (courseName: string, content: string, dueDate?: string) => {
    setData((prev) => ({
      ...prev,
      courseTodos: [
        {
          id: `todo-${Date.now()}`,
          courseName,
          content,
          dueDate,
          done: false,
          createdAtIso: new Date().toISOString(),
        },
        ...prev.courseTodos,
      ],
    }));
  };

  const handleToggleTodo = (id: string) => {
    setData((prev) => ({
      ...prev,
      courseTodos: prev.courseTodos.map((t) => (t.id === id ? { ...t, done: !t.done } : t)),
    }));
  };

  const handleDeleteTodo = (id: string) => {
    setData((prev) => ({
      ...prev,
      courseTodos: prev.courseTodos.filter((t) => t.id !== id),
    }));
  };

  const handleSaveCoupleSchedule = (profile: CoupleScheduleProfile | null) => {
    setData((prev) => ({ ...prev, coupleSchedule: profile }));
  };

  const handleClearAll = () => {
    if (!window.confirm('确定清空本地缓存的课表、考试和成绩数据吗？')) return;
    clearPersistedData();
    setData((prev) => ({
      ...prev,
      courses: [],
      exams: [],
      grades: [],
      emptyRooms: [],
      courseTodos: [],
      coupleSchedule: null,
      lastSyncedAt: null,
      lastSyncReceipt: null,
      termLabel: '尚未同步教务数据',
    }));
  };

  if (!isNative && !webPreviewEntered) {
    return (
      <WebDownloadHome
        hasCachedWebData={data.courses.length > 0 || data.grades.length > 0 || data.exams.length > 0}
        darkMode={data.settings.darkMode}
        onToggleDarkMode={() => updateSettings({ darkMode: !data.settings.darkMode })}
        onEnterWebPreview={() => setWebPreviewEntered(true)}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-20 text-slate-900 transition-colors duration-300 dark:bg-slate-950 dark:text-slate-100 md:pb-0">
      {/* Return-to-Download-Home ribbon when browsing web fallback */}
      {!isNative && (
        <div className="border-b border-rose-200/80 bg-rose-50/95 px-4 py-2 text-center text-xs text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/70 dark:text-rose-200">
          <span>服务器 IP 已被尼海封禁，网页端仅作离线查看 · </span>
          <button
            type="button"
            onClick={() => setWebPreviewEntered(false)}
            className="font-extrabold underline underline-offset-2 hover:text-rose-950 dark:hover:text-white"
          >
            ← 返回下载直连 App 与安装教程
          </button>
        </div>
      )}
      {/* Silky Floating Toast */}
      {toast && (
        <div className="animate-toast pointer-events-none fixed left-1/2 top-4 z-[60] rounded-full bg-slate-900/90 px-4 py-2 text-xs font-semibold text-white shadow-xl backdrop-blur-md dark:bg-white/95 dark:text-slate-900">
          {toast}
        </div>
      )}

      <div className="mx-auto flex max-w-[1440px]">
        {/* Desktop Sidebar */}
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col justify-between border-r border-slate-200/80 bg-white/85 p-5 backdrop-blur-xl transition-colors duration-300 dark:border-slate-800/80 dark:bg-slate-900/80 md:flex">
          <div className="space-y-6">
            <div className="flex items-center gap-3 px-1">
              <div className="skin-bg-gradient flex h-10 w-10 items-center justify-center rounded-2xl text-white shadow-lg">
                <Waves className="h-5 w-5" />
              </div>
              <div>
                <div className="text-sm font-extrabold tracking-tight text-slate-900 dark:text-white">
                  谁用你那难用的教务系统？
                </div>
                <div className="skin-text-primary text-[11px] font-medium">
                  GDOU Ocean Hub
                </div>
              </div>
            </div>

            <nav className="space-y-1.5">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = activeTab === item.key;
                return (
                  <button
                    key={item.key}
                    onClick={() => setActiveTab(item.key)}
                    className={`flex w-full items-center gap-3 rounded-2xl px-3.5 py-2.5 text-sm font-semibold transition-all duration-200 active:scale-[0.98] ${
                      active
                        ? 'skin-soft-pill border shadow-2xs'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/70 dark:hover:text-white'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </button>
                );
              })}
            </nav>
          </div>

          <div className="space-y-3">
            <div className="rounded-2xl border border-emerald-200/70 bg-emerald-50/70 p-3 text-[11px] leading-relaxed text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300">
              <div className="flex items-center gap-1.5 font-bold">
                <ShieldCheck className="h-3.5 w-3.5" />
                浏览器本地加密 · 零留存
              </div>
              <p className="mt-1 opacity-85">
                密码在浏览器本地 AES-128 加密，服务器全程零明文密码，同步完自动注销。
              </p>
            </div>
            <button
              onClick={() => setSyncOpen(true)}
              className="skin-bg-gradient flex w-full items-center justify-center gap-2 rounded-2xl py-2.5 text-xs font-bold text-white shadow-lg active:scale-[0.97]"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              教务无痕同步
            </button>
          </div>
        </aside>

        {/* Main Content */}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200/80 bg-white/85 px-4 py-3 backdrop-blur-xl transition-colors duration-300 dark:border-slate-800/80 dark:bg-slate-900/85 md:px-8">
            <div className="flex items-center gap-2.5">
              <div className="skin-bg-gradient flex h-8 w-8 items-center justify-center rounded-xl text-white md:hidden">
                <Waves className="h-4 w-4" />
              </div>
              <div>
                <h1 className="text-base font-extrabold text-slate-900 dark:text-white md:text-lg">
                  {NAV_ITEMS.find((i) => i.key === activeTab)?.label}
                </h1>
                <p className="hidden text-xs text-slate-400 sm:block">
                  广东海洋大学 · 正方教务（支持免校园网直连与 PWA 离线使用）
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => updateSettings({ darkMode: !data.settings.darkMode })}
                className="rounded-xl border border-slate-200 bg-white p-2 text-slate-600 transition-all duration-150 hover:bg-slate-100 active:scale-95 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                aria-label="切换深色模式"
              >
                {data.settings.darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </button>
              <button
                onClick={() => setSyncOpen(true)}
                className="skin-bg-primary inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold text-white shadow-sm active:scale-95"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                教务同步
              </button>
            </div>
          </header>

          <main className="flex-1 p-3 sm:p-4 md:p-8">
            <div key={activeTab} className="animate-tab-enter">
              {activeTab === 'schedule' && (
                <ScheduleView
                  courses={data.courses}
                  exams={data.exams}
                  courseTodos={data.courseTodos}
                  coupleSchedule={data.coupleSchedule}
                  settings={data.settings}
                  termLabel={data.termLabel}
                  onOpenSync={() => setSyncOpen(true)}
                  onToggleNonCurrentWeek={() =>
                    updateSettings({
                      showNonCurrentWeekCourses: !data.settings.showNonCurrentWeekCourses,
                    })
                  }
                  onCalibrateCurrentWeek={(w) => {
                    handleCalibrateCurrentWeek(w);
                    showToast(`已校准为第 ${w} 周`);
                  }}
                  onAddManualCourse={handleAddManualCourse}
                  onDeleteCourse={handleDeleteCourse}
                  onAddTodo={handleAddTodo}
                  onToggleTodo={handleToggleTodo}
                  onDeleteTodo={handleDeleteTodo}
                  onSaveCoupleSchedule={handleSaveCoupleSchedule}
                />
              )}

              {activeTab === 'exams' && (
                <ExamsView
                  exams={data.exams}
                  courses={data.courses}
                  settings={data.settings}
                  onAddManualExam={handleAddManualExam}
                  onDeleteExam={handleDeleteExam}
                />
              )}

              {activeTab === 'grades' && (
                <GradesView
                  grades={data.grades}
                  graduationCreditTarget={data.settings.graduationCreditTarget}
                  onUpdateGraduationTarget={(target) =>
                    updateSettings({ graduationCreditTarget: target })
                  }
                />
              )}

              {activeTab === 'campus' && (
                <CampusView
                  emptyRooms={data.emptyRooms}
                  courseTodos={data.courseTodos}
                  onToggleTodo={handleToggleTodo}
                  onDeleteTodo={handleDeleteTodo}
                  onOpenSync={() => setSyncOpen(true)}
                />
              )}

              {activeTab === 'settings' && (
                <SettingsView
                  data={data}
                  onUpdateSettings={updateSettings}
                  onLoadSample={() => {
                    setData(createSampleAppData());
                    showToast('已加载海大示例数据');
                  }}
                  onImportJson={(imported) => {
                    setData(imported);
                    showToast('已恢复 JSON 备份数据');
                  }}
                  onClearAll={handleClearAll}
                />
              )}
            </div>
          </main>
        </div>
      </div>

      {/* Mobile Bottom Tab Bar (5 tabs) */}
      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-slate-200/90 bg-white/95 py-1.5 backdrop-blur-xl transition-colors duration-300 dark:border-slate-800 dark:bg-slate-900/95 md:hidden">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = activeTab === item.key;
          return (
            <button
              key={item.key}
              onClick={() => setActiveTab(item.key)}
              className={`flex flex-col items-center justify-center gap-0.5 py-1 text-[10.5px] font-semibold transition-all duration-150 active:scale-90 ${
                active ? 'skin-text-primary' : 'text-slate-400'
              }`}
            >
              <Icon className={`h-5 w-5 transition-transform duration-200 ${active ? 'scale-110' : ''}`} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Zero-Retention Sync Modal */}
      <SyncModal
        isOpen={syncOpen}
        onClose={() => setSyncOpen(false)}
        onSyncCompleted={handleSyncCompleted}
      />
    </div>
  );
}
