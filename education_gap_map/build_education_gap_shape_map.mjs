import fs from "node:fs/promises";
import path from "node:path";

const OUT_DIR = path.resolve("outputs", "education_gap_map");
const CSV_PATH = path.join(OUT_DIR, "education_gap_by_region.csv");
const GEO_PATH = path.join(OUT_DIR, "skorea-provinces-gadm-geo.json");
const HTML_PATH = path.join(OUT_DIR, "education_gap_korea_tile_map.html");

const REGION_META = {
  서울: { geo: "Seoul", lon: 126.978, lat: 37.566 },
  부산: { geo: "Busan", lon: 129.075, lat: 35.179 },
  대구: { geo: "Daegu", lon: 128.601, lat: 35.872 },
  인천: { geo: "Incheon", lon: 126.705, lat: 37.456 },
  광주: { geo: "Gwangju", lon: 126.852, lat: 35.159 },
  대전: { geo: "Daejeon", lon: 127.385, lat: 36.350 },
  울산: { geo: "Ulsan", lon: 129.311, lat: 35.539 },
  세종: { geo: null, lon: 127.292, lat: 36.592 },
  경기: { geo: "Gyeonggi-do", lon: 127.009, lat: 37.275 },
  강원: { geo: "Gangwon-do", lon: 128.155, lat: 37.822 },
  충북: { geo: "Chungcheongbuk-do", lon: 127.491, lat: 36.635 },
  충남: { geo: "Chungcheongnam-do", lon: 126.800, lat: 36.518 },
  전북: { geo: "Jeollabuk-do", lon: 127.109, lat: 35.821 },
  전남: { geo: "Jeollanam-do", lon: 126.463, lat: 34.816 },
  경북: { geo: "Gyeongsangbuk-do", lon: 128.505, lat: 36.576 },
  경남: { geo: "Gyeongsangnam-do", lon: 128.692, lat: 35.238 },
  제주: { geo: "Jeju", lon: 126.531, lat: 33.499 },
};

const LABEL_OFFSETS = {
  서울: [-16, -4],
  인천: [-24, 12],
  대전: [16, 10],
  세종: [28, 1],
  대구: [22, 4],
  부산: [18, 18],
  울산: [24, -4],
  광주: [-18, 8],
  제주: [0, 0],
};

function parseCsv(text) {
  return text.trim().split(/\r?\n/).slice(1).map((line) => {
    const cells = [...line.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
    return {
      name: cells[0],
      fullName: cells[1],
      schoolCount: Number(cells[2]),
      academyCount: Number(cells[3]),
      academiesPerSchool: Number(cells[4]),
      ...REGION_META[cells[0]],
    };
  });
}

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

function perpendicularDistance(point, start, end) {
  const [x, y] = point;
  const [x1, y1] = start;
  const [x2, y2] = end;
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) return Math.hypot(x - x1, y - y1);
  return Math.abs(dy * x - dx * y + x2 * y1 - y2 * x1) / Math.hypot(dx, dy);
}

function simplifyRing(points, tolerance) {
  if (points.length <= 5) return points;
  const closed = points[0][0] === points.at(-1)[0] && points[0][1] === points.at(-1)[1];
  const source = closed ? points.slice(0, -1) : points;
  const simplify = (pts) => {
    if (pts.length <= 2) return pts;
    let maxDistance = 0;
    let index = 0;
    for (let i = 1; i < pts.length - 1; i += 1) {
      const dist = perpendicularDistance(pts[i], pts[0], pts.at(-1));
      if (dist > maxDistance) {
        maxDistance = dist;
        index = i;
      }
    }
    if (maxDistance <= tolerance) return [pts[0], pts.at(-1)];
    return [...simplify(pts.slice(0, index + 1)).slice(0, -1), ...simplify(pts.slice(index))];
  };
  const result = simplify(source);
  return closed ? [...result, result[0]] : result;
}

function simplifyGeometry(geometry, tolerance = 0.012) {
  const simplifyPoly = (poly) => poly
    .map((ring) => simplifyRing(ring, tolerance))
    .filter((ring) => ring.length >= 4);
  if (geometry.type === "Polygon") return { ...geometry, coordinates: simplifyPoly(geometry.coordinates) };
  return { ...geometry, coordinates: geometry.coordinates.map(simplifyPoly).filter((poly) => poly.length) };
}

