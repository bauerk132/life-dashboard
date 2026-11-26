## 2024-10-04 - Loading States for Queue Refresh
**Learning:** For UX enhancements requiring loading states, text-based async feedback (like changing "Refresh queue" to "Refreshing queue...") provides effective visual feedback without introducing new custom CSS spinner dependencies.
**Action:** Always prefer updating textContent on interactive buttons to indicate loading states rather than adding custom CSS, ensuring it aligns with the project's minimal styling approach.
## 2024-10-09 - Syncing automated test assertions with dynamic text-based loading states
**Learning:** When adding text-based loading indicators (like appending `…` to button text during async operations instead of swapping DOM elements or adding CSS classes), exact-match text assertions in automated integration/e2e tests (like `b.textContent === 'Mark reviewed'`) will fail during the simulated async wait.
**Action:** Use `.startsWith()` (or similar prefix-based matching) in test assertions to make them resilient to dynamic text appendages for loading states.
## 2024-10-23 - Accessible Form Validation Indicators
**Learning:** For required UI form inputs, improve accessibility by adding a visual asterisk wrapped in `<span aria-hidden="true">*</span>` within the label alongside the native `required` attribute. This prevents screen readers from redundantly announcing the asterisk.
**Action:** Always link validation error messages directly to the input field using `aria-describedby` and dynamically toggle `aria-invalid="true"` when an error is present.
## 2026-10-27 - Contextual ARIA labels for repeating card actions
**Learning:** When generating repeating card elements with identical visual actions (e.g., 'Edit details' or 'Open source listing' buttons), append contextual information (like the specific job title) to their `aria-label` attributes to ensure screen reader users can distinguish between them.
**Action:** Always verify if repeating interactive elements need dynamic ARIA labels derived from data (like item titles or IDs) to prevent ambiguous screen reader announcements.
