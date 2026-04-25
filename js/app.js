import {
  signInWithGoogle,
  signOut,
  onAuthStateChange,
  isNLSEmail,
  getAdminAccess,
  getUserEmail,
  getBoardPreference,
  loadBoardPreference,
  saveBoardPreference
} from './auth.js';
import {
  fetchAllCourses,
  subscribeToCourses,
  updateCourse,
  createCourse,
  deleteCourse,
  submitCourseSuggestion,
  fetchCourseSuggestions,
  approveCourseSuggestion,
  rejectCourseSuggestion
} from './data.js';
import {
  grantAdminAccess,
  revokeAdminAccess,
  fetchAdmins,
  verifyAdminPassword
} from './admin.js';
import { supabase } from './supabase.js';

const initScreen = document.getElementById('init-screen');
const loginScreen = document.getElementById('login-screen');
const boardScreen = document.getElementById('board-screen');
const googleBtn = document.getElementById('google-signin-btn');
const signoutBtn = document.getElementById('signout-btn');
const userEmailEl = document.getElementById('user-email');
const userRoleEl = document.getElementById('user-role');
const adminToggleBtn = document.getElementById('admin-toggle-btn');

const onboardingModal = document.getElementById('onboarding-modal');
const onboardingForm = document.getElementById('onboarding-form');
const onboardingFeedback = document.getElementById('onboarding-feedback');
const onboardingPreview = document.getElementById('onboarding-preview');
const onboardingYearInputs = document.querySelectorAll('input[name="preferred-year"]');
const onboardingTrimesterInputs = document.querySelectorAll('input[name="preferred-trimester"]');
const onboardingTrimesterGroup = document.getElementById('onboarding-trimester-group');

const headerTabs = document.querySelectorAll('.header-tab[data-view]');
const yearTabs = document.querySelectorAll('.year-tab');
const triTabs = document.querySelectorAll('.tri-tab');
const trimesterNav = document.getElementById('trimester-nav');
const courseGrid = document.getElementById('course-grid');
const emptyState = document.getElementById('empty-state');
const loading = document.getElementById('board-loading');
const toastContainer = document.getElementById('toast-container');
const boardTitleEl = document.getElementById('board-title');
const boardUpdatedAtEl = document.getElementById('board-updated-at');
const boardSearchInput = document.getElementById('board-search-input');
const boardSearchClearBtn = document.getElementById('board-search-clear');

const editModal = document.getElementById('edit-modal');
const editForm = document.getElementById('edit-form');
const editModeNote = document.getElementById('edit-mode-note');
const editSubmitBtn = document.getElementById('edit-submit-btn');
const adminOnlyFields = document.getElementById('admin-only-fields');
const editStatusGroup = document.getElementById('edit-status-group');
const editOutlineGroup = document.getElementById('edit-outline-group');

const adminModal = document.getElementById('admin-modal');
const adminRoleSummary = document.getElementById('admin-role-summary');
const addCourseForm = document.getElementById('add-course-form');
const addCourseFeedback = document.getElementById('add-course-feedback');
const addCourseTemplateSelect = document.getElementById('course-template-select');
const addCourseTemplateHelper = document.getElementById('course-template-helper');
const addAdminForm = document.getElementById('add-admin-form');
const adminPasswordForm = document.getElementById('admin-password-form');
const adminList = document.getElementById('admin-list');
const manageCoursesList = document.getElementById('manage-courses-list');
const suggestionsList = document.getElementById('suggestions-list');

const DEFAULT_YEAR = '1';
const DEFAULT_TRIMESTER = '1';
const DEFAULT_VIEW = 'live';
const SECTION_TONES = [
  { accent: '#d4a843', soft: 'rgba(212, 168, 67, 0.14)', glow: 'rgba(212, 168, 67, 0.32)' },
  { accent: '#6ea8fe', soft: 'rgba(110, 168, 254, 0.14)', glow: 'rgba(110, 168, 254, 0.32)' },
  { accent: '#3ddc84', soft: 'rgba(61, 220, 132, 0.14)', glow: 'rgba(61, 220, 132, 0.32)' },
  { accent: '#fb923c', soft: 'rgba(251, 146, 60, 0.14)', glow: 'rgba(251, 146, 60, 0.32)' },
  { accent: '#f87171', soft: 'rgba(248, 113, 113, 0.14)', glow: 'rgba(248, 113, 113, 0.32)' },
  { accent: '#8bd3dd', soft: 'rgba(139, 211, 221, 0.14)', glow: 'rgba(139, 211, 221, 0.32)' }
];

let currentUser = null;
let currentYear = DEFAULT_YEAR;
let currentTrimester = DEFAULT_TRIMESTER;
let currentView = DEFAULT_VIEW;
let currentCourses = [];
let boardCatalog = [];
let allCourses = [];
let adminDirectory = [];
let pendingSuggestions = [];
let subscription = null;
let adminAccess = null;
let isAdmin = false;
let isSuperAdmin = false;
let boardLoadRequestId = 0;
let boardLoadDelayTimer = null;
let boardLoadFailSafeTimer = null;
let boardSearchTerm = '';
let lastBoardLoadedAt = null;
let boardLoadState = 'idle';
let boardLoadNotice = '';
let boardLoadNoticeDetail = '';
let activeEditCourse = null;
let activeEditMode = 'admin';

const VIEW_COPY = {
  live: {
    tabLabel: 'Live Board',
    searchPlaceholder: 'Search course, section, or topic'
  }
};

function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(message)), ms);
    })
  ]);
}

function readScheduleMap(value) {
  if (!value) return {};

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
      return {};
    }
  }

  if (typeof value === 'object') {
    return value;
  }

  return {};
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getSectionTone(section) {
  if (!section) {
    return SECTION_TONES[0];
  }

  const normalizedSection = String(section).trim().toUpperCase();
  let hash = 0;
  for (const char of normalizedSection) {
    hash = ((hash * 31) + char.charCodeAt(0)) % SECTION_TONES.length;
  }

  return SECTION_TONES[hash];
}

function normalizeYear(value) {
  return ['1', '2', '3', '4', '5', 'electives'].includes(String(value)) ? String(value) : DEFAULT_YEAR;
}

function normalizeTrimester(value) {
  return ['1', '2', '3'].includes(String(value)) ? String(value) : DEFAULT_TRIMESTER;
}

function normalizeView(value) {
  return DEFAULT_VIEW;
}

function getTrimesterLabel(value) {
  return {
    '1': 'Trimester I',
    '2': 'Trimester II',
    '3': 'Trimester III'
  }[normalizeTrimester(value)];
}

function getYearLabel(value) {
  const normalizedYear = normalizeYear(value);
  return normalizedYear === 'electives' ? 'Electives' : `Year ${normalizedYear}`;
}

function getViewLabel(value) {
  return VIEW_COPY[normalizeView(value)].tabLabel;
}

function setCheckedPreference(inputs, value) {
  let didSelect = false;

  inputs.forEach(input => {
    const shouldCheck = input.value === value;
    input.checked = shouldCheck;
    if (shouldCheck) {
      didSelect = true;
    }
  });

  if (!didSelect && inputs[0]) {
    inputs[0].checked = true;
  }
}

function getSelectedPreferenceValue(name, fallback) {
  return document.querySelector(`input[name="${name}"]:checked`)?.value || fallback;
}