function geoBounds(features) {
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
  features.forEach((feature) => visit(feature.geometry.coordinates));
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
  return ring.map((point, index) => {
    const [x, y] = project(point);
    return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ") + "Z";
}

function geometryPath(geometry, project) {
  if (geometry.type === "Polygon") return geometry.coordinates.map((ring) => ringPath(ring, project)).join(" ");
  return geometry.coordinates.flatMap((poly) => poly.map((ring) => ringPath(ring, project))).join(" ");
}

function color(value, min, max) {
  const t = max === min ? 0 : (value - min) / (max - min);
  if (t < 0.20) return "#edf6f9";
  if (t < 0.40) return "#bfe3df";
  if (t < 0.60) return "#7dc7c4";
  if (t < 0.80) return "#f6bd60";
  return "#d95d39";
}

function buildHtml(rows, geo) {
  const width = 740;
  const height = 860;
  const values = rows.map((row) => row.academiesPerSchool);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const rowsByGeo = new Map(rows.filter((row) => row.geo).map((row) => [row.geo, row]));
  const features = geo.features.map((feature) => ({
    ...feature,
    geometry: simplifyGeometry(feature.geometry),
  }));
  const project = makeProjection(geoBounds(features), width, height, 32);
  const totalSchools = rows.reduce((sum, row) => sum + row.schoolCount, 0);
  const totalAcademies = rows.reduce((sum, row) => sum + row.academyCount, 0);
  const top = rows[0];
  const bottom = rows.at(-1);

  const paths = features.map((feature) => {
    const row = rowsByGeo.get(feature.properties.NAME_1);
    if (!row) return "";
    const fill = color(row.academiesPerSchool, min, max);
    const label = `${row.fullName}: 학교 ${fmt(row.schoolCount)}곳, 학원·교습소 ${fmt(row.academyCount)}곳, 학교 1곳당 ${fmt(row.academiesPerSchool, 2)}곳`;
    const [baseX, baseY] = project([row.lon, row.lat]);
    const [dx, dy] = LABEL_OFFSETS[row.name] ?? [0, 0];
    return `<path class="region" d="${geometryPath(feature.geometry, project)}" fill="${fill}" tabindex="0" aria-label="${escapeHtml(label)}"><title>${escapeHtml(label)}</title></path>
      <text class="map-label" x="${(baseX + dx).toFixed(1)}" y="${(baseY + dy).toFixed(1)}">${row.name}</text>`;
  }).join("\n");

  const sejong = rows.find((row) => row.name === "세종");
  const [sjx, sjy] = project([sejong.lon, sejong.lat]);
  const sejongFill = color(sejong.academiesPerSchool, min, max);
  const sejongLabel = `${sejong.fullName}: 학교 ${fmt(sejong.schoolCount)}곳, 학원·교습소 ${fmt(sejong.academyCount)}곳, 학교 1곳당 ${fmt(sejong.academiesPerSchool, 2)}곳`;
  const tableRows = rows.map((row, index) => `<tr><td>${index + 1}</td><td>${row.fullName}</td><td>${fmt(row.schoolCount)}</td><td>${fmt(row.academyCount)}</td><td><strong>${fmt(row.academiesPerSchool, 2)}</strong></td></tr>`).join("");

  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>지역별 학교·학원 수 교육 격차 지도</title>
  <style>
    :root { --ink:#172033; --muted:#667085; --line:#d9e0e8; --paper:#fff; --bg:#f5f7fa; font-family:"Segoe UI","Malgun Gothic","Apple SD Gothic Neo",sans-serif; }
    * { box-sizing:border-box; }
    body { margin:0; background:var(--bg); color:var(--ink); }
    main { max-width:1180px; margin:0 auto; padding:28px; }
    h1 { margin:0 0 8px; font-size:clamp(26px,4vw,44px); line-height:1.1; letter-spacing:0; }
    .subtitle { margin:0 0 18px; max-width:850px; color:var(--muted); line-height:1.65; }
    .dashboard { display:grid; grid-template-columns:minmax(330px,.95fr) minmax(330px,1fr); gap:18px; align-items:start; }
    .panel { background:var(--paper); border:1px solid var(--line); border-radius:8px; padding:18px; }
    svg { width:100%; height:auto; display:block; }
    .region { stroke:#fff; stroke-width:1.3; transition:filter .15s ease, stroke-width .15s ease; }
    .region:hover, .region:focus { filter:brightness(.96); stroke:#172033; stroke-width:2.5; outline:none; }
    .map-label { pointer-events:none; text-anchor:middle; font-size:15px; font-weight:900; fill:#172033; paint-order:stroke; stroke:#fff; stroke-width:3px; stroke-linejoin:round; }
    .legend { display:flex; flex-wrap:wrap; gap:8px 12px; margin-top:12px; color:var(--muted); font-size:13px; }
    .legend span { display:inline-flex; align-items:center; gap:6px; }
    .legend i { width:18px; height:12px; border:1px solid rgba(23,32,51,.14); border-radius:2px; }
    h2 { margin:0 0 10px; font-size:20px; letter-spacing:0; }
    .reading { margin:0; color:var(--muted); line-height:1.7; }
    .metrics { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; margin:16px 0; }
    .metric { border:1px solid var(--line); border-radius:8px; padding:13px; background:#fbfcfd; }
    .metric b { display:block; font-size:26px; line-height:1.1; }
    .metric span { display:block; margin-top:5px; color:var(--muted); font-size:13px; }
    table { width:100%; margin-top:18px; border-collapse:collapse; background:var(--paper); border:1px solid var(--line); border-radius:8px; overflow:hidden; font-size:14px; }
    caption { text-align:left; padding:16px 18px 8px; font-weight:800; font-size:18px; }
    th,td { padding:11px 14px; border-top:1px solid var(--line); text-align:right; }
    th { background:#f1f4f8; color:#344054; }
    th:nth-child(2),td:nth-child(2) { text-align:left; }
    .note { margin:14px 0 0; color:var(--muted); font-size:13px; line-height:1.6; }
    @media (max-width:860px) { main{padding:18px;} .dashboard{grid-template-columns:1fr;} .metrics{grid-template-columns:1fr;} th,td{padding:10px 8px;font-size:13px;} }
  </style>
</head>
<body>
<main>
  <h1>지역별 학교·학원 수로 본 교육 격차 지도</h1>
  <p class="subtitle">색이 진할수록 학교 1곳당 학원·교습소 수가 많습니다. 실제 우리나라 시도 경계 모양 위에 지역별 학교 수와 학원·교습소 수의 차이를 나타냈습니다.</p>
  <section class="dashboard">
    <div class="panel">
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="대한민국 시도별 학교 대비 학원·교습소 수 지도">
        ${paths}
        <circle class="region" cx="${sjx.toFixed(1)}" cy="${sjy.toFixed(1)}" r="11" fill="${sejongFill}" tabindex="0" aria-label="${escapeHtml(sejongLabel)}"><title>${escapeHtml(sejongLabel)}</title></circle>
        <text class="map-label" x="${(sjx + 28).toFixed(1)}" y="${(sjy + 1).toFixed(1)}">세종</text>
      </svg>
      <div class="legend"><span><i style="background:#edf6f9"></i>낮음</span><span><i style="background:#bfe3df"></i></span><span><i style="background:#7dc7c4"></i>보통</span><span><i style="background:#f6bd60"></i></span><span><i style="background:#d95d39"></i>높음</span></div>
      <p class="note">세종은 사용한 행정경계 파일에 별도 폴리곤이 없어 실제 위치에 원형 마커로 표시했습니다.</p>
    </div>
    <aside class="panel">
      <h2>핵심 읽기</h2>
      <p class="reading">전국 합계는 학교 ${fmt(totalSchools)}곳, 학원·교습소 ${fmt(totalAcademies)}곳입니다. 학교 1곳당 학원·교습소 수가 가장 높은 지역은 ${top.fullName}(${fmt(top.academiesPerSchool, 2)}), 가장 낮은 지역은 ${bottom.fullName}(${fmt(bottom.academiesPerSchool, 2)})입니다.</p>
      <div class="metrics">
        <div class="metric"><b>${fmt(totalSchools)}</b><span>전국 학교 수</span></div>
        <div class="metric"><b>${fmt(totalAcademies)}</b><span>전국 학원·교습소 수</span></div>
        <div class="metric"><b>${fmt(top.academiesPerSchool, 2)}</b><span>최고 지역 비율</span></div>
        <div class="metric"><b>${fmt(bottom.academiesPerSchool, 2)}</b><span>최저 지역 비율</span></div>
      </div>
      <p class="note">자료: 나이스 교육정보 개방 API schoolInfo, acaInsTiInfo 조회. 지도 경계: southkorea-maps GADM GeoJSON. 생성일: ${new Date().toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })}</p>
    </aside>
  </section>
  <table>
    <caption>시도별 집계</caption>
    <thead><tr><th>순위</th><th>지역</th><th>학교 수</th><th>학원·교습소 수</th><th>학교 1곳당</th></tr></thead>
    <tbody>${tableRows}</tbody>
  </table>
</main>
</body>
</html>`;
}

const rows = parseCsv(await fs.readFile(CSV_PATH, "utf8")).sort((a, b) => b.academiesPerSchool - a.academiesPerSchool);
const geo = JSON.parse(await fs.readFile(GEO_PATH, "utf8"));
await fs.writeFile(HTML_PATH, buildHtml(rows, geo), "utf8");
console.log(HTML_PATH);
