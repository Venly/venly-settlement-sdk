# Move a Venly Finance build from mock to staging

1. Keep the working mock flow and its visible environment label.
2. Set `VENLY_ENV=staging` and provide client credentials through server-side secret
   storage.
3. Confirm enabled custody model, chains, assets and regulated-partner coverage.
4. Use a documented KYC-verified staging account before provisioning a EUR vIBAN.
5. Run read-only smoke checks through the MCP. Its write/prepare tools stay
   sandbox-only in every environment - a non-mock base URL is refused in code.
6. Implement staging/production mutations in your own reviewed integration over
   `@venlyfinance/sdk`, behind your own review-and-confirm ceremony.
7. Never fall back implicitly to mock when staging authentication or capability checks
   fail.
