import {
  CourseItem,
  CreditCategorySummary,
  EmptyRoomItem,
  ExamItem,
  GpaSummary,
  GradeItem,
  PeriodTime,
  ScoreTierBucket,
  TermGradeBreakdown,
} from './models';

const PALETTE_COUNT = 8;

function stableColorIndex(courseName: string): number {
  let hash = 0;
  for (let i = 0; i < courseName.length; i++) {
    hash = (hash * 31 + courseName.charCodeAt(i)) >>> 0;
  }
  return hash % PALETTE_COUNT;
}

export function parseWeekExpression(zcd: string): number[] {
  if (!zcd) return [];
  const normalized = zcd
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/，/g, ',')
    .replace(/、/g, ',')
    .replace(/第/g, '')
    .trim();

  const weeks = new Set<number>();
  const segments = normalized
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  for (const seg of segments) {
    const isOdd = seg.includes('单');
    const isEven = seg.includes('双');
    const cleaned = seg.replace(/周|\(\s*[单双]\s*\)|[单双]/g, '').trim();

    const rangeMatch = cleaned.match(/^(\d+)\s*[-~至]\s*(\d+)$/);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10);
      const end = parseInt(rangeMatch[2], 10);
      if (Number.isFinite(start) && Number.isFinite(end) && start <= end) {
        for (let w = start; w <= end; w++) {
          if (isOdd && w % 2 === 0) continue;
          if (isEven && w % 2 !== 0) continue;
          if (w >= 1 && w <= 30) weeks.add(w);
        }
      }
      continue;
    }

    const singleMatch = cleaned.match(/^(\d+)$/);
    if (singleMatch) {
      const w = parseInt(singleMatch[1], 10);
      if (w >= 1 && w <= 30) weeks.add(w);
    }
  }

  return Array.from(weeks).sort((a, b) => a - b);
}

export function parseSectionRange(
  jc?: string,
  jcs?: string,
  jcor?: string,
  oldjc?: string | number
): { startSection: number; endSection: number } | null {
  const candidates = [jcs, jc, jcor].filter((v): v is string => Boolean(v && String(v).trim()));
  for (const raw of candidates) {
    const cleaned = String(raw).replace(/节|第/g, '').trim();
    const rangeMatch = cleaned.match(/(\d+)\s*[-~至]\s*(\d+)/);
    if (rangeMatch) {
      const s = parseInt(rangeMatch[1], 10);
      const e = parseInt(rangeMatch[2], 10);
      if (s >= 1 && e >= s && e <= 16) return { startSection: s, endSection: e };
    }
    if (cleaned.includes(',')) {
      const nums = cleaned
        .split(',')
        .map((n) => parseInt(n.trim(), 10))
        .filter((n) => Number.isFinite(n) && n >= 1 && n <= 16);
      if (nums.length > 0) {
        return { startSection: Math.min(...nums), endSection: Math.max(...nums) };
      }
    }
    const singleMatch = cleaned.match(/^(\d+)$/);
    if (singleMatch) {
      const s = parseInt(singleMatch[1], 10);
      if (s >= 1 && s <= 16) return { startSection: s, endSection: s };
    }
  }

  const mask = parseInt(String(oldjc ?? '').trim(), 10);
  if (Number.isFinite(mask) && mask > 0 && mask < 1 << 16) {
    let first = 0;
    let last = 0;
    for (let sec = 1; sec <= 16; sec++) {
      if ((mask & (1 << (sec - 1))) !== 0) {
        if (!first) first = sec;
        last = sec;
      }
    }
    if (first >= 1 && last >= first) return { startSection: first, endSection: last };
  }
  return null;
}

function normalizeTimeToken(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  const m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h < 0 || h > 23 || min < 0 || min > 59) {
    return null;
  }
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