function updateOnboardingPreview() {
  const selectedYear = getSelectedPreferenceValue('preferred-year', currentYear);
  const selectedTrimester = getSelectedPreferenceValue('preferred-trimester', currentTrimester);
  const isElectivesBoard = selectedYear === 'electives';

  onboardingTrimesterGroup?.classList.toggle('hidden', isElectivesBoard);
  onboardingTrimesterInputs.forEach(input => {
    input.disabled = isElectivesBoard;
  });

  onboardingPreview.textContent = isElectivesBoard
    ? `You'll open directly to ${getYearLabel(selectedYear)}.`
    : `You'll open directly to ${getYearLabel(selectedYear)} / ${getTrimesterLabel(selectedTrimester)}.`;
}

function syncBoardSelectionUi() {
  yearTabs.forEach(tab => {
    tab.classList.toggle('active', tab.dataset.year === currentYear);
  });

  triTabs.forEach(tab => {
    tab.classList.toggle('active', tab.dataset.trimester === currentTrimester);
  });

  trimesterNav.classList.toggle('hidden', currentYear === 'electives');
}

function setBoardSelection(year, trimester, { load = true, force = false } = {}) {
  const nextYear = normalizeYear(year);
  const nextTrimester = normalizeTrimester(trimester);
  const selectionUnchanged = nextYear === currentYear && nextTrimester === currentTrimester;

  currentYear = nextYear;
  currentTrimester = nextTrimester;
  syncBoardSelectionUi();

  if (load && (!selectionUnchanged || force)) {
    loadData({ clearVisible: true });
  }
}

function setBoardView(view, { load = true, force = false } = {}) {
  const nextView = normalizeView(view);
  const viewUnchanged = nextView === currentView;

  currentView = nextView;
  syncBoardSelectionUi();

  if (load && (!viewUnchanged || force)) {
    loadData({ clearVisible: true });
  }
}

function openOnboardingModal(preference = null) {
  const selectedYear = normalizeYear(preference?.year || currentYear || DEFAULT_YEAR);
  const selectedTrimester = normalizeTrimester(preference?.trimester || currentTrimester || DEFAULT_TRIMESTER);

  setCheckedPreference(onboardingYearInputs, selectedYear);
  setCheckedPreference(onboardingTrimesterInputs, selectedTrimester);
  updateOnboardingPreview();
  onboardingFeedback.textContent = '';
  onboardingFeedback.className = 'feedback';
  onboardingModal.classList.remove('hidden');
}

function closeOnboardingModal() {
  onboardingModal.classList.add('hidden');
}

function closeSupportModal() {
  const supportModal = document.getElementById('support-modal');
  supportModal?.classList.add('hidden');
}

function showLogin() {
  if (initScreen) {
    initScreen.classList.remove('active', 'init-loading');
    initScreen.style.display = 'none';
  }

  loginScreen.classList.add('active');
  boardScreen.classList.remove('active');
}

function showBoard() {
  if (initScreen) {
    initScreen.classList.remove('active', 'init-loading');
    initScreen.style.display = 'none';
  }

  loginScreen.classList.remove('active');
  boardScreen.classList.add('active');
}

function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);
  setTimeout(() => toast.remove(), 3200);
}

function clearBoardLoadingTimers() {
  window.clearTimeout(boardLoadDelayTimer);
  window.clearTimeout(boardLoadFailSafeTimer);
  boardLoadDelayTimer = null;
  boardLoadFailSafeTimer = null;
}

function showLoading({ immediate = false, onFailSafe = null } = {}) {
  clearBoardLoadingTimers();
  boardScreen.classList.add('is-loading');

  const revealLoading = () => {
    loading.classList.remove('hidden');
  };

  if (immediate || currentCourses.length === 0) {
    revealLoading();
  } else {
    boardLoadDelayTimer = window.setTimeout(revealLoading, 160);
  }

  boardLoadFailSafeTimer = window.setTimeout(() => {
    hideLoading();
    onFailSafe?.();
    if (boardScreen.classList.contains('active')) {
      showToast('Board refresh is taking longer than expected. The current board is still available.', 'error');
    }
  }, 9000);
}

function hideLoading() {
  clearBoardLoadingTimers();
  boardScreen.classList.remove('is-loading');
  loading.classList.add('hidden');
}

function setBoardLoadNotice(state = 'idle', message = '', detail = '') {
  boardLoadState = state;
  boardLoadNotice = message;
  boardLoadNoticeDetail = detail;
}

function setButtonBusy(button, busyLabel) {
  if (!button) {
    return () => {};
  }

  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = busyLabel;

  return () => {
    button.disabled = false;
    button.textContent = originalLabel;
  };
}

function formatTimestamp(value) {
  if (!value) return 'Just now';

  try {
    return new Date(value).toLocaleString('en-IN', {
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit'
    });
  } catch (error) {
    return value;
  }
}

function formatBoardUpdatedAt(value) {
  if (!value) {
    return 'Updated just now';
  }

  try {
    return `Updated: ${new Date(value).toLocaleTimeString('en-IN', {
      hour: 'numeric',
      minute: '2-digit'
    })}`;
  } catch (error) {
    return 'Updated just now';
  }
}

function getTodayRoom(course) {
  let todayRoom = 'No class today';

  try {
    if (course.weeklyschedule) {
      const schedule = readScheduleMap(course.weeklyschedule);
      const dayOfWeek = new Date().getDay();

      if (schedule[dayOfWeek] && schedule[dayOfWeek].trim() !== '') {
        todayRoom = schedule[dayOfWeek];
      } else {
        let nextDay = -1;
        for (let i = 1; i <= 7; i += 1) {
          const candidate = (dayOfWeek + i) % 7;
          if (schedule[candidate] && schedule[candidate].trim() !== '') {
            nextDay = candidate;
            break;
          }
        }

        if (nextDay !== -1) {
          const shortDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
          todayRoom = `Next: ${shortDays[nextDay]} (${schedule[nextDay]})`;
        }
      }
    }
  } catch (error) {
    todayRoom = course.weeklyschedule || 'TBA';
  }

  return todayRoom;
}

function getCourseSessionMetrics(course) {
  const currentSession = Number(course?.currentsession);
  const totalSessions = Number(course?.totalsessions);
  const safeCurrentSession = Number.isFinite(currentSession) && currentSession >= 0 ? currentSession : 0;
  const safeTotalSessions = Number.isFinite(totalSessions) && totalSessions > 0 ? totalSessions : 30;
  const clampedSession = Math.min(safeCurrentSession, safeTotalSessions);
  const progressPct = safeTotalSessions
    ? Math.min(100, Math.max(0, (clampedSession / safeTotalSessions) * 100))
    : 0;

  return {
    currentSession: clampedSession,
    totalSessions: safeTotalSessions,
    progressPct
  };
}

function getCourseScheduleState(course) {
  const schedule = readScheduleMap(course.weeklyschedule);
  const dayOfWeek = new Date().getDay();
  const todayEntry = typeof schedule[dayOfWeek] === 'string' ? schedule[dayOfWeek].trim() : '';
  const roomLabel = getTodayRoom(course);
  const normalizedStatus = String(course.status || 'active').toLowerCase();
  const { currentSession, totalSessions } = getCourseSessionMetrics(course);

  if (normalizedStatus === 'completed' || currentSession >= totalSessions) {
    return {
      tone: 'completed',
      label: 'Archived',
      roomLabel: roomLabel === 'No class today' ? 'Archive on record' : roomLabel,
      isLive: false,
      sortOrder: 3
    };
  }

  if (todayEntry) {
    return {
      tone: 'live',
      label: 'Today',
      roomLabel: todayEntry,
      isLive: true,
      sortOrder: 0
    };
  }

  if (normalizedStatus === 'upcoming' || roomLabel.startsWith('Next:')) {
    return {
      tone: 'upcoming',
      label: 'Upcoming',
      roomLabel: roomLabel === 'No class today' ? 'Schedule pending' : roomLabel,
      isLive: false,
      sortOrder: 1
    };
  }

  return {
    tone: 'idle',
    label: 'Scheduled',
    roomLabel: roomLabel === 'No class today' ? 'No class today' : roomLabel,
    isLive: false,
    sortOrder: 2
  };
}

