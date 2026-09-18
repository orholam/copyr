# Copyr browser extension

Capture any webpage into your Copyr pipeline in one click — the same flow as
`POST /api/v1/capture`, packaged as a Chrome MV3 extension.

## Install (unpacked)

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** → select this folder (`apps/extension`)
4. Pin "Copyr" to the toolbar

## Configure

First click opens setup:

- **API base URL**: `http://localhost:4100` (or your deployed API)
- **API key**: create one in Copyr → Settings → API keys

## Use

Visit any page → click the Copyr icon → adjust the title / add a note →
**Capture to pipeline**.

Copyr will:
- match the page's domain to an existing company (or create one)
- open a deal if none exists
- store the page as a permanent document via link conversion
- log everything on the company timeline

The extension is plain HTML/JS (no build step) — edit and hit reload on the
extensions page.
