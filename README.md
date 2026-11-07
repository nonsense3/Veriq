# Veriq

Privacy and terms are available at `/privacy` and `/terms`. Operator: Axiom. Set optional `NEXT_PUBLIC_SUPPORT_EMAIL` to a dedicated public privacy/support address before building for public launch.

Verify before you trust. Veriq investigates suspicious links, domains and messages using cybersecurity checks, grounded AI explanations and an on-chain report registry.

- **Link and domain analysis**: normalisation, typosquatting and homograph detection, redirect chains followed safely, DNS and RDAP domain age, inert page analysis (brand claims, form destinations).
- **TLS and certificate trust**: chain, hostname/SAN, validity, key size, signature algorithm, Certificate Transparency (crt.sh), plus matching against compromised-CA intelligence such as the October 2026 eMudhra keys.
- **Message and email analysis**: social-engineering cues, OTP and payment requests, UPI IDs, wallets and phone numbers extracted and redacted, and brand/link/sender mismatches.
- **Threat intelligence**: OpenPhish community feed (no key needed), URLhaus and Google Safe Browsing (optional keys), and the Veriq repository.
- **Correlation**: incidents that share domains, certificates, payment destinations, phone numbers or near-identical wording are linked. A shared IP alone is never enough.
- **Five risk classes**: Low Risk, Suspicious, High Risk, Confirmed Malicious and Inconclusive. Each report shows its evidence, sources, confidence, coverage, recommended actions and limitations.
- **Web3 registry**: a Solidity `ReportRegistry` stores salted SHA-256 commitments. A separate verifier recomputes a report's commitment and checks it against the chain without contacting Veriq.

## Repository layout

| Path | What it is |
| --- | --- |
| `apps/web` | Next.js static frontend (landing, investigation workspace, report, repository, verifier) |
| `apps/scanner` | Node investigation service: safe passive inspection, intelligence, AI, registry relay |
| `apps/api` | Cloudflare Worker gateway that validates requests and forwards them to the scanner |
| `apps/verifier` | Stand-alone CLI verifier (shares no code with Veriq) |
| `packages/contracts` | Shared Zod schemas and types |
| `packages/analysis` | Deterministic rules, risk policy, correlation and commitment functions |
| `packages/registry` | Solidity registry, Hardhat tests and deployment script |
| `tests` | Unit, security-boundary and the six required scenario tests |

## Run locally

Requires Node.js 22+ (tested on 24) and pnpm 11+.

```sh
pnpm install
cp .env.example .env                       # then set REGISTRY_PRIVATE_KEY (see the comment in the file)

pnpm chain:node                            # terminal 1: local EVM chain on :8545 (chain id 31337)
pnpm chain:deploy                          # once per chain start: deploys ReportRegistry and writes deployments/localhost.json
pnpm dev:scanner                           # terminal 2: investigation service on :8788 (required; the website cannot investigate alone)
pnpm dev                                   # terminal 3: frontend on http://localhost:3000
```

Keys go in the root `.env` (one file for web and scanner). Each section says where to get its key:

- **Supabase** (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`): accounts and the profile dashboard. Run `supabase/migrations/*.sql` and follow `supabase/README.md`.
- **Gemma 4** (`AI_PROVIDER=google`, `AI_MODEL=gemma-4-26b-a4b-it`, `GOOGLE_AI_API_KEY`), or a self-hosted Gemma (`AI_PROVIDER=openai_compatible`, `AI_BASE_URL`). Check connectivity with `node apps/scanner/scripts/check-ai.mjs`.
- **Optional intelligence**: `URLHAUS_AUTH_KEY`, `GOOGLE_SAFE_BROWSING_API_KEY`.

Without these keys Veriq still works: summaries are deterministic, investigations are anonymous, and disabled sources are listed in every report.

The Hardhat node keeps its state in memory. After restarting it, run `pnpm chain:deploy` again. Reports registered on the previous chain will no longer verify against the new one.

## End-to-end demonstration

1. Open http://localhost:3000 and investigate a sample, such as "PayPal lookalike" or "Recruitment scam".
2. On the report page, choose **Register & publish incident**. The panel shows the chain ID, contract, transaction and block.
3. Download the **Verification bundle**.
4. Verify it independently, either in the browser at `/verify` or from the command line:

   ```sh
   pnpm verify path/to/veriq-report-<id>.json            # ✔ VERIFIED (exit 0)
   ```

   Edit any field in the bundle and run it again to see `✘ MISMATCH` (exit 1).
5. Open `/repository` to see published incidents, campaign clusters and on-chain validate/dispute statements.

## Checks

```sh
pnpm test              # 43 unit, security-boundary and scenario tests (offline)
pnpm test:contracts    # Solidity registry tests (Hardhat, node:test + viem)
pnpm typecheck
pnpm build
pnpm check             # all of the above
```

## Deployment

- **Site and gateway**: one Cloudflare Worker. Build the static site, then deploy the Worker, which serves `apps/web/out` and handles `/health` and `/v1/*`. The browser calls the same origin, so there is no public API URL to set.
  ```sh
  pnpm --filter @veriq/web build
  pnpm --filter @veriq/api exec wrangler deploy
  ```
  Cloudflare build command: `pnpm --filter @veriq/api build`. That builds the site first, then checks the Worker. Deploy command: `pnpm --filter @veriq/api exec wrangler deploy`.
- **Scanner**: `SCANNER_ORIGIN` is a Worker variable, not a `NEXT_PUBLIC_` value. Set it to the public address of the Node investigation service. Until it is set, `/v1/*` reports that the investigation service is offline. The scanner needs outbound HTTPS and DNS, and it cannot run on Workers. Its own domain is always allowed to call the API. Extra browser origins go in the Worker variable `ALLOWED_ORIGINS`, as a comma-separated list.
- **Registry on a testnet**: set `SEPOLIA_RPC_URL` and `SEPOLIA_PRIVATE_KEY` as Hardhat configuration variables, run `pnpm --filter @veriq/registry deploy:sepolia`, then point `REGISTRY_RPC_URL`, `REGISTRY_CONTRACT_ADDRESS` and `REGISTRY_PRIVATE_KEY` at it.

For the Render scanner, put registry variables in the backend service's runtime Environment settings. `REGISTRY_PRIVATE_KEY` must be a dedicated funded account's 32-byte hexadecimal private key, never a wallet address, contract address, recovery phrase or Etherscan API key. Prefixed (`0x`), bare 64-character and matching-quoted exports are accepted; malformed keys are rejected without returning their value. `/v1/config` only reports the registry as available after validating the signing key and reaching the contract. This does not guarantee sufficient funds or a successful transaction. A key change requires redeploying the backend; no contract redeployment is necessary.

## Documentation

- `docs/technical-overview.md`: architecture, analysis pipeline, threat-intelligence sources and security methodology
- `docs/testing-report.md`: required scenarios and live runs with observed results
- `architecture.md`, `design.md`, `implementation.md`, `memory.md`: design record and project memory.
