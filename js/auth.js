import { supabase } from './supabase.js';

const VALID_PREFERENCE_YEARS = ['1', '2', '3', '4', '5', 'electives'];
const VALID_PREFERENCE_TRIMESTERS = ['1', '2', '3'];
const VALID_PREFERENCE_VIEWS = ['live', 'archive', 'registry'];
const BOARD_PREFERENCE_STORAGE_KEY = 'nls-board-preference';

function normalizeAdminAccess(record) {
  if (!record) return null;

  const grantedByEmail = record.granted_by_email || record.grantedby || null;
  const grantSource = record.grant_source || (grantedByEmail ? 'granted_admin' : 'system_password');
  const role = record.role || (grantSource === 'system_password' ? 'super_admin' : 'admin');

  return {
    ...record,
    email: String(record.email || '').toLowerCase(),
    role,
    grant_source: grantSource,
    granted_by_email: grantedByEmail,
    created_at: record.created_at || record.updated_at || null,
    updated_at: record.updated_at || record.created_at || null
  };
}

function getAdminAccessRank(record) {
  if (!record) return 0;
  if (record.role === 'super_admin') return 20;
  if (record.role === 'admin') return 10;
  return 0;
}

function pickPreferredAdminAccess(records) {
  const normalizedRecords = (records || [])
    .map(normalizeAdminAccess)
    .filter(entry => entry?.email);

  if (!normalizedRecords.length) {
    return null;
  }

  return normalizedRecords.sort((left, right) => {
    const rankDiff = getAdminAccessRank(right) - getAdminAccessRank(left);
    if (rankDiff !== 0) return rankDiff;

    const leftUpdatedAt = new Date(left.updated_at || left.created_at || 0).getTime();
    const rightUpdatedAt = new Date(right.updated_at || right.created_at || 0).getTime();
    return rightUpdatedAt - leftUpdatedAt;
  })[0];
}

function getErrorText(error) {
  return [error?.message, error?.details, error?.hint].filter(Boolean).join(' ');
}

function hasMissingPreferenceColumn(error) {
  const errorText = getErrorText(error).toLowerCase();
  return errorText.includes('preferred_view') || errorText.includes('default_live_only');
}

function normalizeBooleanPreference(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    return ['true', '1', 'yes', 'on'].includes(value.toLowerCase());
  }
  if (typeof value === 'number') {
    return value === 1;
  }
  return false;
}

function getAuthRedirectUrl() {
  let configuredUrl = '';
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env) {
      configuredUrl = import.meta.env.VITE_APP_URL?.trim();
    }
  } catch (error) {
    // Ignore environment errors from simple static deployments.
  }

  if (configuredUrl) {
    try {
      const normalizedConfiguredUrl = configuredUrl.replace(/\/+$/, '');
      const configuredHost = new URL(normalizedConfiguredUrl).hostname;
      const currentHost = window.location.hostname;
      const configuredIsLocalhost = ['localhost', '127.0.0.1'].includes(configuredHost);
      const currentIsLocalhost = ['localhost', '127.0.0.1'].includes(currentHost);

      if (!configuredIsLocalhost || currentIsLocalhost) {
        return normalizedConfiguredUrl;
      }
    } catch (error) {
      console.warn('Ignoring invalid VITE_APP_URL for auth redirect:', error);
    }
  }

  return window.location.origin;
}

function normalizeBoardPreference(preference) {
  const year = preference?.year != null
    ? String(preference.year)
    : (preference?.preferred_year != null ? String(preference.preferred_year) : null);
  const trimester = preference?.trimester != null
    ? String(preference.trimester)
    : (preference?.preferred_trimester != null ? String(preference.preferred_trimester) : null);
  const view = preference?.view != null
    ? String(preference.view)
    : (preference?.preferred_view != null ? String(preference.preferred_view) : 'live');
  const liveOnly = preference?.liveOnly != null
    ? normalizeBooleanPreference(preference.liveOnly)
    : normalizeBooleanPreference(preference?.default_live_only);

  if (!VALID_PREFERENCE_YEARS.includes(year)) {
    return null;
  }

  if (year !== 'electives' && !VALID_PREFERENCE_TRIMESTERS.includes(trimester)) {
    return null;
  }

  return {
    year,
    trimester: VALID_PREFERENCE_TRIMESTERS.includes(trimester) ? trimester : '1',
    view: VALID_PREFERENCE_VIEWS.includes(view) ? view : 'live',
    liveOnly
  };
}

function readCachedBoardPreference(user) {
  if (!user?.id) return null;

  try {
    const rawPreference = window.localStorage.getItem(BOARD_PREFERENCE_STORAGE_KEY);
    if (!rawPreference) return null;

    const parsedPreference = JSON.parse(rawPreference);
    if (parsedPreference?.userId !== user.id) return null;

    return normalizeBoardPreference(parsedPreference);
  } catch (error) {
    return null;
  }
}

