import fs from "node:fs/promises";
import path from "node:path";

const OUT_DIR = path.resolve("outputs", "education_gap_map");
const SHAPE_DIR = path.join(OUT_DIR, "sgis_sigungu");
const HTML_PATH = path.join(OUT_DIR, "education_gap_korea_tile_map.html");
const DATA_PATH = path.join(OUT_DIR, "education_gap_sigungu_data.json");
const SCHOOL_CSV_PATH = path.join(OUT_DIR, "school_locations.csv");

const REGIONS = [
  { code: "B10", name: "서울", fullName: "서울특별시", shape: "서울특별시" },
  { code: "C10", name: "부산", fullName: "부산광역시", shape: "부산광역시" },
  { code: "D10", name: "대구", fullName: "대구광역시", shape: "대구광역시" },
  { code: "E10", name: "인천", fullName: "인천광역시", shape: "인천광역시" },
  { code: "F10", name: "광주", fullName: "광주광역시", shape: "광주광역시" },
  { code: "G10", name: "대전", fullName: "대전광역시", shape: "대전광역시" },
  { code: "H10", name: "울산", fullName: "울산광역시", shape: "울산광역시" },
  { code: "I10", name: "세종", fullName: "세종특별자치시", shape: "세종특별자치시" },
  { code: "J10", name: "경기", fullName: "경기도", shape: "경기도" },
  { code: "K10", name: "강원", fullName: "강원특별자치도", shape: "강원도" },
  { code: "M10", name: "충북", fullName: "충청북도", shape: "충청북도" },
  { code: "N10", name: "충남", fullName: "충청남도", shape: "충청남도" },
  { code: "P10", name: "전북", fullName: "전북특별자치도", shape: "전라북도" },
  { code: "Q10", name: "전남", fullName: "전라남도", shape: "전라남도" },
  { code: "R10", name: "경북", fullName: "경상북도", shape: "경상북도" },
  { code: "S10", name: "경남", fullName: "경상남도", shape: "경상남도" },
  { code: "T10", name: "제주", fullName: "제주특별자치도", shape: "제주특별자치도" },
];

const NATION_LABEL_OFFSETS = {
  경기: [0, 34],
};

const REGION_ALIASES = {
  서울특별시: ["서울특별시", "서울"],
  부산광역시: ["부산광역시", "부산"],
  대구광역시: ["대구광역시", "대구"],
  인천광역시: ["인천광역시", "인천"],
  광주광역시: ["광주광역시", "광주"],
  대전광역시: ["대전광역시", "대전"],
  울산광역시: ["울산광역시", "울산"],
  세종특별자치시: ["세종특별자치시", "세종시", "세종"],
  경기도: ["경기도", "경기"],
  강원특별자치도: ["강원특별자치도", "강원도", "강원"],
  충청북도: ["충청북도", "충북"],
  충청남도: ["충청남도", "충남"],
  전북특별자치도: ["전북특별자치도", "전라북도", "전북"],
  전라남도: ["전라남도", "전남"],
  경상북도: ["경상북도", "경북"],
  경상남도: ["경상남도", "경남"],
  제주특별자치도: ["제주특별자치도", "제주도", "제주"],
};

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

async function fetchTotal(endpoint, code, extraParams = {}) {
  const url = new URL(`https://open.neis.go.kr/hub/${endpoint}`);
  url.searchParams.set("Type", "json");
  url.searchParams.set("pIndex", "1");
  url.searchParams.set("pSize", "1");
  url.searchParams.set("ATPT_OFCDC_SC_CODE", code);
  Object.entries(extraParams).forEach(([key, value]) => url.searchParams.set(key, value));
  const json = await (await fetch(url)).json();
  return json[endpoint]?.[0]?.head?.[0]?.list_total_count ?? 0;
}

async function fetchRows(endpoint, code) {
  const firstUrl = new URL(`https://open.neis.go.kr/hub/${endpoint}`);
  firstUrl.searchParams.set("Type", "json");
  firstUrl.searchParams.set("pIndex", "1");
  firstUrl.searchParams.set("pSize", "1");
  firstUrl.searchParams.set("ATPT_OFCDC_SC_CODE", code);
  const first = await (await fetch(firstUrl)).json();
  const total = first[endpoint]?.[0]?.head?.[0]?.list_total_count ?? 0;
  const rows = [];
  const pageSize = 5;
  for (let page = 1; page <= Math.ceil(total / pageSize); page += 1) {
    const url = new URL(`https://open.neis.go.kr/hub/${endpoint}`);
    url.searchParams.set("Type", "json");
    url.searchParams.set("pIndex", String(page));
    url.searchParams.set("pSize", String(pageSize));
    url.searchParams.set("ATPT_OFCDC_SC_CODE", code);
    const json = await (await fetch(url)).json();
    rows.push(...(json[endpoint]?.[1]?.row ?? []));
  }
  return rows;
}

