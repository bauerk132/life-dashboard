const timeTool = require('../tools/time');
const calendarTool = require('../tools/calendar');
const tasksTool = require('../tools/tasks');

/**
 * Creates blocks from a list of tasks and events, respecting constraints.
 * This is a deterministic heuristic logic, acting as the "agent reasoning pattern"
 * when an LLM is not used.
 */
function create_schedule(events, tasks, startTime) {
    let schedule = [];
    let conflicts = [];
    let deferred_tasks = [];

    // Sort events by start time
    let sortedEvents = [...events].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

    // Priority logic: 1 is highest (safety, hard appointments).
    // Tasks are assumed to have priorities 1-7.
    let sortedTasks = [...tasks].sort((a, b) => {
        // Deadline takes precedence
        if (a.deadline && !b.deadline) return -1;
        if (!a.deadline && b.deadline) return 1;
        if (a.deadline && b.deadline) return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
        return a.priority - b.priority;
    });

    let currentCursor = new Date(startTime).getTime();

    // Convert events into blocks
    for (const evt of sortedEvents) {
        schedule.push({
            title: evt.title,
            start: evt.start,
            end: evt.end,
            task_id: evt.id, // Using event ID here for simplicity
            type: 'event',
            priority: 1, // Events are highest priority
            status: 'pending'
        });
    }

    // Simple greedy allocation for tasks
    for (const task of sortedTasks) {
        if (task.status === 'completed' || task.status === 'deferred') continue;

        let durationMs = (task.estimated_duration || 30) * 60 * 1000;
        let allocated = false;

        // Find a slot
        while (!allocated) {
            // Check if currentCursor conflicts with any event
            const overlappingEvent = schedule.find(s => {
                const sStart = new Date(s.start).getTime();
                const sEnd = new Date(s.end).getTime();
                const proposedEnd = currentCursor + durationMs;
                return s.type === 'event' &&
                       ((currentCursor >= sStart && currentCursor < sEnd) ||
                        (proposedEnd > sStart && proposedEnd <= sEnd) ||
                        (currentCursor <= sStart && proposedEnd >= sEnd));
            });

            if (overlappingEvent) {
                // Move cursor to end of event + 5 mins buffer
                currentCursor = new Date(overlappingEvent.end).getTime() + (5 * 60 * 1000);
            } else {
                // Check if it's too late in the day (e.g., past 10 PM)
                const currentHour = new Date(currentCursor).getHours();
                if (currentHour >= 22) {
                    deferred_tasks.push(task);
                    break;
                }

                // Allocate task
                const blockStart = new Date(currentCursor);
                const blockEnd = new Date(currentCursor + durationMs);

                schedule.push({
                    title: task.title,
                    start: blockStart.toISOString(),
                    end: blockEnd.toISOString(),
                    task_id: task.id,
                    type: 'task',
                    priority: task.priority,
                    status: 'pending'
                });

                currentCursor += durationMs + (5 * 60 * 1000); // 5 min buffer
                allocated = true;
            }
        }
    }

    // Sort final schedule
    schedule.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

    // Simple conflict detection (if two events overlap)
    for (let i = 0; i < sortedEvents.length - 1; i++) {
        const currentEnd = new Date(sortedEvents[i].end).getTime();
        const nextStart = new Date(sortedEvents[i+1].start).getTime();
        if (currentEnd > nextStart) {
            conflicts.push(`Overlap between "${sortedEvents[i].title}" and "${sortedEvents[i+1].title}"`);
        }
    }

    return {
        schedule,
        conflicts,
        deferred_tasks
    };
}

module.exports = {
    create_schedule
};
