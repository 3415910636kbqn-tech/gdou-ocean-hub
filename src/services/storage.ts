import {
  buildSampleGdouData,
  createDefaultSettings,
  deriveCurrentTermParams,
} from '../../shared/gdouTimetable';
import type { PersistedAppData } from '../../shared/models';
import { sanitizeForZeroRetention } from '../../shared/zeroRetentionSanitizer';

const STORAGE_KEY = 'gdou_ocean_hub_data_v1';

/**
 * Clean empty state for first-time visitors (prompts user to import via top-right sync button).
 */
export function createEmptyAppData(): PersistedAppData {
  const term = deriveCurrentTermParams();
  return {
    schemaVersion: 2,
    courses: [],
    exams: [],
    grades: [],
    emptyRooms: [],
    courseTodos: [],
    coupleSchedule: null,
    termLabel: '尚未导入教务课表',
    academicYear: term.xnm,
    semesterCode: term.xqm,
    lastSyncedAt: null,
    lastSyncReceipt: null,
    settings: createDefaultSettings(),
  };
}

/**
 * Sample data builder (only used when user explicitly clicks "加载示例数据" in Settings).
 */
export function createSampleAppData(): PersistedAppData {
  const sample = buildSampleGdouData();
  const term = deriveCurrentTermParams();
  return {
    schemaVersion: 2,
    courses: sample.courses,
    exams: sample.exams,
    grades: sample.grades,
    emptyRooms: [],
    courseTodos: [],
    coupleSchedule: null,
    termLabel: sample.termLabel,
    academicYear: term.xnm,
    semesterCode: term.xqm,
    lastSyncedAt: null,
    lastSyncReceipt: null,
    settings: createDefaultSettings(),
  };
}

export function loadPersistedData(): PersistedAppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createEmptyAppData();
    const parsed = JSON.parse(raw) as Partial<PersistedAppData>;
    const defaults = createEmptyAppData();
    const courses = Array.isArray(parsed.courses) ? parsed.courses : [];
    const exams = Array.isArray(parsed.exams) ? parsed.exams : [];
    const grades = Array.isArray(parsed.grades) ? parsed.grades : [];

    // Migrate old auto-loaded sample preview (never synced, only sample-* items) to clean empty prompt
    const isUntouchedLegacySample =
      !parsed.lastSyncedAt &&
      courses.length > 0 &&
      courses.every((c) => typeof c?.id === 'string' && c.id.startsWith('sample-')) &&
      String(parsed.termLabel ?? '').includes('示例预览');

    if (isUntouchedLegacySample) {
      return {
        ...defaults,
        settings: {
          ...defaults.settings,
          ...(parsed.settings ?? {}),
        },
      };
    }

    return {
      ...defaults,
      ...parsed,
      settings: {
        ...defaults.settings,
        ...(parsed.settings ?? {}),
      },
      courses,
      exams,
      grades,
      emptyRooms: Array.isArray(parsed.emptyRooms) ? parsed.emptyRooms : [],
      courseTodos: Array.isArray(parsed.courseTodos) ? parsed.courseTodos : [],
      coupleSchedule: parsed.coupleSchedule ?? null,
    };
  } catch {
    return createEmptyAppData();
  }
}

export function savePersistedData(data: PersistedAppData): void {
  try {
    const sanitized = sanitizeForZeroRetention(data);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitized));
  } catch {
    // storage quota or private mode
  }
}

export function clearPersistedData(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function triggerTextDownload(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
