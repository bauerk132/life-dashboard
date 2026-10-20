## 2024-10-20 - Form Validation Accessibility
**Learning:** Found an accessibility issue pattern where form inputs lacking `aria-describedby` and dynamic `aria-invalid` attributes fail to associate inline error messages with the active input, reducing screen reader clarity. Visual asterisks also lacked `aria-hidden`.
**Action:** Always link input fields to their error message elements using `aria-describedby`, dynamically toggle `aria-invalid` via JavaScript on validation failure, and wrap required field asterisks in `<span aria-hidden="true">` to prevent redundant announcements.

## 2024-10-20 - Form Validation Accessibility
**Learning:** Found an accessibility issue pattern where form inputs lacking `aria-describedby` and dynamic `aria-invalid` attributes fail to associate inline error messages with the active input, reducing screen reader clarity. Visual asterisks also lacked `aria-hidden`.
**Action:** Always link input fields to their error message elements using `aria-describedby`, dynamically toggle `aria-invalid` via JavaScript on validation failure, and wrap required field asterisks in `<span aria-hidden="true">` to prevent redundant announcements.