function normalizeSpaces(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function stripRegion(address, fullName) {
  let value = normalizeSpaces(address);
  for (const alias of REGION_ALIASES[fullName] ?? [fullName]) {
    if (value.startsWith(alias)) return value.slice(alias.length).trim();
  }
  return value;
}

function matchDistrict(text, districts) {
  const value = normalizeSpaces(text);
  return districts.find((district) => value.startsWith(district)) ?? null;
}

function addCount(map, key, field) {
  if (!key) return;
  if (!map[key]) map[key] = { schoolCount: 0, academyCount: 0 };
  map[key][field] += 1;
}

async function getDistrictData(regionsWithDistricts) {
  try {
    const cached = JSON.parse(await fs.readFile(DATA_PATH, "utf8"));
    if (cached._version === 3) return cached.regions;
  } catch {
    // Build from the public API below.
  }

  const schoolRows = parseCsv(await fs.readFile(SCHOOL_CSV_PATH, "utf8"));

  const result = {};
  for (const region of REGIONS) {
    const districts = [...new Set(regionsWithDistricts[region.name].districts.map((district) => district.name))].sort((a, b) => b.length - a.length);
    const counts = {};
    districts.forEach((district) => {
      counts[district] = { schoolCount: 0, academyCount: 0 };
    });

    for (const row of schoolRows) {
      if (normalizeSpaces(row["시도교육청명"]) !== normalizeSpaces(`${region.fullName}교육청`)) continue;
      if (row["운영상태"] && row["운영상태"] !== "운영") continue;
      const address = stripRegion(row["소재지도로명주소"] || row["소재지지번주소"], region.fullName);
      const district = region.name === "세종" ? "세종시" : matchDistrict(address, districts);
      addCount(counts, district, "schoolCount");
    }

    for (const district of districts) {
      const queryName = region.name === "세종" ? "세종특별자치시" : district;
      counts[district].academyCount = await fetchTotal("acaInsTiInfo", region.code, { ADMST_ZONE_NM: queryName });
    }
    const academyTotal = await fetchTotal("acaInsTiInfo", region.code);
    const academySubtotal = Object.values(counts).reduce((sum, item) => sum + item.academyCount, 0);
    const remainder = academyTotal - academySubtotal;
    if (remainder > 0) {
      const target = Object.entries(counts).sort((a, b) => b[1].schoolCount - a[1].schoolCount)[0]?.[0];
      if (target) counts[target].academyCount += remainder;
    }

    result[region.name] = Object.fromEntries(Object.entries(counts).map(([name, item]) => [
      name,
      {
        ...item,
        academiesPerSchool: item.schoolCount ? Number((item.academyCount / item.schoolCount).toFixed(2)) : 0,
      },
    ]));
    const schoolTotal = Object.values(counts).reduce((sum, item) => sum + item.schoolCount, 0);
    const finalAcademyTotal = Object.values(counts).reduce((sum, item) => sum + item.academyCount, 0);
    console.log(`${region.name}: ${schoolTotal} schools, ${finalAcademyTotal} academies`);
  }
  await fs.writeFile(DATA_PATH, JSON.stringify({ _version: 3, regions: result }, null, 2), "utf8");
  return result;
}

function parseCsv(text) {
  const lines = text.replace(/^\ufeff/, "").trim().split(/\r?\n/);
  const headers = splitCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]));
  });
}

function splitCsvLine(line) {
  const cells = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"' && line[i + 1] === '"') {
      cell += '"';
      i += 1;
    } else if (ch === '"') {
      quoted = !quoted;
    } else if (ch === "," && !quoted) {
      cells.push(cell);
      cell = "";
    } else {
      cell += ch;
    }
  }
  cells.push(cell);
  return cells;
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

function simplifyGeometry(geometry, tolerance) {
  const simplifyPoly = (poly) => poly
    .map((ring) => simplifyRing(ring, tolerance))
    .filter((ring) => ring.length >= 4);
  if (geometry.type === "Polygon") return { ...geometry, coordinates: simplifyPoly(geometry.coordinates) };
  return { ...geometry, coordinates: geometry.coordinates.map(simplifyPoly).filter((poly) => poly.length) };
}

