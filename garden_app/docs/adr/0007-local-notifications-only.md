# 0007 — Local notifications only

**Status:** accepted

**Decision.** Plan reminders in the domain and schedule them as local DATE notifications. Non-urgent jobs are grouped into one message per gardening day (or a daily or weekly summary). Frost and heat warnings are sent separately. Quiet days are respected. Everything is rescheduled whenever the app opens or the garden changes.

**Consequences.** There's no push server and no account. Because iOS and Android don't guarantee background execution, reminders reflect the state of the garden and forecast when the app was last opened. This is documented, and it's explained to the gardener on the Reminders screen.

**Update (1.7):** an optional Android background task (`expo-background-task`) checks the forecast a few times a day while the app is closed and sends local frost, heat and heavy-rain alerts. It's still local-only and best-effort: Android decides when it runs.
