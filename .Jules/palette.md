## 2024-10-04 - Loading States for Queue Refresh
**Learning:** For UX enhancements requiring loading states, text-based async feedback (like changing "Refresh queue" to "Refreshing queue...") provides effective visual feedback without introducing new custom CSS spinner dependencies.
**Action:** Always prefer updating textContent on interactive buttons to indicate loading states rather than adding custom CSS, ensuring it aligns with the project's minimal styling approach.
## 2024-10-09 - Syncing automated test assertions with dynamic text-based loading states
**Learning:** When adding text-based loading indicators (like appending `…` to button text during async operations instead of swapping DOM elements or adding CSS classes), exact-match text assertions in automated integration/e2e tests (like `b.textContent === 'Mark reviewed'`) will fail during the simulated async wait.
**Action:** Use `.startsWith()` (or similar prefix-based matching) in test assertions to make them resilient to dynamic text appendages for loading states.
## 2024-10-23 - Accessible Form Validation Indicators
**Learning:** For required UI form inputs, improve accessibility by adding a visual asterisk wrapped in `<span aria-hidden="true">*</span>` within the label alongside the native `required` attribute. This prevents screen readers from redundantly announcing the asterisk.
**Action:** Always link validation error messages directly to the input field using `aria-describedby` and dynamically toggle `aria-invalid="true"` when an error is present.
## 2024-10-29 - Accessible Confirmations for Destructive Actions
**Learning:** Native `window.confirm` provides an accessible, zero-dependency method for guarding destructive actions (like Reject or Withdraw) that remove items from active workflows, without requiring complex custom modal components or new CSS.
**Action:** When adding confirmation dialogs for destructive actions, prefer intercepting the click event with `window.confirm` to ensure a robust, screen-reader friendly user experience while keeping the codebase lightweight.
