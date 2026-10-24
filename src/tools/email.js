/**
 * Email Tool (Mock Implementation)
 */

let mockEmails = [];

/**
 * @param {string} query
 * @returns {Array<any>}
 */
function search_email(query) {
    const q = query.toLowerCase();
    return mockEmails.filter(email =>
        email.subject.toLowerCase().includes(q) ||
        email.body.toLowerCase().includes(q) ||
        email.from.toLowerCase().includes(q)
    );
}

/**
 * @param {string} id
 * @returns {any | null}
 */
function get_email(id) {
    return mockEmails.find(e => e.id === id) || null;
}

/**
 * @param {object} emailData
 * @returns {any}
 */
function draft_email(emailData) {
    const newDraft = {
        id: `draft_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        status: 'draft',
        ...emailData
    };
    mockEmails.push(newDraft);
    return newDraft;
}

/**
 * @param {string} draftId
 * @returns {boolean}
 */
function send_email(draftId) {
    const email = mockEmails.find(e => e.id === draftId);
    if (!email) return false;

    // Safety check as per requirements: require confirmation or explicit flag
    if (!email.auto_send_enabled && !email.confirmed) {
        console.warn(`Safety Abort: Attempted to send email ${draftId} without confirmation.`);
        return false;
    }

    email.status = 'sent';
    email.sentAt = new Date().toISOString();
    return true;
}

// For testing purposes
function _setMockEmails(emails) {
    mockEmails = [...emails];
}

module.exports = {
    search_email,
    get_email,
    draft_email,
    send_email,
    _setMockEmails
};
