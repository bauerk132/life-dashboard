## 2024-10-04 - Loading States for Queue Refresh
**Learning:** For UX enhancements requiring loading states, text-based async feedback (like changing "Refresh queue" to "Refreshing queue...") provides effective visual feedback without introducing new custom CSS spinner dependencies.
**Action:** Always prefer updating textContent on interactive buttons to indicate loading states rather than adding custom CSS, ensuring it aligns with the project's minimal styling approach.
## 2024-10-09 - Syncing automated test assertions with dynamic text-based loading states
**Learning:** When adding text-based loading indicators (like appending `…` to button text during async operations instead of swapping DOM elements or adding CSS classes), exact-match text assertions in automated integration/e2e tests (like `b.textContent === 'Mark reviewed'`) will fail during the simulated async wait.
**Action:** Use `.startsWith()` (or similar prefix-based matching) in test assertions to make them resilient to dynamic text appendages for loading states.
## 2024-10-10 - Connecting Form Validation Errors to Screen Readers
**Learning:** When using custom JS validation messages, simply rendering a `<p>` is insufficient for screen readers. Using `aria-describedby` to link the input to the error element, coupled with dynamically toggling `aria-invalid="true"` via JS when an error is shown, ensures screen readers announce the specific error message when the invalid input field receives focus.
**Action:** For all custom form validation, establish an `aria-describedby` link in HTML and manage the `aria-invalid` state in the client JS logic.
