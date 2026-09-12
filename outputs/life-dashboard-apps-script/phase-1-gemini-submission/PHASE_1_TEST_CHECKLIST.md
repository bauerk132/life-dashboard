# Phase 1 Manual Test Checklist

- [ ] **Property Configuration:** Ensure `DATABASE_SHEET_ID` is set in Script Properties. Do not hardcode the ID anywhere in the codebase.
- [ ] **Idempotent Initialization:** Run `initializeDatabase()` from the editor. Verify `Tasks`, `Jobs`, `Settings`, and `Applications` sheets are created with correct headers.
- [ ] **Idempotence Check:** Run `initializeDatabase()` a second time. Verify it does not duplicate headers, throw an error, or delete existing rows.
- [ ] **Web App Launch:** Open the `doGet` URL. Verify the page loads and displays `Connected to spreadsheet: [Your Sheet Name]`.
- [ ] **Error Handling:** Temporarily remove `DATABASE_SHEET_ID` from properties and reload the Web App. Verify the UI cleanly displays the error message without crashing.
- [ ] **XSS Prevention:** Temporarily rename the spreadsheet to `<script>alert('XSS')</script>`. Reload the Web App and confirm the script does not execute and the HTML is safely escaped in the status box.
- [ ] **No Fake Data:** Verify that the database initialization process leaves rows 2+ completely empty.