export function parseZfPeriodTimesResponse(raw: unknown): PeriodTime[] {
  let rows: Record<string, unknown>[] = [];
  if (Array.isArray(raw)) {
    rows = raw as Record<string, unknown>[];
  } else if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const candidate = obj.items ?? obj.rows ?? obj.rjcList ?? obj.sjdList ?? obj.data ?? obj.list;
    if (Array.isArray(candidate)) rows = candidate as Record<string, unknown>[];
  }
  if (rows.length === 0) return [];

  const bySection = new Map<number, PeriodTime>();
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const secRaw = row.jcdm ?? row.jcbh ?? row.jc ?? row.jcmc ?? row.xh;
    const secMatch = String(secRaw ?? '').match(/(\d+)/);
    if (!secMatch) continue;
    const section = parseInt(secMatch[1], 10);
    if (!Number.isFinite(section) || section < 1 || section > 16) continue;

    let start = normalizeTimeToken(row.qssj ?? row.kssj);
    let end = normalizeTimeToken(row.jssj ?? row.xksj);
    if (!start || !end) {
      const combined = String(row.sj ?? row.qzsj ?? row.sksj ?? '').trim();
      const rangeMatch = combined.match(
        /(\d{1,2}:\d{2})(?::\d{2})?\s*[-~至—–]\s*(\d{1,2}:\d{2})(?::\d{2})?/
      );
      if (rangeMatch) {
        start = normalizeTimeToken(rangeMatch[1]);
        end = normalizeTimeToken(rangeMatch[2]);
      }
    }
    if (!start || !end || start >= end) continue;
    bySection.set(section, { section, start, end });
  }
  return Array.from(bySection.values()).sort((a, b) => a.section - b.section);
}

export function parseDayOfWeek(xqj: unknown): number | null {
  const str = String(xqj ?? '').trim();
  if (!str) return null;
  if (/^[1-7]$/.test(str)) return parseInt(str, 10);
  const map: Record<string, number> = {
    星期一: 1, 周一: 1, 一: 1,
    星期二: 2, 周二: 2, 二: 2,
    星期三: 3, 周三: 3, 三: 3,
    星期四: 4, 周四: 4, 四: 4,
    星期五: 5, 周五: 5, 五: 5,
    星期六: 6, 周六: 6, 六: 6,
    星期日: 7, 星期天: 7, 周日: 7, 周天: 7, 日: 7, 天: 7,
  };
  return map[str] ?? null;
}

