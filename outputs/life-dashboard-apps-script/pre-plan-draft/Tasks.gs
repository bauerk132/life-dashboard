function getTasks_() {
  return getRows_(CONFIG.SHEETS.TASKS)
    .filter(function(task) { return task.status !== 'Archived'; })
    .sort(function(a, b) {
      const completed = Number(a.status === 'Done') - Number(b.status === 'Done');
      if (completed) return completed;
      return new Date(a.due_date || 8640000000000000) - new Date(b.due_date || 8640000000000000);
    });
}

function createTask(input) {
  if (!input || !String(input.title || '').trim()) throw new Error('A task title is required.');
  const now = new Date();
  const task = {
    id: Utilities.getUuid(),
    title: String(input.title).trim(),
    due_date: input.dueDate ? new Date(input.dueDate) : '',
    priority: ['Low', 'Medium', 'High'].indexOf(input.priority) > -1 ? input.priority : 'Medium',
    status: 'Open', created_at: now, completed_at: ''
  };
  appendRecord_(CONFIG.SHEETS.TASKS, task);
  return task;
}

function setTaskStatus(taskId, status) {
  if (['Open', 'Done', 'Archived'].indexOf(status) === -1) throw new Error('Invalid task status.');
  updateRecord_(CONFIG.SHEETS.TASKS, taskId, {
    status: status,
    completed_at: status === 'Done' ? new Date() : ''
  });
  return { id: taskId, status: status };
}
