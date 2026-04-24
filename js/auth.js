import { supabase } from './supabase.js';

const VALID_PREFERENCE_YEARS = ['1', '2', '3', '4', '5'];
const VALID_PREFERENCE_TRIMESTERS = ['1', '2', '3'];
const BOARD_PREFERENCE_STORAGE_KEY = 'nls-board-preference';

function getAuthRedirectUrl() {
  const configuredUrl = import.meta.env.VITE_APP_URL?.trim();
  if (configuredUrl) {
    try {
      const normalizedConfiguredUrl = configuredUrl.replace(/\/+$/, '');
      const configuredHost = new URL(normalizedConfiguredUrl).hostname;
      const currentHost = window.location.hostname;
      const configuredIsLocalhost = ['localhost', '127.0.0.1'].includes(configuredHost);
      const currentIsLocalhost = ['localhost', '127.0.0.1'].includes(currentHost);

      // Never let a production page inherit a localhost redirect target.
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

function readMetadataBoardPreference(user) {
  return normalizeBoardPreference({
    preferred_year: user?.user_metadata?.preferred_year,
    preferred_trimester: user?.user_metadata?.preferred_trimester
  });
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
      const rawPreference = window.localStorage.getItem(BOARD_PREFERENCE_STORAGE_KEY);
      const parsedPreference = rawPreference ? JSON.parse(rawPreference) : null;
      if (parsedPreference?.userId === user.id) {
        window.localStorage.removeItem(BOARD_PREFERENCE_STORAGE_KEY);
      }
      return;
    }

    window.localStorage.setItem(BOARD_PREFERENCE_STORAGE_KEY, JSON.stringify({
      userId: user.id,
      year: preference.year,
      trimester: preference.trimester
    }));
  } catch (error) {
    // Ignore storage failures. The database remains the source of truth.
  }
}

function isMissingPreferencesTableError(error) {
  const errorCode = error?.code || '';
  const message = error?.message || '';

  return errorCode === '42P01'
    || errorCode === 'PGRST205'
    || message.toLowerCase().includes('user_preferences');
}

async function writeBoardPreferenceToDatabase(user, preference) {
  const { data, error } = await supabase
    .from('user_preferences')
    .upsert({
      user_id: user.id,
      preferred_year: parseInt(preference.year, 10),
      preferred_trimester: parseInt(preference.trimester, 10)
    }, { onConflict: 'user_id' })
    .select('preferred_year, preferred_trimester')
    .maybeSingle();

  if (error) throw error;

  return normalizeBoardPreference(data) || preference;
}

export function getBoardPreference(user) {
  return readCachedBoardPreference(user) || readMetadataBoardPreference(user);
}

export async function loadBoardPreference(user = null) {
  const currentUser = user || (await supabase.auth.getUser()).data.user;
  const fallbackPreference = getBoardPreference(currentUser);

  if (!currentUser?.id) {
    return fallbackPreference;
  }

  const { data, error } = await supabase
    .from('user_preferences')
    .select('preferred_year, preferred_trimester')
    .eq('user_id', currentUser.id)
    .maybeSingle();

  if (error) {
    if (isMissingPreferencesTableError(error)) {
      cacheBoardPreference(currentUser, fallbackPreference);
      return fallbackPreference;
    }

    throw error;
  }

  const databasePreference = normalizeBoardPreference(data);

  if (!databasePreference && fallbackPreference) {
    try {
      const migratedPreference = await writeBoardPreferenceToDatabase(currentUser, fallbackPreference);
      cacheBoardPreference(currentUser, migratedPreference);
      return migratedPreference;
    } catch (migrationError) {
      if (!isMissingPreferencesTableError(migrationError)) {
        console.warn('Unable to backfill board preference into the database:', migrationError);
      }
    }
  }

  const resolvedPreference = databasePreference || fallbackPreference;
  cacheBoardPreference(currentUser, resolvedPreference);
  return resolvedPreference;
}

export async function saveBoardPreference(year, trimester) {
  const preference = normalizeBoardPreference({ year, trimester });

  if (!preference) {
    throw new Error('Please choose a valid year and trimester.');
  }

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!user) throw new Error('Please sign in again and retry.');

  try {
    const savedPreference = await writeBoardPreferenceToDatabase(user, preference);
    cacheBoardPreference(user, savedPreference);
    return {
      user,
      preference: savedPreference,
      persistence: 'database'
    };
  } catch (error) {
    if (!isMissingPreferencesTableError(error)) {
      throw error;
    }

    const existingMetadata = user.user_metadata || {};
    const { error: metadataError } = await supabase.auth.updateUser({
      data: {
        ...existingMetadata,
        preferred_year: preference.year,
        preferred_trimester: preference.trimester
      }
    });

    if (metadataError) {
      throw new Error('Board preferences table is missing in Supabase. Run the SQL in the repo to enable account-wide saving.');
    }

    cacheBoardPreference(user, preference);
    return {
      user,
      preference,
      persistence: 'metadata'
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
  const { data } = await supabase.from('admins').select('email').eq('email', email.toLowerCase()).maybeSingle();
  return !!data;
}
