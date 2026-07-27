import { downloadMls } from "../../lib/server/earthdata-mls.mjs";

export default async (request) => {
  try {
    const url = new URL(request.url);
    const product = url.searchParams.get("product");
    const date = url.searchParams.get("date");
    if (!["temperature", "gph"].includes(product) || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) {
      return new Response("Нужны product=temperature|gph и date=YYYY-MM-DD.", { status: 400 });
    }
    const result = await downloadMls(product, date, process.env.EARTHDATA_TOKEN, request.signal);
    return new Response(result.bytes, {
      headers: {
        "Content-Type": "application/x-hdf5",
        "Content-Disposition": `inline; filename="${result.filename}"`,
        "X-MLS-Date": result.resolvedDate,
        "X-MLS-Filename": result.filename,
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : String(error), { status: 502 });
  }
};
