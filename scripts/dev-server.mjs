import fs from "node:fs";
import http from "node:http";
import next from "next";
import { downloadMls } from "../lib/server/earthdata-mls.mjs";

for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match && !process.env[match[1].trim()]) {
    process.env[match[1].trim()] = match[2].trim().replace(/^(['"])(.*)\1$/, "$2");
  }
}

const hostname = "127.0.0.1";
const port = Number(process.env.PORT || 3000);
const app = next({ dev: true, hostname, port });
const handle = app.getRequestHandler();
await app.prepare();

http.createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${hostname}:${port}`);
  if (url.pathname === "/api/earthdata-mls") {
    try {
      const product = url.searchParams.get("product");
      const date = url.searchParams.get("date");
      if (!["temperature", "gph"].includes(product) || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) {
        response.writeHead(400); response.end("Неверные параметры."); return;
      }
      const result = await downloadMls(product, date, process.env.EARTHDATA_TOKEN);
      response.writeHead(200, {
        "Content-Type": "application/x-hdf5",
        "Content-Length": result.bytes.length,
        "X-MLS-Date": result.resolvedDate,
        "X-MLS-Filename": result.filename,
      });
      response.end(result.bytes);
    } catch (error) {
      response.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
      response.end(error instanceof Error ? error.message : String(error));
    }
    return;
  }
  await handle(request, response);
}).listen(port, hostname, () => console.log(`Local: http://${hostname}:${port}`));
