## 2024-10-04 - Loading States for Queue Refresh
**Learning:** For UX enhancements requiring loading states, text-based async feedback (like changing "Refresh queue" to "Refreshing queue...") provides effective visual feedback without introducing new custom CSS spinner dependencies.
**Action:** Always prefer updating textContent on interactive buttons to indicate loading states rather than adding custom CSS, ensuring it aligns with the project's minimal styling approach.
## 2024-10-09 - Syncing automated test assertions with dynamic text-based loading states
**Learning:** When adding text-based loading indicators (like appending `…` to button text during async operations instead of swapping DOM elements or adding CSS classes), exact-match text assertions in automated integration/e2e tests (like `b.textContent === 'Mark reviewed'`) will fail during the simulated async wait.
**Action:** Use `.startsWith()` (or similar prefix-based matching) in test assertions to make them resilient to dynamic text appendages for loading states.
## 2024-10-21 - Accessible Form Validation
**Learning:** For required UI form inputs, improve accessibility by adding a visual asterisk wrapped in `<span aria-hidden="true">*</span>` within the label alongside the native `required` attribute. This prevents screen readers from redundantly announcing the asterisk. Also, use `aria-describedby` on input fields to clearly link them to error message element IDs, and dynamically toggle `aria-invalid='true'` via JavaScript when validation fails.
**Action:** Always apply `aria-hidden="true"` to visual asterisks indicating required fields. Link form inputs to their error containers using `aria-describedby`, and toggle `aria-invalid` based on the field's valid state dynamically.