function isArchivedCourse(course) {
  return getCourseScheduleState(course).tone === 'completed';
}

function matchesCurrentSelection(course) {
  if (currentYear === 'electives') {
    return !!course.iselective;
  }

  if (course.iselective) {
    return false;
  }

  return String(course.year || '') === currentYear && String(course.trimester || '') === currentTrimester;
}

function getCoursesForSelection(courses, year = currentYear, trimester = currentTrimester) {
  const targetYear = normalizeYear(year);
  const targetTrimester = normalizeTrimester(trimester);

  return (courses || []).filter(course => {
    if (targetYear === 'electives') {
      return !!course.iselective;
    }

    if (course.iselective) {
      return false;
    }

    return String(course.year || '') === targetYear && String(course.trimester || '') === targetTrimester;
  });
}

function getCoursePlacementLabel(course) {
  if (course.iselective) {
    return 'Elective';
  }

  return `${getYearLabel(course.year || currentYear)} • ${getTrimesterLabel(course.trimester || currentTrimester)}`;
}

function getCourseScheduleLabel(course, scheduleState) {
  if (scheduleState.roomLabel && scheduleState.roomLabel !== 'No class today') {
    return scheduleState.roomLabel;
  }

  return 'Schedule pending';
}

function matchesCourseSearch(course, term) {
  const normalizedTerm = term.trim().toLowerCase();
  if (!normalizedTerm) return true;

  return [
    course.name,
    course.section ? `Section ${course.section}` : '',
    course.topic
  ].some(value => String(value || '').toLowerCase().includes(normalizedTerm));
}

function getVisibleCourses() {
  return currentCourses
    .filter(course => matchesCourseSearch(course, boardSearchTerm))
    .sort((left, right) => {
      const leftName = String(left.name || '').toLowerCase();
      const rightName = String(right.name || '').toLowerCase();
      if (leftName !== rightName) {
        return leftName.localeCompare(rightName);
      }

      return String(left.section || '').localeCompare(String(right.section || ''));
    });
}

function syncBoardTools() {
  if (boardSearchInput && boardSearchInput.value !== boardSearchTerm) {
    boardSearchInput.value = boardSearchTerm;
  }

  if (boardSearchInput) {
    boardSearchInput.placeholder = VIEW_COPY.live.searchPlaceholder;
  }

  if (boardSearchClearBtn) {
    boardSearchClearBtn.classList.toggle('hidden', !boardSearchTerm.trim());
  }
}

function updateBoardUiMeta(visibleCourses) {
  const yearLabel = getYearLabel(currentYear);
  const trimesterLabel = currentYear === 'electives' ? '' : getTrimesterLabel(currentTrimester);

  if (boardTitleEl) {
    boardTitleEl.textContent = trimesterLabel ? `${yearLabel} / ${trimesterLabel}` : yearLabel;
  }

  if (boardUpdatedAtEl) {
    boardUpdatedAtEl.textContent = formatBoardUpdatedAt(lastBoardLoadedAt);
  }

  syncBoardTools();
}

function getRoleLabel(role) {
  return role === 'super_admin' ? 'Super Admin' : 'Admin';
}

function getRoleDescription(entry) {
  if (!entry) return 'Student access';
  if (entry.role === 'super_admin') {
    return 'Password-verified admin with hierarchy controls';
  }

  if (entry.granted_by_email) {
    return `Granted by ${entry.granted_by_email}`;
  }

  return 'Granted admin';
}

function renderUserRole() {
  if (!userRoleEl) {
    return;
  }

  if (!adminAccess) {
    userRoleEl.textContent = 'Student';
    userRoleEl.className = 'user-role student';
    return;
  }

  userRoleEl.textContent = getRoleLabel(adminAccess.role);
  userRoleEl.className = `user-role ${adminAccess.role === 'super_admin' ? 'super-admin' : 'admin'}`;
}

function renderCourses() {
  const visibleCourses = getVisibleCourses();
  courseGrid.innerHTML = '';
  courseGrid.dataset.view = currentView;
  updateBoardUiMeta(visibleCourses);

  if (visibleCourses.length === 0) {
    const searchLabel = boardSearchTerm.trim();
    const emptyMessage = boardLoadState === 'loading'
      ? (boardLoadNotice || 'Loading board...')
      : boardLoadState === 'error'
        ? (boardLoadNotice || 'Unable to load this board.')
        : searchLabel
          ? `No courses match "${escapeHtml(searchLabel)}".`
          : 'No courses found for this selection.';
    const emptyDetail = boardLoadState === 'loading'
      ? (boardLoadNoticeDetail || 'Pulling the latest course data for this selection.')
      : boardLoadState === 'error'
        ? (boardLoadNoticeDetail || 'Try another year or trimester, or refresh and try again.')
        : 'Try another year, trimester, or search term.';

    emptyState.classList.remove('hidden');
    emptyState.innerHTML = `
      <p>${emptyMessage}</p>
      <span class="empty-state-detail">${emptyDetail}</span>
    `;
    courseGrid.appendChild(emptyState);
    return;
  }

  emptyState.classList.add('hidden');

  visibleCourses.forEach(course => {
    const sectionTone = getSectionTone(course.section);
    const { currentSession, totalSessions } = getCourseSessionMetrics(course);
    const card = document.createElement('article');
    card.className = 'course-card docket-card minimal-course-card';
    card.style.setProperty('--course-accent', sectionTone.accent);
    card.style.setProperty('--course-accent-soft', sectionTone.soft);
    card.style.setProperty('--course-accent-glow', sectionTone.glow);
    card.innerHTML = `
      <div class="course-card-shell">
        <span class="course-card-accent" aria-hidden="true"></span>
        <div class="course-card-header">
          <div class="course-card-heading">
            ${course.section
              ? `<div class="course-card-meta-line"><span class="course-card-section-label">${escapeHtml(`Section ${course.section}`)}</span></div>`
              : ''}
            <h3 class="course-card-title">${escapeHtml(course.name || 'Untitled Course')}</h3>
          </div>
          <div class="course-card-session-block">
            <span class="course-card-session-label">Current Session</span>
            <div class="course-card-session-value">
              <strong>${currentSession}</strong>
              <span>of ${totalSessions}</span>
            </div>
          </div>
        </div>

        <div class="course-card-body">
          <p class="course-card-topic-label">Current Topic</p>
          <p class="course-card-topic${course.topic ? '' : ' empty'}">${escapeHtml(course.topic || 'Topic update pending')}</p>
        </div>
        ${!isAdmin
          ? `<div class="course-card-footer course-card-footer-minimal">
              <button class="btn-secondary btn-compact course-card-action" type="button" data-course-card-action="suggest" data-course-id="${course.id}">
                Suggest update
              </button>
            </div>`
          : ''}
      </div>
    `;

    courseGrid.appendChild(card);
  });
}

