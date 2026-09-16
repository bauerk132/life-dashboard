require('dotenv').config();
const express = require('express');
const path = require('path');
const plannerAgent = require('./agent/planner_agent');
const tasksTool = require('./tools/tasks');
const calendarTool = require('./tools/calendar');
const timeTool = require('./tools/time');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'ui')));

// Pre-populate some mock data for demonstration
function initMockData() {
    const now = new Date();

    // Create some events for today
    calendarTool.create_event({
        title: 'Morning Meeting',
        start: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10, 0, 0).toISOString(),
        end: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 11, 0, 0).toISOString(),
    });

    calendarTool.create_event({
        title: 'Doctor Appointment',
        start: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 14, 0, 0).toISOString(),
        end: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 15, 0, 0).toISOString(),
    });

    // Create some tasks
    tasksTool.create_task({
        title: 'Review PRs',
        estimated_duration: 60,
        priority: 2
    });

    tasksTool.create_task({
        title: 'Call Assistance Office',
        estimated_duration: 30,
        priority: 1
    });

    tasksTool.create_task({
        title: 'Update Documentation',
        estimated_duration: 90,
        priority: 4
    });
}

initMockData();

// API Endpoints
app.get('/api/plan', (req, res) => {
    const plan = plannerAgent.plan_day();
    res.json(plan);
});

app.post('/api/replan', (req, res) => {
    const plan = plannerAgent.replan_day();
    res.json(plan);
});

app.get('/api/briefing', (req, res) => {
    const briefing = plannerAgent.create_morning_briefing();
    res.json(briefing);
});

app.post('/api/complete_task', (req, res) => {
    const { id } = req.body;
    if (id) {
        tasksTool.complete_task(id);
        res.json({ success: true });
    } else {
        res.status(400).json({ error: 'Task ID required' });
    }
});

app.post('/api/breakdown', (req, res) => {
    const { project } = req.body;
    if (project) {
        const breakdown = plannerAgent.break_down_project(project);
        res.json(breakdown);
    } else {
        res.status(400).json({ error: 'Project name required' });
    }
});

// Fallback to serve index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'ui', 'index.html'));
});

// Export app for testing, or listen if called directly
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`LifeOps Daily Planner running on http://localhost:${PORT}`);
    });
}

module.exports = app;
