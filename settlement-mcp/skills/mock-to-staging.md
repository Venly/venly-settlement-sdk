# Move a Venly Finance build from mock to staging

1. Keep the working mock flow and its visible environment label.
2. Set `VENLY_ENV=staging` and provide client credentials through server-side secret
   storage.
3. Confirm enabled custody model, chains, assets and regulated-partner coverage.
4. Use a documented KYC-verified staging account before provisioning a EUR vIBAN.
5. Run read-only smoke checks before setting `VENLY_MCP_LIVE=1`.
6. Dry-run each intended write, review the normalized request, then explicitly confirm.
7. Never fall back implicitly to mock when staging authentication or capability checks
   fail.
