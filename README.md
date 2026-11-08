# Veriq

Privacy and terms are available at `/privacy` and `/terms`. Operator: Axiom. Set optional `NEXT_PUBLIC_SUPPORT_EMAIL` to a dedicated public privacy/support address before building for public launch.

Verify before you trust. Veriq investigates suspicious links, domains and messages using cybersecurity checks, grounded AI explanations and an on-chain report registry.

- **Link and domain analysis**: normalisation, typosquatting and homograph detection, redirect chains followed safely, DNS and RDAP domain age, inert page analysis (brand claims, form destinations).
- **TLS and certificate trust**: chain, hostname/SAN, validity, key size, signature algorithm, Certificate Transparency (crt.sh), plus matching against compromised-CA intelligence such as the October 2026 eMudhra keys.
- **Message and email analysis**: social-engineering cues, OTP and payment requests, UPI IDs, wallets and phone numbers extracted and redacted, and brand/link/sender mismatches.
- **Threat intelligence**: OpenPhish community feed (no key needed), URLhaus and Google Safe Browsing (optional keys), and the Veriq repository.
- **Correlation**: incidents that share domains, certificates, payment destinations, phone numbers or near-identical wording are linked. A shared IP alone is never enough.
- **Five risk classes**: Low Risk, Suspicious, High Risk, Confirmed Malicious and Inconclusive. Each report shows its evidence, sources, confidence, coverage, recommended actions and limitations.
- **Web3 registry**: a Solidity `ReportRegistry` stores salted SHA-256 commitments. Seal using a compatible browser/mobile wallet on Sepolia, or the signed-in backend relay. The backend checks the wallet transaction's contract, event, commitment, revision parent, schema version and stored record before confirming it. A separate verifier recomputes a report's commitment and checks it against the chain without contacting Veriq.

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

- **Supabase** (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`): accounts and the profile dashboard. Run the SQL files in `supabase/migrations/` in filename order using Supabase's SQL editor. Enable the OAuth providers you use and allow the site's `/auth/callback` redirect URL.
- **Gemma 4** (`AI_PROVIDER=google`, `AI_MODEL=gemma-4-26b-a4b-it`, `GOOGLE_AI_API_KEY`), or a self-hosted Gemma (`AI_PROVIDER=openai_compatible`, `AI_BASE_URL`). Check connectivity with `node apps/scanner/scripts/check-ai.mjs`.
- **Optional intelligence**: `URLHAUS_AUTH_KEY`, `GOOGLE_SAFE_BROWSING_API_KEY`.

Without these keys Veriq still works: summaries are deterministic, investigations are anonymous, and disabled sources are listed in every report.

The Hardhat node keeps its state in memory. After restarting it, run `pnpm chain:deploy` again. Reports registered on the previous chain will no longer verify against the new one.

## End-to-end demonstration

1. Open http://localhost:3000 and investigate a sample, such as "PayPal lookalike" or "Recruitment scam".
2. On the report page, choose **Seal with wallet**, select Sepolia, and approve the transaction using test ETH. Your private key stays in the wallet. Veriq waits for two confirmations and checks the chain receipt. If confirmation times out, use **Check transaction** to retry the existing hash instead of paying again. To publish a redacted incident, sign in and select **Share to the threat repository**; publication may require an explicit review confirmation. The panel shows the chain ID, contract, transaction and block, with a Sepolia explorer link.
3. Download the **Verification bundle**.
4. Verify it independently, either in the browser at `/verify` or from the command line:

   ```sh
   pnpm verify path/to/veriq-report-<id>.json            # ✔ VERIFIED (exit 0)
   ```

   Edit any field in the bundle and run it again to see `✘ MISMATCH` (exit 1).
5. Open `/repository` to see published incidents and campaign clusters. Click an incident to inspect redacted findings, configuration weaknesses, check coverage and community reasons. Signed-in accounts can confirm or dispute without a wallet fee; each account's latest review counts once. These community reviews are off-chain and do not change the original report or its seal. Existing anchored statements retain their transaction links.

Confirmed reports offer **Receipt** (a JSON chain reference without private evidence) and **Verification bundle** (the private report and nonce used by the independent verifier). Keep the bundle private. The panel links to the Sepolia transaction and contract, displays the record key/fingerprint, and supports sharing a previously private seal without a second blockchain transaction. Publication review cannot hide chain confirmation; pending transactions retain their hashes and are rechecked automatically up to ten times before manual retry.

Repository sharing and removal require the signed-in account that ran the investigation. In **Profile → Your investigations**, use **Remove from repository** and confirm to remove the online listing, public note and community reviews. The private investigation and on-chain fingerprint remain. The existing Supabase foreign key cascades public-review deletion; no new migration is needed. Mobile users can tap the **Investigations** total to jump to their history and use **Show more investigations** for older entries.

## Checks

```sh
pnpm test              # analysis, security-boundary, wallet and six required scenario tests (offline)
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

Wallet sealing does not need `REGISTRY_PRIVATE_KEY`. It needs the backend's reachable `REGISTRY_RPC_URL` and deployed `REGISTRY_CONTRACT_ADDRESS`. Set `REGISTRY_PUBLIC_RPC_URL` to a public, credential-free endpoint for downloaded verification bundles. Wallet sealing is restricted to Sepolia (11155111) and the local test chain (31337). The funded relay requires a verified account and has an account-based request limit. A seal proves report integrity and history, not that the verdict is true. Veriq's report storage and API remain centrally operated; the ledger commitments are independently verifiable.

## Security and scope

Veriq is a prototype, not a security certification. It validates and pins public destination IPs at every redirect, restricts schemes/ports/body sizes, parses pages without executing scripts, verifies signed-in report ownership, and keeps report contents and random commitment nonces off-chain. Unverifiable signed-in requests fail rather than becoming anonymous reports. Anonymous report URLs are capability links: anyone holding that URL can access that report. Public notes and user-downloaded bundles can disclose their contents; review them before sharing.

Before a production launch, verify deployed Supabase RLS policies and retention, isolate scanner egress and resources, add distributed abuse controls and gateway authentication, review AI output and feed false positives, and independently audit the contracts. Current IP limits run in memory and forwarded client headers are not a production trust boundary. Revocation checks are not a complete OCSP/CRL service, CT availability varies, and passive version observations are not a vulnerability scan. The public contract is permissionless; validation/dispute counts are statements, not verified votes or proof of fraud. A privacy policy does not replace these technical controls.

The published repository intentionally includes this README only among Markdown documents. Private planning/audit notes and secrets are not uploaded.
