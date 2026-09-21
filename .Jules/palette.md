## 2023-10-10 - Async Loading States
**Learning:** For asynchronous App Script calls (`google.script.run`), users lack visual feedback that something is occurring. Relying on just `disabled = true` is ambiguous. Changing `textContent` alongside disabling the button vastly improves user confidence in the interaction state without needing complex CSS spinners.
**Action:** Always check async form submissions and button clicks in Vanilla JS/Apps Script for corresponding `disabled = true` logic and inject descriptive `textContent` states during the pending phase.
