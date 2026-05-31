import fs from "node:fs/promises";
import path from "node:path";

const OUT_DIR = path.resolve("outputs", "education_gap_map");
const GEO_PATH = path.join(OUT_DIR, "skorea-provinces-gadm-geo.json");
const CSV_PATH = path.join(OUT_DIR, "education_gap_by_region.csv");
const HTML_PATH = path.join(OUT_DIR, "education_gap_korea_map.html");

const REGIONS = [
  { code: "B10", name: "서울", fullName: "서울특별시", geo: "Seoul", lon: 126.978, lat: 37.566 },
  { code: "C10", name: "부산", fullName: "부산광역시", geo: "Busan", lon: 129.075, lat: 35.179 },
  { code: "D10", name: "대구", fullName: "대구광역시", geo: "Daegu", lon: 128.601, lat: 35.872 },
  { code: "E10", name: "인천", fullName: "인천광역시", geo: "Incheon", lon: 126.705, lat: 37.456 },
  { code: "F10", name: "광주", fullName: "광주광역시", geo: "Gwangju", lon: 126.852, lat: 35.159 },
  { code: "G10", name: "대전", fullName: "대전광역시", geo: "Daejeon", lon: 127.385, lat: 36.350 },
  { code: "H10", name: "울산", fullName: "울산광역시", geo: "Ulsan", lon: 129.311, lat: 35.539 },
  { code: "I10", name: "세종", fullName: "세종특별자치시", geo: null, lon: 127.292, lat: 36.592 },
  { code: "J10", name: "경기", fullName: "경기도", geo: "Gyeonggi-do", lon: 127.009, lat: 37.275 },
  { code: "K10", name: "강원", fullName: "강원특별자치도", geo: "Gangwon-do", lon: 128.155, lat: 37.822 },
  { code: "M10", name: "충북", fullName: "충청북도", geo: "Chungcheongbuk-do", lon: 127.491, lat: 36.635 },
  { code: "N10", name: "충남", fullName: "충청남도", geo: "Chungcheongnam-do", lon: 126.800, lat: 36.518 },
  { code: "P10", name: "전북", fullName: "전북특별자치도", geo: "Jeollabuk-do", lon: 127.109, lat: 35.821 },
  { code: "Q10", name: "전남", fullName: "전라남도", geo: "Jeollanam-do", lon: 126.463, lat: 34.816 },
  { code: "R10", name: "경북", fullName: "경상북도", geo: "Gyeongsangbuk-do", lon: 128.505, lat: 36.576 },
  { code: "S10", name: "경남", fullName: "경상남도", geo: "Gyeongsangnam-do", lon: 128.692, lat: 35.238 },
  { code: "T10", name: "제주", fullName: "제주특별자치도", geo: "Jeju", lon: 126.531, lat: 33.499 },
];

const DATASETS = [
  { key: "schoolCount", endpoint: "schoolInfo", label: "학교 수" },
  { key: "academyCount", endpoint: "acaInsTiInfo", label: "학원·교습소 수" },
];

