import { supabase } from './supabase.js';

const VALID_PREFERENCE_YEARS = ['1', '2', '3', '4', '5'];
const VALID_PREFERENCE_TRIMESTERS = ['1', '2', '3'];
const BOARD_PREFERENCE_STORAGE_KEY = 'nls-board-preference';

function getAuthRedirectUrl() {
  let configuredUrl = '';
  try {
    // Safely check for import.meta.env to prevent crashes on simple static servers
    if (typeof import.meta !== 'undefined' && import.meta.env) {
      configuredUrl = import.meta.env.VITE_APP_URL?.trim();
    }
  } catch (e) {
    // Ignore environment error
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

function normalizeBoardPreference(preference) {
  const year = preference?.year != null
    ? String(preference.year)
    : (preference?.preferred_year != null ? String(preference.preferred_year) : null);
  const trimester = preference?.trimester != null
    ? String(preference.trimester)
    : (preference?.preferred_trimester != null ? String(preference.preferred_trimester) : null);

  if (!VALID_PREFERENCE_YEARS.includes(year) || !VALID_PREFERENCE_TRIMESTERS.includes(trimester)) {
    return null;
  }

  return { year, trimester };
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
      trimester: preference.trimester
    }));
  } catch (error) {
    // Ignore
  }
}

export function getBoardPreference(user) {
  // We don't rely on user_metadata anymore, strictly cache or DB
  return readCachedBoardPreference(user);
}

export async function loadBoardPreference(user = null) {
  const currentUser = user || (await supabase.auth.getSession()).data.session?.user;
  const fallbackPreference = getBoardPreference(currentUser);

  if (!currentUser?.id) {
    return fallbackPreference;
  }

  try {
    const { data, error } = await Promise.race([
      supabase.from('user_preferences')
        .select('preferred_year, preferred_trimester')
        .eq('user_id', currentUser.id)
        .maybeSingle(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Network timeout')), 4000))
    ]);

    if (error) {
      console.error('Error loading preference from DB:', error);
      return fallbackPreference;
    }

    const databasePreference = normalizeBoardPreference(data);
    if (databasePreference) {
      cacheBoardPreference(currentUser, databasePreference);
      return databasePreference;
    }
    
    return fallbackPreference;
  } catch (e) {
    console.error('Load preference error:', e);
    return fallbackPreference;
  }
}

export async function saveBoardPreference(year, trimester) {
  const preference = normalizeBoardPreference({ year, trimester });

  if (!preference) {
    throw new Error('Please choose a valid year and trimester.');
  }

  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !session?.user) throw new Error('Please sign in again and retry.');
  const user = session.user;

  // Immediately cache to unblock UI if network is slow
  cacheBoardPreference(user, preference);

  try {
    // Wrap the DB call in a timeout
    const { data, error } = await Promise.race([
      supabase.from('user_preferences').upsert({
        user_id: user.id,
        preferred_year: parseInt(preference.year, 10),
        preferred_trimester: parseInt(preference.trimester, 10)
      }, { onConflict: 'user_id' }).select('preferred_year, preferred_trimester').maybeSingle(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Network timeout')), 6000))
    ]);

    if (error) {
      console.error('Database update error:', error);
      throw error;
    }
    
    const savedPreference = normalizeBoardPreference(data) || preference;
    cacheBoardPreference(user, savedPreference);

    return {
      user,
      preference: savedPreference,
      persistence: 'database'
    };
  } catch (e) {
    console.error('Save preference error:', e);
    // Even if it fails (e.g. table doesn't exist), return the local persistence so UI proceeds
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

export async function checkIsAdmin(email) {
  if (!email) return false;
  try {
    const { data } = await supabase.from('admins').select('email').eq('email', email.toLowerCase()).maybeSingle();
    return !!data;
  } catch (e) {
    return false;
  }
}
