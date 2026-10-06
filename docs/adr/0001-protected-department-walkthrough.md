# Department sign-in within a protected presenter workspace

The client walkthrough uses a production-style interface with seven predefined department accounts, while records and files remain in one presenter's browser. We retain browser-local credential checks and remembered sessions instead of introducing server authentication and a shared database, because this presentation is operated from one browser.

Vercel deployment protection remains the server access gate for Drive and AI integrations; the account fixtures shipped to the client are not security credentials. Users change departments through sign-out and sign-in, while saved records remain linked. Prototype boundaries are documented internally rather than shown as interface labels; production multi-user access will require a separate authentication and data-storage implementation.
