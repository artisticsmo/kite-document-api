import { service } from "./service.mjs";
import { Documents } from "./documents.mjs";
import { auth, body, json } from "./http.mjs";
let docs;
const applicationMode = process.env.DOC_AUTH_MODE === "application";
async function identity(req, path, seller) {
  if (applicationMode) {
    auth(req, process.env.APP_TOKEN);
    if (!/^0x[0-9a-f]{40}$/i.test(process.env.APP_PAYER || ""))
      throw Error("APP_PAYER required in application mode");
    return { payer: process.env.APP_PAYER.toLowerCase() };
  }
  return seller.identity(path, req.headers["sign-in-with-x"]);
}
const app = service({
  path: "/v1/documents/extract",
  port: 4409,
  precheck: async (i, req, { vault, seller }) => {
    docs ??= new Documents(vault);
    // A signed payment will independently establish ownership during execute.
    if (!applicationMode && req.headers["payment-signature"]) {
      docs.precheck(i);
      return;
    }
    const owner = await identity(req, "/v1/documents/extract", seller);
    if (!owner.payer) return owner;
    docs.precheck(i, owner.payer);
  },
  execute: ({ input, payer }) => docs.execute(input, payer),
  extraRoute: async (req, res, path, { vault, seller }) => {
    if (path !== "/uploads" || req.method !== "POST") return false;
    const owner = await identity(req, path, seller);
    if (!owner.payer) {
      json(res, owner.status, owner.body, owner.headers);
      return true;
    }
    docs ??= new Documents(vault);
    await docs.expire();
    const i = await body(req, 14 * 1024 * 1024);
    json(res, 201, await docs.upload(i.pdf_base64, owner.payer));
    return true;
  },
});
app.start();
