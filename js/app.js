import { signInWithGoogle, signOut, onAuthStateChange, isNLSEmail, checkIsAdmin, getUserEmail, getBoardPreference, loadBoardPreference, saveBoardPreference } from './auth.js';
import { fetchCourses, subscribeToCourses, updateCourse, createCourse, deleteCourse } from './data.js';
import { addAdmin, fetchAdmins, verifyAdminPassword } from './admin.js';
import { supabase } from './supabase.js';

// DOM Elements
const initScreen = document.getElementById('init-screen');
const loginScreen = document.getElementById('login-screen');
const boardScreen = document.getElementById('board-screen');
const googleBtn = document.getElementById('google-signin-btn');
const signoutBtn = document.getElementById('signout-btn');
const boardPreferenceBtn = document.getElementById('board-preference-btn');
const userEmailEl = document.getElementById('user-email');
const adminToggleBtn = document.getElementById('admin-toggle-btn');
const onboardingModal = document.getElementById('onboarding-modal');
const onboardingForm = document.getElementById('onboarding-form');
const onboardingFeedback = document.getElementById('onboarding-feedback');
const onboardingPreview = document.getElementById('onboarding-preview');
const onboardingYearInputs = document.querySelectorAll('input[name="preferred-year"]');
const onboardingTrimesterInputs = document.querySelectorAll('input[name="preferred-trimester"]');

const yearTabs = document.querySelectorAll('.year-tab');
const triTabs = document.querySelectorAll('.tri-tab');
const trimesterNav = document.getElementById('trimester-nav');
const courseGrid = document.getElementById('course-grid');
const emptyState = document.getElementById('empty-state');
const loading = document.getElementById('board-loading');
const toastContainer = document.getElementById('toast-container');

// Edit Modal Elements
const editModal = document.getElementById('edit-modal');
const editForm = document.getElementById('edit-form');
const adminOnlyFields = document.getElementById('admin-only-fields');
const editStatusGroup = document.getElementById('edit-status-group');

// Admin Modal Elements
const adminModal = document.getElementById('admin-modal');
const addCourseForm = document.getElementById('add-course-form');
const addCourseFeedback = document.getElementById('add-course-feedback');
const addAdminForm = document.getElementById('add-admin-form');
const adminPasswordForm = document.getElementById('admin-password-form');
const adminList = document.getElementById('admin-list');
const deleteCourseList = document.getElementById('delete-course-list');

// State
const DEFAULT_YEAR = '1';
const DEFAULT_TRIMESTER = '1';
let currentUser = null;
let isAdmin = false;
let currentYear = DEFAULT_YEAR;
let currentTrimester = DEFAULT_TRIMESTER;
let currentCourses = [];
let subscription = null;
const SECTION_TONES = [
  { accent: '#d4a843', soft: 'rgba(212, 168, 67, 0.14)', glow: 'rgba(212, 168, 67, 0.32)' },
  { accent: '#6ea8fe', soft: 'rgba(110, 168, 254, 0.14)', glow: 'rgba(110, 168, 254, 0.32)' },
  { accent: '#3ddc84', soft: 'rgba(61, 220, 132, 0.14)', glow: 'rgba(61, 220, 132, 0.32)' },
  { accent: '#fb923c', soft: 'rgba(251, 146, 60, 0.14)', glow: 'rgba(251, 146, 60, 0.32)' },
  { accent: '#f87171', soft: 'rgba(248, 113, 113, 0.14)', glow: 'rgba(248, 113, 113, 0.32)' },
  { accent: '#8bd3dd', soft: 'rgba(139, 211, 221, 0.14)', glow: 'rgba(139, 211, 221, 0.32)' }
];

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

function getTrimesterLabel(value) {
  return {
    '1': 'Trimester I',
    '2': 'Trimester II',
    '3': 'Trimester III'
  }[normalizeTrimester(value)];
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
  onboardingPreview.textContent = `You'll open directly to Year ${selectedYear} / ${getTrimesterLabel(selectedTrimester)}.`;
}