export function parseZfScheduleResponse(raw: unknown): {
  courses: CourseItem[];
  termLabel?: string;
  campusId?: string;
  campusName?: string;
  warnings: string[];
} {
  if (!raw || typeof raw !== 'object') return { courses: [], warnings: [] };
  const obj = raw as Record<string, unknown>;
  const kbList = Array.isArray(obj.kbList) ? (obj.kbList as Record<string, unknown>[]) : [];

  const seen = new Set<string>();
  const courses: CourseItem[] = [];
  const warnings: string[] = [];
  let campusId: string | undefined;
  let campusName: string | undefined;

  for (let idx = 0; idx < kbList.length; idx++) {
    const item = kbList[idx];
    const name = String(item.kcmc ?? '').trim();
    if (!name) continue;

    if (!campusId && item.xqh_id) campusId = String(item.xqh_id).trim() || undefined;
    if (!campusName && item.xqmc) campusName = String(item.xqmc).trim() || undefined;

    const dayOfWeek = parseDayOfWeek(item.xqj ?? item.xqjmc);
    const sectionRange = parseSectionRange(
      item.jc as string | undefined,
      item.jcs as string | undefined,
      item.jcor as string | undefined,
      item.oldjc as string | number | undefined
    );
    const weekText = String(item.zcd ?? '').trim();
    const weeks = parseWeekExpression(weekText);
    const location = String(item.cdmc ?? item.jgmc ?? '待定教室').trim();
    const teacher = String(item.xm ?? '待定教师').trim();
    const code = String(item.kch ?? item.kch_id ?? '').trim();
    const campus = String(item.xqmc ?? '').trim();
    const credit = String(item.xf ?? '').trim();
    const classGroup = String(item.jxbmc ?? item.skbj ?? '').trim();

    const missingParts: string[] = [];
    if (dayOfWeek === null) missingParts.push(`星期(${String(item.xqj ?? item.xqjmc ?? '空')})`);
    if (sectionRange === null) missingParts.push(`节次(${String(item.jcs ?? item.jc ?? item.jcor ?? '空')})`);
    if (weeks.length === 0) missingParts.push(`周次(${weekText || '空'})`);

    const parseWarning =
      missingParts.length > 0 ? `时间字段未解析：${missingParts.join('、')}` : undefined;
    if (parseWarning) warnings.push(`《${name}》${parseWarning}`);

    const effDay = dayOfWeek ?? 0;
    const effStart = sectionRange?.startSection ?? 0;
    const effEnd = sectionRange?.endSection ?? 0;

    const dedupKey = `${name}|${effDay}|${effStart}-${effEnd}|${weekText}|${location}|${teacher}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);

    if (!parseWarning && effDay >= 1 && effStart >= 1 && weeks.length > 0) {
      const mergeTarget = courses.find(
        (existing) =>
          !existing.parseWarning &&
          existing.name === name &&
          existing.code === code &&
          existing.dayOfWeek === effDay &&
          existing.startSection === effStart &&
          existing.endSection === effEnd &&
          existing.location === location &&
          existing.teacher === teacher
      );
      if (mergeTarget) {
        mergeTarget.weeks = Array.from(new Set([...mergeTarget.weeks, ...weeks])).sort((a, b) => a - b);
        if (weekText && !mergeTarget.weekText.includes(weekText)) {
          mergeTarget.weekText = `${mergeTarget.weekText},${weekText}`;
        }
        continue;
      }
    }

    courses.push({
      id: `c-${code || stableColorIndex(name)}-${effDay}-${effStart}-${effEnd}-${idx}`,
      name,
      code,
      teacher,
      location,
      campus,
      dayOfWeek: effDay,
      startSection: effStart,
      endSection: effEnd,
      weeks,
      weekText: weekText || '周次待定',
      credit,
      classGroup,
      colorIndex: stableColorIndex(name),
      parseWarning,
    });
  }

  let termLabel: string | undefined;
  const xsxx = obj.xsxx as Record<string, unknown> | undefined;
  if (xsxx && xsxx.XNMC && xsxx.XQMMC) {
    termLabel = `${String(xsxx.XNMC)}学年 第${String(xsxx.XQMMC)}学期`;
  }

  courses.sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startSection - b.startSection);
  return { courses, termLabel, campusId, campusName, warnings };
}

export function parseLocalDateStrict(ymd: string): Date | null {
  const m = String(ymd ?? '').trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const day = parseInt(m[3], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(year, month - 1, day, 0, 0, 0, 0);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return d;
}

export function computeTermWeek(termStartDate: string, now: Date = new Date()): number {
  const start = parseLocalDateStrict(termStartDate);
  if (!start) return 1;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const diffDays = Math.floor((today.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
  if (diffDays < 0) return 1;
  return Math.floor(diffDays / 7) + 1;
}

export function getDateForWeekAndDay(termStartDate: string, week: number, dayOfWeek: number): Date {
  const base = parseLocalDateStrict(termStartDate) ?? new Date();
  const out = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  out.setDate(out.getDate() + (week - 1) * 7 + (dayOfWeek - 1));
  return out;
}

export function getCourseTimeSpan(
  course: CourseItem,
  periods: PeriodTime[]
): { startText: string; endText: string } {
  const startPeriod =
    periods.find((p) => p.section === course.startSection) ??
    periods[Math.max(0, Math.min(periods.length - 1, course.startSection - 1))];
  const endPeriod =
    periods.find((p) => p.section === course.endSection) ??
    periods[Math.max(0, Math.min(periods.length - 1, course.endSection - 1))];
  return {
    startText: startPeriod?.start ?? '08:10',
    endText: endPeriod?.end ?? '09:45',
  };
}

export function getTodayDayOfWeek(now: Date = new Date()): number {
  const d = now.getDay();
  return d === 0 ? 7 : d;
}

// ==================== EXAM PARSER ====================

function isValidYmd(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

function isValidHm(hhmm: string): boolean {
  const m = hhmm.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return false;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  return h >= 0 && h <= 23 && min >= 0 && min <= 59;
}

function padTime(hhmm: string): string {
  const [h, m] = hhmm.split(':');
  return `${String(h || '00').padStart(2, '0')}:${String(m || '00').padStart(2, '0')}`;
}

export function parseExamDateTime(kssj?: string, ksrq?: string, qzsj?: string) {
  const combined = `${kssj ?? ''} ${ksrq ?? ''} ${qzsj ?? ''}`
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/年|月/g, '-')
    .replace(/日/g, ' ')
    .trim();

  const dateMatch = combined.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  const timeMatch = combined.match(/(\d{1,2}:\d{2})\s*[-~至]\s*(\d{1,2}:\d{2})/);

  let dateText = '';
  if (dateMatch) {
    const y = parseInt(dateMatch[1], 10);
    const m = parseInt(dateMatch[2], 10);
    const d = parseInt(dateMatch[3], 10);
    if (isValidYmd(y, m, d)) {
      dateText = `${dateMatch[1]}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  const startTimeText = timeMatch && isValidHm(timeMatch[1]) ? padTime(timeMatch[1]) : '';
  const endTimeText = timeMatch && isValidHm(timeMatch[2]) ? padTime(timeMatch[2]) : '';
  const startIso = dateText && startTimeText ? `${dateText}T${startTimeText}:00` : null;
  const endIso = dateText && endTimeText ? `${dateText}T${endTimeText}:00` : null;

  return { dateText, startTimeText, endTimeText, startIso, endIso };
}

export function parseExamIsoLocal(iso: string): Date {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return new Date(iso);
  return new Date(
    parseInt(m[1], 10),
    parseInt(m[2], 10) - 1,
    parseInt(m[3], 10),
    parseInt(m[4], 10),
    parseInt(m[5], 10),
    0,
    0
  );
}

export function parseZfExamResponse(raw: unknown): ExamItem[] {
  if (!raw || typeof raw !== 'object') return [];
  const obj = raw as Record<string, unknown>;
  const list = Array.isArray(obj.items)
    ? (obj.items as Record<string, unknown>[])
    : Array.isArray(obj.rows)
      ? (obj.rows as Record<string, unknown>[])
      : Array.isArray(raw)
        ? (raw as Record<string, unknown>[])
        : [];

  const seen = new Set<string>();
  const exams: ExamItem[] = [];

  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    const courseName = String(item.kcmc ?? '').trim();
    if (!courseName) continue;

    const kssjClean = String(item.kssj ?? '').trim();
    const fallbackCombined = [item.ksrq, item.qzsj]
      .map((v) => String(v ?? '').trim())
      .filter(Boolean)
      .join(' ');
    const { dateText, startTimeText, endTimeText, startIso, endIso } = parseExamDateTime(
      kssjClean || undefined,
      item.ksrq as string | undefined,
      item.qzsj as string | undefined
    );
    const derivedFormatted =
      dateText && startTimeText && endTimeText
        ? `${dateText}(${startTimeText}-${endTimeText})`
        : dateText;
    const rawTimeText = kssjClean || fallbackCombined || derivedFormatted;

    const location = String(item.cdmc ?? item.jsmc ?? item.ksdd ?? '考场待公布').trim();
    const seatNumber = String(item.zwh ?? item.jsz ?? '').trim();
    const examType =
      [item.ksfs, item.ksxzmc].map((v) => String(v ?? '').trim()).filter(Boolean).join(' · ') ||
      String(item.ksmc ?? '期末考试').trim();
    const courseCode = String(item.kch ?? item.kch_id ?? '').trim();
    const campus = String(item.cdxqmc ?? item.xqmc ?? '').trim();
    const invigilator = String(item.jklsmc ?? item.xm ?? '').trim();

    const dedup = `${courseName}|${rawTimeText}|${location}|${seatNumber}`;
    if (seen.has(dedup)) continue;
    seen.add(dedup);

    exams.push({
      id: `exam-${courseCode || courseName}-${dateText || i}-${i}`,
      courseName,
      courseCode,
      examType,
      dateText,
      startTimeText,
      endTimeText,
      startIso,
      endIso,
      rawTimeText: rawTimeText || '时间待公布',
      location,
      seatNumber,
      campus,
      invigilator,
    });
  }

  exams.sort((a, b) => {
    const ta = a.startIso ? parseExamIsoLocal(a.startIso).getTime() : Number.MAX_SAFE_INTEGER;
    const tb = b.startIso ? parseExamIsoLocal(b.startIso).getTime() : Number.MAX_SAFE_INTEGER;
    return ta - tb;
  });

  return exams;
}

