export interface PeriodTime {
  section: number;
  start: string; // HH:mm
  end: string; // HH:mm
}

export type CampusPresetKey = 'huguang_0810' | 'huguang_0800' | 'yangjiang' | 'custom';
export type ThemeSkinKey = 'ocean' | 'morandi' | 'sakura' | 'mono';
export type ScheduleViewMode = 'mine' | 'couple' | 'partner';

export interface CourseItem {
  id: string;
  name: string;
  code: string;
  teacher: string;
  location: string;
  campus: string;
  dayOfWeek: number; // 1 = Monday .. 7 = Sunday (0 if unparsed)
  startSection: number; // 1 .. 16
  endSection: number; // 1 .. 16
  weeks: number[]; // sorted unique teaching week numbers
  weekText: string; // e.g. "1-16周(单)"
  credit: string;
  classGroup: string;
  colorIndex: number;
  parseWarning?: string;
  isManual?: boolean;
  ownerTag?: 'mine' | 'partner';
}

export interface CoupleScheduleProfile {
  partnerName: string;
  termLabel: string;
  courses: CourseItem[];
  updatedAtIso: string;
}

export interface CourseTodoItem {
  id: string;
  courseName: string;
  content: string;
  dueDate?: string; // YYYY-MM-DD
  done: boolean;
  createdAtIso: string;
}

export interface EmptyRoomItem {
  id: string;
  name: string; // e.g. 钟海楼02018
  building: string; // e.g. 钟海楼
  campus: string;
  seats: number;
  roomType: string;
  slotLabel: string; // e.g. "1-2节", "3-4节", "5-6节", "7-8节", "9-10节"
  dateText: string; // YYYY-MM-DD
}

export interface ExamItem {
  id: string;
  courseName: string;
  courseCode: string;
  examType: string;
  dateText: string; // YYYY-MM-DD
  startTimeText: string; // HH:mm
  endTimeText: string; // HH:mm
  startIso: string | null;
  endIso: string | null;
  rawTimeText: string;
  location: string;
  seatNumber: string;
  campus: string;
  invigilator: string;
  isManual?: boolean;
}

export interface GradeItem {
  id: string;
  courseName: string;
  courseCode: string;
  academicYear: string;
  semester: string;
  termKey: string;
  credit: number;
  scoreText: string;
  numericScore: number | null;
  gpa: number;
  gpaEstimated?: boolean;
  scoreEstimated?: boolean;
  courseCategory: string;
  examNature: string;
  teacher: string;
  passed: boolean;
}

export interface TermGradeBreakdown {
  termKey: string;
  academicYear: string;
  semester: string;
  coursesCount: number;
  passedCount: number;
  failedCount: number;
  creditsEarned: number;
  creditsAttempted: number;
  weightedGpa: number;
  weightedAvgScore: number;
}

export interface ScoreTierBucket {
  key: 'excellent' | 'good' | 'medium' | 'pass' | 'fail';
  label: string;
  rangeText: string;
  count: number;
  credits: number;
  ratio: number;
}

export interface CreditCategorySummary {
  category: string;
  credits: number;
  attemptedCredits: number;
  count: number;
  share: number;
}

export interface GpaSummary {
  totalCreditsEarned: number;
  totalCreditsAttempted: number;
  weightedGpa: number;
  requiredGpa: number;
  weightedAvgScore: number;
  totalCourses: number;
  passedCourses: number;
  failedCourses: number;
  passRate: number;
  hasEstimatedItems: boolean;
  byCategory: CreditCategorySummary[];
  byTerm: TermGradeBreakdown[];
  scoreDistribution: ScoreTierBucket[];
}

export interface AppSettings {
  campusPreset: CampusPresetKey;
  customPeriods: PeriodTime[];
  termStartDate: string; // YYYY-MM-DD (Monday of Week 1)
  totalWeeks: number;
  showNonCurrentWeekCourses: boolean;
  darkMode: boolean;
  themeSkin: ThemeSkinKey;
  scheduleBgImage?: string; // compressed DataURL
  scheduleBgOpacity: number; // 0.1..0.65
  graduationCreditTarget: number; // default 165
}

export interface LogoutVerificationDetails {
  attempted: number;
  succeeded: number;
  casLoggedOut: boolean;
  failedEndpoints: string[];
}

export interface SyncReceipt {
  syncedAtIso: string;
  mode: 'direct';
  networkRoute: 'wfw-webvpn' | 'campus-direct';
  termLabel: string;
  coursesCount: number;
  examsCount: number;
  gradesCount: number;
  emptyRoomsCount?: number;
  credentialsPurged: boolean;
  sessionLoggedOut: boolean;
  storageCleaned: boolean;
  cookiesFlushed: boolean;
  logoutDetails?: LogoutVerificationDetails;
  warnings?: string[];
  steps: string[];
}

export interface PersistedAppData {
  schemaVersion: number;
  courses: CourseItem[];
  exams: ExamItem[];
  grades: GradeItem[];
  emptyRooms: EmptyRoomItem[];
  courseTodos: CourseTodoItem[];
  coupleSchedule: CoupleScheduleProfile | null;
  termLabel: string;
  academicYear: string;
  semesterCode: string;
  lastSyncedAt: string | null;
  lastSyncReceipt: SyncReceipt | null;
  settings: AppSettings;
}

export interface EphemeralCredentials {
  username: string;
  password: string;
  captcha?: string;
}

export interface SyncResultPayload {
  courses: CourseItem[];
  exams: ExamItem[];
  grades: GradeItem[];
  emptyRooms?: EmptyRoomItem[];
  syncedPeriods?: PeriodTime[];
  detectedCampus?: string;
  termLabel: string;
  academicYear: string;
  semesterCode: string;
  receipt: SyncReceipt;
}
