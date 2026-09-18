## 2024-05-18 - Missing loading states for async operations
**Learning:** Found that the "Add task" button lacked an explicit loading text, leaving the user with a disabled button but no confirmation of ongoing background work. Updating `textContent` conditionally tied to `disabled` state is a clean pattern in this app's vanilla JS structure.
**Action:** When working with vanilla JS forms, always pair the disabling of submit buttons with a text change (e.g. "Adding...") to give the user immediate feedback during async requests.