function boundsOfFeatures(features) {
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const visit = (coords) => {
    if (typeof coords[0] === "number") {
      const [x, y] = coords;
      bounds.minX = Math.min(bounds.minX, x);
      bounds.maxX = Math.max(bounds.maxX, x);
      bounds.minY = Math.min(bounds.minY, y);
      bounds.maxY = Math.max(bounds.maxY, y);
      return;
    }
    coords.forEach(visit);
  };
  features.forEach((feature) => visit(feature.geometry.coordinates));
  return bounds;
}

function centroid(feature) {
  const pts = [];
  const visit = (coords) => {
    if (typeof coords[0] === "number") {
      pts.push(coords);
      return;
    }
    coords.forEach(visit);
  };
  visit(feature.geometry.coordinates);
  return [
    pts.reduce((sum, p) => sum + p[0], 0) / pts.length,
    pts.reduce((sum, p) => sum + p[1], 0) / pts.length,
  ];
}

function compactGeometry(geometry) {
  return geometry.coordinates;
}

async function loadShapes() {
  const nationwide = JSON.parse(await fs.readFile(path.join(SHAPE_DIR, "전국_시도_경계.json"), "utf8"));
  const provinceFeatures = nationwide.features.map((feature) => ({
    name: feature.properties.title,
    geometry: compactGeometry(simplifyGeometry(feature.geometry, 800)),
    centroid: centroid(feature),
  }));

  const regions = {};
  for (const region of REGIONS) {
    const file = path.join(SHAPE_DIR, `${region.shape}_시군구_경계.json`);
    const geo = JSON.parse(await fs.readFile(file, "utf8"));
    const seenLabels = new Set();
    const features = geo.features.map((feature) => {
      const rawName = feature.properties.title;
      const groupedName = rawName.replace(/^(.+시) .+구$/, "$1");
      const showLabel = !seenLabels.has(groupedName);
      seenLabels.add(groupedName);
      return {
      name: groupedName,
      shapeName: rawName,
      showLabel,
      geometry: compactGeometry(simplifyGeometry(feature.geometry, 550)),
      centroid: centroid(feature),
    };
    });
    regions[region.name] = {
      ...region,
      districts: features,
    };
  }
  return { provinces: provinceFeatures, regions };
}

