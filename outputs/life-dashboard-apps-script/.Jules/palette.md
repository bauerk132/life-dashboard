## 2024-05-18 - Accessibility of Task Form
**Learning:** Adding `aria-describedby` dynamically or statically to inputs linking to an error message element, along with toggling `aria-invalid`, significantly improves screen reader context when form validation fails in the Apps Script UI.
**Action:** Always link form error elements to their inputs via `aria-describedby` and toggle `aria-invalid` based on validation state in the Apps Script frontend.
