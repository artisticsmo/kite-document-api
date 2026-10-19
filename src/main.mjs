import { service } from "./service.mjs";
import { Documents } from "./documents.mjs";
import { auth, body, json } from "./http.mjs";
let docs;
const app = service({
  path: "/v1/documents/extract",
  port: 4409,
  precheck: (i, req, { vault }) => {
    auth(req, process.env.APP_TOKEN);
    docs ??= new Documents(vault, { payer: process.env.APP_PAYER });
    docs.precheck(i);
  },
  execute: ({ input, payer }) => docs.execute(input, payer),
  extraRoute: async (req, res, path, { vault }) => {
    if (path !== "/uploads" || req.method !== "POST") return false;
    auth(req, process.env.APP_TOKEN);
    docs ??= new Documents(vault, { payer: process.env.APP_PAYER });
    await docs.expire();
    const i = await body(req, 14 * 1024 * 1024);
    json(res, 201, await docs.upload(i.pdf_base64));
    return true;
  },
});
app.start();
