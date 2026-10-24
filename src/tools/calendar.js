/**
 * Calendar Tool (Mock Implementation)
 */

let mockEvents = [];

/**
 * @param {string} start ISO string
 * @param {string} end ISO string
 * @returns {Array<import('../models/types').CalendarEvent>}
 */
function get_events(start, end) {
    const startTime = new Date(start).getTime();
    const endTime = new Date(end).getTime();

    return mockEvents.filter(event => {
        const eventStart = new Date(event.start).getTime();
        const eventEnd = new Date(event.end).getTime();
        return (eventStart >= startTime && eventStart < endTime) ||
               (eventEnd > startTime && eventEnd <= endTime) ||
               (eventStart <= startTime && eventEnd >= endTime);
    }).sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
}

/**
 * @param {Omit<import('../models/types').CalendarEvent, 'id'>} eventData
 * @returns {import('../models/types').CalendarEvent}
 */
function create_event(eventData) {
    const newEvent = {
        id: `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        ...eventData
    };
    mockEvents.push(newEvent);
    return newEvent;
}

/**
 * @param {string} id
 * @param {Partial<import('../models/types').CalendarEvent>} updates
 * @returns {import('../models/types').CalendarEvent | null}
 */
function update_event(id, updates) {
    const index = mockEvents.findIndex(e => e.id === id);
    if (index === -1) return null;

    mockEvents[index] = { ...mockEvents[index], ...updates };
    return mockEvents[index];
}

/**
 * @param {string} id
 * @returns {boolean}
 */
function delete_event(id) {
    const initialLength = mockEvents.length;
    mockEvents = mockEvents.filter(e => e.id !== id);
    return mockEvents.length < initialLength;
}

/**
 * Find open time slots of a given duration between start and end.
 * @param {string} start ISO string
 * @param {string} end ISO string
 * @param {number} durationMinutes
 * @returns {Array<{start: string, end: string}>}
 */
function find_open_time(start, end, durationMinutes) {
    const events = get_events(start, end);
    const slots = [];
    let currentStart = new Date(start).getTime();
    const endTime = new Date(end).getTime();
    const durationMs = durationMinutes * 60 * 1000;

    for (const event of events) {
        const eventStart = new Date(event.start).getTime();
        if (eventStart - currentStart >= durationMs) {
            slots.push({
                start: new Date(currentStart).toISOString(),
                end: new Date(eventStart).toISOString()
            });
        }
        currentStart = Math.max(currentStart, new Date(event.end).getTime());
    }

    if (endTime - currentStart >= durationMs) {
        slots.push({
            start: new Date(currentStart).toISOString(),
            end: new Date(endTime).toISOString()
        });
    }

    return slots;
}

// For testing purposes
function _setMockEvents(events) {
    mockEvents = [...events];
}

module.exports = {
    get_events,
    create_event,
    update_event,
    delete_event,
    find_open_time,
    _setMockEvents
};
