# CoinWatch — Privacy Policy

*Last updated: March 21, 2026*

## Overview

CoinWatch is a Chrome extension that lets you track cryptocurrency prices across multiple chains. Your privacy matters — this policy explains what data we handle and how.

## Data We Collect

**We do not collect, store, or transmit any personal data.** CoinWatch has no accounts, no sign-ups, and no server-side storage.

All user data — your watchlist, alerts, preferences, and settings — is stored **locally on your device** using Chrome's built-in storage (`chrome.storage.local`). This data never leaves your browser.

## Third-Party APIs

CoinWatch fetches publicly available cryptocurrency market data from the following third-party services:

- **DexScreener API** (`api.dexscreener.com`) — token prices, market cap, liquidity, and pair data
- **Binance API** (`api.binance.com`) — ticker prices and 24-hour change data for centrally listed pairs
- **Jupiter API** (`datapi.jup.ag`) — Solana token metadata (optional, used for enrichment)

These requests contain only **public token identifiers** (contract addresses, trading pair symbols). No personal information, browsing history, or user identifiers are sent to these services.

Each of these services has its own privacy policy:
- DexScreener: https://dexscreener.com/privacy
- Binance: https://www.binance.com/en/privacy
- Jupiter: https://jup.ag/privacy-policy

## Permissions

CoinWatch requests the following Chrome permissions:

| Permission | Purpose |
|---|---|
| `storage` | Save your watchlist, alerts, and settings locally |
| `alarms` | Schedule periodic price refreshes and alert checks |
| `notifications` | Display Chrome notifications when price alerts trigger |
| Host permissions | Fetch market data from the APIs listed above |

## Content Scripts

CoinWatch injects a small content script on supported chart websites (DexScreener, Birdeye, GeckoTerminal, DEXTools, GMGN, Defined) to provide an "Add to CoinWatch" button. This script:

- Only reads the current page URL to extract token/pair identifiers
- Does not read page content, form data, or cookies
- Does not modify any page content beyond adding the floating button
- Does not track your browsing activity

## Data Sharing

We do not sell, share, or transfer any data to third parties. We do not use analytics, tracking pixels, or advertising SDKs.

## Data Retention

All data is stored locally on your device. You can clear all CoinWatch data at any time via the Settings page ("Reset all data") or by removing the extension.

## Changes to This Policy

If we update this policy, the changes will be reflected here with an updated date. Significant changes will be noted in the extension's changelog.

## Contact

If you have questions about this privacy policy, email cornelis.apps@gmail.com

---

*CoinWatch is an independent project and is not affiliated with DexScreener, Binance, or Jupiter.*
