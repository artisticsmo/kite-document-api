import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fault, hash, audit } from "./store.mjs";
export async function parser(
  input,
  { python = process.env.PYTHON || "python3" } = {},
) {
  return new Promise((resolve, reject) => {
    const p = spawn(
      python,
      [new URL("../parser/parse.py", import.meta.url).pathname],
      {
        stdio: ["pipe", "pipe", "pipe"],
        shell: false,
        env: { PATH: process.env.PATH, LANG: "en_US.UTF-8" },
      },
    );
    const chunks = [];
    let total = 0;
    const timer = setTimeout(() => {
      p.kill("SIGKILL");
      reject(fault("parser_timeout", 422));
    }, 45000);
    p.stdout.on("data", (b) => {
      total += b.length;
      if (total > 8 * 1024 * 1024) {
        p.kill("SIGKILL");
        reject(fault("parser_output_limit", 422));
      } else chunks.push(b);
    });
    p.stderr.resume();
    p.on("error", () => {
      clearTimeout(timer);
      reject(fault("parser_unavailable", 503));
    });
    p.on("close", () => {
      clearTimeout(timer);
      try {
        const r = JSON.parse(Buffer.concat(chunks));
        if (!r.ok) throw fault(r.error, 422);
        resolve(r.result);
      } catch (e) {
        reject(e.code ? e : fault("parser_failed", 422));
      }
    });
    p.stdin.on("error", () => {});
    p.stdin.end(JSON.stringify(input));
  });
}
export class Documents {
  constructor(vault, { payer, parse = parser, retentionMs = 86400000 } = {}) {
    if (!/^0x[\da-f]{40}$/i.test(payer || ""))
      throw fault("APP_PAYER_required", 503);
    Object.assign(this, {
      vault,
      payer: payer.toLowerCase(),
      parse,
      retentionMs,
    });
  }
  async upload(pdf_base64) {
    if (
      typeof pdf_base64 !== "string" ||
      pdf_base64.length > 14 * 1024 * 1024 ||
      pdf_base64.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(pdf_base64) ||
      Buffer.from(pdf_base64, "base64").toString("base64") !== pdf_base64
    )
      throw fault("invalid_pdf_encoding");
    const meta = await this.parse({ mode: "inspect", pdf_base64 });
    return this.vault.transaction((s, save) => {
      s.uploads ??= {};
      const id = randomUUID();
      s.uploads[id] = {
        id,
        payer: this.payer,
        pdf_base64,
        input_hash: hash(Buffer.from(pdf_base64, "base64")),
        ...meta,
        expires_at: Date.now() + this.retentionMs,
      };
      audit(s, "upload_prechecked", {
        upload_id: id,
        page_count: meta.page_count,
      });
      save();
      return {
        upload_id: id,
        input_hash: s.uploads[id].input_hash,
        ...meta,
        spec_version: "pdf-v1",
        retention_seconds: this.retentionMs / 1000,
      };
    });
  }
  precheck(input) {
    const u = this.vault.read().uploads?.[input.upload_id];
    if (!u || u.payer !== this.payer) throw fault("upload_not_found", 404);
    if (u.expires_at < Date.now()) throw fault("upload_expired", 410);
    if (
      input.spec_version !== "pdf-v1" ||
      !Array.isArray(input.page_range) ||
      !input.page_range.length ||
      new Set(input.page_range).size !== input.page_range.length ||
      input.page_range.some(
        (n) => !Number.isInteger(n) || n < 1 || n > u.page_count,
      )
    )
      throw fault("invalid_extraction_spec");
    return u;
  }
  async execute(input, payer) {
    if (payer !== this.payer) throw fault("upload_payer_mismatch", 403);
    const u = this.precheck(input);
    const result = await this.parse({
      pdf_base64: u.pdf_base64,
      page_range: input.page_range,
    });
    return {
      document_id: input.upload_id,
      input_hash: u.input_hash,
      spec_version: input.spec_version,
      ...result,
    };
  }
  async expire() {
    return this.vault.transaction((s, save) => {
      let removed = 0;
      for (const u of Object.values(s.uploads || {}))
        if (u.expires_at < Date.now() && u.pdf_base64) {
          delete u.pdf_base64;
          removed++;
        }
      save();
      return removed;
    });
  }
}
