# TROPOMI PMC Explorer

Статическое клиентское приложение для локального исследования Sentinel-5P TROPOMI Level‑1B RA_BD1. Текущий релиз — первый MVP из ТЗ: инспектор NetCDF4/HDF5, автоматический поиск latitude/longitude, построение реального орбитального следа и экспорт `orbit.geojson`.

## Приватность и архитектура

Выбранный `.nc` не загружается в сеть. Браузер передаёт объект `File` модульному Web Worker. `h5wasm` монтирует файл через Emscripten `WORKERFS`, поэтому HDF5 использует произвольный доступ к локальному Blob, а главный UI-поток получает только прогресс, метаданные и небольшой GeoJSON. Backend, API routes, Python, Docker и Netlify Functions отсутствуют.

MapLibre загружается только в client component. Подложка OpenStreetMap не требует токена; при её использовании браузер запрашивает только тайлы карты, не содержимое научного файла.

## Запуск

```bash
npm install
npm run dev
```

Проверки:

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

Статическая сборка создаётся в `out/`. Для Netlify: build command `npm run build`, publish directory `out`.

## Инспектор и геолокация

Инспектор рекурсивно обходит groups и datasets, показывает shape/dtype/attributes и оценивает кандидатов по имени, пути и метаданным. Код не привязан к одному фиксированному пути. Орбитальный полигон строится по внешнему контуру фактической сетки координат; GeoJSON использует порядок `[longitude, latitude]`, нормализует долготу и пропускает недопустимые координаты.

## Научные ограничения

MVP намеренно не выдаёт фиктивные PMC и не вычисляет `detectionScore`. Полный pipeline статьи (UV-сигнал, SZA-binning, фон, residual, robust threshold, morphology и connected components) относится к следующей очереди разработки после проверки MVP на реальном RA_BD1. Орбитальный контур не включает параллактическую поправку на высоту PMC.

Научная основа: *Detection of Polar Mesospheric Clouds with TROPOMI*, Remote Sensing 18(10), 1599.

## Браузеры и память

Рекомендуются актуальные 64-битные Chrome или Edge. Метаданные читаются быстро, но извлечение двух полных координатных datasets может потребовать десятки мегабайт памяти. Worker можно отменить между этапами, однако активный синхронный вызов HDF5 нельзя прервать посередине.