function getSuggestionFieldLabel(field) {
  return {
    name: 'Course Name',
    section: 'Section',
    professor: 'Professor',
    currentsession: 'Current Session',
    totalsessions: 'Total Sessions',
    topic: 'Current Topic',
    weeklyschedule: 'Weekly Schedule'
  }[field] || field;
}

function getSuggestionFieldValue(field, value) {
  if (field === 'section') {
    return value ? `Section ${value}` : 'No section';
  }

  if (field === 'weeklyschedule') {
    return value && typeof value === 'object'
      ? 'Schedule update proposed'
      : (value || 'Schedule removed');
  }

  if (value === null || value === undefined || value === '') {
    return 'Empty';
  }

  return String(value);
}

function getSuggestionCourseRecord(suggestion) {
  if (Array.isArray(suggestion?.course)) {
    return suggestion.course[0] || null;
  }

  return suggestion?.course || null;
}

function renderSuggestionQueue() {
  if (!suggestionsList) {
    return;
  }

  if (!pendingSuggestions.length) {
    suggestionsList.innerHTML = '<div class="empty-admin-state">No pending student suggestions right now.</div>';
    return;
  }

  suggestionsList.innerHTML = pendingSuggestions.map(suggestion => {
    const course = getSuggestionCourseRecord(suggestion);
    const payload = suggestion?.payload && typeof suggestion.payload === 'object' ? suggestion.payload : {};
    const changeRows = Object.entries(payload).map(([field, nextValue]) => {
      const previousValue = course ? course[field] : null;
      return `
        <div class="suggestion-change-row${field === 'weeklyschedule' ? ' schedule' : ''}">
          <span class="suggestion-field">${escapeHtml(getSuggestionFieldLabel(field))}</span>
          <span class="suggestion-old">${escapeHtml(getSuggestionFieldValue(field, previousValue))}</span>
          <span class="suggestion-arrow" aria-hidden="true">→</span>
          <span class="suggestion-new">${escapeHtml(getSuggestionFieldValue(field, nextValue))}</span>
        </div>
      `;
    }).join('');

    const coursePlacement = course?.iselective
      ? 'Elective'
      : `${getYearLabel(course?.year || DEFAULT_YEAR)} / ${getTrimesterLabel(course?.trimester || DEFAULT_TRIMESTER)}`;

    return `
      <article class="suggestion-card">
        <div class="suggestion-card-header">
          <div>
            <h4>${escapeHtml(course?.name || 'Unknown course')}</h4>
            <p>${escapeHtml(coursePlacement)}${course?.section ? ` • ${escapeHtml(`Section ${course.section}`)}` : ''}</p>
          </div>
          <span class="suggestion-status-pill">Pending</span>
        </div>
        <div class="suggestion-meta">
          <span>${escapeHtml(suggestion.suggested_by_email || 'Unknown student')}</span>
          <span>${escapeHtml(formatTimestamp(suggestion.submitted_at))}</span>
        </div>
        <div class="suggestion-change-list">
          ${changeRows || '<div class="suggestion-change-row"><span class="suggestion-field">Suggestion</span><span class="suggestion-new">Change details unavailable</span></div>'}
        </div>
        <textarea class="suggestion-review-note-input" data-suggestion-note="${suggestion.id}" placeholder="Optional review note for the student"></textarea>
        <div class="suggestion-actions">
          <button class="btn-secondary btn-compact" type="button" data-suggestion-action="reject" data-suggestion-id="${suggestion.id}">Reject</button>
          <button class="btn-primary btn-compact" type="button" data-suggestion-action="approve" data-suggestion-id="${suggestion.id}">Approve</button>
        </div>
      </article>
    `;
  }).join('');
}

function renderSupportHistory() {
  const count = supportRequests.length;
  supportHistoryMeta.textContent = count
    ? `${count} recent ${count === 1 ? 'request' : 'requests'}`
    : 'No support requests submitted from this account yet.';

  if (!count) {
    supportHistoryList.innerHTML = '<div class="empty-admin-state">Once support requests are submitted, they will show up here.</div>';
    return;
  }

  supportHistoryList.innerHTML = supportRequests.map(request => `
    <article class="support-request-card">
      <div class="support-request-head">
        <strong>${escapeHtml(request.subject)}</strong>
        <span class="support-request-status">${escapeHtml(request.status || 'open')}</span>
      </div>
      <p class="support-request-meta">${escapeHtml(request.category || 'other')} • ${escapeHtml(formatTimestamp(request.created_at))}</p>
      <p class="support-request-body">${escapeHtml(request.message)}</p>
    </article>
  `).join('');
}

async function openSupportModal() {
  supportModal.classList.remove('hidden');
  supportForm.reset();
  supportFeedback.textContent = '';
  supportFeedback.className = 'feedback';
  supportHistoryList.innerHTML = '<div class="empty-admin-state">Loading your recent support requests...</div>';

  try {
    supportRequests = await fetchSupportRequests();
    renderSupportHistory();
  } catch (error) {
    supportHistoryMeta.textContent = 'Recent support history could not be loaded.';
    supportHistoryList.innerHTML = '<div class="empty-admin-state">Support history is unavailable right now.</div>';
    supportFeedback.textContent = error.message || 'Unable to load support history.';
    supportFeedback.className = 'feedback error';
  }
}

async function loadData({ refreshCatalog = false, clearVisible = false } = {}) {
  const requestId = ++boardLoadRequestId;
  const selectedYear = currentYear;
  const selectedTrimester = currentTrimester;
  const yearLabel = getYearLabel(selectedYear);
  const trimesterLabel = selectedYear === 'electives' ? '' : getTrimesterLabel(selectedTrimester);
  const selectionLabel = trimesterLabel ? `${yearLabel} / ${trimesterLabel}` : yearLabel;
  const failSafeMessage = `Unable to load ${selectionLabel}.`;
  const failSafeDetail = 'The board refresh took too long for this selection.';
  const hasCachedCatalog = boardCatalog.length > 0;
  const applyCachedSelection = () => {
    currentCourses = getCoursesForSelection(boardCatalog, selectedYear, selectedTrimester);
    renderCourses();
  };

  if (!refreshCatalog && hasCachedCatalog) {
    setBoardLoadNotice('idle');
    applyCachedSelection();
    return;
  }

  if (hasCachedCatalog) {
    currentCourses = getCoursesForSelection(boardCatalog, selectedYear, selectedTrimester);
    setBoardLoadNotice('loading');
    renderCourses();
  } else if (clearVisible) {
    currentCourses = [];
    setBoardLoadNotice('loading', `Loading ${selectionLabel}`, 'Pulling the latest course data for this selection.');
    renderCourses();
  } else {
    setBoardLoadNotice('loading');
  }

  showLoading({
    immediate: clearVisible || !hasCachedCatalog || currentCourses.length === 0,
    onFailSafe: () => {
      if (requestId !== boardLoadRequestId) {
        return;
      }

      if (!hasCachedCatalog && currentCourses.length === 0) {
        setBoardLoadNotice('error', failSafeMessage, failSafeDetail);
        renderCourses();
      } else {
        setBoardLoadNotice('idle');
        applyCachedSelection();
      }
    }
  });

  try {
    const courses = await withTimeout(
      fetchAllCourses(),
      8000,
      'Loading that board timed out. Please try again.'
    );

    if (requestId !== boardLoadRequestId) {
      return;
    }

    boardCatalog = courses;
    currentCourses = getCoursesForSelection(boardCatalog, selectedYear, selectedTrimester);
    setBoardLoadNotice('idle');
    lastBoardLoadedAt = new Date();
    renderCourses();
  } catch (error) {
    if (requestId !== boardLoadRequestId) {
      return;
    }

    if (!hasCachedCatalog && (clearVisible || currentCourses.length === 0 || boardLoadState === 'loading')) {
      currentCourses = [];
      setBoardLoadNotice(
        'error',
        failSafeMessage,
        'The board could not be refreshed for this selection.'
      );
      renderCourses();
    } else {
      currentCourses = getCoursesForSelection(boardCatalog, selectedYear, selectedTrimester);
      setBoardLoadNotice('idle');
      renderCourses();
    }

    showToast(error.message || 'Unable to load the board.', 'error');
  } finally {
    if (requestId === boardLoadRequestId) {
      hideLoading();
    }
  }
}

