# Google Drive setup for local and Vercel presentations

The Drive connection runs on the Next.js server. This app has simulated roles and browser-local records; those roles do not protect the Drive API. For the one-presenter Vercel deployment, turn on **Vercel Authentication for All Deployments**, including the production URL, in the project's [Deployment Protection settings](https://vercel.com/docs/deployment-protection) before enabling Drive. Check that both the production and preview URLs require Vercel sign-in. The presenter signs in to Vercel and operates the app from one browser. Local `npm run dev` and `npm run start` bind to `127.0.0.1`.

1. Enable the Google Drive API in the Google Cloud project that owns the credentials.
2. Choose a company root folder. Copy its folder ID from the URL into `GOOGLE_DRIVE_ROOT_FOLDER_ID`.
3. Configure one credential method:
   - **Actual Google Shared Drive:** Crea
   te a service account, give it permission to add content to the Shared Drive, and put its credential JSON on one line in `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON`. Escape private-key newlines as `\n` inside the JSON string.
   - **Folder shared from a user's My Drive:** Use a dedicated Google account with edit access. Configure an OAuth client and an offline refresh token authorized for the Drive scope. Set `GOOGLE_DRIVE_OAUTH_CLIENT_ID`, `GOOGLE_DRIVE_OAUTH_CLIENT_SECRET`, and `GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN`. Leave the service account variable blank.
4. Generate a random 32-byte upload key with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`. Set `GOOGLE_DRIVE_UPLOAD_TOKEN_KEY` to that value. Keep the same value across deployments so an upload in progress can continue.
5. For local use, place these values in `.env.local`, set `GOOGLE_DRIVE_ENABLED=true`, and restart the server. For Vercel, set them as **server-side project Environment Variables** for the protected environment, set `GOOGLE_DRIVE_ENABLED=true`, and redeploy. Do not use `NEXT_PUBLIC_` prefixes. Leave Drive disabled on any public deployment.
6. In **Administration**, paste each project's folder URL and select **Validate and save folder**. The folder must sit beneath the configured root and allow the connection to add files.

Site Personnel submit one combined supporting PDF per MRF. PM approval creates a generated MRF PDF and copies both PDFs into separate `MRF Form` and `Supporting Documents` subfolders beneath the MRF-number folder. The supporting PDF is sent in 3 MiB chunks so files up to 50 MB fit within Vercel's 4.5 MB request limit. The request page shows pending status and a manual retry if the upload fails. Procurement waits for both files. Later approved corrections create numbered versions and keep earlier versions.

Procurement can enter quotation details manually, but must attach the supplier's original PDF or image files before finalization. Finalized quotations archive up to 12 source files (20 MB each, 45 MB combined) in a `Supplier Quotations` subfolder. A failed archive can be retried; the quotation cannot be awarded until its archive completes. Finance approval also generates a PO PDF in `Purchase Orders`; Procurement cannot serve the PO until that archive completes. Both document types show their Drive links in the app. Files already finalized or approved before this extension remain readable without a new archive requirement.

The project page lists and searches files under its mapped folder. File links open Google Drive, where the viewer still needs Google permission. Browser records and uploaded originals stay in localStorage and IndexedDB; clearing the app's workspace does not remove Drive files.

Never commit `.env.local`, upload keys, or credential JSON. This prototype's browser tests mock archive responses; verify a real upload and folder browse on the protected Vercel deployment with the company's own Drive credentials before relying on the integration. Vercel Authentication is configured in the Vercel project settings, outside this repository.