export function getExamCountdown(
  exam: ExamItem,
  now: Date = new Date()
): { status: 'upcoming' | 'today' | 'past' | 'tbd'; daysLeft: number; label: string } {
  if (!exam.startIso) return { status: 'tbd', daysLeft: 999, label: '时间待定' };
  const examStart = parseExamIsoLocal(exam.startIso);
  const examEnd = exam.endIso
    ? parseExamIsoLocal(exam.endIso)
    : new Date(examStart.getTime() + 2 * 3600 * 1000);

  if (now.getTime() > examEnd.getTime()) {
    return { status: 'past', daysLeft: -1, label: '已结束' };
  }
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const examMidnight = new Date(
    examStart.getFullYear(),
    examStart.getMonth(),
    examStart.getDate()
  ).getTime();
  const diffDays = Math.round((examMidnight - todayMidnight) / (24 * 60 * 60 * 1000));

  if (diffDays <= 0) return { status: 'today', daysLeft: 0, label: '今日考试' };
  if (diffDays === 1) return { status: 'upcoming', daysLeft: 1, label: '明天考试' };
  return { status: 'upcoming', daysLeft: diffDays, label: `还有 ${diffDays} 天` };
}

// ==================== GRADE & GPA PARSER ====================

const TEXT_SCORE_MAP: Record<string, { score: number; gpa: number; passed: boolean }> = {
  优秀: { score: 95, gpa: 4.5, passed: true },
  优: { score: 95, gpa: 4.5, passed: true },
  良好: { score: 85, gpa: 3.5, passed: true },
  良: { score: 85, gpa: 3.5, passed: true },
  中等: { score: 75, gpa: 2.5, passed: true },
  中: { score: 75, gpa: 2.5, passed: true },
  及格: { score: 65, gpa: 1.5, passed: true },
  合格: { score: 80, gpa: 3.0, passed: true },
  通过: { score: 80, gpa: 3.0, passed: true },
  免修: { score: 85, gpa: 3.5, passed: true },
  不及格: { score: 50, gpa: 0, passed: false },
  不合格: { score: 50, gpa: 0, passed: false },
  未通过: { score: 50, gpa: 0, passed: false },
  缺考: { score: 0, gpa: 0, passed: false },
  缓考: { score: 0, gpa: 0, passed: false },
};

