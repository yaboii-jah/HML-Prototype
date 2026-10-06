# Presenter access

Use the same browser profile for the complete department walkthrough. The deployed app remains behind Vercel deployment protection. These predefined credentials simulate department access; they do not protect server APIs or correspond to owned Gmail inboxes, and the app sends no email.

| Name | Department | Email | Password |
| --- | --- | --- | --- |
| Miguel Santos | Site Personnel | hml.constructsync.site@gmail.com | HML!SITE2026 |
| Andrea Reyes | Procurement | hml.constructsync.procurement@gmail.com | HML!PROC2026 |
| Paolo Mendoza | Finance | hml.constructsync.finance@gmail.com | HML!FIN2026 |
| Carlo Villanueva | Logistics | hml.constructsync.logistics@gmail.com | HML!LOG2026 |
| Isabel Cruz | Accounting / Auditing | hml.constructsync.accounting@gmail.com | HML!ACCT2026 |
| Rafael Navarro | Management | hml.constructsync.management@gmail.com | HML!MGMT2026 |
| Daniel Garcia | Administrator | hml.constructsync.admin@gmail.com | HML!ADMIN2026 |

After signing in, open **Account → Switch department** on any workspace page to change departments without entering another password. The selected user's name, email, permissions and audit identity change together; the current page, project filter, saved records and files remain available. Auth pages have no switcher. You can still sign out and sign in with the next department's credentials. Sessions survive refresh and browser restart until sign-out; prior role-only sessions require one new sign-in without clearing workspace data.

For a fresh walkthrough, sign in as Administrator and open `/admin/maintenance` directly. **Reset workspace** removes local records and cached files after confirmation; archived Drive copies remain. Normal Administration has no reset control or maintenance link.