function handleRealtimeUpdate() {
  if (boardLoadState === 'loading' && currentCourses.length === 0) {
    return;
  }

  loadData({ refreshCatalog: true });
}

async function refreshBoardAndAdmin({ board = true, admin = false } = {}) {
  const refreshTasks = [];

  if (board) {
    refreshTasks.push(loadData({ refreshCatalog: true }));
  }

  if (admin && isAdmin && !adminModal.classList.contains('hidden')) {
    refreshTasks.push(loadAdminPanelData());
  }

  if (!refreshTasks.length) {
    return;
  }

  await Promise.allSettled(refreshTasks);
}

function getSharedCoursePayloadFromEditForm() {
  const name = document.getElementById('edit-name').value.trim();
  const currentSessionInput = parseInt(document.getElementById('edit-current-session').value, 10);
  const totalSessionsInput = parseInt(document.getElementById('edit-total-sessions').value, 10);

  return {
    name: name || 'Untitled Course',
    section: document.getElementById('edit-section').value.trim() || null,
    currentsession: Number.isFinite(currentSessionInput) && currentSessionInput >= 0 ? currentSessionInput : 0,
    totalsessions: Number.isFinite(totalSessionsInput) && totalSessionsInput > 0 ? totalSessionsInput : 30,
    topic: document.getElementById('edit-topic').value.trim() || null,
    year: parseInt(document.getElementById('edit-year').value, 10),
    trimester: parseInt(document.getElementById('edit-trimester').value, 10),
    iselective: document.getElementById('edit-elective').checked
  };
}

function getSuggestionPayloadFromEditForm() {
  const sharedPayload = getSharedCoursePayloadFromEditForm();
  return {
    name: sharedPayload.name,
    section: sharedPayload.section,
    currentsession: sharedPayload.currentsession,
    totalsessions: sharedPayload.totalsessions,
    topic: sharedPayload.topic
  };
}

function setFormModeNote(message, tone) {
  editModeNote.textContent = message;
  editModeNote.className = `form-mode-note ${tone}`;
}

function closeEditModal() {
  activeEditCourse = null;
  activeEditMode = isAdmin ? 'admin' : 'suggestion';
  editModal.classList.add('hidden');
}

function openEditModal(course, { mode = 'admin' } = {}) {
  if (mode === 'admin' && !isAdmin) {
    showToast('Admin access is required to edit courses.', 'error');
    return;
  }

  activeEditCourse = course;
  activeEditMode = mode;
  document.getElementById('edit-course-id').value = course.id;
  document.getElementById('edit-name').value = course.name || '';
  document.getElementById('edit-section').value = course.section || '';
  document.getElementById('edit-current-session').value = course.currentsession || 0;
  document.getElementById('edit-total-sessions').value = course.totalsessions || 30;
  document.getElementById('edit-topic').value = course.topic || '';
  document.getElementById('edit-year').value = course.year || 1;
  document.getElementById('edit-trimester').value = course.trimester || 1;
  document.getElementById('edit-elective').checked = !!course.iselective;
  document.getElementById('modal-title').textContent = mode === 'admin' ? 'Edit Course' : 'Suggest Course Update';
  editSubmitBtn.textContent = mode === 'admin' ? 'Save Changes' : 'Submit Suggestion';
  setFormModeNote(
    mode === 'admin'
      ? 'Course updates apply to the live board immediately.'
      : 'Your suggestion will go to admins for review before anything changes on the live board.',
    mode === 'admin' ? 'admin' : 'suggestion'
  );
  adminOnlyFields.style.display = mode === 'admin' ? 'grid' : 'none';

  editModal.classList.remove('hidden');
}

async function handleEditSubmit(event) {
  event.preventDefault();

  const courseId = document.getElementById('edit-course-id').value;
  const isSuggestionMode = activeEditMode === 'suggestion';
  const restoreButton = setButtonBusy(editSubmitBtn, isSuggestionMode ? 'Submitting...' : 'Saving...');

  try {
    if (isSuggestionMode) {
      await withTimeout(
        submitCourseSuggestion(courseId, getSuggestionPayloadFromEditForm()),
        12000,
        'Submitting the suggestion timed out. Please try again.'
      );
      showToast('Suggestion submitted for admin review');
      closeEditModal();
      return;
    }

    if (!isAdmin) {
      showToast('Admin access is required to edit courses.', 'error');
      return;
    }

    const sharedPayload = getSharedCoursePayloadFromEditForm();
    await withTimeout(
      updateCourse(courseId, {
        ...sharedPayload,
        updatedby: currentUser.email
      }),
      12000,
      'Saving the course timed out. Please try again.'
    );
    await refreshBoardAndAdmin({ board: true, admin: true });
    showToast('Course updated successfully');
    closeEditModal();
  } catch (error) {
    showToast(
      error.message || (isSuggestionMode ? 'Unable to submit your suggestion.' : 'Unable to save this change.'),
      'error'
    );
  } finally {
    restoreButton();
  }
}

function buildCourseTemplateOptions(courses) {
  const templateMap = new Map();

  courses.forEach(course => {
    const key = [
      (course.name || '').trim().toLowerCase(),
      course.year ?? '',
      course.trimester ?? '',
      course.iselective ? '1' : '0'
    ].join('::');

    if (!templateMap.has(key)) {
      templateMap.set(key, course);
    }
  });

  return [...templateMap.values()];
}

function renderCourseTemplateOptions(courses) {
  const templates = buildCourseTemplateOptions(courses);

  addCourseTemplateSelect.innerHTML = `
    <option value="">Start from scratch</option>
    ${templates.map(course => `
      <option value="${escapeHtml(course.id)}">
        ${escapeHtml(course.name || 'Untitled Course')} • ${escapeHtml(
          course.iselective
            ? 'Elective'
            : `Year ${course.year || '-'} • ${getTrimesterLabel(course.trimester || DEFAULT_TRIMESTER)}`
        )}
      </option>
    `).join('')}
  `;

  addCourseTemplateHelper.textContent = 'Choose an existing course to reuse its core details and add another section quickly.';
}

function handleCourseTemplateSelection() {
  const templateId = addCourseTemplateSelect.value;
  if (!templateId) {
    addCourseTemplateHelper.textContent = 'Choose an existing course to reuse its core details and add another section quickly.';
    return;
  }

  const template = allCourses.find(course => course.id === templateId);
  if (!template) return;

  document.getElementById('add-name').value = template.name || '';
  document.getElementById('add-topic').value = template.topic || '';
  document.getElementById('add-year').value = template.year || '1';
  document.getElementById('add-trimester').value = template.trimester || '1';
  document.getElementById('add-current-session').value = template.currentsession || 0;
  document.getElementById('add-total-sessions').value = template.totalsessions || 30;
  document.getElementById('add-elective-check').checked = !!template.iselective;
  document.getElementById('add-section').value = '';
  addCourseTemplateHelper.textContent = `Copied the core setup from "${template.name}". Add the section letter and live board values below.`;
}