function fmt(value, digits = 0) {
  return Number(value).toLocaleString("ko-KR", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function getTotal(endpoint, code) {
  const url = new URL(`https://open.neis.go.kr/hub/${endpoint}`);
  url.searchParams.set("Type", "json");
  url.searchParams.set("pIndex", "1");
  url.searchParams.set("pSize", "1");
  url.searchParams.set("ATPT_OFCDC_SC_CODE", code);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${endpoint} ${code} HTTP ${res.status}`);
  const json = await res.json();
  const block = json[endpoint];
  const total = block?.[0]?.head?.[0]?.list_total_count;
  if (!Number.isFinite(total)) {
    throw new Error(`${endpoint} ${code} total count not found: ${JSON.stringify(json).slice(0, 300)}`);
  }
  return total;
}

async function collectData() {
  const rows = [];
  for (const region of REGIONS) {
    const row = { ...region };
    for (const dataset of DATASETS) {
      row[dataset.key] = await getTotal(dataset.endpoint, region.code);
    }
    row.academiesPerSchool = row.academyCount / row.schoolCount;
    row.gapScore = Math.round(row.academiesPerSchool * 100) / 100;
    rows.push(row);
    console.log(`${region.name}: 학교 ${row.schoolCount}, 학원·교습소 ${row.academyCount}`);
  }
  return rows.sort((a, b) => b.academiesPerSchool - a.academiesPerSchool);
}

function csv(rows) {
  const header = ["region", "full_name", "school_count", "academy_count", "academies_per_school"];
  const lines = rows.map((row) => [
    row.name,
    row.fullName,
    row.schoolCount,
    row.academyCount,
    row.academiesPerSchool.toFixed(2),
  ].map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","));
  return `\ufeff${header.join(",")}\n${lines.join("\n")}\n`;
}

function geoBounds(geo) {
  const bounds = { minLon: Infinity, minLat: Infinity, maxLon: -Infinity, maxLat: -Infinity };
  const visit = (coords) => {
    if (typeof coords[0] === "number") {
      const [lon, lat] = coords;
      bounds.minLon = Math.min(bounds.minLon, lon);
      bounds.maxLon = Math.max(bounds.maxLon, lon);
      bounds.minLat = Math.min(bounds.minLat, lat);
      bounds.maxLat = Math.max(bounds.maxLat, lat);
      return;
    }
    coords.forEach(visit);
  };
  geo.features.forEach((feature) => visit(feature.geometry.coordinates));
  return bounds;
}

function makeProjection(bounds, width, height, pad) {
  const scale = Math.min(
    (width - pad * 2) / (bounds.maxLon - bounds.minLon),
    (height - pad * 2) / (bounds.maxLat - bounds.minLat),
  );
  const usedW = (bounds.maxLon - bounds.minLon) * scale;
  const usedH = (bounds.maxLat - bounds.minLat) * scale;
  const xPad = (width - usedW) / 2;
  const yPad = (height - usedH) / 2;
  return ([lon, lat]) => [
    xPad + (lon - bounds.minLon) * scale,
    yPad + (bounds.maxLat - lat) * scale,
  ];
}

function ringPath(ring, project) {
  return ring.map((point, i) => {
    const [x, y] = project(point);
    return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ") + "Z";
}

function geometryPath(geometry, project) {
  if (geometry.type === "Polygon") {
    return geometry.coordinates.map((ring) => ringPath(ring, project)).join(" ");
  }
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.flatMap((poly) => poly.map((ring) => ringPath(ring, project))).join(" ");
  }
  return "";
}

function quantileBreaks(values, buckets) {
  const sorted = [...values].sort((a, b) => a - b);
  return Array.from({ length: buckets - 1 }, (_, i) => {
    const pos = Math.ceil(((i + 1) / buckets) * sorted.length) - 1;
    return sorted[Math.max(0, Math.min(sorted.length - 1, pos))];
  });
}

function bucket(value, breaks) {
  return breaks.findIndex((limit) => value <= limit) + 1 || breaks.length + 1;
}

function buildHtml(rows, geo) {
  const width = 760;
  const height = 880;
  const byGeo = new Map(rows.filter((row) => row.geo).map((row) => [row.geo, row]));
  const byName = new Map(rows.map((row) => [row.name, row]));
  const bounds = geoBounds(geo);
  const project = makeProjection(bounds, width, height, 32);
  const breaks = quantileBreaks(rows.map((row) => row.academiesPerSchool), 5);
  const palette = ["#edf6f9", "#bfe3df", "#7dc7c4", "#f6bd60", "#d95d39"];
  const top = rows[0];
  const bottom = rows.at(-1);
  const avg = rows.reduce((sum, row) => sum + row.academiesPerSchool, 0) / rows.length;
  const totalSchools = rows.reduce((sum, row) => sum + row.schoolCount, 0);
  const totalAcademies = rows.reduce((sum, row) => sum + row.academyCount, 0);

  const paths = geo.features.map((feature) => {
    const row = byGeo.get(feature.properties.NAME_1);
    const label = row ? `${row.fullName}: 학교 ${fmt(row.schoolCount)}곳, 학원·교습소 ${fmt(row.academyCount)}곳, 학교 1곳당 ${fmt(row.academiesPerSchool, 2)}곳` : feature.properties.NAME_1;
    const fill = row ? palette[bucket(row.academiesPerSchool, breaks) - 1] : "#e8ecf1";
    const [cx, cy] = project([row?.lon ?? 127.7, row?.lat ?? 36.2]);
    return `
      <path class="region" d="${geometryPath(feature.geometry, project)}" fill="${fill}" tabindex="0" aria-label="${escapeHtml(label)}">
        <title>${escapeHtml(label)}</title>
      </path>
      ${row ? `<text class="map-label" x="${cx.toFixed(1)}" y="${cy.toFixed(1)}">${row.name}</text>` : ""}`;
  }).join("\n");

  const sejong = byName.get("세종");
  const [sjx, sjy] = project([sejong.lon, sejong.lat]);
  const sejongFill = palette[bucket(sejong.academiesPerSchool, breaks) - 1];
  const legend = palette.map((color, i) => {
    const min = i === 0 ? Math.min(...rows.map((row) => row.academiesPerSchool)) : breaks[i - 1];
    const max = i === palette.length - 1 ? Math.max(...rows.map((row) => row.academiesPerSchool)) : breaks[i];
    return `<span><i style="background:${color}"></i>${fmt(min, 1)}-${fmt(max, 1)}</span>`;
  }).join("");

  const tableRows = rows.map((row, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${row.fullName}</td>
      <td>${fmt(row.schoolCount)}</td>
      <td>${fmt(row.academyCount)}</td>
      <td><strong>${fmt(row.academiesPerSchool, 2)}</strong></td>
    </tr>`).join("");

  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>지역별 학교·학원 수 교육 격차 지도</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #172033;
      --muted: #667085;
      --line: #d9e0e8;
      --paper: #ffffff;
      --bg: #f5f7fa;
      --accent: #0f766e;
      font-family: "Segoe UI", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif;
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--ink); }
    main { max-width: 1240px; margin: 0 auto; padding: 28px; }
    header { margin-bottom: 18px; }
    h1 { margin: 0 0 8px; font-size: clamp(26px, 4vw, 44px); line-height: 1.1; letter-spacing: 0; }
    .subtitle { max-width: 860px; margin: 0; color: var(--muted); line-height: 1.65; font-size: 16px; }
    .dashboard { display: grid; grid-template-columns: minmax(360px, 1.1fr) minmax(340px, 0.9fr); gap: 18px; align-items: start; }
    .map-panel, .side-panel, .table-panel { background: var(--paper); border: 1px solid var(--line); border-radius: 8px; }
    .map-panel { padding: 16px; }
    .side-panel { padding: 18px; }
    .table-panel { margin-top: 18px; overflow: hidden; }
    svg { width: 100%; height: auto; display: block; }
    .region { stroke: #ffffff; stroke-width: 1.2; transition: filter .15s ease, stroke-width .15s ease; }
    .region:hover, .region:focus { filter: brightness(.96); stroke: #172033; stroke-width: 2.4; outline: none; }
    .map-label { pointer-events: none; text-anchor: middle; font-size: 15px; font-weight: 800; fill: #172033; paint-order: stroke; stroke: white; stroke-width: 3px; stroke-linejoin: round; }
    .sejong-label { font-size: 14px; }
    .legend { display: flex; flex-wrap: wrap; gap: 8px 12px; margin-top: 12px; color: var(--muted); font-size: 13px; }
    .legend span { display: inline-flex; align-items: center; gap: 6px; }
    .legend i { width: 18px; height: 12px; border-radius: 2px; border: 1px solid rgba(23,32,51,.14); }
    .metric-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin: 16px 0; }
    .metric { border: 1px solid var(--line); border-radius: 8px; padding: 13px; background: #fbfcfd; }
    .metric b { display: block; font-size: 26px; line-height: 1.1; }
    .metric span { display: block; margin-top: 5px; color: var(--muted); font-size: 13px; }
    h2 { margin: 0 0 10px; font-size: 20px; letter-spacing: 0; }
    .reading { margin: 0; color: var(--muted); line-height: 1.7; }
    .ranking { margin: 16px 0 0; padding: 0; list-style: none; display: grid; gap: 9px; }
    .ranking li { display: flex; justify-content: space-between; gap: 12px; border-bottom: 1px solid var(--line); padding-bottom: 9px; }
    .ranking b { white-space: nowrap; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    caption { text-align: left; padding: 16px 18px 8px; font-weight: 800; font-size: 18px; }
    th, td { padding: 11px 14px; border-top: 1px solid var(--line); text-align: right; }
    th { background: #f1f4f8; color: #344054; font-weight: 700; }
    th:nth-child(2), td:nth-child(2) { text-align: left; }
    .note { margin: 14px 0 0; color: var(--muted); font-size: 13px; line-height: 1.6; }
    a { color: var(--accent); }
    @media (max-width: 880px) {
      main { padding: 18px; }
      .dashboard { grid-template-columns: 1fr; }
      .metric-grid { grid-template-columns: 1fr; }
      th, td { padding: 10px 8px; font-size: 13px; }
    }
  </style>
</head>
<body>
<main>
  <header>
    <h1>지역별 학교·학원 수로 본 교육 격차 지도</h1>
    <p class="subtitle">색이 진할수록 학교 1곳당 학원·교습소 수가 많습니다. 이 지표는 공교육 기관 수에 비해 사교육 인프라가 얼마나 조밀하게 분포하는지 보는 보조 지표입니다.</p>
  </header>
  <section class="dashboard">
    <div class="map-panel">
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="map-title map-desc">
        <title id="map-title">대한민국 시도별 학교 대비 학원·교습소 수 지도</title>
        <desc id="map-desc">나이스 교육정보 개방 API의 학교기본정보와 학원교습소정보 집계를 사용한 시도별 교육 인프라 지도</desc>
        ${paths}
        <circle class="region" cx="${sjx.toFixed(1)}" cy="${sjy.toFixed(1)}" r="12" fill="${sejongFill}" stroke="#172033" stroke-width="1.5" tabindex="0" aria-label="${escapeHtml(`${sejong.fullName}: 학교 ${fmt(sejong.schoolCount)}곳, 학원·교습소 ${fmt(sejong.academyCount)}곳, 학교 1곳당 ${fmt(sejong.academiesPerSchool, 2)}곳`)}">
          <title>${escapeHtml(`${sejong.fullName}: 학교 ${fmt(sejong.schoolCount)}곳, 학원·교습소 ${fmt(sejong.academyCount)}곳, 학교 1곳당 ${fmt(sejong.academiesPerSchool, 2)}곳`)}</title>
        </circle>
        <text class="map-label sejong-label" x="${(sjx + 34).toFixed(1)}" y="${(sjy + 5).toFixed(1)}">세종</text>
      </svg>
      <div class="legend" aria-label="학교 1곳당 학원·교습소 수 범례">${legend}</div>
      <p class="note">세종은 사용한 시도 경계 GeoJSON에 독립 폴리곤이 없어 실제 위치에 원형 마커로 표시했습니다.</p>
    </div>
    <aside class="side-panel">
      <h2>핵심 읽기</h2>
      <p class="reading">전국 합계는 학교 ${fmt(totalSchools)}곳, 학원·교습소 ${fmt(totalAcademies)}곳입니다. 학교 1곳당 학원·교습소 수 평균은 ${fmt(avg, 2)}곳이며, 가장 높은 지역은 ${top.fullName}(${fmt(top.academiesPerSchool, 2)}), 가장 낮은 지역은 ${bottom.fullName}(${fmt(bottom.academiesPerSchool, 2)})입니다.</p>
      <div class="metric-grid">
        <div class="metric"><b>${fmt(totalSchools)}</b><span>전국 학교 수</span></div>
        <div class="metric"><b>${fmt(totalAcademies)}</b><span>전국 학원·교습소 수</span></div>
        <div class="metric"><b>${fmt(top.academiesPerSchool, 2)}</b><span>최고 지역 비율</span></div>
        <div class="metric"><b>${fmt(bottom.academiesPerSchool, 2)}</b><span>최저 지역 비율</span></div>
      </div>
      <h2>상위 지역</h2>
      <ol class="ranking">
        ${rows.slice(0, 5).map((row) => `<li><span>${row.fullName}</span><b>${fmt(row.academiesPerSchool, 2)}</b></li>`).join("")}
      </ol>
      <p class="note">자료: 나이스 교육정보 개방 API schoolInfo, acaInsTiInfo 조회. 지도 경계: southkorea-maps GADM GeoJSON. 생성일: ${new Date().toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })}</p>
    </aside>
  </section>
  <section class="table-panel">
    <table>
      <caption>시도별 집계</caption>
      <thead><tr><th>순위</th><th>지역</th><th>학교 수</th><th>학원·교습소 수</th><th>학교 1곳당</th></tr></thead>
      <tbody>${tableRows}</tbody>
    </table>
  </section>
</main>
</body>
</html>`;
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const geo = JSON.parse(await fs.readFile(GEO_PATH, "utf8"));
  const rows = await collectData();
  await fs.writeFile(CSV_PATH, csv(rows), "utf8");
  await fs.writeFile(HTML_PATH, buildHtml(rows, geo), "utf8");
  console.log(`CSV: ${CSV_PATH}`);
  console.log(`HTML: ${HTML_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
