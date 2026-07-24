"use client";

import { useRef, useState } from "react";

type CatalogueProduct = {
  Id: string;
  Name: string;
  ContentLength: number;
  ContentDate: { Start: string; End: string };
};

type LocalWritable = {
  write(data: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort?(): Promise<void>;
};

type LocalFileHandle = {
  getFile(): Promise<File>;
  createWritable(): Promise<LocalWritable>;
};

type LocalDirectoryHandle = {
  name: string;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<LocalDirectoryHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<LocalFileHandle>;
};

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (options?: { mode?: "read" | "readwrite" }) => Promise<LocalDirectoryHandle>;
};

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
};

type DownloadState = {
  current: number;
  total: number;
  file: string;
  fileBytes: number;
  fileTotal: number;
  downloaded: number;
  skipped: number;
};

const TOKEN_ENDPOINT =
  "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token";
const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} ГБ`;
const percent = (part: number, total: number) => (total ? Math.min(100, Math.round(part / total * 100)) : 0);

export default function ApiCalendar() {
  const [date, setDate] = useState("2026-07-23");
  const [products, setProducts] = useState<CatalogueProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [download, setDownload] = useState<DownloadState | null>(null);
  const [message, setMessage] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const search = async () => {
    setLoading(true);
    setError("");
    setMessage("");
    setProducts([]);
    try {
      const end = new Date(`${date}T00:00:00.000Z`);
      end.setUTCDate(end.getUTCDate() + 1);
      const load = async (prefix: string, start = `${date}T00:00:00.000Z`, finish = end.toISOString()) => {
        const query = new URLSearchParams({
          "$filter": `Collection/Name eq 'SENTINEL-5P' and ContentDate/Start ge ${start} and ContentDate/Start lt ${finish} and startswith(Name,'${prefix}')`,
          "$select": "Id,Name,ContentLength,ContentDate",
          "$orderby": "ContentDate/Start asc",
          "$top": "1000",
        });
        const response = await fetch(`https://catalogue.dataspace.copernicus.eu/odata/v1/Products?${query}`);
        if (!response.ok) throw new Error(`Каталог CDSE ответил ${response.status}`);
        return (await response.json()).value as CatalogueProduct[];
      };
      const irradianceStart = new Date(`${date}T00:00:00.000Z`);
      irradianceStart.setUTCDate(irradianceStart.getUTCDate() - 2);
      const irradianceEnd = new Date(`${date}T00:00:00.000Z`);
      irradianceEnd.setUTCDate(irradianceEnd.getUTCDate() + 3);
      const radianceStart = new Date(`${date}T00:00:00.000Z`);
      radianceStart.setUTCHours(radianceStart.getUTCHours() - 2);
      const radianceEnd = new Date(end);
      radianceEnd.setUTCHours(radianceEnd.getUTCHours() + 2);
      const [radianceCandidates, irradianceCandidates] = await Promise.all([
        load("S5P_OFFL_L1B_RA_BD1_", radianceStart.toISOString(), radianceEnd.toISOString()),
        load("S5P_OFFL_L1B_IR_UVN_", irradianceStart.toISOString(), irradianceEnd.toISOString()),
      ]);
      const dayStartTime = new Date(`${date}T00:00:00.000Z`).getTime();
      const dayEndTime = end.getTime();
      const radiance = radianceCandidates.filter((product) =>
        new Date(product.ContentDate.Start).getTime() < dayEndTime
        && new Date(product.ContentDate.End).getTime() > dayStartTime
      );
      const targetTime = new Date(`${date}T12:00:00.000Z`).getTime();
      const irradiance = irradianceCandidates
        .sort((a, b) =>
          Math.abs(new Date(a.ContentDate.Start).getTime() - targetTime)
          - Math.abs(new Date(b.ContentDate.Start).getTime() - targetTime)
        )
        .slice(0, 1);
      setProducts([...radiance, ...irradiance]);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setLoading(false);
    }
  };

  const downloadProducts = async (selected: CatalogueProduct[]) => {
    setError("");
    setMessage("");
    if (!username.trim() || !password) {
      setError("Введите логин и пароль Copernicus Data Space.");
      return;
    }
    const picker = (window as DirectoryPickerWindow).showDirectoryPicker?.bind(window);
    if (!picker) {
      setError("Прямая запись папки поддерживается в актуальном Chrome или Edge.");
      return;
    }

    let root: LocalDirectoryHandle;
    try {
      root = await picker({ mode: "readwrite" });
    } catch (pickerError) {
      if (pickerError instanceof DOMException && pickerError.name === "AbortError") return;
      setError("Не удалось открыть выбранную папку.");
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    let accessToken = "";
    let refreshToken = "";
    let expiresAt = 0;
    let downloaded = 0;
    let skipped = 0;

    const authenticate = async (refresh = false) => {
      const body = new URLSearchParams(refresh
        ? { client_id: "cdse-public", grant_type: "refresh_token", refresh_token: refreshToken }
        : {
            client_id: "cdse-public",
            grant_type: "password",
            username: username.trim(),
            password,
          });
      const response = await fetch(TOKEN_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
        signal: controller.signal,
      });
      if (!response.ok) {
        if (response.status === 401 || response.status === 400) {
          throw new Error("CDSE отклонил логин или пароль.");
        }
        throw new Error(`Авторизация CDSE завершилась ошибкой ${response.status}.`);
      }
      const token = await response.json() as TokenResponse;
      accessToken = token.access_token;
      refreshToken = token.refresh_token ?? refreshToken;
      expiresAt = Date.now() + Math.max(30, Number(token.expires_in ?? 300) - 60) * 1000;
    };

    const validToken = async () => {
      if (!accessToken) await authenticate(false);
      else if (Date.now() >= expiresAt) await authenticate(Boolean(refreshToken));
      return accessToken;
    };

    try {
      setDownload({
        current: 0, total: selected.length, file: "Авторизация CDSE…",
        fileBytes: 0, fileTotal: 0, downloaded: 0, skipped: 0,
      });
      const target = await root.getDirectoryHandle(date, { create: true });
      await authenticate(false);

      for (let index = 0; index < selected.length; index += 1) {
        const product = selected[index];
        const expected = Number(product.ContentLength || 0);
        let handle: LocalFileHandle | null = null;
        try {
          handle = await target.getFileHandle(product.Name);
          const existing = await handle.getFile();
          if (expected > 0 && existing.size === expected) {
            skipped += 1;
            setDownload({
              current: index + 1, total: selected.length, file: product.Name,
              fileBytes: expected, fileTotal: expected, downloaded, skipped,
            });
            continue;
          }
        } catch {
          handle = null;
        }
        handle ??= await target.getFileHandle(product.Name, { create: true });

        setDownload({
          current: index + 1, total: selected.length, file: product.Name,
          fileBytes: 0, fileTotal: expected, downloaded, skipped,
        });
        let response = await fetch(
          `https://download.dataspace.copernicus.eu/odata/v1/Products(${product.Id})/$value`,
          {
            redirect: "follow",
            headers: { authorization: `Bearer ${await validToken()}` },
            signal: controller.signal,
          },
        );
        if (response.status === 401) {
          await authenticate(Boolean(refreshToken));
          response = await fetch(
            `https://download.dataspace.copernicus.eu/odata/v1/Products(${product.Id})/$value`,
            {
              redirect: "follow",
              headers: { authorization: `Bearer ${accessToken}` },
              signal: controller.signal,
            },
          );
        }
        if (!response.ok || !response.body) {
          throw new Error(`Не удалось скачать ${product.Name}: HTTP ${response.status}.`);
        }

        const fileTotal = Number(response.headers.get("content-length") || expected);
        const writable = await handle.createWritable();
        const reader = response.body.getReader();
        let fileBytes = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            await writable.write(value);
            fileBytes += value.byteLength;
            setDownload({
              current: index + 1, total: selected.length, file: product.Name,
              fileBytes, fileTotal, downloaded, skipped,
            });
          }
          await writable.close();
        } catch (writeError) {
          await writable.abort?.();
          throw writeError;
        }
        downloaded += 1;
      }
      setMessage(`Готово: ${downloaded} скачано, ${skipped} уже было. Папка: ${root.name}\\${date}`);
    } catch (nextError) {
      if (nextError instanceof DOMException && nextError.name === "AbortError") {
        setMessage("Загрузка остановлена.");
      } else {
        setError(nextError instanceof Error ? nextError.message : String(nextError));
      }
    } finally {
      abortRef.current = null;
      setDownload(null);
    }
  };

  const radiance = products.filter((product) => product.Name.includes("_RA_BD1_"));
  const irradiance = products.filter((product) => product.Name.includes("_IR_UVN_"));

  return (
    <div className="api-calendar">
      <div><span className="api-dot" />COPERNICUS DATA SPACE API</div>
      <p>Нет локальных орбит? Найдите и скачайте полный суточный набор OFFL прямо в папку data.</p>
      <div className="calendar-row">
        <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        <button onClick={search} disabled={loading || Boolean(download)}>
          {loading ? "ПОИСК…" : "НАЙТИ ОРБИТЫ"}
        </button>
      </div>
      {error ? <div className="error">{error}</div> : null}
      {message ? <div className="api-success">{message}</div> : null}
      {products.length ? (
        <>
          <div className="catalogue-result">
            <div><b>{radiance.length}</b><span>OFFL RA_BD1</span></div>
            <div><b>{irradiance.length}</b><span>IR_UVN</span></div>
            <div><b>{gb(products.reduce((sum, product) => sum + Number(product.ContentLength || 0), 0))}</b><span>объём</span></div>
          </div>
          <div className="api-credentials">
            <label>
              CDSE логин
              <input
                type="email"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <label>
              CDSE пароль
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
              />
            </label>
          </div>
          <div className="api-download-actions">
            <button onClick={() => downloadProducts(products)} disabled={Boolean(download)}>
              СКАЧАТЬ ВСЕ ({products.length})
            </button>
            <button onClick={() => downloadProducts(irradiance)} disabled={Boolean(download) || !irradiance.length}>
              ТОЛЬКО IR_UVN
            </button>
          </div>
        </>
      ) : null}
      {download ? (
        <div className="api-progress">
          <div>
            <span>{download.current}/{download.total}</span>
            <span>{percent(download.fileBytes, download.fileTotal)}%</span>
          </div>
          <progress value={download.fileBytes} max={download.fileTotal || 1} />
          <code title={download.file}>{download.file}</code>
          <small>Скачано: {download.downloaded} · пропущено: {download.skipped}</small>
          <button onClick={() => abortRef.current?.abort()}>ОСТАНОВИТЬ</button>
        </div>
      ) : null}
      <small>
        Выберите папку <b>data</b>: приложение создаст внутри каталог {date}. Логин и пароль не
        сохраняются и отправляются только службе авторизации CDSE. Работает в Chrome и Edge.
      </small>
    </div>
  );
}