export function scoreToGdouGpa(score: number): number {
  if (!Number.isFinite(score) || score < 60) return 0;
  if (score >= 100) return 5.0;
  return Math.round(((score - 50) / 10) * 100) / 100;
}

function normalizeSemester(xqm?: string, xqmmc?: string): string {
  const m = String(xqmmc ?? '').trim();
  if (m === '1' || m === '2' || m === '3') return m;
  const raw = String(xqm ?? '').trim();
  if (raw === '3') return '1';
  if (raw === '12') return '2';
  if (raw === '16') return '3';
  return m || raw || '1';
}

function normalizeAcademicYear(xnm?: string, xnmmc?: string): string {
  const m = String(xnmmc ?? '').trim();
  if (m && m.includes('-')) return m;
  const y = parseInt(String(xnm ?? '').trim(), 10);
  if (Number.isFinite(y) && y > 2000) return `${y}-${y + 1}`;
  return m || '当前学年';
}

export function parseZfGradesResponse(raw: unknown): GradeItem[] {
  if (!raw || typeof raw !== 'object') return [];
  const obj = raw as Record<string, unknown>;
  const list = Array.isArray(obj.items)
    ? (obj.items as Record<string, unknown>[])
    : Array.isArray(obj.rows)
      ? (obj.rows as Record<string, unknown>[])
      : Array.isArray(raw)
        ? (raw as Record<string, unknown>[])
        : [];

  const grades: GradeItem[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    const courseName = String(item.kcmc ?? '').trim();
    if (!courseName) continue;

    const courseCode = String(item.kch ?? item.kch_id ?? '').trim();
    const creditNum = parseFloat(String(item.xf ?? '0'));
    const credit = Number.isFinite(creditNum) && creditNum >= 0 ? creditNum : 0;

    const scoreText = String(item.cj ?? item.bfzcj ?? '').trim();
    const bfzNum = parseFloat(String(item.bfzcj ?? item.cj ?? ''));
    const mapped = TEXT_SCORE_MAP[scoreText];

    const scoreEstimated = !Number.isFinite(bfzNum) && Boolean(mapped);
    const numericScore = Number.isFinite(bfzNum) ? bfzNum : mapped ? mapped.score : null;

    const rawJd = parseFloat(String(item.jd ?? ''));
    let gpa = 0;
    let passed = false;
    let gpaEstimated = false;

    if (Number.isFinite(rawJd) && rawJd >= 0) {
      gpa = rawJd;
      passed = rawJd > 0 || (numericScore !== null && numericScore >= 60);
    } else if (mapped) {
      gpa = mapped.gpa;
      passed = mapped.passed;
      gpaEstimated = true;
    } else if (numericScore !== null) {
      gpa = scoreToGdouGpa(numericScore);
      passed = numericScore >= 60;
      gpaEstimated = true;
    }

    const academicYear = normalizeAcademicYear(
      item.xnm as string | undefined,
      item.xnmmc as string | undefined
    );
    const semester = normalizeSemester(
      item.xqm as string | undefined,
      item.xqmmc as string | undefined
    );
    const termKey = `${academicYear} 第${semester}学期`;
    const courseCategory = String(item.kcxzmc ?? item.kclbmc ?? '普通课程').trim();
    const examNature = String(item.ksxz ?? item.ksxzmc ?? '正常考试').trim();
    const teacher = String(item.jsxm ?? '').trim();

    const dedup = `${courseCode || courseName}|${termKey}|${examNature}|${scoreText}`;
    if (seen.has(dedup)) continue;
    seen.add(dedup);

    grades.push({
      id: `grade-${i}-${courseCode || courseName}-${termKey}`,
      courseName,
      courseCode,
      academicYear,
      semester,
      termKey,
      credit,
      scoreText: scoreText || '-',
      numericScore,
      gpa,
      gpaEstimated,
      scoreEstimated,
      courseCategory,
      examNature,
      teacher,
      passed,
    });
  }

  grades.sort((a, b) => b.termKey.localeCompare(a.termKey) || b.credit - a.credit);
  return grades;
}

