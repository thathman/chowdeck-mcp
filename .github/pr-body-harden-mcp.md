This branch hardens the MCP server where connector writes were allowed.

Included:
- Removes the hardcoded Google Maps key from `mcp/src/api.ts` and reads `GOOGLE_MAPS_API_KEY` from the environment.
- Adds a clear runtime error when `reverse_geocode` is called without a configured Maps key.
- Replaces plain HTTP IP lookup with HTTPS `https://ipapi.co/json/`.
- Adds a `PaymentMethod` union type in `api.ts`.
- Updates TypeScript module settings from `ESNext`/`bundler` to `NodeNext`/`NodeNext`.

Not included because connector writes were blocked by safety checks:
- `mcp/src/index.ts` error redaction and Zod enum validation.
- `mcp/src/session.ts` filesystem permission hardening.
