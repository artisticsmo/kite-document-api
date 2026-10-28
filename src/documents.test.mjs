import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parser, Documents } from "./documents.mjs";
import { Vault } from "./store.mjs";
test("30 labelled operator-owned PDFs: text/table/scan/errors reported separately", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "pdf-corpus-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const generated = spawnSync(
    process.env.PYTHON || "python3",
    [new URL("../tests/make_samples.py", import.meta.url).pathname, root],
    { encoding: "utf8" },
  );
  assert.equal(generated.status, 0, generated.stderr);
  const labels = JSON.parse(readFileSync(join(root, "labels.json"))),
    metrics = {
      text: { pass: 0, total: 10 },
      table: { pass: 0, total: 10 },
      scan: { pass: 0, total: 5 },
      exception: { pass: 0, total: 5 },
    };
  for (const label of labels) {
    const input = {
      pdf_base64: readFileSync(join(root, label.file)).toString("base64"),
      page_range: [1],
    };
    if (label.expected_error) {
      await assert.rejects(
        parser(input),
        { code: label.expected_error },
        label.file,
      );
      metrics.exception.pass++;
      continue;
    }
    const r = await parser(input);
    assert.equal(r.pages.length, 1);
    assert(r.pages[0].text.includes(label.expected_text), label.file);
    assert(r.pages[0].words.every((w) => w.bbox.length === 4));
    if (label.kind === "table") {
      assert(r.pages[0].tables.length > 0, label.file);
      assert(r.pages[0].tables[0].cells.some((c) => c.text === "Widget"));
    }
    if (label.kind === "scan") assert.equal(r.pages[0].method, "tesseract-eng");
    metrics[label.kind].pass++;
  }
  t.diagnostic(JSON.stringify(metrics));
});
test("upload belongs to configured application payer and locks extraction range", async (t) => {
  const folder = mkdtempSync(join(tmpdir(), "docs-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const vault = new Vault(folder, randomBytes(32).toString("hex")),
    payer = "0x" + "a".repeat(40);
  const docs = new Documents(vault, {
    payer,
    parse: async (i) =>
      i.mode === "inspect"
        ? { page_count: 2, byte_length: 10 }
        : { pages: [{ number: 1, text: "Actual parser stub evidence E1" }] },
  });
  const u = await docs.upload(Buffer.from("%PDF-fixture").toString("base64"));
  const i = { upload_id: u.upload_id, spec_version: "pdf-v1", page_range: [1] };
  assert.equal(docs.precheck(i).page_count, 2);
  await assert.rejects(docs.execute(i, "0x" + "b".repeat(40)), {
    code: "upload_payer_mismatch",
  });
  assert.throws(() => docs.precheck({ ...i, page_range: [3] }), {
    code: "invalid_extraction_spec",
  });
  assert.throws(() => docs.precheck({ ...i, upload_id: "unknown" }), {
    code: "upload_not_found",
  });
  assert.equal((await docs.execute(i, payer)).input_hash, u.input_hash);
});
test("wallet-authenticated uploads isolate independent buyers without global payer", async (t) => {
  const folder = mkdtempSync(join(tmpdir(), "multi-docs-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const docs = new Documents(
    new Vault(folder, randomBytes(32).toString("hex")),
    {
      parse: async (i) =>
        i.mode === "inspect"
          ? { page_count: 1 }
          : { pages: [{ text: "evidence" }] },
    },
  );
  const a = "0x" + "a".repeat(40),
    b = "0x" + "b".repeat(40);
  const first = await docs.upload(
    Buffer.from("%PDF-buyer-a").toString("base64"),
    a,
  );
  const second = await docs.upload(
    Buffer.from("%PDF-buyer-b").toString("base64"),
    b,
  );
  const input = (id) => ({
    upload_id: id,
    spec_version: "pdf-v1",
    page_range: [1],
  });
  assert.throws(() => docs.precheck(input(first.upload_id), b), {
    code: "upload_not_found",
  });
  await assert.rejects(docs.execute(input(first.upload_id), b), {
    code: "upload_payer_mismatch",
  });
  assert.equal(
    (await docs.execute(input(first.upload_id), a)).pages[0].text,
    "evidence",
  );
  assert.equal(
    (await docs.execute(input(second.upload_id), b)).pages[0].text,
    "evidence",
  );
  await assert.rejects(
    docs.upload(Buffer.from("%PDF-no-identity").toString("base64")),
    { code: "authenticated_payer_required" },
  );
});
