# Changes

## 0.2.1 — 2026-10-28

Align the draft manifest with default SIWX wallet mode: no application API key is required; clarify upload identity and the explicit legacy application mode. Runtime code is unchanged from 0.2.0.

## 0.2.0 — 2026-10-28

Default DOC_AUTH_MODE=wallet: POST /uploads first returns an SIWX identity challenge; repeat with the authenticated wallet signature and the same body. Each upload binds that actual wallet. For extraction, SIWX can authorize the free preflight and the verified payment payer must own the upload. No global APP_TOKEN or APP_PAYER is needed in wallet mode. Explicit DOC_AUTH_MODE=application preserves a single application token/payer integration. All identity recovery stays free. examples/paid-jobs-processor.mjs exports a local PDF processor for windingbuff/kite-paid-jobs, avoiding a nested paid HTTP call. Synthetic parser samples remain regression data, not production OCR accuracy.

This evaluation update retains explicit blocked real-payment, public-hosting and official-listing gates. Prior releases remain available.
