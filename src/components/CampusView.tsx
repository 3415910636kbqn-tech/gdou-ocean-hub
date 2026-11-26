import React, { useMemo, useState } from 'react';
import {
  BookOpen,
  Building2,
  CheckSquare,
  Compass,
  DoorOpen,
  ExternalLink,
  RefreshCw,
  Search,
  Square,
  StickyNote,
  Trash2,
} from 'lucide-react';
import type { CourseTodoItem, EmptyRoomItem } from '../../shared/models';

interface CampusViewProps {
  emptyRooms: EmptyRoomItem[];
  courseTodos: CourseTodoItem[];
  onToggleTodo: (id: string) => void;
  onDeleteTodo: (id: string) => void;
  onOpenSync: () => void;
}

const SLOTS = ['1-2节', '3-4节', '5-6节', '7-8节', '9-10节'] as const;

const OFFICIAL_LINKS = [
  {
    title: '正方教务系统（校内外自动路由）',
    desc: '自动判断校园网或校外微门户进入选课/评教/查分',
    url: 'https://netcheck.gdou.edu.cn/go.php?code=jw',
    badge: '常用',
  },
  {
    title: '海大校外微门户 (WebVPN)',
    desc: '无需买校园网，校外访问校内各类系统的官方入口',
    url: 'https://wfw.gdou.edu.cn/',
    badge: '免校园网',
  },
  {
    title: '海大网上办事大厅',
    desc: '请假、证明开具、学籍服务与一站式校园事务',
    url: 'https://ehall.gdou.edu.cn/',
    badge: '官方',
  },
  {
    title: '广东海洋大学图书馆',
    desc: '馆藏检索、座位预约、知网/论文数据库入口',
    url: 'https://lib.gdou.edu.cn/',
    badge: '学习',
  },
  {
    title: '广东海洋大学教务处官网',
    desc: '最新校历公告、四六级报名、考试与选课通知',
    url: 'https://jwc.gdou.edu.cn/',
    badge: '通知',
  },
  {
    title: '海大统一身份认证自助服务',
    desc: '忘记密码找回、绑定手机号与企业微信多因子设置',
    url: 'https://authserver.gdou.edu.cn/authserver/login',
    badge: '账号',
  },
];

