## 2024-10-04 - Loading States for Queue Refresh
**Learning:** For UX enhancements requiring loading states, text-based async feedback (like changing "Refresh queue" to "Refreshing queue...") provides effective visual feedback without introducing new custom CSS spinner dependencies.
**Action:** Always prefer updating textContent on interactive buttons to indicate loading states rather than adding custom CSS, ensuring it aligns with the project's minimal styling approach.
## 2024-10-09 - Syncing automated test assertions with dynamic text-based loading states
**Learning:** When adding text-based loading indicators (like appending `…` to button text during async operations instead of swapping DOM elements or adding CSS classes), exact-match text assertions in automated integration/e2e tests (like `b.textContent === 'Mark reviewed'`) will fail during the simulated async wait.
**Action:** Use `.startsWith()` (or similar prefix-based matching) in test assertions to make them resilient to dynamic text appendages for loading states.
## 2024-10-15 - Accessible form validation for Apps Script UI
**Learning:** To make form validation accessible in the Apps Script UI, simply showing a text error message isn't enough for screen readers. The error must be semantically linked to the input field so the user knows what is invalid and why when they focus the field.
**Action:** Use `aria-describedby` on input fields to clearly link them to error message element IDs, and dynamically toggle `aria-invalid='true'` via JavaScript when validation fails.
