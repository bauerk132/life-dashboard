/**
 * @typedef {Object} Task
 * @property {string} id - Unique identifier
 * @property {string} title - Title of the task
 * @property {string} [description] - Description of the task
 * @property {string} [due_date] - Due date (ISO string)
 * @property {string} [deadline] - Hard deadline (ISO string)
 * @property {number} estimated_duration - Estimated duration in minutes
 * @property {number} priority - Priority level (1 is highest)
 * @property {'pending' | 'in_progress' | 'completed' | 'deferred'} status - Current status
 * @property {string} [project] - Associated project name
 * @property {string} [parent_task_id] - ID of parent task if it's a subtask
 * @property {string[]} [labels] - Tags or labels
 */

/**
 * @typedef {Object} CalendarEvent
 * @property {string} id - Unique identifier
 * @property {string} title - Title of the event
 * @property {string} start - Start time (ISO string)
 * @property {string} end - End time (ISO string)
 * @property {string} [location] - Location of the event
 * @property {string} [notes] - Additional notes
 */

/**
 * @typedef {Object} DailyPlanBlock
 * @property {string} title - Title of the block
 * @property {string} start - Start time (ISO string)
 * @property {string} end - End time (ISO string)
 * @property {string} [task_id] - Associated task ID, if any
 * @property {'task' | 'event' | 'break' | 'meal' | 'travel'} type - Type of the block
 * @property {number} priority - Priority level
 * @property {'pending' | 'completed' | 'skipped'} status - Status of the block
 */

module.exports = {};