function deduplicateBestAttempts(grades: GradeItem[]): GradeItem[] {
  const bestByCourse = new Map<string, GradeItem>();
  for (const g of grades) {
    const key = g.courseCode || g.courseName;
    const prev = bestByCourse.get(key);
    if (!prev || g.gpa > prev.gpa || (g.numericScore ?? 0) > (prev.numericScore ?? 0)) {
      bestByCourse.set(key, g);
    }
  }
  return Array.from(bestByCourse.values());
}

export function computeTermBreakdowns(grades: GradeItem[]): TermGradeBreakdown[] {
  const grouped = new Map<string, GradeItem[]>();
  for (const g of grades) {
    const key = g.termKey || `${g.academicYear} 第${g.semester}学期`;
    const list = grouped.get(key) ?? [];
    list.push(g);
    grouped.set(key, list);
  }

  const breakdowns: TermGradeBreakdown[] = [];
  for (const [termKey, items] of grouped.entries()) {
    const effective = deduplicateBestAttempts(items);
    let creditsEarned = 0;
    let creditsAttempted = 0;
    let passedCount = 0;
    let failedCount = 0;
    let gpaSum = 0;
    let gpaDenom = 0;
    let scoreSum = 0;
    let scoreDenom = 0;

    for (const g of effective) {
      creditsAttempted += g.credit;
      if (g.passed) {
        creditsEarned += g.credit;
        passedCount++;
      } else {
        failedCount++;
      }
      if (g.credit > 0) {
        gpaSum += g.gpa * g.credit;
        gpaDenom += g.credit;
        if (g.numericScore !== null) {
          scoreSum += g.numericScore * g.credit;
          scoreDenom += g.credit;
        }
      }
    }

    breakdowns.push({
      termKey,
      academicYear: items[0]?.academicYear || '',
      semester: items[0]?.semester || '',
      coursesCount: effective.length,
      passedCount,
      failedCount,
      creditsEarned: Math.round(creditsEarned * 100) / 100,
      creditsAttempted: Math.round(creditsAttempted * 100) / 100,
      weightedGpa: gpaDenom > 0 ? Math.round((gpaSum / gpaDenom) * 100) / 100 : 0,
      weightedAvgScore: scoreDenom > 0 ? Math.round((scoreSum / scoreDenom) * 100) / 100 : 0,
    });
  }

  breakdowns.sort((a, b) => a.termKey.localeCompare(b.termKey));
  return breakdowns;
}

export function computeScoreDistribution(effectiveGrades: GradeItem[]): ScoreTierBucket[] {
  const buckets: ScoreTierBucket[] = [
    { key: 'excellent', label: '优秀', rangeText: '90-100', count: 0, credits: 0, ratio: 0 },
    { key: 'good', label: '良好', rangeText: '80-89', count: 0, credits: 0, ratio: 0 },
    { key: 'medium', label: '中等', rangeText: '70-79', count: 0, credits: 0, ratio: 0 },
    { key: 'pass', label: '及格', rangeText: '60-69', count: 0, credits: 0, ratio: 0 },
    { key: 'fail', label: '未通过', rangeText: '<60', count: 0, credits: 0, ratio: 0 },
  ];

  for (const g of effectiveGrades) {
    let idx = 4;
    if (!g.passed) idx = 4;
    else if ((g.numericScore !== null && g.numericScore >= 90) || g.gpa >= 4.0) idx = 0;
    else if ((g.numericScore !== null && g.numericScore >= 80) || g.gpa >= 3.0) idx = 1;
    else if ((g.numericScore !== null && g.numericScore >= 70) || g.gpa >= 2.0) idx = 2;
    else idx = 3;

    buckets[idx].count += 1;
    buckets[idx].credits = Math.round((buckets[idx].credits + g.credit) * 100) / 100;
  }

  const total = effectiveGrades.length;
  if (total > 0) {
    for (const b of buckets) {
      b.ratio = Math.round((b.count / total) * 1000) / 1000;
    }
  }
  return buckets;
}