function syncBoardSelectionUi() {
  yearTabs.forEach(tab => {
    tab.classList.toggle('active', tab.dataset.year === currentYear);
  });

  triTabs.forEach(tab => {
    tab.classList.toggle('active', tab.dataset.trimester === currentTrimester);
  });

  if (currentYear === 'electives') {
    trimesterNav.classList.add('hidden');
  } else {
    trimesterNav.classList.remove('hidden');
  }
}

function setBoardSelection(year, trimester, { load = true } = {}) {
  currentYear = normalizeYear(year);
  currentTrimester = normalizeTrimester(trimester);
  syncBoardSelectionUi();

  if (load) {
    loadData();
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

async function handleSessionState(session) {
  if (session) {
    currentUser = session.user;
    const email = getUserEmail(session);
    const cachedBoardPreference = getBoardPreference(session.user);
    
    if (!isNLSEmail(email)) {
      showToast('Only @nls.ac.in accounts are allowed.', 'error');
      await signOut();
      return;
    }
    
    userEmailEl.textContent = email;
    isAdmin = await checkIsAdmin(email);
    setBoardSelection(cachedBoardPreference?.year || DEFAULT_YEAR, cachedBoardPreference?.trimester || DEFAULT_TRIMESTER, { load: false });
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
    await loadData();

    if (boardPreference) {
      closeOnboardingModal();
    } else {
      openOnboardingModal();
    }
    
    if (subscription) subscription.unsubscribe();
    subscription = subscribeToCourses(handleRealtimeUpdate);
  } else {
    currentUser = null;
    isAdmin = false;
    closeOnboardingModal();
    if (subscription) {
      subscription.unsubscribe();
      subscription = null;
    }
    showLogin();
  }
}

// Initialization
async function init() {
  // Hard timeout set FIRST — guarantees the spinner never gets permanently stuck
  const sessionTimeout = setTimeout(() => {
    if (initScreen && initScreen.classList.contains('active')) {
      console.warn('Session check timed out — falling back to login screen.');
      showLogin();
    }
  }, 5000);

  // Safe event listener setup — crash here won't block session check
  try {
    setupEventListeners();
  } catch (e) {
    console.error('setupEventListeners failed:', e);
  }

  try {
    const sessionPromise = supabase.auth.getSession();
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('getSession timeout')), 4500)
    );
    const { data: { session } } = await Promise.race([sessionPromise, timeoutPromise]);
    clearTimeout(sessionTimeout);
    await handleSessionState(session);
  } catch (e) {
    clearTimeout(sessionTimeout);
    console.error('Initial session check failed:', e);
    await handleSessionState(null);
  }

  onAuthStateChange(async (event, session) => {
    if (event === 'INITIAL_SESSION') return;
    await handleSessionState(session);
  });
}

function showLogin() {
  if (initScreen) {
    initScreen.classList.remove('active');
    initScreen.classList.remove('init-loading');
    initScreen.style.display = 'none';
  }
  loginScreen.classList.add('active');
  boardScreen.classList.remove('active');
}

