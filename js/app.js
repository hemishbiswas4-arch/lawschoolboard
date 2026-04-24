import { signInWithGoogle, signOut, onAuthStateChange, isNLSEmail, checkIsAdmin, getUserEmail } from './auth.js';
import { fetchCourses, subscribeToCourses, updateCourse, createCourse, deleteCourse } from './data.js';
import { addAdmin, fetchAdmins, verifyAdminPassword } from './admin.js';
import { supabase } from './supabase.js';

// DOM Elements
const loginScreen = document.getElementById('login-screen');
const boardScreen = document.getElementById('board-screen');
const googleBtn = document.getElementById('google-signin-btn');
const signoutBtn = document.getElementById('signout-btn');
const userEmailEl = document.getElementById('user-email');
const adminToggleBtn = document.getElementById('admin-toggle-btn');

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
let currentUser = null;
let isAdmin = false;
let currentYear = '1';
let currentTrimester = '1';
let currentCourses = [];
let subscription = null;

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

// Initialization
function init() {
  onAuthStateChange(async (event, session) => {
    if (session) {
      currentUser = session.user;
      const email = getUserEmail(session);
      
      if (!isNLSEmail(email)) {
        showToast('Only @nls.ac.in accounts are allowed.', 'error');
        await signOut();
        return;
      }
      
      userEmailEl.textContent = email;
      isAdmin = await checkIsAdmin(email);
      // Admin toggle is always visible so users can enter the password to become admin
      adminToggleBtn.classList.remove('hidden');
      
      showBoard();
      loadData();
      
      // Setup realtime listener
      if (subscription) subscription.unsubscribe();
      subscription = subscribeToCourses(handleRealtimeUpdate);
    } else {
      currentUser = null;
      isAdmin = false;
      if (subscription) {
        subscription.unsubscribe();
        subscription = null;
      }
      showLogin();
    }
  });

  setupEventListeners();
}

function showLogin() {
  loginScreen.classList.add('active');
  boardScreen.classList.remove('active');
}

function showBoard() {
  loginScreen.classList.remove('active');
  boardScreen.classList.active = true;
  boardScreen.classList.add('active'); // Added to fix rendering
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

// UI Rendering
function renderCourses() {
  courseGrid.innerHTML = '';
  if (currentCourses.length === 0) {
    emptyState.classList.remove('hidden');
    courseGrid.appendChild(emptyState);
    return;
  }
  
  emptyState.classList.add('hidden');
  
  currentCourses.forEach(course => {
    const tile = document.createElement('div');
    tile.className = 'course-tile';
    tile.dataset.id = course.id;
    
    let todayRoom = 'No class today';
    try {
      if (course.weeklyschedule) {
        const sched = readScheduleMap(course.weeklyschedule);
        const dayOfWeek = new Date().getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
        if (sched[dayOfWeek] && sched[dayOfWeek].trim() !== '') {
          todayRoom = sched[dayOfWeek];
        } else {
          // Find next available class
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
      // Fallback if it's legacy text
      todayRoom = course.weeklyschedule || 'TBA';
    }

    tile.innerHTML = `
      <div class="tile-header" style="justify-content: flex-end;">
        <div class="tile-status ${course.status || 'active'}"></div>
      </div>
      <h3 class="tile-name">${course.name}${course.section ? ` <span class="tile-section">(Sec ${course.section})</span>` : ''}</h3>
      <div class="tile-info">
        <div class="tile-row">
          <span class="tile-label">Prof</span>
          <span class="tile-value">${course.professor || 'TBA'}</span>
        </div>
        <div class="tile-row">
          <span class="tile-label">Room</span>
          <span class="tile-value tile-classroom">${todayRoom}</span>
        </div>
        <div class="tile-row">
          <span class="tile-label">Session</span>
          <span class="tile-value tile-session">${course.currentsession || 0} / ${course.totalsessions || 30}</span>
        </div>
        ${course.topic ? `<div class="tile-topic">${course.topic}</div>` : ''}
      </div>
    `;
    
    tile.addEventListener('click', () => openEditModal(course));
    courseGrid.appendChild(tile);
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
  
  // Navigation
  yearTabs.forEach(tab => {
    tab.addEventListener('click', (e) => {
      yearTabs.forEach(t => t.classList.remove('active'));
      e.target.classList.add('active');
      currentYear = e.target.dataset.year;
      
      if (currentYear === 'electives') {
        trimesterNav.classList.add('hidden');
      } else {
        trimesterNav.classList.remove('hidden');
      }
      loadData();
    });
  });
  
  triTabs.forEach(tab => {
    tab.addEventListener('click', (e) => {
      triTabs.forEach(t => t.classList.remove('active'));
      e.target.classList.add('active');
      currentTrimester = e.target.dataset.trimester;
      loadData();
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
