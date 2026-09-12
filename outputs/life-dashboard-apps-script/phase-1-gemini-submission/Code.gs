/**
 * Life Dashboard - Phase 1 Foundation
 * Entry points and web app routing
 */

const SCRIPT_PROP_SHEET_ID = 'DATABASE_SHEET_ID';

function doGet(e) {
  const template = HtmlService.createTemplateFromFile('Index');
  return template.evaluate()
    .setTitle('Life Dashboard')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Verifies client-server communication and database connection.
 * @returns {Object} status and message
 */
function getAppStatus() {
  try {
    const props = PropertiesService.getScriptProperties();
    const sheetId = props.getProperty(SCRIPT_PROP_SHEET_ID);

    if (!sheetId) {
      return { status: 'unconfigured', message: 'Spreadsheet ID not set in Script Properties.' };
    }

    const ss = SpreadsheetApp.openById(sheetId);
    return {
      status: 'ok',
      message: `Connected to spreadsheet: ${ss.getName()}`,
      sheetId: sheetId
    };
  } catch (error) {
    console.error('getAppStatus error:', error);
    return { status: 'error', message: error.message };
  }
}