export const CampusView: React.FC<CampusViewProps> = ({
  emptyRooms,
  courseTodos,
  onToggleTodo,
  onDeleteTodo,
  onOpenSync,
}) => {
  const [selectedSlot, setSelectedSlot] = useState<string>('1-2节');
  const [selectedBuilding, setSelectedBuilding] = useState<string>('all');
  const [roomSearch, setRoomSearch] = useState('');

  const buildings = useMemo(() => {
    const set = new Set(emptyRooms.map((r) => r.building));
    return Array.from(set).sort();
  }, [emptyRooms]);

  const filteredRooms = useMemo(() => {
    const kw = roomSearch.trim().toLowerCase();
    return emptyRooms.filter((r) => {
      if (r.slotLabel !== selectedSlot) return false;
      if (selectedBuilding !== 'all' && r.building !== selectedBuilding) return false;
      if (kw && !r.name.toLowerCase().includes(kw) && !r.building.toLowerCase().includes(kw)) {
        return false;
      }
      return true;
    });
  }, [emptyRooms, selectedSlot, selectedBuilding, roomSearch]);

  const roomDate = emptyRooms[0]?.dateText ?? '';
  const pendingTodos = courseTodos.filter((t) => !t.done);
  const doneTodos = courseTodos.filter((t) => t.done);

  return (
    <div className="space-y-5">
      {/* Empty Classroom Finder */}
      <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-base font-bold text-slate-900 dark:text-white">
              <DoorOpen className="h-5 w-5 text-sky-500" />
              海大今日空教室速查
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              {roomDate
                ? `已缓存 ${roomDate} 教务空教室数据（共 ${emptyRooms.length} 条），离线可查`
                : '同步教务时会自动顺带拉取今日各教学楼空闲教室，自习不再白跑一趟'}
            </p>
          </div>
          <button
            onClick={onOpenSync}
            className="inline-flex items-center gap-1.5 rounded-xl bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-700 transition hover:bg-sky-100 dark:bg-sky-950/60 dark:text-sky-300"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            刷新今日空教室
          </button>
        </div>

        {emptyRooms.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 p-8 text-center dark:border-slate-800 dark:bg-slate-800/30">
            <Building2 className="mx-auto h-8 w-8 text-slate-400" />
            <p className="mt-2 text-xs font-medium text-slate-600 dark:text-slate-300">
              暂未拉取今日空教室数据
            </p>
            <p className="mt-1 text-[11px] text-slate-400">
              点击右上角「教务同步」即可自动获取今日 1–10 节钟海楼、广学楼、博文楼、主楼等空闲教室
            </p>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {/* Slot tabs */}
            <div className="flex flex-wrap gap-1.5">
              {SLOTS.map((slot) => {
                const cnt = emptyRooms.filter((r) => r.slotLabel === slot).length;
                return (
                  <button
                    key={slot}
                    onClick={() => setSelectedSlot(slot)}
                    className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                      selectedSlot === slot
                        ? 'bg-sky-600 text-white shadow-xs'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
                    }`}
                  >
                    {slot} ({cnt})
                  </button>
                );
              })}
            </div>

            {/* Building filter + Search */}
            <div className="flex flex-wrap gap-2">
              <select
                value={selectedBuilding}
                onChange={(e) => setSelectedBuilding(e.target.value)}
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium dark:border-slate-700 dark:bg-slate-800"
              >
                <option value="all">全部教学楼 ({buildings.length})</option>
                {buildings.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
              <div className="relative min-w-[180px] flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  value={roomSearch}
                  onChange={(e) => setRoomSearch(e.target.value)}
                  placeholder="搜教室号，如 02018 / 广学..."
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-3 text-xs outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-800"
                />
              </div>
            </div>

            {/* Room Grid */}
            {filteredRooms.length === 0 ? (
              <div className="rounded-xl bg-slate-50 py-8 text-center text-xs text-slate-400 dark:bg-slate-800/50">
                当前时段 / 教学楼没有匹配的空闲教室
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                {filteredRooms.slice(0, 60).map((r) => (
                  <div
                    key={r.id}
                    className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-2.5 dark:border-slate-800 dark:bg-slate-800/50"
                  >
                    <div className="truncate text-xs font-bold text-slate-800 dark:text-slate-100">
                      {r.name}
                    </div>
                    <div className="mt-0.5 flex items-center justify-between text-[10.5px] text-slate-400">
                      <span className="truncate">{r.roomType}</span>
                      {r.seats > 0 && <span className="shrink-0">{r.seats}座</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Course Homework / Lab DDL Summary */}
      <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-bold text-slate-900 dark:text-white">
            <StickyNote className="h-5 w-5 text-amber-500" />
            全部课程作业 / 实验 DDL ({pendingTodos.length} 待完成)
          </h2>
          <span className="text-[11px] text-slate-400">在课表点任意课程即可添加新提醒</span>
        </div>

        {courseTodos.length === 0 ? (
          <p className="mt-3 text-xs text-slate-400">
            还没有记任何作业提醒。去「课表」里点开任意一门课，就能随时记录交作业/带实验报告的 DDL，课表格子上会自动亮起提醒角标！
          </p>
        ) : (
          <div className="mt-3 space-y-2">
            {[...pendingTodos, ...doneTodos].map((t) => (
              <div
                key={t.id}
                className="flex items-center justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-800/50"
              >
                <button
                  onClick={() => onToggleTodo(t.id)}
                  className="flex flex-1 items-center gap-2.5 text-left"
                >
                  {t.done ? (
                    <CheckSquare className="h-4 w-4 shrink-0 text-emerald-500" />
                  ) : (
                    <Square className="h-4 w-4 shrink-0 text-amber-500" />
                  )}
                  <div>
                    <span className="mr-2 rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-bold text-sky-700 dark:bg-sky-950 dark:text-sky-300">
                      {t.courseName}
                    </span>
                    <span className={t.done ? 'text-slate-400 line-through' : 'font-medium text-slate-800 dark:text-slate-100'}>
                      {t.content}
                    </span>
                    {t.dueDate && (
                      <span className="ml-2 text-[10.5px] font-semibold text-amber-600 dark:text-amber-400">
                        截止 {t.dueDate}
                      </span>
                    )}
                  </div>
                </button>
                <button
                  onClick={() => onDeleteTodo(t.id)}
                  className="text-slate-400 hover:text-rose-500"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Official GDOU Quick Links */}
      <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <h2 className="flex items-center gap-2 text-base font-bold text-slate-900 dark:text-white">
          <Compass className="h-5 w-5 text-indigo-500" />
          海大官方常用直达入口
        </h2>
        <p className="mt-0.5 text-xs text-slate-400">
          纯官网快捷导航，直接跳转至广东海洋大学官方域名（*.gdou.edu.cn）
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {OFFICIAL_LINKS.map((item) => (
            <a
              key={item.url}
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex flex-col justify-between rounded-2xl border border-slate-200/80 bg-slate-50/50 p-3.5 transition hover:-translate-y-0.5 hover:border-sky-300 hover:bg-sky-50/50 hover:shadow-sm dark:border-slate-800 dark:bg-slate-800/40 dark:hover:border-sky-700"
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-900 group-hover:text-sky-700 dark:text-white dark:group-hover:text-sky-300">
                    <BookOpen className="h-3.5 w-3.5 text-sky-500" />
                    {item.title}
                  </span>
                  <span className="shrink-0 rounded-md bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700 dark:bg-sky-950 dark:text-sky-300">
                    {item.badge}
                  </span>
                </div>
                <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                  {item.desc}
                </p>
              </div>
              <div className="mt-2.5 flex items-center gap-1 text-[11px] font-semibold text-sky-600 dark:text-sky-400">
                打开官网
                <ExternalLink className="h-3 w-3" />
              </div>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
};
