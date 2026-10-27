const credentials = [
  'GEMINI_API_KEY', 'GOOGLE_DRIVE_ROOT_FOLDER_ID', 'GOOGLE_DRIVE_UPLOAD_TOKEN_KEY',
  'GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON', 'GOOGLE_DRIVE_OAUTH_CLIENT_ID',
  'GOOGLE_DRIVE_OAUTH_CLIENT_SECRET', 'GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN',
];

export function verificationEnvironment(blockNetwork = false) {
  return {
    ...process.env,
    ...Object.fromEntries(credentials.map(key => [key, ''])),
    GOOGLE_DRIVE_ENABLED: 'false',
    ...(blockNetwork ? { NODE_OPTIONS: [process.env.NODE_OPTIONS, '--import=./scripts/helpers/no-external-network.mjs'].filter(Boolean).join(' ') } : {}),
  };
}
