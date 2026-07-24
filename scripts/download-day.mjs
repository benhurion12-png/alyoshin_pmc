import { createWriteStream, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";

const args = process.argv.slice(2);
const valueAfter = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};
const date = valueAfter("--date");
const outputRoot = path.resolve(valueAfter("--output") ?? "data");
const username = process.env.CDSE_USERNAME;
const password = process.env.CDSE_PASSWORD;

if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error("Usage: npm run download-day -- --date YYYY-MM-DD [--output data]");
  process.exit(1);
}
if (!username || !password) {
  console.error("Set CDSE_USERNAME and CDSE_PASSWORD in the current terminal.");
  process.exit(1);
}

const dayStart = `${date}T00:00:00.000Z`;
const dayEnd = new Date(`${date}T00:00:00.000Z`);
dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
const targetDir = path.join(outputRoot, date);
mkdirSync(targetDir, { recursive: true });

let accessToken = "";
let refreshToken = "";
let expiresAt = 0;
const tokenEndpoint = "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token";

async function authenticate(refresh = false) {
  const body = new URLSearchParams(refresh
    ? { client_id: "cdse-public", grant_type: "refresh_token", refresh_token: refreshToken }
    : { client_id: "cdse-public", grant_type: "password", username, password });
  const response = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) throw new Error(`CDSE authentication failed (${response.status}).`);
  const token = await response.json();
  accessToken = token.access_token;
  refreshToken = token.refresh_token ?? refreshToken;
  expiresAt = Date.now() + Math.max(30, Number(token.expires_in ?? 300) - 60) * 1000;
}

async function validToken() {
  if (!accessToken) await authenticate(false);
  else if (Date.now() >= expiresAt) await authenticate(true);
  return accessToken;
}

async function searchProducts(fragment) {
  const filter = [
    "Collection/Name eq 'SENTINEL-5P'",
    `ContentDate/Start ge ${dayStart}`,
    `ContentDate/Start lt ${dayEnd.toISOString()}`,
    `contains(Name,'${fragment}')`,
  ].join(" and ");
  const query = new URLSearchParams({
    "$filter": filter,
    "$select": "Id,Name,ContentLength,ContentDate",
    "$orderby": "ContentDate/Start asc",
    "$top": "1000",
  });
  const response = await fetch(`https://catalogue.dataspace.copernicus.eu/odata/v1/Products?${query}`);
  if (!response.ok) throw new Error(`Catalogue search failed (${response.status}).`);
  return (await response.json()).value ?? [];
}

async function download(product, position, total) {
  const destination = path.join(targetDir, product.Name);
  if (existsSync(destination) && statSync(destination).size === Number(product.ContentLength)) {
    console.log(`[${position}/${total}] already downloaded: ${product.Name}`);
    return;
  }
  const partial = `${destination}.part`;
  const response = await fetch(`https://download.dataspace.copernicus.eu/odata/v1/Products(${product.Id})/$value`, {
    redirect: "follow",
    headers: { authorization: `Bearer ${await validToken()}` },
  });
  if (!response.ok || !response.body) throw new Error(`Download failed for ${product.Name} (${response.status}).`);
  const expected = Number(response.headers.get("content-length") ?? product.ContentLength ?? 0);
  let received = 0;
  const monitor = new TransformStream({
    transform(chunk, controller) {
      received += chunk.byteLength;
      if (received % (64 * 1024 * 1024) < chunk.byteLength) {
        const percent = expected ? ` ${Math.round(received / expected * 100)}%` : "";
        process.stdout.write(`\r[${position}/${total}] ${product.Name}${percent}`);
      }
      controller.enqueue(chunk);
    },
  });
  await pipeline(Readable.fromWeb(response.body.pipeThrough(monitor)), createWriteStream(partial));
  renameSync(partial, destination);
  process.stdout.write(`\r[${position}/${total}] downloaded: ${product.Name}\n`);
}

try {
  const [radiance, irradiance] = await Promise.all([
    searchProducts("_L1B_RA_BD1_"),
    searchProducts("_L1B_IR_UVN_"),
  ]);
  const products = [...radiance, ...irradiance];
  console.log(`Found ${radiance.length} RA_BD1 and ${irradiance.length} IR_UVN products for ${date}.`);
  if (!products.length) process.exit(2);
  await authenticate(false);
  for (let index = 0; index < products.length; index++) await download(products[index], index + 1, products.length);
  console.log(`Complete: ${targetDir}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
