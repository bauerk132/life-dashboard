const test = require('node:test');
const assert = require('node:assert');

const plannerAgent = require('../src/agent/planner_agent');
const timeTool = require('../src/tools/time');
const calendarTool = require('../src/tools/calendar');
const tasksTool = require('../src/tools/tasks');

test('Planning Edge Cases', async (t) => {

    await t.test('Overlapping calendar events are detected as conflicts', () => {
        // Setup mock time
        const now = new Date('2024-05-15T09:00:00Z');
        timeTool.setMockTime(now.toISOString());

        // Setup overlapping events
        calendarTool._setMockEvents([
            { id: 'e1', title: 'Meeting A', start: '2024-05-15T10:00:00Z', end: '2024-05-15T11:00:00Z' },
            { id: 'e2', title: 'Meeting B', start: '2024-05-15T10:30:00Z', end: '2024-05-15T11:30:00Z' }
        ]);

        tasksTool._setMockTasks([]);

        const plan = plannerAgent.plan_day();
        assert.ok(plan.conflicts.length > 0, 'Should detect overlap conflict');
        assert.match(plan.conflicts[0], /Overlap between/);
    });

    await t.test('Too many tasks for available time defer some tasks', () => {
        const now = new Date('2024-05-15T20:00:00Z'); // Start late
        timeTool.setMockTime(now.toISOString());

        calendarTool._setMockEvents([]);

        // Create tasks that take more than 2 hours (cutoff is 22:00)
        tasksTool._setMockTasks([
            { id: 't1', title: 'Task 1', estimated_duration: 60, priority: 1, status: 'pending' },
            { id: 't2', title: 'Task 2', estimated_duration: 60, priority: 2, status: 'pending' },
            { id: 't3', title: 'Task 3', estimated_duration: 60, priority: 3, status: 'pending' } // Will be deferred
        ]);

        const plan = plannerAgent.plan_day();

        assert.strictEqual(plan.deferred_tasks.length, 1, 'One task should be deferred due to time constraints');
        assert.strictEqual(plan.deferred_tasks[0].id, 't3', 'Lowest priority task should be deferred');
    });

    await t.test('User starts the day late', () => {
        const lateStart = new Date('2024-05-15T13:00:00Z');
        timeTool.setMockTime(lateStart.toISOString());

        calendarTool._setMockEvents([]);
        tasksTool._setMockTasks([
            { id: 't1', title: 'Task 1', estimated_duration: 30, priority: 1, status: 'pending' }
        ]);

        const plan = plannerAgent.plan_day();

        const firstBlockStart = new Date(plan.schedule[0].start).getTime();
        assert.ok(firstBlockStart >= lateStart.getTime(), 'First task should not start before the late start time');
    });

    await t.test('Replanning preserves future hard appointments', () => {
        const now = new Date('2024-05-15T14:00:00Z');
        timeTool.setMockTime(now.toISOString());

        calendarTool._setMockEvents([
            { id: 'e1', title: 'Future Appt', start: '2024-05-15T16:00:00Z', end: '2024-05-15T17:00:00Z' }
        ]);

        tasksTool._setMockTasks([
            { id: 't1', title: 'Flex Task', estimated_duration: 60, priority: 1, status: 'pending' }
        ]);

        const plan = plannerAgent.replan_day();

        const eventBlock = plan.schedule.find(s => s.type === 'event');
        assert.ok(eventBlock, 'Future appointment should be in the schedule');
        assert.strictEqual(new Date(eventBlock.start).toISOString(), '2024-05-15T16:00:00.000Z', 'Future appointment time should be preserved');
    });

    await t.test('User misses a planned work block', () => {
        // Setup initial schedule
        const now = new Date('2024-05-15T10:00:00Z'); // Current time is after task was supposed to happen
        timeTool.setMockTime(now.toISOString());

        calendarTool._setMockEvents([]);
        tasksTool._setMockTasks([
            // Task that should have started at 9AM but is still pending
            { id: 't1', title: 'Missed Task', estimated_duration: 30, priority: 1, status: 'pending' }
        ]);

        const plan = plannerAgent.replan_day();

        const firstBlockStart = new Date(plan.schedule[0].start).getTime();
        assert.ok(firstBlockStart >= now.getTime(), 'Missed task should be replanned to start after current time');
        assert.strictEqual(plan.schedule[0].task_id, 't1', 'Missed task should be the next scheduled task');
    });

    await t.test('User completes a task early', () => {
         const now = new Date('2024-05-15T09:15:00Z'); // Current time is 15 mins into a 60 min task
         timeTool.setMockTime(now.toISOString());

         calendarTool._setMockEvents([]);
         tasksTool._setMockTasks([
             { id: 't1', title: 'Early Task', estimated_duration: 60, priority: 1, status: 'completed' }, // Completed early
             { id: 't2', title: 'Next Task', estimated_duration: 30, priority: 2, status: 'pending' }
         ]);

         const plan = plannerAgent.replan_day();

         const nextTaskStart = new Date(plan.schedule.find(s => s.type === 'task').start).getTime();
         // The next task should now start at the current time (9:15) instead of waiting for 10:00
         assert.ok(nextTaskStart >= now.getTime() && nextTaskStart < new Date('2024-05-15T10:00:00Z').getTime(), 'Next task should be pulled forward since previous task finished early');
    });

    await t.test('A new urgent task appears', () => {
        const now = new Date('2024-05-15T10:00:00Z');
        timeTool.setMockTime(now.toISOString());

        calendarTool._setMockEvents([]);
        tasksTool._setMockTasks([
            { id: 't1', title: 'Important Task', estimated_duration: 60, priority: 2, status: 'pending' },
            // A new urgent task was just added
            { id: 't2', title: 'URGENT Fire', estimated_duration: 30, priority: 1, status: 'pending' }
        ]);

        const plan = plannerAgent.replan_day();

        assert.strictEqual(plan.schedule[0].task_id, 't2', 'Urgent task should be scheduled first');
        assert.strictEqual(plan.schedule[1].task_id, 't1', 'Lower priority task should be pushed back');
    });

    await t.test('A large task must be broken into subtasks', () => {
         // Testing the orchestrator's break down method
         const result = plannerAgent.break_down_project("Write Term Paper");

         assert.ok(result.tasks.length > 1, 'Project should be broken down into multiple tasks');
         assert.ok(result.milestones.length > 0, 'Project breakdown should include milestones');
    });

    await t.test('Calendar data is unavailable', () => {
        const now = new Date('2024-05-15T09:00:00Z');
        timeTool.setMockTime(now.toISOString());

        // Simulate calendar failure by monkey-patching
        const originalGetEvents = calendarTool.get_events;
        calendarTool.get_events = () => { throw new Error('Calendar API Down'); };

        try {
            tasksTool._setMockTasks([
                 { id: 't1', title: 'Task 1', estimated_duration: 30, priority: 1, status: 'pending' }
            ]);

            // Assuming agent should either handle the error or fail gracefully. For simplicity, we just check if it propagates.
            assert.throws(() => plannerAgent.plan_day(), Error);
        } finally {
            // Restore
            calendarTool.get_events = originalGetEvents;
        }
    });

    await t.test('Task provider is unavailable', () => {
        const now = new Date('2024-05-15T09:00:00Z');
        timeTool.setMockTime(now.toISOString());

        // Simulate tasks failure by monkey-patching
        const originalGetTasks = tasksTool.get_tasks;
        tasksTool.get_tasks = () => { throw new Error('Tasks API Down'); };

        try {
            calendarTool._setMockEvents([]);

            assert.throws(() => plannerAgent.plan_day(), Error);
        } finally {
            // Restore
            tasksTool.get_tasks = originalGetTasks;
        }
    });


    await t.test('Completing a task removes it from replanned schedule', () => {
        const now = new Date('2024-05-15T09:00:00Z');
        timeTool.setMockTime(now.toISOString());

        calendarTool._setMockEvents([]);
        tasksTool._setMockTasks([
            { id: 't1', title: 'To do', estimated_duration: 30, priority: 1, status: 'completed' },
            { id: 't2', title: 'Next thing', estimated_duration: 30, priority: 2, status: 'pending' }
        ]);

        const plan = plannerAgent.replan_day();

        assert.strictEqual(plan.schedule.filter(s => s.type === 'task').length, 1, 'Only pending tasks should be scheduled');
        assert.strictEqual(plan.schedule.find(s => s.type === 'task').task_id, 't2', 'Completed task should not be scheduled');
    });

    await t.test('User has no scheduled obligations', () => {
        timeTool.setMockTime('2024-05-15T09:00:00Z');
        calendarTool._setMockEvents([]);
        tasksTool._setMockTasks([]);

        const plan = plannerAgent.plan_day();

        assert.strictEqual(plan.schedule.length, 0, 'Schedule should be empty');
        assert.strictEqual(plan.deferred_tasks.length, 0, 'No tasks deferred');
        assert.strictEqual(plan.next_action, null, 'No next action');
    });

});