export function computeGpaSummary(grades: GradeItem[]): GpaSummary {
  if (grades.length === 0) {
    return {
      totalCreditsEarned: 0,
      totalCreditsAttempted: 0,
      weightedGpa: 0,
      requiredGpa: 0,
      weightedAvgScore: 0,
      totalCourses: 0,
      passedCourses: 0,
      failedCourses: 0,
      passRate: 0,
      hasEstimatedItems: false,
      byCategory: [],
      byTerm: [],
      scoreDistribution: computeScoreDistribution([]),
    };
  }

  const effective = deduplicateBestAttempts(grades);
  let totalCreditsEarned = 0;
  let totalCreditsAttempted = 0;
  let weightedGpaSum = 0;
  let gpaCreditsDenom = 0;
  let reqGpaSum = 0;
  let reqCreditsDenom = 0;
  let weightedScoreSum = 0;
  let scoreCreditsDenom = 0;
  let passedCourses = 0;
  let failedCourses = 0;
  let hasEstimatedItems = false;

  const catMap = new Map<string, { credits: number; attemptedCredits: number; count: number }>();

  for (const g of effective) {
    if (g.gpaEstimated || g.scoreEstimated) hasEstimatedItems = true;
    totalCreditsAttempted += g.credit;

    const prevCat = catMap.get(g.courseCategory) ?? { credits: 0, attemptedCredits: 0, count: 0 };
    prevCat.attemptedCredits = Math.round((prevCat.attemptedCredits + g.credit) * 100) / 100;
    prevCat.count += 1;

    if (g.passed) {
      totalCreditsEarned += g.credit;
      passedCourses++;
      prevCat.credits = Math.round((prevCat.credits + g.credit) * 100) / 100;
    } else {
      failedCourses++;
    }
    catMap.set(g.courseCategory, prevCat);

    if (g.credit > 0) {
      weightedGpaSum += g.gpa * g.credit;
      gpaCreditsDenom += g.credit;
      if (g.courseCategory.includes('必修')) {
        reqGpaSum += g.gpa * g.credit;
        reqCreditsDenom += g.credit;
      }
      if (g.numericScore !== null) {
        weightedScoreSum += g.numericScore * g.credit;
        scoreCreditsDenom += g.credit;
      }
    }
  }

  const roundedEarned = Math.round(totalCreditsEarned * 100) / 100;
  const byCategory: CreditCategorySummary[] = Array.from(catMap.entries())
    .map(([category, v]) => ({
      category,
      credits: v.credits,
      attemptedCredits: v.attemptedCredits,
      count: v.count,
      share: roundedEarned > 0 ? Math.round((v.credits / roundedEarned) * 1000) / 1000 : 0,
    }))
    .sort((a, b) => b.credits - a.credits || b.attemptedCredits - a.attemptedCredits);

  return {
    totalCreditsEarned: roundedEarned,
    totalCreditsAttempted: Math.round(totalCreditsAttempted * 100) / 100,
    weightedGpa: gpaCreditsDenom > 0 ? Math.round((weightedGpaSum / gpaCreditsDenom) * 100) / 100 : 0,
    requiredGpa:
      reqCreditsDenom > 0
        ? Math.round((reqGpaSum / reqCreditsDenom) * 100) / 100
        : gpaCreditsDenom > 0
          ? Math.round((weightedGpaSum / gpaCreditsDenom) * 100) / 100
          : 0,
    weightedAvgScore:
      scoreCreditsDenom > 0 ? Math.round((weightedScoreSum / scoreCreditsDenom) * 100) / 100 : 0,
    totalCourses: effective.length,
    passedCourses,
    failedCourses,
    passRate: effective.length > 0 ? Math.round((passedCourses / effective.length) * 1000) / 10 : 0,
    hasEstimatedItems,
    byCategory,
    byTerm: computeTermBreakdowns(grades),
    scoreDistribution: computeScoreDistribution(effective),
  };
}

// ==================== ICS EXPORT (RFC 5545) ====================

