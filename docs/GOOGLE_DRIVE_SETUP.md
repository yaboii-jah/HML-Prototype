# Google Drive configuration

New project archives use Google Drive. New browser profiles start empty; automated workflow tests use synthetic fixtures and controlled responses. Configure the following only on the application server, using a root folder where the configured account can create and read files.

Copy `.env.example` to `.env.local` and configure the variables read by `src/server/drive.ts`:

- `GOOGLE_DRIVE_ENABLED=true` explicitly enables deployed integration; `false` disables it locally too.
- `GOOGLE_DRIVE_ROOT_FOLDER_ID` identifies the test root accessible to the configured account.
- `GOOGLE_DRIVE_UPLOAD_TOKEN_KEY` is a base64-encoded 32-byte secret used for encrypted upload tickets.
- Use either `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON` for the configured service-account credentials, or the OAuth combination `GOOGLE_DRIVE_OAUTH_CLIENT_ID`, `GOOGLE_DRIVE_OAUTH_CLIENT_SECRET` and `GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN`. The example environment describes the intended Shared Drive/My Drive distinction.

Restart the local server after changing environment values. Project settings validates mapped folders and reports pending/failed archive work with retry controls. Use test documents and a test Drive location when exercising live integration. Do not commit credentials, tokens or `.env.local`.

The prototype's browser accounts do not provide server-side authorization. Keep live-enabled instances protected while production authentication and permissions are pending.

After `npm run verify` has produced a build, run `npm run test:live` for isolated integration verification. This uses the actual application credentials, creates a uniquely tagged test child under the configured root, starts a separate application process restricted to that child, and exercises AI extraction and Drive upload/download integrity with generated synthetic documents. The runner verifies ownership before trashing its own test folder and verifies the trashed state afterward. Existing company files and sharing permissions are preserved. Only test tooling can perform this cleanup; no deletion endpoint is added to the application.

The ignored `.verification/live.json` contains the outcome. A failed cleanup returns a failing exit status and identifies the run-owned folder for follow-up. A successful run verifies current credentials and permissions; future credential expiry, production authorization, provider outages and recovery still need operational controls.
