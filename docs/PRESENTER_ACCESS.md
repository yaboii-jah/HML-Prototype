# Presenter access

Use the same browser profile for the complete department walkthrough. The deployed app remains behind Vercel deployment protection. These bootstrap credentials initialize the browser-local user directory once and simulate department access; they do not protect server APIs or correspond to owned Gmail inboxes, and the app sends no email.

The workspace starts empty. Sign in as Administrator or Project Manager to create projects and set up their Google Drive folders. The one-time removal of old operational data preserves these accounts, their current passwords and any manually added accounts; project assignments must be set again for new projects.

| Name | Department | Email | Password |
| --- | --- | --- | --- |
| Miguel Santos | Site Personnel | hml.constructsync.site@gmail.com | HML!SITE2026 |
| Adrian Cruz | Project Manager | hml.constructsync.pm@gmail.com | HML!PM2026 |
| Andrea Reyes | Procurement | hml.constructsync.procurement@gmail.com | HML!PROC2026 |
| Paolo Mendoza | Finance | hml.constructsync.finance@gmail.com |    |
| Carlo Villanueva | Logistics | hml.constructsync.logistics@gmail.com | HML!LOG2026 |
| Isabel Cruz | Accounting / Auditing | hml.constructsync.accounting@gmail.com | HML!ACCT2026 |
| Daniel Garcia | Administrator | hml.constructsync.admin@gmail.com | HML!ADMIN2026 |

After signing in, open **Account → Switch department** on any workspace page to change departments without entering another password. The selected user's name, email, permissions and audit identity change together; the current page, project filter, saved records and files remain available. Auth pages have no switcher. You can still sign out and sign in with the next department's credentials. Sessions survive refresh and browser restart until sign-out; prior role-only sessions require one new sign-in without clearing workspace data.

Workspace clearing is intentionally absent from routine Administration. `/admin/maintenance` redirects to Administration. Temporary setup failures offer **Retry setup**; only genuine unreadable-data recovery exposes a confirmed Administrator restore/clear action. Keep the same origin and browser profile throughout the demonstration.


Administrators manage named accounts under **Administration > Users**: add and edit users, reset passwords, deactivate and reactivate access. Each normalized email is unique. Initial and replacement passwords are set by Administrator and shared outside the app; stored credentials use salted PBKDF2 hashes. The table above applies until those bootstrap users are edited. Multiple users may share a department role.

Management is retired from active access; historical Management attribution is retained. Project Managers have all project controls under **Projects**, including budgets, scopes and Drive folder setup. Reports is available to Project Manager, Procurement, Finance, Logistics, Accounting / Auditing, and Administrator, with the same complete report and filters for each role. Site Personnel remains excluded; Reports may appear under **More sections** on compact navigation. Viewing Reports does not grant additional transaction-editing permissions. User management and workspace reset remain Administrator-only. Deactivation and role, email or password changes invalidate existing sessions. The final active Administrator cannot be removed and users cannot deactivate themselves. Presenter switching continues to allow password-free selection of any active named account; this remains a browser-local prototype rather than backend authentication.
