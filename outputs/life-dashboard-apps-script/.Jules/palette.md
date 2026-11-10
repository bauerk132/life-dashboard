## 2024-11-10 - Add native confirm dialogs for destructive actions
**Learning:** Destructive actions like Rejecting a job or Withdrawing an application need confirmation dialogs to avoid accidental clicks. Native `window.confirm` provides an accessible, zero-dependency guard without requiring custom modal components or new CSS.
**Action:** When adding confirmation dialogs for destructive UI actions in this project, prefer native `window.confirm`.
