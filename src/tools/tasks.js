/**
 * Tasks Tool (Mock Implementation)
 */

let mockTasks = [];

/**
 * @param {string} [date] Optional date string (ISO or YYYY-MM-DD) to filter tasks due on or before
 * @returns {Array<import('../models/types').Task>}
 */
function get_tasks(date) {
    if (!date) return mockTasks;

    const targetDate = new Date(date).getTime();
    return mockTasks.filter(task => {
        if (!task.due_date) return true; // Tasks without due dates are always returned
        return new Date(task.due_date).getTime() <= targetDate;
    });
}

/**
 * @param {Omit<import('../models/types').Task, 'id' | 'status'>} taskData
 * @returns {import('../models/types').Task}
 */
function create_task(taskData) {
    const newTask = {
        id: `tsk_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        status: 'pending',
        ...taskData
    };
    mockTasks.push(newTask);
    return newTask;
}

/**
 * @param {string} parentId
 * @param {Omit<import('../models/types').Task, 'id' | 'status' | 'parent_task_id'>} subtaskData
 * @returns {import('../models/types').Task}
 */
function create_subtask(parentId, subtaskData) {
    return create_task({ ...subtaskData, parent_task_id: parentId });
}

/**
 * @param {string} id
 * @returns {import('../models/types').Task | null}
 */
function complete_task(id) {
    return update_task(id, { status: 'completed' });
}

/**
 * @param {string} id
 * @param {Partial<import('../models/types').Task>} updates
 * @returns {import('../models/types').Task | null}
 */
function update_task(id, updates) {
    const index = mockTasks.findIndex(t => t.id === id);
    if (index === -1) return null;

    mockTasks[index] = { ...mockTasks[index], ...updates };
    return mockTasks[index];
}

/**
 * @param {string} id
 * @param {string} newDate ISO string
 * @returns {import('../models/types').Task | null}
 */
function reschedule_task(id, newDate) {
    return update_task(id, { due_date: newDate, status: 'pending' });
}

// For testing purposes
function _setMockTasks(tasks) {
    mockTasks = [...tasks];
}

module.exports = {
    get_tasks,
    create_task,
    create_subtask,
    complete_task,
    update_task,
    reschedule_task,
    _setMockTasks
};