function buildHtml(payload) {
  const serialized = JSON.stringify(payload);
  const labelOffsets = JSON.stringify(NATION_LABEL_OFFSETS);
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
    main { max-width:1200px; margin:0 auto; padding:28px; }
    h1 { margin:0 0 8px; font-size:clamp(26px,4vw,44px); line-height:1.1; letter-spacing:0; }
    .subtitle { margin:0 0 18px; max-width:900px; color:var(--muted); line-height:1.65; }
    .dashboard { display:grid; grid-template-columns:minmax(340px,.95fr) minmax(340px,1fr); gap:18px; align-items:start; }
    .panel { background:var(--paper); border:1px solid var(--line); border-radius:8px; padding:18px; }
    .toolbar { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:12px; }
    .crumb { color:var(--muted); font-weight:700; }
    button { border:1px solid var(--line); background:#fff; color:var(--ink); border-radius:8px; padding:8px 11px; font-weight:800; cursor:pointer; }
    button:disabled { opacity:.4; cursor:default; }
    svg { width:100%; height:auto; display:block; }
    .region { stroke:#fff; stroke-width:1.2; cursor:pointer; transition:filter .15s ease, stroke-width .15s ease; }
    .region:hover, .region:focus { filter:brightness(.96); stroke:#172033; stroke-width:2.4; outline:none; }
    .hit { cursor:pointer; fill:transparent; }
    .map-label { pointer-events:none; text-anchor:middle; font-size:14px; font-weight:900; fill:#172033; paint-order:stroke; stroke:#fff; stroke-width:3px; stroke-linejoin:round; }
    .legend { display:flex; flex-wrap:wrap; gap:8px 12px; margin-top:12px; color:var(--muted); font-size:13px; }
    .legend span { display:inline-flex; align-items:center; gap:6px; }
    .legend i { width:18px; height:12px; border:1px solid rgba(23,32,51,.14); border-radius:2px; }
    h2 { margin:0 0 10px; font-size:20px; letter-spacing:0; }
    .reading { margin:0; color:var(--muted); line-height:1.7; }
    .metrics { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; margin:16px 0; }
    .metric { border:1px solid var(--line); border-radius:8px; padding:13px; background:#fbfcfd; }
    .metric b { display:block; font-size:26px; line-height:1.1; }
    .metric span { display:block; margin-top:5px; color:var(--muted); font-size:13px; }
    .selection { border:1px solid var(--line); border-radius:8px; padding:14px; background:#f8fbfb; margin-top:14px; }
    .selection h3 { margin:0 0 8px; font-size:17px; letter-spacing:0; }
    .selection p { margin:0; color:var(--muted); line-height:1.65; }
    .region.selected { stroke:#172033; stroke-width:3; filter:brightness(.96); }
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
  <p class="subtitle">시도를 클릭하면 해당 시도 모양으로 확대되어 시·군·구별 학교 수와 학원·교습소 수를 확인할 수 있습니다. 색이 진할수록 학교 1곳당 학원·교습소 수가 많습니다.</p>
  <section class="dashboard">
    <div class="panel">
      <div class="toolbar"><div class="crumb" id="crumb">전국</div><button id="back" disabled>전국으로</button></div>
      <svg id="map" viewBox="0 0 740 860" role="img" aria-label="교육 격차 지도"></svg>
      <div class="legend"><span><i style="background:#edf6f9"></i>낮음</span><span><i style="background:#bfe3df"></i></span><span><i style="background:#7dc7c4"></i>보통</span><span><i style="background:#f6bd60"></i></span><span><i style="background:#d95d39"></i>높음</span></div>
    </div>
    <aside class="panel">
      <h2 id="summaryTitle">전국 요약</h2>
      <p class="reading" id="summaryText"></p>
      <div class="metrics">
        <div class="metric"><b id="mSchools"></b><span>학교 수</span></div>
        <div class="metric"><b id="mAcademies"></b><span>학원·교습소 수</span></div>
        <div class="metric"><b id="mTop"></b><span>최고 지역 비율</span></div>
        <div class="metric"><b id="mBottom"></b><span>최저 지역 비율</span></div>
      </div>
      <div class="selection" id="selectionBox">
        <h3 id="selectionTitle">선택 지역</h3>
        <p id="selectionText">지도에서 시·군·구를 클릭하면 학교 수와 학원·교습소 수가 여기에 표시됩니다.</p>
      </div>
      <p class="note">자료: 나이스 교육정보 개방 API schoolInfo, acaInsTiInfo 조회. 지도 경계: statgarten/maps SGIS 행정경계. 생성일: ${new Date().toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })}</p>
    </aside>
  </section>
  <table>
    <caption id="tableTitle">시도별 집계</caption>
    <thead><tr><th>순위</th><th>지역</th><th>학교 수</th><th>학원·교습소 수</th><th>학교 1곳당</th></tr></thead>
    <tbody id="rows"></tbody>
  </table>
</main>
<script>
const DATA = ${serialized};
const NATION_LABEL_OFFSETS = ${labelOffsets};
const svg = document.querySelector("#map");
const crumb = document.querySelector("#crumb");
const back = document.querySelector("#back");
let currentRegion = null;
const palette = ["#edf6f9", "#bfe3df", "#7dc7c4", "#f6bd60", "#d95d39"];
const fmt = (value, digits = 0) => Number(value).toLocaleString("ko-KR", { maximumFractionDigits: digits, minimumFractionDigits: digits });
const esc = (value) => String(value).replace(/[&<>"]/g, (ch) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[ch]));
function color(value, min, max) {
  const t = max === min ? 0 : (value - min) / (max - min);
  if (t < .20) return palette[0];
  if (t < .40) return palette[1];
  if (t < .60) return palette[2];
  if (t < .80) return palette[3];
  return palette[4];
}
function geometryBounds(features) {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const visit = (coords) => {
    if (typeof coords[0] === "number") {
      b.minX = Math.min(b.minX, coords[0]); b.maxX = Math.max(b.maxX, coords[0]);
      b.minY = Math.min(b.minY, coords[1]); b.maxY = Math.max(b.maxY, coords[1]);
    } else coords.forEach(visit);
  };
  features.forEach((f) => visit(f.geometry));
  return b;
}
function projector(features) {
  const width = 740, height = 860, pad = 28;
  const b = geometryBounds(features);
  const scale = Math.min((width - pad * 2) / (b.maxX - b.minX), (height - pad * 2) / (b.maxY - b.minY));
  const usedW = (b.maxX - b.minX) * scale;
  const usedH = (b.maxY - b.minY) * scale;
  const xPad = (width - usedW) / 2;
  const yPad = (height - usedH) / 2;
  return ([x, y]) => [xPad + (x - b.minX) * scale, yPad + (b.maxY - y) * scale];
}
function ringPath(ring, project) {
  return ring.map((p, i) => {
    const [x, y] = project(p);
    return (i ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1);
  }).join(" ") + "Z";
}
function pathOf(geometry, project) {
  if (!Array.isArray(geometry[0][0][0])) return geometry.map((ring) => ringPath(ring, project)).join(" ");
  return geometry.flatMap((poly) => poly.map((ring) => ringPath(ring, project))).join(" ");
}
function rowsFor(regionName) {
  if (!regionName) return DATA.regionRows;
  return [...new Set(DATA.regions[regionName].districts.map((d) => d.name))].map((name) => ({ name, fullName: name, ...(DATA.districtData[regionName][name] || { schoolCount: 0, academyCount: 0, academiesPerSchool: 0 }) }))
    .sort((a, b) => b.academiesPerSchool - a.academiesPerSchool);
}
function summarize(rows, title) {
  const schools = rows.reduce((s, r) => s + r.schoolCount, 0);
  const academies = rows.reduce((s, r) => s + r.academyCount, 0);
  const ranked = rows.filter((r) => r.schoolCount).sort((a, b) => b.academiesPerSchool - a.academiesPerSchool);
  const top = ranked[0] || rows[0];
  const bottom = ranked.at(-1) || rows.at(-1);
  document.querySelector("#summaryTitle").textContent = title + " 요약";
  document.querySelector("#summaryText").textContent = title + "의 학교 수는 " + fmt(schools) + "곳, 학원·교습소 수는 " + fmt(academies) + "곳입니다. 학교 1곳당 학원·교습소 수가 가장 높은 지역은 " + (top.fullName || top.name) + "(" + fmt(top.academiesPerSchool, 2) + "), 가장 낮은 지역은 " + (bottom.fullName || bottom.name) + "(" + fmt(bottom.academiesPerSchool, 2) + ")입니다.";
  document.querySelector("#mSchools").textContent = fmt(schools);
  document.querySelector("#mAcademies").textContent = fmt(academies);
  document.querySelector("#mTop").textContent = fmt(top.academiesPerSchool, 2);
  document.querySelector("#mBottom").textContent = fmt(bottom.academiesPerSchool, 2);
}
function renderTable(rows, title) {
  document.querySelector("#tableTitle").textContent = title;
  document.querySelector("#rows").innerHTML = rows.map((r, i) => "<tr><td>" + (i + 1) + "</td><td>" + esc(r.fullName || r.name) + "</td><td>" + fmt(r.schoolCount) + "</td><td>" + fmt(r.academyCount) + "</td><td><strong>" + fmt(r.academiesPerSchool, 2) + "</strong></td></tr>").join("");
}
function showSelection(row, title) {
  document.querySelector("#selectionTitle").textContent = title;
  document.querySelector("#selectionText").textContent = "학교 " + fmt(row.schoolCount) + "곳, 학원·교습소 " + fmt(row.academyCount) + "곳, 학교 1곳당 학원·교습소 " + fmt(row.academiesPerSchool, 2) + "곳입니다.";
}
function clearSelection(message) {
  document.querySelector("#selectionTitle").textContent = "선택 지역";
  document.querySelector("#selectionText").textContent = message;
}
function markSelected(selector, value) {
  svg.querySelectorAll(".region.selected").forEach((el) => el.classList.remove("selected"));
  const target = svg.querySelector(selector + '="' + value.replace(/"/g, '\\"') + '"]');
  if (target) target.classList.add("selected");
}
function renderNation() {
  currentRegion = null;
  crumb.textContent = "전국";
  back.disabled = true;
  const project = projector(DATA.provinces);
  const values = DATA.regionRows.map((r) => r.academiesPerSchool);
  const min = Math.min(...values), max = Math.max(...values);
  svg.innerHTML = DATA.provinces.map((f) => {
    const row = DATA.regionRows.find((r) => r.shape === f.name);
    const shortName = row?.name || f.name;
    const fill = row ? color(row.academiesPerSchool, min, max) : "#e8ecf1";
    const [baseX, baseY] = project(f.centroid);
    const [dx, dy] = NATION_LABEL_OFFSETS[shortName] || [0, 0];
    const x = baseX + dx;
    const y = baseY + dy;
    const label = row ? row.fullName + ": 학교 " + fmt(row.schoolCount) + "곳, 학원·교습소 " + fmt(row.academyCount) + "곳, 학교 1곳당 " + fmt(row.academiesPerSchool, 2) + "곳" : f.name;
    return '<path class="region" data-region="' + esc(shortName) + '" d="' + pathOf(f.geometry, project) + '" fill="' + fill + '" tabindex="0" aria-label="' + esc(label) + '"><title>' + esc(label) + '</title></path><text class="map-label" x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '">' + esc(shortName) + '</text><circle class="hit" data-region="' + esc(shortName) + '" cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="18" aria-hidden="true"></circle>';
  }).join("");
  svg.querySelectorAll("[data-region]").forEach((el) => el.addEventListener("click", () => renderRegion(el.dataset.region)));
  svg.querySelectorAll(".region[data-region]").forEach((el) => el.addEventListener("keydown", (e) => { if (e.key === "Enter") renderRegion(el.dataset.region); }));
  const rows = rowsFor(null);
  summarize(rows, "전국");
  renderTable(rows, "시도별 집계");
  clearSelection("시도를 클릭하면 해당 지역 지도로 확대됩니다.");
}
function renderRegion(regionName) {
  currentRegion = regionName;
  const region = DATA.regions[regionName];
  crumb.textContent = "전국 > " + region.fullName;
  back.disabled = false;
  const features = region.districts;
  const project = projector(features);
  const rows = rowsFor(regionName);
  const values = rows.map((r) => r.academiesPerSchool);
  const min = Math.min(...values), max = Math.max(...values);
  svg.innerHTML = features.map((f) => {
    const row = DATA.districtData[regionName][f.name] || { schoolCount: 0, academyCount: 0, academiesPerSchool: 0 };
    const fill = color(row.academiesPerSchool, min, max);
    const [x, y] = project(f.centroid);
    const label = f.name + ": 학교 " + fmt(row.schoolCount) + "곳, 학원·교습소 " + fmt(row.academyCount) + "곳, 학교 1곳당 " + fmt(row.academiesPerSchool, 2) + "곳";
    return '<path class="region" data-district="' + esc(f.name) + '" d="' + pathOf(f.geometry, project) + '" fill="' + fill + '" tabindex="0" aria-label="' + esc(label) + '"><title>' + esc(label) + '</title></path>' + (f.showLabel ? '<text class="map-label" x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '">' + esc(f.name.replace(/ /g, "\\n")) + '</text><circle class="hit" data-district="' + esc(f.name) + '" cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="18" aria-hidden="true"></circle>' : '');
  }).join("");
  svg.querySelectorAll("[data-district]").forEach((el) => el.addEventListener("click", () => {
    const district = el.dataset.district;
    const row = DATA.districtData[regionName][district] || { schoolCount: 0, academyCount: 0, academiesPerSchool: 0 };
    showSelection(row, district);
    markSelected('[data-district', district);
  }));
  svg.querySelectorAll(".region[data-district]").forEach((el) => el.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const district = el.dataset.district;
      const row = DATA.districtData[regionName][district] || { schoolCount: 0, academyCount: 0, academiesPerSchool: 0 };
      showSelection(row, district);
      markSelected('[data-district', district);
    }
  }));
  summarize(rows, region.fullName);
  renderTable(rows, region.fullName + " 시·군·구별 집계");
  clearSelection("시·군·구를 클릭하면 학교 수와 학원·교습소 수가 여기에 고정됩니다.");
}
back.addEventListener("click", renderNation);
renderNation();
</script>
</body>
</html>`;
}

async function main() {
  const shapes = await loadShapes();
  const districtData = await getDistrictData(shapes.regions);
  const regionRows = REGIONS.map((region) => {
    const counts = Object.values(districtData[region.name]).reduce((acc, item) => {
      acc.schoolCount += item.schoolCount;
      acc.academyCount += item.academyCount;
      return acc;
    }, { schoolCount: 0, academyCount: 0 });
    return {
      name: region.name,
      fullName: region.fullName,
      shape: region.shape,
      schoolCount: counts.schoolCount,
      academyCount: counts.academyCount,
      academiesPerSchool: Number((counts.academyCount / counts.schoolCount).toFixed(2)),
    };
  }).sort((a, b) => b.academiesPerSchool - a.academiesPerSchool);
  await fs.writeFile(HTML_PATH, buildHtml({ ...shapes, districtData, regionRows }), "utf8");
  console.log(HTML_PATH);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