function showBoard() {
  if (initScreen) {
    initScreen.classList.remove('active');
    initScreen.classList.remove('init-loading');
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
  setTimeout(() => toast.remove(), 3000);
}

// Data Loading
async function loadData() {
  showLoading();
  try {
    currentCourses = await fetchCourses(currentYear, currentYear === 'electives' ? null : currentTrimester);
    renderCourses();
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    hideLoading();
  }
}

function handleRealtimeUpdate(payload) {
  // Simple approach: reload data if anything changes
  // A better approach would be to merge the payload into currentCourses
  loadData();
}

function getTodayRoom(course) {
  let todayRoom = 'No class today';
  try {
    if (course.weeklyschedule) {
      const sched = readScheduleMap(course.weeklyschedule);
      const dayOfWeek = new Date().getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
      if (sched[dayOfWeek] && sched[dayOfWeek].trim() !== '') {
        todayRoom = sched[dayOfWeek];
      } else {
        let nextDay = -1;
        for(let i=1; i<=7; i++) {
          const checkDay = (dayOfWeek + i) % 7;
          if(sched[checkDay] && sched[checkDay].trim() !== '') {
            nextDay = checkDay;
            break;
          }
        }
        if(nextDay !== -1) {
          const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
          todayRoom = `Next: ${dayNames[nextDay]} (${sched[nextDay]})`;
        }
      }
    }
  } catch (e) {
    todayRoom = course.weeklyschedule || 'TBA';
  }
  return todayRoom;
}

function renderCourses() {
  courseGrid.innerHTML = '';
  if (currentCourses.length === 0) {
    emptyState.classList.remove('hidden');
    courseGrid.appendChild(emptyState);
    return;
  }
  
  emptyState.classList.add('hidden');
  
  // Group courses by name
  const groupedCourses = {};
  currentCourses.forEach(course => {
    const key = course.name || 'Untitled Course';
    if (!groupedCourses[key]) {
      groupedCourses[key] = [];
    }
    groupedCourses[key].push(course);
  });

  Object.entries(groupedCourses).forEach(([courseName, sections]) => {
    const baseCourse = sections[0];
    const card = document.createElement('div');
    card.className = 'course-card';
    
    // Sort sections: Core first, then A, B, C etc.
    sections.sort((a, b) => {
      if (!a.section && b.section) return -1;
      if (a.section && !b.section) return 1;
      return (a.section || '').localeCompare(b.section || '');
    });

    const typeBadge = baseCourse.iselective
      ? '<span class="course-badge">Elective</span>'
      : `<span class="course-badge">Trimester ${escapeHtml(baseCourse.trimester || currentTrimester)}</span>`;

    let cardHtml = `
      <div class="course-card-header">
        <h3 class="course-card-title">${escapeHtml(courseName)}</h3>
        ${typeBadge}
      </div>
      <div class="course-sections">
    `;

    sections.forEach(course => {
      const sectionTone = getSectionTone(course.section);
      let todayRoom = getTodayRoom(course);
      
      const sessionPct = Math.min(100, Math.max(0, ((course.currentsession || 0) / (course.totalsessions || 30)) * 100));
      
      const sectionBadge = course.section 
        ? `<span class="section-badge" style="color: ${sectionTone.accent}; background: ${sectionTone.soft}; border-color: ${sectionTone.glow}">Section ${escapeHtml(course.section)}</span>`
        : `<span class="section-badge muted">Core</span>`;

      cardHtml += `
        <div class="course-section-row" data-id="${course.id}">
          <div class="section-header">
            ${sectionBadge}
            <div class="section-meta">
              <span class="section-prof">${escapeHtml(course.professor || 'TBA')}</span>
              <span class="meta-dot">•</span>
              <span class="section-room">${escapeHtml(todayRoom)}</span>
            </div>
          </div>
          ${course.topic ? `<div class="section-topic-large">${escapeHtml(course.topic)}</div>` : `<div class="section-topic-large empty">No topic assigned</div>`}
          <div class="section-progress-large">
            <div class="progress-stats">
              <span class="progress-label">Session Progress</span>
              <span class="progress-numbers" style="color: ${sectionTone.accent}">${course.currentsession || 0} <span class="progress-total">/ ${course.totalsessions || 30}</span></span>
            </div>
            <div class="progress-bar-wrap">
              <div class="progress-bar-fill" style="width: ${sessionPct}%; background: ${sectionTone.accent}; box-shadow: 0 0 8px ${sectionTone.glow}"></div>
            </div>
          </div>
        </div>
      `;
    });

    cardHtml += `</div>`;
    card.innerHTML = cardHtml;
    
    const rows = card.querySelectorAll('.course-section-row');
    rows.forEach(row => {
      row.addEventListener('click', () => {
        const c = sections.find(s => s.id === row.dataset.id);
        if (c) openEditModal(c);
      });
    });

    // Stagger animation
    card.style.animationDelay = `${Math.random() * 0.2}s`;
    courseGrid.appendChild(card);
  });
}

function showLoading() { loading.classList.remove('hidden'); }
function hideLoading() { loading.classList.add('hidden'); }

// Event Listeners
function setupEventListeners() {
  googleBtn.addEventListener('click', async () => {
    try {
      await signInWithGoogle();
    } catch (e) {
      showToast(e.message, 'error');
    }
  });
  
  signoutBtn.addEventListener('click', () => signOut());
  boardPreferenceBtn.addEventListener('click', () => openOnboardingModal(getBoardPreference(currentUser) || {
    year: currentYear,
    trimester: currentTrimester
  }));
  
  // Navigation
  yearTabs.forEach(tab => {
    tab.addEventListener('click', (e) => {
      setBoardSelection(e.target.dataset.year, currentTrimester);
    });
  });
  
  triTabs.forEach(tab => {
    tab.addEventListener('click', (e) => {
      setBoardSelection(currentYear, e.target.dataset.trimester);
    });
  });
  
  // Modals
  document.getElementById('modal-close').addEventListener('click', () => editModal.classList.add('hidden'));
  document.getElementById('edit-cancel').addEventListener('click', () => editModal.classList.add('hidden'));
  document.getElementById('admin-modal-close').addEventListener('click', () => adminModal.classList.add('hidden'));
  
  adminToggleBtn.addEventListener('click', openAdminPanel);
  
  editForm.addEventListener('submit', handleEditSubmit);
  addCourseForm.addEventListener('submit', handleAddCourse);
  addAdminForm.addEventListener('submit', handleAddAdmin);
  adminPasswordForm.addEventListener('submit', handleAdminPassword);
  onboardingForm.addEventListener('submit', handleOnboardingSubmit);
  onboardingYearInputs.forEach(input => input.addEventListener('change', updateOnboardingPreview));
  onboardingTrimesterInputs.forEach(input => input.addEventListener('change', updateOnboardingPreview));
  
  // Dynamic total sessions for electives
  document.getElementById('add-elective-check').addEventListener('change', (e) => {
    document.getElementById('add-total-sessions').value = e.target.checked ? 20 : 30;
  });
  
  document.getElementById('edit-elective').addEventListener('change', (e) => {
    document.getElementById('edit-total-sessions').value = e.target.checked ? 20 : 30;
  });
  
  // Admin Tabs Logic
  document.querySelectorAll('.admin-tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      // Ignore clicks on restricted tabs if not admin
      if (e.target.classList.contains('restricted-tab') && !isAdmin) return;
      
      document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.admin-section').forEach(s => s.classList.remove('active'));
      
      e.target.classList.add('active');
      document.getElementById(e.target.dataset.target).classList.add('active');
    });
  });
  
  // Desktop close button
  document.getElementById('admin-modal-close-desktop').addEventListener('click', () => adminModal.classList.add('hidden'));
}

