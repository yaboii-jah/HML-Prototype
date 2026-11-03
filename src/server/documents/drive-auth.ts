import { GoogleAuth, OAuth2Client } from "google-auth-library";

/** Used only by server modules and explicitly authorized live verification. */
export async function driveAccessToken() {
  if (process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON) {
    const credentials: unknown = JSON.parse(process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON);
    if (!credentials || typeof credentials !== "object" || Array.isArray(credentials)) throw Error("Invalid Drive service-account configuration");
    const settings = credentials as Record<string, string>;
    if (settings.private_key) settings.private_key = settings.private_key.replace(/\\n/g, "\n");
    const client = await new GoogleAuth({ credentials: settings, scopes: ["https://www.googleapis.com/auth/drive"] }).getClient();
    const access = await client.getAccessToken();
    if (!access.token) throw Error("Drive service-account authentication failed");
    return access.token;
  }
  const { GOOGLE_DRIVE_OAUTH_CLIENT_ID: clientId, GOOGLE_DRIVE_OAUTH_CLIENT_SECRET: clientSecret, GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN: refreshToken } = process.env;
  if (!clientId || !clientSecret || !refreshToken) throw Error("Configure Drive credentials on the server");
  const client = new OAuth2Client(clientId, clientSecret);
  client.setCredentials({ refresh_token: refreshToken });
  const access = await client.getAccessToken();
  if (!access.token) throw Error("Drive OAuth authentication failed");
  return access.token;
}
