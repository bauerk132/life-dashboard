// UI Logic for LifeOps Daily Planner

let currentPlan = null;
let currentFocusTask = null;
let focusTimer = null;

const API_BASE = '/api';

async function fetchPlan() {
    try {
        const response = await fetch(`${API_BASE}/plan`);
        const data = await response.json();
        currentPlan = data;
        renderPlan();
    } catch (error) {
        console.error('Failed to fetch plan', error);
    }
}

async function replanDay() {
    try {
        const response = await fetch(`${API_BASE}/replan`, { method: 'POST' });
        const data = await response.json();
        currentPlan = data;
        renderPlan();
        addChatMessage('system', 'Schedule replanned based on current time. Next up: ' + (data.next_action?.title || 'Nothing right now.'));
    } catch (error) {
        console.error('Failed to replan', error);
    }
}

async function completeTask(taskId) {
    try {
        await fetch(`${API_BASE}/complete_task`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: taskId })
        });
        await replanDay(); // Automatically replan after completion
    } catch (error) {
        console.error('Failed to complete task', error);
    }
}

function formatTime(isoString) {
    const date = new Date(isoString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function renderPlan() {
    if (!currentPlan) return;

    // Render Priorities
    const prioritiesList = document.getElementById('priorities-list');
    prioritiesList.innerHTML = '';
    currentPlan.top_priorities.forEach(p => {
        const li = document.createElement('li');
        li.textContent = p.title;
        prioritiesList.appendChild(li);
    });

    // Render Timeline
    const timelineContainer = document.getElementById('timeline-container');
    timelineContainer.innerHTML = '';

    currentPlan.schedule.forEach(block => {
        const div = document.createElement('div');
        div.className = `timeline-block type-${block.type} ${block.status === 'completed' ? 'completed' : ''}`;

        const timeSpan = document.createElement('span');
        timeSpan.textContent = `${formatTime(block.start)} - ${formatTime(block.end)}`;

        const titleSpan = document.createElement('span');
        titleSpan.textContent = block.title;

        div.appendChild(timeSpan);
        div.appendChild(titleSpan);

        // Add click to focus if it's a pending task
        if (block.type === 'task' && block.status === 'pending') {
            div.style.cursor = 'pointer';
            div.onclick = () => setFocusTask(block);
        }

        timelineContainer.appendChild(div);
    });

    // Update Focus Card if there's a next action
    if (currentPlan.next_action && !currentFocusTask) {
        setFocusTask(currentPlan.next_action);
    }
}

function setFocusTask(block) {
    currentFocusTask = block;
    document.getElementById('current-task-title').textContent = block.title;
    document.getElementById('mark-complete-btn').disabled = false;
    document.getElementById('skip-task-btn').disabled = false;

    // Calculate remaining duration
    const start = new Date(block.start);
    const end = new Date(block.end);
    const durationMs = end - start;
    let remaining = Math.floor(durationMs / 1000);

    clearInterval(focusTimer);
    focusTimer = setInterval(() => {
        if (remaining <= 0) {
            clearInterval(focusTimer);
            document.getElementById('focus-timer').textContent = "Time's up!";
            return;
        }

        const m = Math.floor(remaining / 60);
        const s = remaining % 60;
        document.getElementById('focus-timer').textContent = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        remaining--;
    }, 1000);
}

function addChatMessage(sender, text) {
    const messagesArea = document.getElementById('chat-messages');
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${sender}`;
    msgDiv.textContent = text;
    messagesArea.appendChild(msgDiv);
    messagesArea.scrollTop = messagesArea.scrollHeight;
}

// Event Listeners
document.getElementById('replan-btn').addEventListener('click', replanDay);

document.getElementById('mark-complete-btn').addEventListener('click', () => {
    if (currentFocusTask && currentFocusTask.task_id) {
        completeTask(currentFocusTask.task_id);
        currentFocusTask = null;
        document.getElementById('current-task-title').textContent = "No active task";
        clearInterval(focusTimer);
        document.getElementById('focus-timer').textContent = "--:--";
        document.getElementById('mark-complete-btn').disabled = true;
        document.getElementById('skip-task-btn').disabled = true;
    }
});

document.getElementById('skip-task-btn').addEventListener('click', () => {
    replanDay();
});

document.getElementById('send-chat-btn').addEventListener('click', () => {
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (text) {
        addChatMessage('user', text);
        input.value = '';

        // Mock response handling
        setTimeout(() => {
            if (text.toLowerCase().includes('replan') || text.toLowerCase().includes('skip')) {
                replanDay();
            } else {
                addChatMessage('system', "I noted that. Let me know if you need to replan the day.");
            }
        }, 500);
    }
});

document.getElementById('close-briefing-btn').addEventListener('click', () => {
    document.getElementById('morning-briefing-card').classList.add('hidden');
});

// Update clock
setInterval(() => {
    const now = new Date();
    document.getElementById('current-time').textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}, 1000);

// Initialize
fetchPlan();

// Fetch and display morning briefing
fetch(`${API_BASE}/briefing`).then(r => r.json()).then(data => {
    document.getElementById('briefing-content').textContent = data.briefing;
    document.getElementById('morning-briefing-card').classList.remove('hidden');
});