async function handleAddCourse(event) {
  event.preventDefault();

  const submitButton = addCourseForm.querySelector('button[type="submit"]');
  const originalLabel = submitButton.textContent;
  submitButton.disabled = true;
  submitButton.textContent = 'Saving...';
  addCourseFeedback.textContent = '';
  addCourseFeedback.className = 'feedback';

  try {
    const isElective = document.getElementById('add-elective-check').checked;
    const totalSessionsInput = parseInt(document.getElementById('add-total-sessions').value, 10);
    const currentSessionInput = parseInt(document.getElementById('add-current-session').value, 10);

    const courseData = {
      name: document.getElementById('add-name').value.trim() || 'Untitled Course',
      section: document.getElementById('add-section').value.trim() || null,
      year: parseInt(document.getElementById('add-year').value, 10),
      trimester: parseInt(document.getElementById('add-trimester').value, 10),
      currentsession: Number.isFinite(currentSessionInput) && currentSessionInput >= 0 ? currentSessionInput : 0,
      totalsessions: Number.isFinite(totalSessionsInput) && totalSessionsInput > 0 ? totalSessionsInput : 30,
      topic: document.getElementById('add-topic').value.trim() || null,
      iselective: isElective,
      updatedby: currentUser.email
    };

    const createdCourse = await withTimeout(
      createCourse(courseData),
      12000,
      'Saving the course timed out. Please try again.'
    );

    const destinationLabel = (createdCourse?.iselective || courseData.iselective)
      ? 'Electives'
      : `Year ${createdCourse?.year || courseData.year} / ${getTrimesterLabel(createdCourse?.trimester || courseData.trimester)}`;

    addCourseFeedback.textContent = `Added "${courseData.name}" to ${destinationLabel}.`;
    addCourseFeedback.className = 'feedback success';
    showToast('Course added');

    addCourseForm.reset();
    addCourseTemplateSelect.value = '';
    addCourseTemplateHelper.textContent = 'Choose an existing course to reuse its core details and add another section quickly.';
    document.getElementById('add-total-sessions').value = 30;
    document.getElementById('add-current-session').value = 0;

    await refreshBoardAndAdmin({ board: true, admin: true });
  } catch (error) {
    console.error('Add course failed:', error);
    addCourseFeedback.textContent = error.message || 'Unable to add course.';
    addCourseFeedback.className = 'feedback error';
    showToast(error.message || 'Unable to add course.', 'error');
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = originalLabel;
  }
}

function adminRoleRank(entry) {
  if (!entry) return 0;
  return entry.role === 'super_admin' ? 20 : 10;
}

function renderAdminDirectory() {
  if (!isSuperAdmin) {
    adminList.innerHTML = '<div class="empty-admin-state">Only super admins can manage the admin hierarchy.</div>';
    return;
  }

  if (!adminDirectory.length) {
    adminList.innerHTML = '<div class="empty-admin-state">No admins found.</div>';
    return;
  }

  const orderedAdmins = [...adminDirectory].sort((a, b) => {
    const roleDiff = adminRoleRank(b) - adminRoleRank(a);
    if (roleDiff !== 0) return roleDiff;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });

  adminList.innerHTML = orderedAdmins.map(entry => `
    <div class="admin-email-row">
      <div class="admin-email-meta">
        <div class="admin-email-main">
          <span class="admin-role-badge ${entry.role === 'super_admin' ? 'super-admin' : 'admin'}">${escapeHtml(getRoleLabel(entry.role))}</span>
          <span>${escapeHtml(entry.email)}</span>
        </div>
        <span class="text-dim">${escapeHtml(getRoleDescription(entry))}</span>
      </div>
      ${entry.grant_source === 'granted_admin'
        ? `<button class="btn-secondary btn-compact" type="button" data-admin-action="revoke" data-email="${escapeHtml(entry.email)}">Revoke</button>`
        : '<span class="hierarchy-lock">Password-based</span>'}
    </div>
  `).join('');
}

function renderManageCourseRows() {
  if (!allCourses.length) {
    manageCoursesList.innerHTML = '<div class="empty-admin-state">No courses to manage yet.</div>';
    return;
  }

  manageCoursesList.innerHTML = allCourses.map(course => {
    const { currentSession, totalSessions } = getCourseSessionMetrics(course);
    return `
    <div class="manage-course-row">
      <div class="manage-course-copy">
        <div class="delete-course-name">${escapeHtml(course.name || 'Untitled Course')}</div>
        <div class="delete-course-meta">
          ${course.iselective
            ? 'Elective'
            : `${escapeHtml(`Year ${course.year || '-'}`)} • ${escapeHtml(getTrimesterLabel(course.trimester || DEFAULT_TRIMESTER))}`}
          ${course.section ? ` • ${escapeHtml(`Section ${course.section}`)}` : ''}
        </div>
        <div class="manage-course-meta">
          <span>Session ${currentSession} of ${totalSessions}</span>
          <span>${escapeHtml(course.topic || 'Topic update pending')}</span>
        </div>
      </div>
      <div class="manage-course-actions">
        <button class="btn-secondary btn-compact" type="button" data-course-action="edit" data-course-id="${course.id}">Edit</button>
        <button class="btn-danger" type="button" data-course-action="delete" data-course-id="${course.id}" data-course-name="${escapeHtml(course.name || 'Untitled Course')}">Delete</button>
      </div>
    </div>
    `;
  }).join('');
}

function renderAdminRoleSummary() {
  if (!adminAccess) {
    adminRoleSummary.innerHTML = `
      <div class="admin-role-card student">
        <span class="admin-role-card-label">Current access</span>
        <strong>Student</strong>
        <p>Students can view the live board. Admin tools stay hidden until access is granted.</p>
      </div>
    `;
    return;
  }

  adminRoleSummary.innerHTML = `
    <div class="admin-role-card ${adminAccess.role === 'super_admin' ? 'super-admin' : 'admin'}">
      <span class="admin-role-card-label">Current access</span>
      <strong>${escapeHtml(getRoleLabel(adminAccess.role))}</strong>
      <p>${escapeHtml(getRoleDescription(adminAccess))}</p>
    </div>
  `;
}

async function handleSuggestionDecision(action, suggestionId, button = null) {
  const reviewNote = suggestionsList?.querySelector(`[data-suggestion-note="${suggestionId}"]`)?.value.trim() || '';
  const isApproval = action === 'approve';
  const restoreButton = setButtonBusy(button, isApproval ? 'Approving...' : 'Rejecting...');

  try {
    await withTimeout(
      isApproval
        ? approveCourseSuggestion(suggestionId, reviewNote)
        : rejectCourseSuggestion(suggestionId, reviewNote),
      12000,
      `${isApproval ? 'Approving' : 'Rejecting'} the suggestion timed out. Please try again.`
    );
    showToast(isApproval ? 'Suggestion approved' : 'Suggestion rejected');
    await refreshBoardAndAdmin({ board: isApproval, admin: true });
  } catch (error) {
    showToast(error.message || `Unable to ${isApproval ? 'approve' : 'reject'} this suggestion.`, 'error');
  } finally {
    restoreButton();
  }
}

function activateAdminSection(targetId) {
  document.querySelectorAll('.admin-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.target === targetId);
  });

  document.querySelectorAll('.admin-section').forEach(section => {
    section.classList.toggle('active', section.id === targetId);
  });
}

