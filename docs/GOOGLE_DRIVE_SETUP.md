# Optional Google Drive configuration

The populated demonstration workspace stores its archive copies locally and does not require Drive credentials. Use the same browser origin/profile to open those files. This configuration applies when exercising the prototype's live Drive path with a separate test workspace.

Copy `.env.example` to `.env.local` and configure the variables read by `src/server/drive.ts`:

- `GOOGLE_DRIVE_ENABLED=true` explicitly enables deployed integration; `false` disables it locally too.
- `GOOGLE_DRIVE_ROOT_FOLDER_ID` identifies the test root accessible to the configured account.
- `GOOGLE_DRIVE_UPLOAD_TOKEN_KEY` is a base64-encoded 32-byte secret used for encrypted upload tickets.
- Use either `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON` for the configured service-account credentials, or the OAuth combination `GOOGLE_DRIVE_OAUTH_CLIENT_ID`, `GOOGLE_DRIVE_OAUTH_CLIENT_SECRET` and `GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN`. The example environment describes the intended Shared Drive/My Drive distinction.

Restart the local server after changing environment values. Project settings validates mapped folders and reports pending/failed archive work with retry controls. Use test documents and a test Drive location when exercising live integration. Do not commit credentials, tokens or `.env.local`.

The prototype's browser accounts do not provide server-side authorization. Live Drive permission and credential-expiry behavior require a separate integration verification before company use; the automated workflow suites use controlled responses rather than accessing a real account.
