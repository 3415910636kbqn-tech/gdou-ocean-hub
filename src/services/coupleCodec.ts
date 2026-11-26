import type { CoupleScheduleProfile, CourseItem } from '../../shared/models';

const PREFIX = 'GDOU-COUPLE-V1:';

interface CompactCourse {
  n: string; // name
  l: string; // location
  t: string; // teacher
  d: number; // dayOfWeek
  s: number; // startSection
  e: number; // endSection
  w: number[]; // weeks
  wt: string; // weekText
  ci: number; // colorIndex
}

interface CompactPayload {
  v: 1;
  p: string; // partnerName
  tl: string; // termLabel
  c: CompactCourse[];
}

function toBase64Url(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(b64: string): string {
  const padded = b64.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64.length + 3) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/**
 * Encodes ONLY schedule blocks (zero credentials, zero student IDs) into a compact copyable code.
 */
export function encodeCoupleShareCode(
  partnerName: string,
  termLabel: string,
  courses: CourseItem[]
): string {
  const payload: CompactPayload = {
    v: 1,
    p: (partnerName || 'TA').trim().slice(0, 16),
    tl: termLabel || '',
    c: courses
      .filter((c) => !c.parseWarning && c.dayOfWeek >= 1 && c.dayOfWeek <= 7 && c.weeks.length > 0)
      .map((c) => ({
        n: c.name,
        l: c.location,
        t: c.teacher,
        d: c.dayOfWeek,
        s: c.startSection,
        e: c.endSection,
        w: c.weeks,
        wt: c.weekText,
        ci: c.colorIndex,
      })),
  };
  return PREFIX + toBase64Url(JSON.stringify(payload));
}

export function decodeCoupleShareCode(raw: string): CoupleScheduleProfile {
  const trimmed = raw.trim();
  const idx = trimmed.indexOf(PREFIX);
  if (idx === -1) {
    throw new Error('口令格式无效，请确认完整复制了以 GDOU-COUPLE-V1: 开头的课表口令');
  }
  const encoded = trimmed.slice(idx + PREFIX.length).replace(/\s+/g, '');
  let parsed: CompactPayload;
  try {
    parsed = JSON.parse(fromBase64Url(encoded)) as CompactPayload;
  } catch {
    throw new Error('口令解析失败，可能复制不完整，请重新复制');
  }
  if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.c)) {
    throw new Error('不支持的课表口令版本');
  }

  const courses: CourseItem[] = parsed.c.map((item, i) => ({
    id: `partner-${i}-${item.d}-${item.s}-${item.e}`,
    name: String(item.n || '未命名课程'),
    code: '',
    teacher: String(item.t || ''),
    location: String(item.l || ''),
    campus: '',
    dayOfWeek: Number(item.d) || 1,
    startSection: Number(item.s) || 1,
    endSection: Number(item.e) || 2,
    weeks: Array.isArray(item.w) ? item.w.map(Number).filter((x) => x >= 1 && x <= 30) : [],
    weekText: String(item.wt || ''),
    credit: '',
    classGroup: '',
    colorIndex: Number(item.ci) || (i % 8),
    ownerTag: 'partner',
  }));

  return {
    partnerName: String(parsed.p || 'TA'),
    termLabel: String(parsed.tl || ''),
    courses,
    updatedAtIso: new Date().toISOString(),
  };
}

const MAJOR_SLOTS: { label: string; start: number; end: number }[] = [
  { label: '1-2节', start: 1, end: 2 },
  { label: '3-4节', start: 3, end: 4 },
  { label: '5-6节', start: 5, end: 6 },
  { label: '7-8节', start: 7, end: 8 },
  { label: '9-10节', start: 9, end: 10 },
];

function extractBuilding(loc: string): string {
  const m = (loc || '').match(/^([\u4e00-\u9fa5]+楼|[\u4e00-\u9fa5]+馆)/);
  return m ? m[1] : '';
}

export interface CoupleWeekStats {
  mutualFreeSlots: { day: number; start: number; end: number; label: string }[];
  sameClassCount: number;
  sameBuildingCount: number;
}

export function computeCoupleWeekStats(
  myCourses: CourseItem[],
  partnerCourses: CourseItem[],
  week: number
): CoupleWeekStats {
  const myActive = myCourses.filter((c) => !c.parseWarning && c.weeks.includes(week));
  const taActive = partnerCourses.filter((c) => !c.parseWarning && c.weeks.includes(week));

  const mutualFreeSlots: CoupleWeekStats['mutualFreeSlots'] = [];
  let sameClassCount = 0;
  let sameBuildingCount = 0;

  for (let day = 1; day <= 5; day++) {
    for (const slot of MAJOR_SLOTS) {
      const myHit = myActive.find(
        (c) => c.dayOfWeek === day && c.startSection <= slot.end && c.endSection >= slot.start
      );
      const taHit = taActive.find(
        (c) => c.dayOfWeek === day && c.startSection <= slot.end && c.endSection >= slot.start
      );

      if (!myHit && !taHit) {
        mutualFreeSlots.push({ day, ...slot });
      } else if (myHit && taHit) {
        if (myHit.name === taHit.name && myHit.location === taHit.location) {
          sameClassCount++;
        } else {
          const b1 = extractBuilding(myHit.location);
          const b2 = extractBuilding(taHit.location);
          if (b1 && b1 === b2) sameBuildingCount++;
        }
      }
    }
  }

  return { mutualFreeSlots, sameClassCount, sameBuildingCount };
}
