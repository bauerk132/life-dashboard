# Life Dashboard (Phase 1)

## Setup Instructions

1. Create a new Google Apps Script project.
2. Copy `Code.gs`, `Database.gs`, and `Index.html` into the editor. Update `appsscript.json` (viewable via Project Settings > Show `appsscript.json`).
3. Create a **blank** Google Sheet and copy its ID from the URL.
4. In the Apps Script editor, go to **Project Settings > Script Properties**.
5. Add a property named `DATABASE_SHEET_ID` and paste the spreadsheet ID as the value.
6. Open `Database.gs`, select the `initializeDatabase` function from the top toolbar, and click **Run**. You will need to authorize the script.
7. Deploy as a Web App (Execute as: You, Access: You).
8. Open the Web App URL to confirm the connection.
