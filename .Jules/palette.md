## 2024-10-04 - Loading States for Queue Refresh
**Learning:** For UX enhancements requiring loading states, text-based async feedback (like changing "Refresh queue" to "Refreshing queue...") provides effective visual feedback without introducing new custom CSS spinner dependencies.
**Action:** Always prefer updating textContent on interactive buttons to indicate loading states rather than adding custom CSS, ensuring it aligns with the project's minimal styling approach.
## 2024-10-09 - Syncing automated test assertions with dynamic text-based loading states
**Learning:** When adding text-based loading indicators (like appending `…` to button text during async operations instead of swapping DOM elements or adding CSS classes), exact-match text assertions in automated integration/e2e tests (like `b.textContent === 'Mark reviewed'`) will fail during the simulated async wait.
**Action:** Use `.startsWith()` (or similar prefix-based matching) in test assertions to make them resilient to dynamic text appendages for loading states.
## 2024-10-27 - [Task Form Accessibility]
**Learning:** Found that required visual indicators (like asterisks) were not fully accessible and form validation errors did not properly toggle `aria-invalid` on inputs, which is crucial for screen-reader users to understand error states dynamically.
**Action:** Applied `aria-hidden="true"` to visual asterisks and used `aria-describedby` along with dynamically toggling `aria-invalid="true"` in JavaScript when showing error messages. Used existing `.is-error` utility classes instead of inline styles. Cleaned up backup `.orig` and `.diff` files before committing to keep the PR focused and clean.
