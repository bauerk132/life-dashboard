## 2023-10-27 - Added Destructive Action Confirmation
**Learning:** Native `window.confirm` is highly effective and simple for destructive actions where custom modals are over-engineering. Ensure formatting of the action text matches UI constraints (e.g., `.toLowerCase()`).
**Action:** Use native browser prompts for quick safety rails in lightweight SPAs where complex component state is unnecessary.