// Edit Flow
function openEditModal(course) {
  document.getElementById('edit-course-id').value = course.id;
  document.getElementById('edit-name').value = course.name;
  document.getElementById('edit-section').value = course.section || '';
  document.getElementById('edit-professor').value = course.professor;
  document.getElementById('edit-current-session').value = course.currentsession || 0;
  document.getElementById('edit-total-sessions').value = course.totalsessions || 30;
  document.getElementById('edit-topic').value = course.topic || '';
  document.getElementById('edit-outline').value = course.outline || '';
  
  const sched = readScheduleMap(course.weeklyschedule);
  
  for(let i=1; i<=6; i++) {
    document.getElementById(`edit-sched-${i}`).value = sched[i] || '';
  }

  if (isAdmin) {
    adminOnlyFields.style.display = 'flex';
    editStatusGroup.style.display = 'block';
    document.getElementById('edit-year').value = course.year;
    document.getElementById('edit-trimester').value = course.trimester;
    document.getElementById('edit-elective').checked = course.iselective;
    document.getElementById('edit-status').value = course.status || 'active';
  } else {
    adminOnlyFields.style.display = 'none';
    editStatusGroup.style.display = 'none';
  }
  
  editModal.classList.remove('hidden');
}

async function handleEditSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('edit-course-id').value;
  const name = document.getElementById('edit-name').value.trim() || 'Untitled Course';
  const section = document.getElementById('edit-section').value.trim();
  const professor = document.getElementById('edit-professor').value.trim() || 'TBA';
  const topic = document.getElementById('edit-topic').value.trim();
  const outline = document.getElementById('edit-outline').value.trim();
  const totalSessionsInput = parseInt(document.getElementById('edit-total-sessions').value, 10);
  const currentSessionInput = parseInt(document.getElementById('edit-current-session').value, 10);
  
  let sched = {};
  for(let i=1; i<=6; i++) {
    const val = document.getElementById(`edit-sched-${i}`).value.trim();
    if (val) sched[i] = val;
  }

  const updates = {
    name,
    section: section || null,
    professor,
    currentsession: Number.isFinite(currentSessionInput) && currentSessionInput >= 0 ? currentSessionInput : 0,
    totalsessions: Number.isFinite(totalSessionsInput) && totalSessionsInput > 0 ? totalSessionsInput : 30,
    topic: topic || null,
    outline: outline || null,
    weeklyschedule: Object.keys(sched).length ? JSON.stringify(sched) : null,
    updatedby: currentUser.email
  };
  
  if (isAdmin) {
    updates.year = parseInt(document.getElementById('edit-year').value);
    updates.trimester = parseInt(document.getElementById('edit-trimester').value);
    updates.iselective = document.getElementById('edit-elective').checked;
    updates.status = document.getElementById('edit-status').value;
  }
  
  try {
    await updateCourse(id, updates);
    showToast('Course updated successfully');
    editModal.classList.add('hidden');
    // loadData() will be called by realtime listener
  } catch (error) {
    showToast(error.message, 'error');
  }
}

