# TrenchScanner Data Collection APIs

---

## 1. GeckoTerminal

**Base URLs:**
- `https://app.geckoterminal.com/api/p1/` — pool data
- `https://api.geckoterminal.com/api/v2/` — token info

### `GET /api/p1/{chain}/pools`
Fetches new/trending pools with filters.

**Query params:**  
`volume_24h`, `liquidity`, `fdv_in_usd`, `pool_creation_hours_ago`, `networks`, `dex_id`, `page`

**Returns:**
- Pool metrics
- 5m buy/sell tx counts
- Price changes
- Liquidity
- FDV
- Token mint address

---

### `GET /api/v2/networks/{chain}/tokens/{mint}/info`
Fetches token metadata.

**Returns:**
- Twitter handle
- Holder distribution
- Honeypot detection signals

**Fallback:**  
`GET /api/v2/networks/{chain}/tokens/{mint}`

**Auth:** None (public)  
**Cache TTL:** 2 hours  
**Headers:**  
`User-Agent: Mozilla/5.0 (compatible; TrenchScanner/1.0)`

---

## 2. DexScreener

**Base URL:**  
`https://api.dexscreener.com/`

### `GET /latest/dex/pairs/{chain}/{pair_id}`
Fetches live pair data.

**Returns:**
- Price (USD)
- Liquidity
- Volume (24h / 1h / 5m)
- 5m buy/sell tx counts
- Price change % (1h, 24h)
- Pair creation timestamp
- DEX ID

**Auth:** None (public)  
**Rate limit handling:**  
- 60s cooldown on 429  
- 0.8s sleep between calls  
- 4 retries with exponential backoff  
**Timeout:** 20s  

---

## 3. Solana JSON-RPC

**Endpoint priority:**
1. `https://mainnet.helius-rpc.com/?api-key={HELIUS_RPC_KEY}` (if set)
2. `SOLANA_RPC_URL` env var
3. `https://api.mainnet-beta.solana.com` (public fallback)

### Methods Used

| Method | Purpose |
|--------|---------|
| `getAccountInfo` | Fetch mint account / check authorities |
| `getTokenSupply` | Get total token supply |
| `getTokenLargestAccounts` | Get top token holders |
| `getSignaturesForAddress` | Get tx history for mint/wallet |
| `getTransaction` | Get full transaction details |
| `getTokenAccountsByOwner` | Get all token accounts for wallet |
| `getBalance` | Get SOL balance |

**Auth:** Optional — `HELIUS_RPC_KEY`  
**Timeout:** 10–30s depending on method  

---

## 4. Jupiter Data API (Rich Asset + Audit + Live Stats)

**Base URL:**  
`https://datapi.jup.ag/`

### `GET /v1/assets/search?query={mint_or_symbol}`

Searches for token assets using mint (recommended) or symbol/name.

⚠️ Returns an **array**. When querying by mint, use `results[0]`.

**Auth:** None (public)  
**Recommended Cache TTL:**  
- 2 hours for static metadata  
- 30–120s if using 5m stats for live signals  
**Timeout:** 10s  

---

### Returned Fields (Observed)

#### Identity
- `id`
- `name`
- `symbol`
- `icon`
- `decimals`
- `tokenProgram`

#### Supply
- `circSupply`
- `totalSupply`

#### Launch Provenance
- `launchpad` (e.g. `"pump.fun"`)
- `dev` (deployer wallet)
- `firstPool.id`
- `firstPool.createdAt`
- `graduatedPool`
- `graduatedAt`

#### Holder Data
- `holderCount`

#### Audit Block
- `audit.mintAuthorityDisabled`
- `audit.freezeAuthorityDisabled`
- `audit.topHoldersPercentage`
- `audit.devBalancePercentage`
- `audit.devMigrations`
- `audit.devMints`
- `audit.sniperPct`
- `audit.botHoldersCount`
- `audit.botHoldersPercentage`

#### Organic Metrics
- `organicScore` (0–100)
- `organicScoreLabel` (`low`, `medium`, `high`)

#### Tags
- `tags[]` (e.g. `"token-2022"`)

#### Market Data
- `fdv`
- `mcap`
- `usdPrice`
- `priceBlockId`
- `liquidity`

#### Rolling Stats Windows
Available windows:
- `stats5m`
- `stats1h`
- `stats6h`
- `stats24h`

Each window may include:
- `priceChange`
- `holderChange`
- `liquidityChange`
- `volumeChange`
- `buyVolume`
- `sellVolume`
- `buyOrganicVolume`
- `sellOrganicVolume`
- `numBuys`
- `numSells`
- `numTraders`
- `numNetBuyers`

#### Mechanics
- `fees`
- `bondingCurve`

#### Timestamps
- `createdAt`
- `updatedAt`

---

### Suggested Use in TrenchScanner

**Risk Signals**
- `mintAuthorityDisabled`
- `freezeAuthorityDisabled`
- `topHoldersPercentage`
- `devBalancePercentage`
- `sniperPct`
- `botHoldersPercentage`

**Momentum**
- `stats5m.priceChange`
- `stats5m.numNetBuyers`
- `stats5m.buyOrganicVolume`
- `stats1h.numNetBuyers`

**Health**
- `liquidity`
- `fdv`
- `usdPrice`
- `holderCount`

---

## 5. Jupiter Price API

**Primary:**  
`https://lite-api.jup.ag/price/v3`

**Fallback:**  
`https://price.jup.ag/v6/price`

### `GET /price/v3?ids={mint}`

Fetches current USD price.

**Returns:**
- `data.{mint}.price`
- or `data.{mint}.usdPrice`

**Auth:** None (public)  
**Timeout:** 10s  
**Used as:** Fallback price source when DexScreener is rate-limited  

---

## Environment Variables

| Variable | Service | Required |
|----------|----------|----------|
| `HELIUS_RPC_KEY` | Solana RPC (Helius) | No |
| `SOLANA_RPC_URL` | Solana RPC (custom) | No |

---

## General Patterns

- **Retries:** 3–4 attempts with exponential backoff (base ~0.6–2s)
- **Caching:** Token metadata cached for 2 hours
- **User-Agent:**  
  `Mozilla/5.0 (compatible; TrenchScanner/1.0)`
- **Timeouts:** 10–20s across all endpoints