function cacheBoardPreference(user, preference) {
  if (!user?.id) return;

  try {
    if (!preference) {
      window.localStorage.removeItem(BOARD_PREFERENCE_STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(BOARD_PREFERENCE_STORAGE_KEY, JSON.stringify({
      userId: user.id,
      year: preference.year,
      trimester: preference.trimester,
      view: preference.view || 'live',
      liveOnly: !!preference.liveOnly
    }));
  } catch (error) {
    // Ignore local storage failures.
  }
}

export async function signInWithGoogle() {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      queryParams: { hd: 'nls.ac.in' },
      redirectTo: getAuthRedirectUrl()
    }
  });

  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

export function getBoardPreference(user) {
  return readCachedBoardPreference(user);
}

export async function loadBoardPreference(user = null) {
  const currentUser = user || (await supabase.auth.getSession()).data.session?.user;
  const fallbackPreference = getBoardPreference(currentUser);

  if (!currentUser?.id) {
    return fallbackPreference;
  }

  try {
    let data = null;
    let error = null;

    ({ data, error } = await Promise.race([
      supabase
        .from('user_preferences')
        .select('preferred_year, preferred_trimester, preferred_view, default_live_only')
        .eq('user_id', currentUser.id)
        .maybeSingle(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Network timeout')), 4000))
    ]));

    if (error && hasMissingPreferenceColumn(error)) {
      ({ data, error } = await Promise.race([
        supabase
          .from('user_preferences')
          .select('preferred_year, preferred_trimester')
          .eq('user_id', currentUser.id)
          .maybeSingle(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Network timeout')), 4000))
      ]));
    }

    if (error) {
      console.error('Error loading preference from DB:', error);
      return fallbackPreference;
    }

    const databasePreference = normalizeBoardPreference(data);
    if (fallbackPreference?.year === 'electives') {
      return fallbackPreference;
    }

    if (databasePreference) {
      cacheBoardPreference(currentUser, databasePreference);
      return databasePreference;
    }

    return fallbackPreference;
  } catch (error) {
    console.error('Load preference error:', error);
    return fallbackPreference;
  }
}

export async function saveBoardPreference(year, trimester, view = 'live', liveOnly = false) {
  const preference = normalizeBoardPreference({ year, trimester, view, liveOnly });

  if (!preference) {
    throw new Error('Please choose a valid year and trimester.');
  }

  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !session?.user) {
    throw new Error('Please sign in again and retry.');
  }

  const user = session.user;
  cacheBoardPreference(user, preference);

  if (preference.year === 'electives') {
    return {
      user,
      preference,
      persistence: 'local'
    };
  }

  try {
    let data = null;
    let error = null;

    ({ data, error } = await Promise.race([
      supabase
        .from('user_preferences')
        .upsert({
          user_id: user.id,
          preferred_year: parseInt(preference.year, 10),
          preferred_trimester: parseInt(preference.trimester, 10),
          preferred_view: preference.view,
          default_live_only: !!preference.liveOnly
        }, { onConflict: 'user_id' })
        .select('preferred_year, preferred_trimester, preferred_view, default_live_only')
        .maybeSingle(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Network timeout')), 6000))
    ]));

    if (error && hasMissingPreferenceColumn(error)) {
      ({ data, error } = await Promise.race([
        supabase
          .from('user_preferences')
          .upsert({
            user_id: user.id,
            preferred_year: parseInt(preference.year, 10),
            preferred_trimester: parseInt(preference.trimester, 10)
          }, { onConflict: 'user_id' })
          .select('preferred_year, preferred_trimester')
          .maybeSingle(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Network timeout')), 6000))
      ]));
    }

    if (error) {
      console.error('Database update error:', error);
      throw error;
    }

    const savedPreference = normalizeBoardPreference({
      ...data,
      preferred_view: data?.preferred_view ?? preference.view,
      default_live_only: data?.default_live_only ?? preference.liveOnly
    }) || preference;
    cacheBoardPreference(user, savedPreference);

    return {
      user,
      preference: savedPreference,
      persistence: 'database'
    };
  } catch (error) {
    console.error('Save preference error:', error);
    return {
      user,
      preference,
      persistence: 'local'
    };
  }
}

export function getUserEmail(session) {
  return session?.user?.email || null;
}

export function isNLSEmail(email) {
  return email ? email.toLowerCase().endsWith('@nls.ac.in') : false;
}

export function onAuthStateChange(callback) {
  return supabase.auth.onAuthStateChange(callback);
}

export async function getAdminAccess(email) {
  if (!email) return null;

  try {
    const normalizedEmail = email.toLowerCase();
    const { data, error } = await supabase
      .from('admins')
      .select('*')
      .eq('email', normalizedEmail)
      .limit(25);

    if (error) {
      throw error;
    }

    return pickPreferredAdminAccess(data);
  } catch (error) {
    return null;
  }
}

export async function checkIsAdmin(email) {
  const adminAccess = await getAdminAccess(email);
  return !!adminAccess;
}