// Admin Flow
async function openAdminPanel() {
  adminModal.classList.remove('hidden');
  
  const restrictedTabs = document.querySelectorAll('.restricted-tab');
  const restrictedSections = document.querySelectorAll('.restricted-section');
  const tabPassword = document.getElementById('tab-password');
  
  if (!isAdmin) {
    // Non-admin: Hide restricted tabs and sections
    restrictedTabs.forEach(t => t.style.display = 'none');
    restrictedSections.forEach(s => s.classList.remove('active'));
    
    // Show password tab and section
    tabPassword.style.display = 'block';
    tabPassword.click();
    return; // Don't load admin data
  }
  
  // Admin view: Show restricted tabs
  restrictedTabs.forEach(t => t.style.display = 'block');
  
  // Hide password tab
  tabPassword.style.display = 'none';
  
  // Click first restricted tab (Add Course)
  document.getElementById('tab-add-course').click();

  try {
    const admins = await fetchAdmins();
    adminList.innerHTML = admins.map(a => `
      <div class="admin-email-row">
        <span>${a.email}</span>
        <span class="text-dim">by ${a.grantedby}</span>
      </div>
    `).join('');
    
    // Load courses for deletion
    const { data: allCourses } = await supabase.from('courses').select('id, name').order('name');
    deleteCourseList.innerHTML = (allCourses || []).map(c => `
      <div class="delete-course-row">
        <span class="delete-course-name">${c.name}</span>
        <button class="btn-danger" onclick="window.handleDeleteCourse('${c.id}')">Delete</button>
      </div>
    `).join('');
    
  } catch (e) {
    showToast('Error loading admin data: ' + e.message, 'error');
  }
}

