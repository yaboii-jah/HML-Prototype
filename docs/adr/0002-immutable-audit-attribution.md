# Capture audit identity when an action happens

Audit events retain immutable name, email and department snapshots instead of looking up today's account name when history is rendered. Optional metadata preserves existing v12 role-only records without asserting unknown past usernames, and explicit MRF ownership keeps removed draft/allocation events traceable.

Started file-processing operations may finish under their initiating account after sign-out or an account change. Their runners are restricted to the captured target, source version and pipeline acknowledgements, recheck current business conditions and preserve the currently selected workspace role. Ordinary business commands still require the matching active account; manual retries capture the retrying account. This separates historical responsibility from current session selection without introducing production server authentication; Vercel deployment protection remains the outer access gate.
