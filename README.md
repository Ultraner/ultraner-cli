# ultraner

The Ultraner CLI. One command sets a project up to take payments with Ultraner.

```
npx ultraner init
```

It:

1. Detects your project: Next.js (app or pages router), Express, NestJS, Fastify, Koa, Hono, Nuxt, SvelteKit, Remix; TypeScript or JavaScript; npm, pnpm, yarn or bun. Python (Django, FastAPI, Flask), PHP (Laravel), Go and Flutter are recognised from their project files.
2. Asks what you are building (checkout, marketplace, subscriptions, payouts, invoices), where your business and customers are, how customers pay, whether you pay sellers and whether you keep a commission.
3. Prints an integration plan that only uses what the Ultraner API actually does, with doc links. Things people expect but the API does not have (split payments, seller onboarding, an invoice object) are listed as such, with the real workaround.
4. With your consent, writes:
   - `.env.example` with `ULTRANER_API_KEY=uk_test_...` (sandbox first), `ULTRANER_WEBHOOK_SECRET`, and `ULTRANER_SIGNATURE_KEY` if you pay out
   - a client using `@ultraner/sdk`
   - a charge helper (checkout sessions, mobile money push, card/PayPal redirect)
   - a payouts helper with commission math, if you pay sellers
   - a webhook handler that verifies `x-ultraner-signature` (HMAC-SHA256), plus a Next.js route or an Express handler
   - a "Payments with Ultraner" section in your README
5. Offers to install `@ultraner/sdk` with your package manager.

It never overwrites an existing file unless you pass `--force` and confirm. `.env.example` only gains the variables it is missing, and the README section is added once.

## Options

```
--yes, -y               Accept defaults and say yes to every prompt (still never overwrites)
--dry-run               Show the plan and the files, write nothing, install nothing
--force                 Allow overwriting existing generated files
--no-install            Never install @ultraner/sdk
--cwd <dir>             Project directory
--building <list>       checkout,marketplace,subscriptions,payouts,invoices
--country <name|code>   Business country
--customers <list>      Customer countries
--methods <list>        mobile_money,card,paypal
--pay-sellers           You pay sellers or other people out
--commission <percent>  Platform commission you keep
```

Without a terminal (CI, agents) and without `--yes`, it prints the plan from flags and defaults and writes nothing.

```
npx ultraner init --yes --building marketplace --country TZ --customers TZ,KE --methods mobile_money,card --pay-sellers --commission 10
```

## Coverage data

`src/coverage.json` is generated from the website's `lib/pay-countries.ts`, the payment source of truth. Refresh it with `npm run sync-coverage` from inside the website repo before each release.

## Development

Node 18+, no runtime dependencies.

```
npm test
```