function escapeIcsText(text: string): string {
  return String(text ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

function fmtLocalIcsDate(d: Date, hhmm: string): string {
  const [h, m] = hhmm.split(':');
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}${mo}${da}T${String(h || '08').padStart(2, '0')}${String(m || '00').padStart(2, '0')}00`;
}

export function buildGdouIcsContent(
  courses: CourseItem[],
  exams: ExamItem[],
  termStartDate: string,
  periods: PeriodTime[]
): string {
  const nowUtc = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//GDOU Ocean Hub//Academic Calendar//CN',
    'CALSCALE:GREGORIAN',
    'X-WR-CALNAME:海大课表与考试',
    'X-WR-TIMEZONE:Asia/Shanghai',
  ];

  for (const c of courses) {
    if (c.parseWarning || c.dayOfWeek < 1 || c.weeks.length === 0) continue;
    const { startText, endText } = getCourseTimeSpan(c, periods);
    for (const w of c.weeks) {
      const dt = getDateForWeekAndDay(termStartDate, w, c.dayOfWeek);
      lines.push(
        'BEGIN:VEVENT',
        `UID:gdou-course-${c.id}-w${w}@gdou-ocean-hub`,
        `DTSTAMP:${nowUtc}`,
        `DTSTART;TZID=Asia/Shanghai:${fmtLocalIcsDate(dt, startText)}`,
        `DTEND;TZID=Asia/Shanghai:${fmtLocalIcsDate(dt, endText)}`,
        `SUMMARY:${escapeIcsText(c.name)}`,
        `LOCATION:${escapeIcsText(c.location)}`,
        `DESCRIPTION:${escapeIcsText(`教师：${c.teacher} | 第${w}周 | 第${c.startSection}-${c.endSection}节`)}`,
        'END:VEVENT'
      );
    }
  }

  for (const ex of exams) {
    if (!ex.dateText || !ex.startTimeText) continue;
    const d = parseLocalDateStrict(ex.dateText);
    if (!d) continue;
    const endTime = ex.endTimeText || ex.startTimeText;
    lines.push(
      'BEGIN:VEVENT',
      `UID:gdou-exam-${ex.id}@gdou-ocean-hub`,
      `DTSTAMP:${nowUtc}`,
      `DTSTART;TZID=Asia/Shanghai:${fmtLocalIcsDate(d, ex.startTimeText)}`,
      `DTEND;TZID=Asia/Shanghai:${fmtLocalIcsDate(d, endTime)}`,
      `SUMMARY:${escapeIcsText(`【考试】${ex.courseName}`)}`,
      `LOCATION:${escapeIcsText(ex.seatNumber ? `${ex.location} (座位 ${ex.seatNumber})` : ex.location)}`,
      `DESCRIPTION:${escapeIcsText(`${ex.examType} | 座位号：${ex.seatNumber || '待公布'} | ${ex.campus}`)}`,
      'END:VEVENT'
    );
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

// ==================== EMPTY CLASSROOM PARSER ====================

function extractBuildingName(roomName: string, rawBuilding?: string): string {
  const b = String(rawBuilding ?? '').trim();
  if (b) return b;
  const m = roomName.match(/^([\u4e00-\u9fa5]+楼|[\u4e00-\u9fa5]+馆|[\u4e00-\u9fa5]+中心|[\u4e00-\u9fa5]+)/);
  return m ? m[1] : '其他教学楼';
}

export function parseZfEmptyRoomsResponse(
  raw: unknown,
  slotLabel: string,
  dateText: string
): EmptyRoomItem[] {
  if (!raw || typeof raw !== 'object') return [];
  const obj = raw as Record<string, unknown>;
  const list = Array.isArray(obj.items)
    ? (obj.items as Record<string, unknown>[])
    : Array.isArray(obj.rows)
      ? (obj.rows as Record<string, unknown>[])
      : Array.isArray(raw)
        ? (raw as Record<string, unknown>[])
        : [];

  const seen = new Set<string>();
  const rooms: EmptyRoomItem[] = [];

  for (let i = 0; i < list.length; i++) {
    const row = list[i];
    const name = String(row.cdmc ?? row.jsmc ?? row.cdbh ?? '').trim();
    if (!name) continue;
    const dedup = `${name}|${slotLabel}|${dateText}`;
    if (seen.has(dedup)) continue;
    seen.add(dedup);

    const building = extractBuildingName(name, String(row.jxlmc ?? row.lh ?? ''));
    const campus = String(row.xqmc ?? row.cdxqmc ?? '湖光校区').trim();
    const seatsNum = parseInt(String(row.zws ?? row.kszws1 ?? row.rnrs ?? '0'), 10);
    const roomType = String(row.cdlbmc ?? row.jslxmc ?? '普通教室').trim();

    rooms.push({
      id: `room-${dateText}-${slotLabel}-${name}-${i}`,
      name,
      building,
      campus,
      seats: Number.isFinite(seatsNum) && seatsNum > 0 ? seatsNum : 0,
      roomType,
      slotLabel,
      dateText,
    });
  }

  return rooms.sort((a, b) => a.building.localeCompare(b.building) || a.name.localeCompare(b.name));
}

