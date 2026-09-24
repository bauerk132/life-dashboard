## 2024-09-24 - Text-based Async Feedback
**Learning:** For async forms, providing text-based loading feedback on submit buttons (e.g. changing "Add task" to "Adding task...") is highly effective for visual reassurance without needing custom CSS spinner components.
**Action:** Use plain text updates instead of injecting DOM elements for async status inside limited environments like Google Apps Script.
