import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  createSIWxPayload,
  encodeSIWxHeader,
} from "@x402/extensions/sign-in-with-x";
test("real HTTP upload signs wallet identity, rejects replay and isolates another wallet before payment", async (t) => {
  const socket = createServer();
  await new Promise((r) => socket.listen(0, "127.0.0.1", r));
  const port = socket.address().port;
  await new Promise((r) => socket.close(r));
  const folder = mkdtempSync(join(tmpdir(), "document-http-"));
  const origin = "http://127.0.0.1:" + port;
  const child = spawn(process.execPath, ["src/main.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      PORT: String(port),
      PUBLIC_ORIGIN: origin,
      KITE_NETWORK: "eip155:2368",
      ASSET: "0x" + "b".repeat(40),
      PAY_TO: "0x" + "c".repeat(40),
      FACILITATOR_URL: "https://not-used.invalid/v2",
      DATA_DIR: folder,
      DATA_KEY: randomBytes(32).toString("hex"),
      OPERATOR_TOKEN: "synthetic-test-only",
      DOC_AUTH_MODE: "wallet",
    },
    stdio: "ignore",
  });
  t.after(async () => {
    child.kill();
    await new Promise((r) => {
      child.once("close", r);
      setTimeout(r, 2000).unref();
    });
    rmSync(folder, { recursive: true, force: true });
  });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(origin + "/healthz")).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 50));
  }
  assert(ready, "document service started");
  const generated = spawnSync(
    process.env.PYTHON || "python3",
    [
      "-c",
      "from pypdf import PdfWriter; import io,base64; p=PdfWriter();p.add_blank_page(width=200,height=200);b=io.BytesIO();p.write(b);print(base64.b64encode(b.getvalue()).decode())",
    ],
    { encoding: "utf8" },
  );
  assert.equal(generated.status, 0, generated.stderr);
  const request = (path, input, header) =>
    fetch(origin + path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(header ? { "sign-in-with-x": header } : {}),
      },
      body: JSON.stringify(input),
    });
  const signed = async (path, input, account) => {
    const challenge = await request(path, input);
    assert.equal(challenge.status, 402);
    const info = (await challenge.json()).extensions["sign-in-with-x"].info;
    return encodeSIWxHeader(
      await createSIWxPayload(
        { ...info, chainId: "eip155:2368", type: "eip191" },
        account,
        info.uri,
      ),
    );
  };
  const a = privateKeyToAccount(generatePrivateKey()),
    b = privateKeyToAccount(generatePrivateKey()),
    input = { pdf_base64: generated.stdout.trim() };
  const header = await signed("/uploads", input, a);
  const uploaded = await request("/uploads", input, header);
  assert.equal(uploaded.status, 201);
  const upload = await uploaded.json();
  assert.equal((await request("/uploads", input, header)).status, 401);
  const extraction = {
    operation_id: "wallet-http-purchase",
    upload_id: upload.upload_id,
    spec_version: "pdf-v1",
    page_range: [1],
  };
  assert.equal(
    (
      await request(
        "/v1/documents/extract",
        extraction,
        await signed("/v1/documents/extract", extraction, b),
      )
    ).status,
    404,
  );
  const own = await request(
    "/v1/documents/extract",
    extraction,
    await signed("/v1/documents/extract", extraction, a),
  );
  assert.equal(own.status, 402);
  assert.equal((await own.json()).accepts[0].network, "eip155:2368");
});
