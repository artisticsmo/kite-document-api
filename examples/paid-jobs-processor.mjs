import { parser } from "../src/documents.mjs";
export const specVersion = "pdf-extract-v1";
export function validate(input) {
  if (
    input.spec_version !== specVersion ||
    typeof input.pdf_base64 !== "string" ||
    input.pdf_base64.length > 14 * 1024 * 1024 ||
    !input.pdf_base64.startsWith("JVBERi") ||
    !Array.isArray(input.page_range) ||
    !input.page_range.length ||
    input.page_range.length > 10 ||
    new Set(input.page_range).size !== input.page_range.length ||
    input.page_range.some((n) => !Number.isInteger(n) || n < 1 || n > 10)
  )
    throw Object.assign(Error("invalid_pdf_job"), {
      code: "invalid_pdf_job",
      status: 400,
    });
  return input;
}
export async function process(input) {
  validate(input);
  return {
    spec_version: specVersion,
    ...(await parser({
      pdf_base64: input.pdf_base64,
      page_range: input.page_range,
    })),
  };
}
export async function preflight(input) {
  validate(input);
  const meta = await parser({ mode: "inspect", pdf_base64: input.pdf_base64 });
  if (input.page_range.some((n) => n > meta.page_count))
    throw Object.assign(Error("invalid_pdf_job_page"), {
      code: "invalid_pdf_job_page",
      status: 400,
    });
  return meta;
}
