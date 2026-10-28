# Document API

PDF text, table and English OCR extraction with page evidence.

Version 0.2.0 is an AI-assisted engineering evaluation release, developed under one operator and assigned to this GitHub account. It is not evidence of independent human adoption, official Kite approval, Electric Capital inclusion or successful live payment.

## Run and verify

Node.js 20.11+ is required; Node.js 24 is used for current CI and is recommended.

```sh
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt
# Install Tesseract with English language data using your OS package manager.
npm ci
PYTHON=.venv/bin/python npm test
PYTHON=.venv/bin/python npm start
```

POST /uploads uses an SIWX wallet identity challenge by default and prechecks a PDF up to 10 MB / 10 pages before charging. Each upload belongs to its authenticated wallet. POST /v1/documents/extract locks upload_id, pdf-v1 and an explicit page_range; the verified payment payer must own that upload. APP_TOKEN and APP_PAYER are used only when the operator explicitly selects DOC_AUTH_MODE=application.

The Python subprocess extracts text/words, tables/cells and top-left PDF-point coordinates through pdfplumber. Pages without text use Tesseract English TSV with engine confidence. Every selected page is preserved with issues; no readable output fails before settlement. Corrupt, encrypted, oversized and unsupported documents are rejected at preflight. CPU, time, page dimensions and output are bounded. This is parsing evidence, not semantic fact checking.

Generate the operator-owned CC0 sample corpus with python tests/make_samples.py /tmp/pdf-corpus. Tests exercise 10 text, 10 table, 5 scanned and 5 exception PDFs, checking each expected outcome separately. Synthetic corpus success is not a claim of production OCR accuracy. Uploaded bytes expire after 24 hours; encrypted payment/exception evidence remains.

## Configuration and recovery

Use .env.example as a list of required environment variables; the service does not automatically load it. Generate a fresh 32-byte hex DATA_KEY locally, keep it outside the repository and retain it across restarts. Supply strong operator/application bearer tokens and a real receiver and asset before enabling a service. Values are intentionally blank so example configuration cannot silently charge a wrong wallet. The stored payment state UNKNOWN never means unpaid. Inspect the original receipt/activity and restricted journal; do not change an operation key to buy again. Where a writer lock survives a crash, stop all writer processes and review the journal before removing only the stale lock directory.

## Integration evidence

Read [compatibility.json](compatibility.json) and [the protocol boundary](docs/PROTOCOL.md). Local tests are E1; read-only public capability/RPC observations prove only the facts observed. Real Passport approval, funded purchase, SIWX interoperability, public deployment and catalog/EC review are not completed by this release. The service manifest stays draft and uses placeholder pay_to until a genuine receiver and deployment are configured.

## Scope and evidence

[Original PRD](docs/PRD.md) describes the full target, not a claim that every external acceptance gate has passed. [Event contract](docs/EVENTS.md) defines the application records. The standalone repositories share protocol/storage support code, with distinct business implementations and tests. The license is MIT; third-party dependencies keep their upstream licenses. Reproduce failures without publishing payment signatures, account credentials or private files.

## 2026-10-28 update

Default DOC_AUTH_MODE=wallet: POST /uploads first returns an SIWX identity challenge; repeat with the authenticated wallet signature and the same body. Each upload binds that actual wallet. For extraction, SIWX can authorize the free preflight and the verified payment payer must own the upload. No global APP_TOKEN or APP_PAYER is needed in wallet mode. Explicit DOC_AUTH_MODE=application preserves a single application token/payer integration. All identity recovery stays free. examples/paid-jobs-processor.mjs exports a local PDF processor for windingbuff/kite-paid-jobs, avoiding a nested paid HTTP call. Synthetic parser samples remain regression data, not production OCR accuracy.

See [Kite integration and interoperability boundaries](docs/KITE-INTEGRATION.md) and [this release's changes](CHANGELOG.md).
