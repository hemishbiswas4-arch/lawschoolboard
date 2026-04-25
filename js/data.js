import { supabase } from './supabase.js';

function extractMissingColumn(error) {
  const errorText = [error?.message, error?.details, error?.hint].filter(Boolean).join(' ');
  const singleQuoteMatch = errorText.match(/'([^']+)' column/i);
  if (singleQuoteMatch) return singleQuoteMatch[1];

  const doubleQuoteMatch = errorText.match(/column "([^"]+)"/i);
  if (doubleQuoteMatch) return doubleQuoteMatch[1];

  return null;
}

function getErrorText(error) {
  return [error?.message, error?.details, error?.hint].filter(Boolean).join(' ');
}

function isMissingSupportTable(error) {
  const errorText = getErrorText(error).toLowerCase();
  return errorText.includes('support_requests') && (
    errorText.includes('does not exist') ||
    errorText.includes('could not find') ||
    error?.code === '42p01'
  );
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function ensureMutationResult(data, message) {
  if (Array.isArray(data) && data.length > 0) {
    return data[0];
  }

  if (data && typeof data === 'object') {
    return data;
  }

  throw new Error(message);
}

function shouldParseWeeklySchedule(error, payload) {
  const errorText = getErrorText(error).toLowerCase();
  return typeof payload.weeklyschedule === 'string' &&
    errorText.includes('weeklyschedule') &&
    (errorText.includes('json') || error?.code === '22p02');
}

function shouldStringifyWeeklySchedule(error, payload) {
  const errorText = getErrorText(error).toLowerCase();
  return isPlainObject(payload.weeklyschedule) &&
    errorText.includes('weeklyschedule') &&
    (
      errorText.includes('type text') ||
      errorText.includes('type character varying') ||
      errorText.includes('type varchar') ||
      errorText.includes('expression is of type json') ||
      errorText.includes('expression is of type jsonb')
    );
}

async function runCourseWrite(operation, initialPayload) {
  const payload = { ...initialPayload };

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const { data, error } = await operation(payload);
    if (!error) return data;

    const missingColumn = extractMissingColumn(error);
    if (missingColumn && Object.prototype.hasOwnProperty.call(payload, missingColumn)) {
      console.warn(`Dropping unsupported course column "${missingColumn}" before retrying save.`);
      delete payload[missingColumn];
      continue;
    }

    if (shouldParseWeeklySchedule(error, payload)) {
      payload.weeklyschedule = JSON.parse(payload.weeklyschedule);
      continue;
    }

    if (shouldStringifyWeeklySchedule(error, payload)) {
      payload.weeklyschedule = JSON.stringify(payload.weeklyschedule);
      continue;
    }

    throw error;
  }

  throw new Error('Unable to save the course after multiple retries.');
}

export async function fetchCourses(year, trimester) {
  let query = supabase
    .from('courses')
    .select('id, name, year, trimester, section, totalsessions, currentsession, topic, lastupdated, updatedby');

  if (year === 'electives') {
    query = query.eq('iselective', true);
  } else {
    query = query.eq('iselective', false).eq('year', parseInt(year, 10));
    if (trimester) {
      query = query.eq('trimester', parseInt(trimester, 10));
    }
  }

  const { data, error } = await query
    .order('name')
    .order('section', { ascending: true, nullsFirst: true });

  if (error) throw error;
  return data || [];
}

export async function fetchAllCourses() {
  const { data, error } = await supabase
    .from('courses')
    .select('id, name, section, year, trimester, iselective, topic, totalsessions, currentsession, created_at')
    .order('name')
    .order('section', { ascending: true, nullsFirst: true });

  if (error) throw error;
  return data || [];
}

export function subscribeToCourses(callback) {
  return supabase
    .channel('public:courses')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'courses' }, payload => {
      callback(payload);
    })
    .subscribe();
}

export async function updateCourse(id, updates) {
  const data = await runCourseWrite(
    payload => supabase
      .from('courses')
      .update(payload)
      .eq('id', id)
      .select(),
    { ...updates, lastupdated: new Date().toISOString() }
  );

  return ensureMutationResult(
    data,
    'The course update was not confirmed. Please refresh and try again.'
  );
}

export async function createCourse(courseData) {
  const data = await runCourseWrite(
    payload => supabase
      .from('courses')
      .insert([payload])
      .select(),
    { ...courseData, lastupdated: new Date().toISOString() }
  );

  return ensureMutationResult(
    data,
    'The new course was not confirmed. Please refresh and try again.'
  );
}

export async function deleteCourse(id) {
  const { data, error } = await supabase
    .from('courses')
    .delete()
    .eq('id', id)
    .select('id');

  if (error) throw error;

  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('The course could not be deleted. Please refresh and try again.');
  }

  return true;
}

export async function submitCourseSuggestion(courseId, payload) {
  const { data, error } = await supabase.rpc('submit_course_suggestion', {
    target_course_id: courseId,
    raw_payload: payload
  });

  if (error) throw error;
  return ensureMutationResult(
    data,
    'Your suggestion was not confirmed. Please refresh and try again.'
  );
}

export async function fetchCourseSuggestions(status = 'pending') {
  let query = supabase
    .from('course_suggestions')
    .select(`
      id,
      course_id,
      suggested_by_email,
      payload,
      status,
      review_note,
      submitted_at,
      reviewed_at,
      reviewed_by_email,
      course:courses (
        id,
        name,
        section,
        year,
        trimester,
        iselective,
        topic,
        currentsession,
        totalsessions
      )
    `)
    .order('submitted_at', { ascending: true });

  if (status) {
    query = query.eq('status', status);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function approveCourseSuggestion(suggestionId, reviewMessage = '') {
  const { data, error } = await supabase.rpc('approve_course_suggestion', {
    target_suggestion_id: suggestionId,
    review_message: reviewMessage || null
  });

  if (error) throw error;
  return ensureMutationResult(
    data,
    'The suggestion approval was not confirmed. Please refresh and try again.'
  );
}

export async function rejectCourseSuggestion(suggestionId, reviewMessage = '') {
  const { data, error } = await supabase.rpc('reject_course_suggestion', {
    target_suggestion_id: suggestionId,
    review_message: reviewMessage || null
  });

  if (error) throw error;
  return ensureMutationResult(
    data,
    'The suggestion rejection was not confirmed. Please refresh and try again.'
  );
}

export async function fetchSupportRequests() {
  const { data, error } = await supabase
    .from('support_requests')
    .select('id, category, subject, message, status, created_at')
    .order('created_at', { ascending: false })
    .limit(8);

  if (error) {
    if (isMissingSupportTable(error)) {
      return [];
    }
    throw error;
  }

  return data || [];
}

export async function createSupportRequest(payload) {
  const { data, error } = await supabase
    .from('support_requests')
    .insert([payload])
    .select();

  if (error) {
    if (isMissingSupportTable(error)) {
      throw new Error('Support inbox is not configured on this deployment yet.');
    }
    throw error;
  }

  return ensureMutationResult(
    data,
    'Your support request was not confirmed. Please try again.'
  );
}
