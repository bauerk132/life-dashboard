const timeTool = require('../tools/time');
const calendarTool = require('../tools/calendar');
const tasksTool = require('../tools/tasks');
const logic = require('./planning_logic');

/**
 * Main Orchestrator for LifeOps Daily Planner
 */
class PlannerAgent {
    constructor() {}

    /**
     * Determines current date/time, gathers commitments, and creates a plan
     */
    plan_day(context = {}) {
        const now = timeTool.get_current_datetime();
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
        const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString();

        const events = calendarTool.get_events(startOfDay, endOfDay);
        const tasks = tasksTool.get_tasks(endOfDay);

        // Start planning from current time or 9 AM if earlier
        let planningStart = now;
        if (now.getHours() < 9) {
            planningStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0);
        }

        const { schedule, conflicts, deferred_tasks } = logic.create_schedule(events, tasks, planningStart);

        const summary = `Plan generated with ${schedule.length} blocks. ${deferred_tasks.length} tasks deferred.`;
        const top_priorities = tasks.sort((a,b) => a.priority - b.priority).slice(0, 3);

        const next_action = schedule.find(s => s.type === 'task' && s.status === 'pending') || null;

        return {
            summary,
            top_priorities,
            schedule,
            conflicts,
            deferred_tasks,
            next_action
        };
    }

    /**
     * Replans from the current moment, preserving future hard appointments.
     */
    replan_day(context = {}) {
        const now = timeTool.get_current_datetime();
        const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString();

        const events = calendarTool.get_events(now.toISOString(), endOfDay);
        const allTasks = tasksTool.get_tasks(endOfDay);

        // Filter out completed tasks
        const unfinishedTasks = allTasks.filter(t => t.status !== 'completed');

        const { schedule, conflicts, deferred_tasks } = logic.create_schedule(events, unfinishedTasks, now);

        return {
            summary: "Schedule replanned based on current time.",
            schedule,
            conflicts,
            deferred_tasks,
            next_action: schedule.find(s => s.type === 'task' && s.status === 'pending') || null
        };
    }

    create_morning_briefing(context = {}) {
        const plan = this.plan_day(context);

        return {
            briefing: `Good morning. You have ${plan.schedule.filter(s => s.type === 'event').length} appointments today and ${plan.schedule.filter(s => s.type === 'task').length} tasks scheduled.`,
            ...plan
        };
    }

    break_down_project(project) {
        // Simulated breakdown
        return {
            milestones: ['Phase 1', 'Phase 2'],
            tasks: [
                { title: `Research ${project}`, estimated_duration: 60 },
                { title: `Draft ${project}`, estimated_duration: 120 }
            ],
            suggested_order: [0, 1]
        };
    }

    get_next_action(context = {}) {
        const plan = this.replan_day(context);
        return plan.next_action;
    }
}

module.exports = new PlannerAgent();
