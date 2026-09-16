/**
 * Time Tool (Mock Implementation)
 */

let mockCurrentTime = new Date().toISOString();

function setMockTime(isoString) {
    mockCurrentTime = isoString;
}

function get_current_datetime() {
    return new Date(mockCurrentTime);
}

function get_timezone() {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

module.exports = {
    get_current_datetime,
    get_timezone,
    setMockTime
};
