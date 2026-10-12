## 2024-10-04 - Loading States for Queue Refresh
**Learning:** For UX enhancements requiring loading states, text-based async feedback (like changing "Refresh queue" to "Refreshing queue...") provides effective visual feedback without introducing new custom CSS spinner dependencies.
**Action:** Always prefer updating textContent on interactive buttons to indicate loading states rather than adding custom CSS, ensuring it aligns with the project's minimal styling approach.
## 2024-10-09 - Syncing automated test assertions with dynamic text-based loading states
**Learning:** When adding text-based loading indicators (like appending `…` to button text during async operations instead of swapping DOM elements or adding CSS classes), exact-match text assertions in automated integration/e2e tests (like `b.textContent === 'Mark reviewed'`) will fail during the simulated async wait.
**Action:** Use `.startsWith()` (or similar prefix-based matching) in test assertions to make them resilient to dynamic text appendages for loading states.
## 2024-10-12 - Accessible Form Validation
**Learning:** To satisfy accessibility standards and provide clear form validation in the Apps Script UI without relying purely on color or visual positioning, input fields should explicitly connect to their error message elements and indicate invalid states dynamically.
**Action:** Use `aria-describedby` on input fields (e.g., `aria-describedby="add-task-error"`) to link them to the error message paragraph, and dynamically toggle `aria-invalid="true"` (via `setAttribute` / `removeAttribute`) via JavaScript when validation fails or passes, instead of only updating text content.