async function handleAddCourse(e) {
  e.preventDefault();
  const submitButton = addCourseForm.querySelector('button[type="submit"]');
  const originalLabel = submitButton.textContent;
  const courseName = document.getElementById('add-name').value.trim() || 'Untitled Course';
  const section = document.getElementById('add-section').value.trim();
  const professor = document.getElementById('add-professor').value.trim() || 'TBA';
  const topic = document.getElementById('add-topic').value.trim();
  const isElective = document.getElementById('add-elective-check').checked;
  const totalSessionsInput = parseInt(document.getElementById('add-total-sessions').value, 10);
  const currentSessionInput = parseInt(document.getElementById('add-current-session').value, 10);
  const totalSessions = Number.isFinite(totalSessionsInput) && totalSessionsInput > 0
    ? totalSessionsInput
    : (isElective ? 20 : 30);
  const currentSession = Number.isFinite(currentSessionInput) && currentSessionInput >= 0
    ? currentSessionInput
    : 0;

  addCourseFeedback.textContent = '';
  addCourseFeedback.className = 'feedback';
  submitButton.disabled = true;
  submitButton.textContent = 'Adding...';

  let sched = {};
  for(let i=1; i<=6; i++) {
    const val = document.getElementById(`add-sched-${i}`).value.trim();
    if (val) sched[i] = val;
  }

  const courseData = {
    name: courseName,
    section: section || null,
    professor,
    year: parseInt(document.getElementById('add-year').value),
    trimester: parseInt(document.getElementById('add-trimester').value),
    totalsessions: totalSessions,
    currentsession: currentSession,
    topic: topic || null,
    iselective: isElective,
    status: 'active',
    weeklyschedule: Object.keys(sched).length ? JSON.stringify(sched) : null,
    updatedby: currentUser.email
  };
  
  try {
    await withTimeout(
      createCourse(courseData),
      12000,
      'Saving the course timed out. Please try again.'
    );
    showToast('Course added');
    addCourseFeedback.textContent = `Added "${courseData.name}".`;
    addCourseFeedback.className = 'feedback success';
    addCourseForm.reset();
    document.getElementById('add-total-sessions').value = 30;
    document.getElementById('add-current-session').value = 0;
    loadData();
    if (!adminModal.classList.contains('hidden')) openAdminPanel(); // refresh lists
  } catch (error) {
    console.error('Add course failed:', error);
    addCourseFeedback.textContent = error.message || 'Unable to add course.';
    addCourseFeedback.className = 'feedback error';
    showToast(error.message, 'error');
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = originalLabel;
  }
}

async function handleAddAdmin(e) {
  e.preventDefault();
  const email = document.getElementById('add-admin-email').value;
  try {
    await addAdmin(email, currentUser.email);
    showToast('Admin granted to ' + email);
    document.getElementById('add-admin-email').value = '';
    openAdminPanel(); // refresh list
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function handleOnboardingSubmit(e) {
  e.preventDefault();
  const submitButton = onboardingForm.querySelector('button[type="submit"]');
  const originalLabel = submitButton.textContent;
  const year = getSelectedPreferenceValue('preferred-year', DEFAULT_YEAR);
  const trimester = getSelectedPreferenceValue('preferred-trimester', DEFAULT_TRIMESTER);

  onboardingFeedback.textContent = '';
  onboardingFeedback.className = 'feedback';
  submitButton.disabled = true;
  submitButton.textContent = 'Saving...';

  try {
    const result = await saveBoardPreference(year, trimester);
    currentUser = result?.user || currentUser;
    setBoardSelection(result?.preference?.year || year, result?.preference?.trimester || trimester);
    closeOnboardingModal();
    showToast(result?.persistence === 'database'
      ? 'Default board saved'
      : 'Default board saved on this device');
  } catch (error) {
    onboardingFeedback.textContent = error.message || 'Unable to save your board preference.';
    onboardingFeedback.className = 'feedback error';
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = originalLabel;
  }
}

async function handleAdminPassword(e) {
  e.preventDefault();
  const password = document.getElementById('admin-password-input').value;
  const feedback = document.getElementById('admin-password-feedback');
  
  try {
    const success = await verifyAdminPassword(password, currentUser.email);
    if (success) {
      feedback.textContent = 'Admin access granted. Refreshing...';
      feedback.className = 'feedback success';
      setTimeout(() => window.location.reload(), 1500);
    } else {
      feedback.textContent = 'Invalid password.';
      feedback.className = 'feedback error';
    }
  } catch (error) {
    feedback.textContent = 'Error: ' + error.message;
    feedback.className = 'feedback error';
  }
}

// Expose delete to window for inline onclick handler
window.handleDeleteCourse = async function(id) {
  if (!confirm('Are you sure you want to delete this course?')) return;
  try {
    await deleteCourse(id);
    showToast('Course deleted');
    openAdminPanel(); // refresh list
  } catch (error) {
    showToast(error.message, 'error');
  }
};

// Start
init();