function syncAdminTabVisibility() {
  const passwordTab = document.getElementById('tab-password');
  const adminTabs = document.querySelectorAll('.admin-tab.admin-only-tab');
  const superAdminTabs = document.querySelectorAll('.admin-tab.super-admin-only-tab');

  if (!isAdmin) {
    passwordTab.classList.remove('hidden');
    adminTabs.forEach(tab => tab.classList.add('hidden'));
    superAdminTabs.forEach(tab => tab.classList.add('hidden'));
    return 'section-password';
  }

  passwordTab.classList.add('hidden');
  adminTabs.forEach(tab => tab.classList.remove('hidden'));
  superAdminTabs.forEach(tab => tab.classList.toggle('hidden', !isSuperAdmin));
  return 'section-manage-courses';
}

async function loadAdminPanelData() {
  renderAdminRoleSummary();

  if (!isAdmin) {
    return;
  }

  const [coursesResult, suggestionsResult, adminsResult] = await Promise.allSettled([
    fetchAllCourses(),
    fetchCourseSuggestions('pending'),
    isSuperAdmin ? fetchAdmins() : Promise.resolve([])
  ]);

  let didHitError = false;

  if (coursesResult.status === 'fulfilled') {
    allCourses = coursesResult.value || [];
  } else {
    didHitError = true;
    console.error('Error loading admin courses:', coursesResult.reason);
  }

  if (suggestionsResult.status === 'fulfilled') {
    pendingSuggestions = suggestionsResult.value || [];
  } else {
    didHitError = true;
    console.error('Error loading course suggestions:', suggestionsResult.reason);
  }

  if (adminsResult.status === 'fulfilled') {
    adminDirectory = adminsResult.value;
  } else {
    didHitError = true;
    console.error('Error loading admin directory:', adminsResult.reason);
  }

  renderCourseTemplateOptions(allCourses);
  renderManageCourseRows();
  renderSuggestionQueue();
  renderAdminDirectory();

  if (didHitError) {
    showToast('Some admin data could not be refreshed. Try again in a moment.', 'error');
  }
}

async function openAdminPanel() {
  adminModal.classList.remove('hidden');
  renderAdminRoleSummary();
  const defaultSection = syncAdminTabVisibility();

  if (isAdmin) {
    await loadAdminPanelData();
  }

  activateAdminSection(defaultSection);
}

async function handleAddAdmin(event) {
  event.preventDefault();

  if (!isSuperAdmin) {
    showToast('Only super admins can manage admin access.', 'error');
    return;
  }

  const emailField = document.getElementById('add-admin-email');
  const email = emailField.value.trim();
  const submitButton = addAdminForm.querySelector('button[type="submit"]');
  const restoreButton = setButtonBusy(submitButton, 'Granting...');

  try {
    await withTimeout(
      grantAdminAccess(email),
      12000,
      'Granting admin access timed out. Please try again.'
    );
    emailField.value = '';
    showToast(`Admin granted to ${email.toLowerCase()}`);
    await refreshBoardAndAdmin({ board: false, admin: true });
  } catch (error) {
    showToast(error.message || 'Unable to grant admin access.', 'error');
  } finally {
    restoreButton();
  }
}

async function handleOnboardingSubmit(event) {
  event.preventDefault();

  const submitButton = onboardingForm.querySelector('button[type="submit"]');
  const originalLabel = submitButton.textContent;
  const year = getSelectedPreferenceValue('preferred-year', DEFAULT_YEAR);
  const trimester = getSelectedPreferenceValue('preferred-trimester', DEFAULT_TRIMESTER);
  const view = DEFAULT_VIEW;
  const liveOnly = false;

  onboardingFeedback.textContent = '';
  onboardingFeedback.className = 'feedback';
  submitButton.disabled = true;
  submitButton.textContent = 'Saving...';

  try {
    const result = await saveBoardPreference(year, trimester, view, liveOnly);
    currentUser = result?.user || currentUser;
    setBoardSelection(result?.preference?.year || year, result?.preference?.trimester || trimester, { load: false });
    setBoardView(DEFAULT_VIEW, { load: false });
    await loadData();
    closeOnboardingModal();
    showToast(result?.persistence === 'database'
      ? 'Board setup saved'
      : 'Board setup saved on this device');
  } catch (error) {
    onboardingFeedback.textContent = error.message || 'Unable to save your board preference.';
    onboardingFeedback.className = 'feedback error';
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = originalLabel;
  }
}

async function handleAdminPassword(event) {
  event.preventDefault();

  const password = document.getElementById('admin-password-input').value;
  const feedback = document.getElementById('admin-password-feedback');
  const submitButton = adminPasswordForm.querySelector('button[type="submit"]');
  const restoreButton = setButtonBusy(submitButton, 'Verifying...');

  feedback.textContent = '';
  feedback.className = 'feedback';

  try {
    adminAccess = await withTimeout(
      verifyAdminPassword(password),
      12000,
      'Password verification timed out. Please try again.'
    );
    isAdmin = true;
    isSuperAdmin = true;
    renderUserRole();
    syncAdminTabVisibility();
    document.getElementById('admin-password-input').value = '';
    feedback.textContent = 'Super admin access granted.';
    feedback.className = 'feedback success';
    await loadAdminPanelData();
    activateAdminSection('section-manage-admins');
    showToast('Super admin access granted');
  } catch (error) {
    feedback.textContent = error.message || 'Invalid admin password.';
    feedback.className = 'feedback error';
  } finally {
    restoreButton();
  }
}

async function handleDeleteCourseRequest(courseId, courseName, button = null) {
  if (!window.confirm(`Delete "${courseName}"? This cannot be undone.`)) {
    return;
  }

  const restoreButton = setButtonBusy(button, 'Deleting...');

  try {
    await withTimeout(
      deleteCourse(courseId),
      12000,
      'Deleting the course timed out. Please try again.'
    );
    showToast('Course deleted');
    await refreshBoardAndAdmin({ board: true, admin: true });
  } catch (error) {
    showToast(error.message || 'Unable to delete course.', 'error');
  } finally {
    restoreButton();
  }
}

async function handleRevokeAdminRequest(email, button = null) {
  if (!window.confirm(`Revoke admin access for ${email}?`)) {
    return;
  }

  const restoreButton = setButtonBusy(button, 'Revoking...');

  try {
    await withTimeout(
      revokeAdminAccess(email),
      12000,
      'Revoking admin access timed out. Please try again.'
    );
    showToast(`Admin access revoked for ${email}`);
    await refreshBoardAndAdmin({ board: false, admin: true });
  } catch (error) {
    showToast(error.message || 'Unable to revoke admin access.', 'error');
  } finally {
    restoreButton();
  }
}

