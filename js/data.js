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

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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

/**
 * Fetch courses based on year and trimester
 */
export async function fetchCourses(year, trimester) {
  let query = supabase.from('courses').select('*');
  
  if (year === 'electives') {
    query = query.eq('iselective', true);
  } else {
    query = query.eq('iselective', false).eq('year', parseInt(year));
    if (trimester) {
      query = query.eq('trimester', parseInt(trimester));
    }
  }
  
  const { data, error } = await query.order('name');
  if (error) throw error;
  return data;
}

/**
 * Subscribe to real-time changes on courses
 */
export function subscribeToCourses(callback) {
  return supabase.channel('public:courses')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'courses' }, payload => {
      callback(payload);
    })
    .subscribe();
}

/**
 * Update a course (Student/Admin)
 */
export async function updateCourse(id, updates) {
  const data = await runCourseWrite(
    payload => supabase
      .from('courses')
      .update(payload)
      .eq('id', id)
      .select(),
    { ...updates, lastupdated: new Date().toISOString() }
  );

  return data[0];
}

/**
 * Create a new course (Admin only)
 */
export async function createCourse(courseData) {
  const data = await runCourseWrite(
    payload => supabase
      .from('courses')
      .insert([payload]),
    { ...courseData, lastupdated: new Date().toISOString() }
  );

  return Array.isArray(data) ? data[0] : null;
}

/**
 * Delete a course (Admin only)
 */
export async function deleteCourse(id) {
  const { error } = await supabase.from('courses').delete().eq('id', id);
  if (error) throw error;
}
