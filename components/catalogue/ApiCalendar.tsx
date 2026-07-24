"use client";

import { useState } from "react";

type CatalogueProduct = {
  Id: string;
  Name: string;
  ContentLength: number;
  ContentDate: { Start: string; End: string };
};

const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} ГБ`;

export default function ApiCalendar() {
  const [date, setDate] = useState("2026-07-23");
  const [products, setProducts] = useState<CatalogueProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const search = async () => {
    setLoading(true); setError(""); setProducts([]);
    try {
      const end = new Date(`${date}T00:00:00.000Z`); end.setUTCDate(end.getUTCDate() + 1);
      const load = async (prefix: string, start = `${date}T00:00:00.000Z`, finish = end.toISOString()) => {
        const query = new URLSearchParams({
          "$filter": `Collection/Name eq 'SENTINEL-5P' and ContentDate/Start ge ${start} and ContentDate/Start lt ${finish} and startswith(Name,'${prefix}')`,
          "$select": "Id,Name,ContentLength,ContentDate",
          "$orderby": "ContentDate/Start asc",
          "$top": "100",
        });
        const response = await fetch(`https://catalogue.dataspace.copernicus.eu/odata/v1/Products?${query}`);
        if (!response.ok) throw new Error(`Каталог CDSE ответил ${response.status}`);
        return (await response.json()).value as CatalogueProduct[];
      };
      const irradianceStart = new Date(`${date}T00:00:00.000Z`); irradianceStart.setUTCDate(irradianceStart.getUTCDate() - 2);
      const irradianceEnd = new Date(`${date}T00:00:00.000Z`); irradianceEnd.setUTCDate(irradianceEnd.getUTCDate() + 3);
      const [radiance, irradianceCandidates] = await Promise.all([
        load("S5P_OFFL_L1B_RA_BD1_"),
        load("S5P_OFFL_L1B_IR_UVN_", irradianceStart.toISOString(), irradianceEnd.toISOString()),
      ]);
      const targetTime = new Date(`${date}T12:00:00.000Z`).getTime();
      const irradiance = irradianceCandidates
        .sort((a, b) => Math.abs(new Date(a.ContentDate.Start).getTime() - targetTime) - Math.abs(new Date(b.ContentDate.Start).getTime() - targetTime))
        .slice(0, 1);
      setProducts([...radiance, ...irradiance]);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setLoading(false);
    }
  };

  const radiance = products.filter((product) => product.Name.includes("_RA_BD1_"));
  const irradiance = products.filter((product) => product.Name.includes("_IR_UVN_"));
  const command = `npm run download-day -- --date ${date}`;

  return (
    <div className="api-calendar">
      <div><span className="api-dot" />COPERNICUS DATA SPACE API</div>
      <p>Нет локальных орбит? Найдите полный суточный набор OFFL.</p>
      <div className="calendar-row">
        <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        <button onClick={search} disabled={loading}>{loading ? "ПОИСК…" : "НАЙТИ ОРБИТЫ"}</button>
      </div>
      {error ? <div className="error">{error}</div> : null}
      {products.length ? (
        <div className="catalogue-result">
          <div><b>{radiance.length}</b><span>OFFL RA_BD1</span></div>
          <div><b>{irradiance.length}</b><span>IR_UVN</span></div>
          <div><b>{gb(products.reduce((sum, product) => sum + Number(product.ContentLength || 0), 0))}</b><span>объём</span></div>
          <code>{command}</code>
          <button onClick={() => navigator.clipboard.writeText(command)}>КОПИРОВАТЬ</button>
        </div>
      ) : null}
      <small>Поиск открыт без авторизации. Скачивание выполняет локальная команда; пароль не передаётся этому сайту.</small>
    </div>
  );
}