async function handleSessionState(session) {
  if (!session) {
    boardLoadRequestId += 1;
    hideLoading();
    currentUser = null;
    currentCourses = [];
    boardCatalog = [];
    allCourses = [];
    adminDirectory = [];
    pendingSuggestions = [];
    adminAccess = null;
    isAdmin = false;
    isSuperAdmin = false;
    boardSearchTerm = '';
    lastBoardLoadedAt = null;
    setBoardLoadNotice('idle');
    currentView = DEFAULT_VIEW;
    if (userEmailEl) {
      userEmailEl.textContent = '';
    }
    adminModal.classList.add('hidden');
    closeEditModal();
    syncBoardTools();
    renderUserRole();
    closeOnboardingModal();

    if (subscription) {
      subscription.unsubscribe();
      subscription = null;
    }

    showLogin();
    return;
  }

  currentUser = session.user;
  const email = getUserEmail(session);
  const cachedBoardPreference = getBoardPreference(session.user);

  if (!isNLSEmail(email)) {
    showToast('Only @nls.ac.in accounts are allowed.', 'error');
    await signOut();
    return;
  }

  if (userEmailEl) {
    userEmailEl.textContent = email;
  }
  adminAccess = await getAdminAccess(email);
  isAdmin = !!adminAccess;
  isSuperAdmin = adminAccess?.role === 'super_admin';
  renderUserRole();

  setBoardSelection(cachedBoardPreference?.year || DEFAULT_YEAR, cachedBoardPreference?.trimester || DEFAULT_TRIMESTER, { load: false });
  setBoardView(DEFAULT_VIEW, { load: false });
  adminToggleBtn.classList.remove('hidden');
  showBoard();

  let boardPreference = cachedBoardPreference;
  try {
    boardPreference = await loadBoardPreference(session.user);
  } catch (error) {
    console.error('Unable to load board preference:', error);
    showToast('Unable to load your saved board. Using the default view instead.', 'error');
  }

  setBoardSelection(boardPreference?.year || DEFAULT_YEAR, boardPreference?.trimester || DEFAULT_TRIMESTER, { load: false });
  setBoardView(DEFAULT_VIEW, { load: false });
  await loadData({ clearVisible: true });

  if (boardPreference) {
    closeOnboardingModal();
  } else {
    openOnboardingModal();
  }

  if (subscription) {
    subscription.unsubscribe();
  }
  subscription = subscribeToCourses(handleRealtimeUpdate);
}

function setupEventListeners() {
  googleBtn.addEventListener('click', async () => {
    try {
      await signInWithGoogle();
    } catch (error) {
      showToast(error.message || 'Unable to sign in.', 'error');
    }
  });

  signoutBtn.addEventListener('click', async () => {
    try {
      await signOut();
    } catch (error) {
      showToast(error.message || 'Unable to sign out.', 'error');
    }
  });

  headerTabs.forEach(tab => {
    tab.addEventListener('click', event => {
      setBoardView(event.currentTarget.dataset.view);
    });
  });

  yearTabs.forEach(tab => {
    tab.addEventListener('click', event => {
      setBoardSelection(event.currentTarget.dataset.year, currentTrimester);
    });
  });

  triTabs.forEach(tab => {
    tab.addEventListener('click', event => {
      setBoardSelection(currentYear, event.currentTarget.dataset.trimester);
    });
  });

  boardSearchInput?.addEventListener('input', event => {
    boardSearchTerm = event.currentTarget.value;
    renderCourses();
  });

  boardSearchClearBtn?.addEventListener('click', event => {
    event.preventDefault();
    boardSearchTerm = '';
    if (boardSearchInput) {
      boardSearchInput.value = '';
      boardSearchInput.focus();
    }
    renderCourses();
  });

  document.getElementById('modal-close').addEventListener('click', closeEditModal);
  document.getElementById('edit-cancel').addEventListener('click', closeEditModal);
  document.getElementById('admin-modal-close').addEventListener('click', () => adminModal.classList.add('hidden'));
  document.getElementById('admin-modal-close-desktop').addEventListener('click', () => adminModal.classList.add('hidden'));
  document.getElementById('onboarding-close').addEventListener('click', closeOnboardingModal);
  document.getElementById('onboarding-cancel').addEventListener('click', closeOnboardingModal);
  editModal.querySelector('.modal-backdrop')?.addEventListener('click', closeEditModal);
  adminModal.querySelector('.modal-backdrop')?.addEventListener('click', () => adminModal.classList.add('hidden'));
  onboardingModal.querySelector('.modal-backdrop')?.addEventListener('click', closeOnboardingModal);

  adminToggleBtn.addEventListener('click', openAdminPanel);
  editForm.addEventListener('submit', handleEditSubmit);
  addCourseForm.addEventListener('submit', handleAddCourse);
  addAdminForm.addEventListener('submit', handleAddAdmin);
  adminPasswordForm.addEventListener('submit', handleAdminPassword);
  onboardingForm.addEventListener('submit', handleOnboardingSubmit);
  addCourseTemplateSelect.addEventListener('change', handleCourseTemplateSelection);

  onboardingYearInputs.forEach(input => input.addEventListener('change', updateOnboardingPreview));
  onboardingTrimesterInputs.forEach(input => input.addEventListener('change', updateOnboardingPreview));

  document.getElementById('add-elective-check')?.addEventListener('change', event => {
    if (event.target.checked && Number(document.getElementById('add-total-sessions').value) === 30) {
      document.getElementById('add-total-sessions').value = 20;
    }
  });

  document.querySelectorAll('.admin-tab').forEach(tab => {
    tab.addEventListener('click', event => {
      const targetId = event.currentTarget.dataset.target;
      if (!targetId) return;

      if (event.currentTarget.classList.contains('hidden')) return;
      if (event.currentTarget.classList.contains('super-admin-only-tab') && !isSuperAdmin) return;
      if (event.currentTarget.classList.contains('admin-only-tab') && !isAdmin) return;

      activateAdminSection(targetId);
    });
  });

  manageCoursesList.addEventListener('click', event => {
    const editButton = event.target.closest('[data-course-action="edit"]');
    if (editButton) {
      const course = allCourses.find(candidate => candidate.id === editButton.dataset.courseId);
      if (course) {
        openEditModal(course, { mode: 'admin' });
      }
      return;
    }

    const deleteButton = event.target.closest('[data-course-action="delete"]');
    if (!deleteButton) return;

    handleDeleteCourseRequest(
      deleteButton.dataset.courseId,
      deleteButton.dataset.courseName || 'this course',
      deleteButton
    );
  });

  adminList.addEventListener('click', event => {
    const button = event.target.closest('[data-admin-action="revoke"]');
    if (!button) return;

    handleRevokeAdminRequest(button.dataset.email, button);
  });

  courseGrid.addEventListener('click', event => {
    const button = event.target.closest('[data-course-card-action="suggest"]');
    if (!button) return;

    const course = currentCourses.find(candidate => candidate.id === button.dataset.courseId);
    if (course) {
      openEditModal(course, { mode: 'suggestion' });
    }
  });

  suggestionsList?.addEventListener('click', event => {
    const button = event.target.closest('[data-suggestion-action]');
    if (!button) return;

    handleSuggestionDecision(
      button.dataset.suggestionAction,
      button.dataset.suggestionId,
      button
    );
  });
}

async function init() {
  const sessionTimeout = setTimeout(() => {
    if (initScreen?.classList.contains('active')) {
      console.warn('Session check timed out, falling back to login screen.');
      showLogin();
    }
  }, 5000);

  try {
    setupEventListeners();
  } catch (error) {
    console.error('setupEventListeners failed:', error);
  }

  try {
    const sessionPromise = supabase.auth.getSession();
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('getSession timeout')), 4500);
    });
    const { data: { session } } = await Promise.race([sessionPromise, timeoutPromise]);
    clearTimeout(sessionTimeout);
    await handleSessionState(session);
  } catch (error) {
    clearTimeout(sessionTimeout);
    console.error('Initial session check failed:', error);
    await handleSessionState(null);
  }

  onAuthStateChange(async (event, session) => {
    if (event === 'INITIAL_SESSION') return;
    await handleSessionState(session);
  });
}

init();
