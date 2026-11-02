const credentials = [
  'GEMINI_API_KEY', 'GOOGLE_DRIVE_ROOT_FOLDER_ID', 'GOOGLE_DRIVE_UPLOAD_TOKEN_KEY',
  'GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON', 'GOOGLE_DRIVE_OAUTH_CLIENT_ID',
  'GOOGLE_DRIVE_OAUTH_CLIENT_SECRET', 'GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN',
  'SUPABASE_ACCESS_TOKEN', 'SUPABASE_DB_PASSWORD', 'SUPABASE_SECRET_KEY',
  'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
];

export function verificationEnvironment(blockNetwork = false) {
  return {
    ...process.env,
    ...Object.fromEntries(credentials.map(key => [key, ''])),
    GOOGLE_DRIVE_ENABLED: 'false',
    APP_ORIGIN: 'http://127.0.0.1:3199',
    ...(blockNetwork ? { NODE_OPTIONS: [process.env.NODE_OPTIONS, '--import=./scripts/helpers/no-external-network.mjs'].filter(Boolean).join(' ') } : {}),
  };
}
