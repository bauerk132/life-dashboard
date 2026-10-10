## 2024-10-04 - Loading States for Queue Refresh
**Learning:** For UX enhancements requiring loading states, text-based async feedback (like changing "Refresh queue" to "Refreshing queue...") provides effective visual feedback without introducing new custom CSS spinner dependencies.
**Action:** Always prefer updating textContent on interactive buttons to indicate loading states rather than adding custom CSS, ensuring it aligns with the project's minimal styling approach.
## 2024-10-09 - Syncing automated test assertions with dynamic text-based loading states
**Learning:** When adding text-based loading indicators (like appending `…` to button text during async operations instead of swapping DOM elements or adding CSS classes), exact-match text assertions in automated integration/e2e tests (like `b.textContent === 'Mark reviewed'`) will fail during the simulated async wait.
**Action:** Use `.startsWith()` (or similar prefix-based matching) in test assertions to make them resilient to dynamic text appendages for loading states.

## 2024-10-10 - Programmatic linking of error states for screen readers
**Learning:** Adding a visible required indicator (like `*`) is good for sighted users, but adding `aria-describedby` dynamically links form validation errors to the input element so that when screen reader users tab back to fix the field, they hear the error contextually rather than having to hunt for it. Toggling `aria-invalid` enhances this further.
**Action:** Always link inline validation error messages dynamically to their inputs using `aria-describedby` and `aria-invalid` when implementing form validation in Vanilla JS apps without relying on framework primitives.
