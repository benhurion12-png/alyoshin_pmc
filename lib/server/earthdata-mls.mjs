const COLLECTIONS = {
  temperature: "C3127198472-GES_DISC",
  gph: "C3127197602-GES_DISC",
};

const day = (date) => date.toISOString().slice(0, 10);

async function granuleForDate(product, requestedDate, signal) {
  const collection = COLLECTIONS[product];
  if (!collection) throw new Error("Неизвестный продукт Aura MLS.");
  const base = new Date(`${requestedDate}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) throw new Error("Некорректная дата.");
  const offsets = [0, ...Array.from({ length: 14 }, (_, i) => [-(i + 1), i + 1]).flat()];
  for (const offset of offsets) {
    const candidate = new Date(base.getTime() + offset * 86_400_000);
    const date = day(candidate);
    const url = new URL("https://cmr.earthdata.nasa.gov/search/granules.umm_json");
    url.searchParams.set("collection_concept_id", collection);
    url.searchParams.set("temporal", `${date}T00:00:00Z,${date}T23:59:59Z`);
    url.searchParams.set("page_size", "10");
    const response = await fetch(url, { signal, headers: { Accept: "application/vnd.nasa.cmr.umm_results+json" } });
    if (!response.ok) continue;
    const json = await response.json();
    const item = json.items?.[0]?.umm;
    const dataUrl = item?.RelatedUrls?.find((entry) =>
      entry.Type === "GET DATA" && typeof entry.URL === "string" && entry.URL.endsWith(".he5"),
    )?.URL;
    if (dataUrl) return { dataUrl, resolvedDate: date, filename: dataUrl.split("/").at(-1) };
  }
  throw new Error(`Aura MLS не найден в пределах ±14 дней от ${requestedDate}.`);
}

export async function downloadMls(product, requestedDate, token, signal) {
  if (!token) throw new Error("На сервере не задан EARTHDATA_TOKEN.");
  const granule = await granuleForDate(product, requestedDate, signal);
  const response = await fetch(granule.dataUrl, {
    signal,
    redirect: "follow",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const details = (await response.text()).slice(0, 300);
    throw new Error(`NASA GES DISC: HTTP ${response.status}${details ? ` · ${details}` : ""}`);
  }
  return { ...granule, bytes: Buffer.from(await response.arrayBuffer()) };
}
