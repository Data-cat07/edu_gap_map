import fs from "node:fs/promises";
import path from "node:path";

const OUT_DIR = path.resolve("outputs", "education_gap_map");
const CSV_PATH = path.join(OUT_DIR, "education_gap_by_region.csv");
const HTML_PATH = path.join(OUT_DIR, "education_gap_korea_tile_map.html");

const LAYOUT = {
  인천: [1, 3],
  서울: [2, 3],
  경기: [2, 4],
  강원: [4, 3],
  충남: [1, 5],
  세종: [2, 5],
  충북: [3, 5],
  대전: [2, 6],
  경북: [5, 6],
  대구: [5, 7],
  전북: [2, 8],
  울산: [6, 8],
  경남: [5, 9],
  부산: [6, 9],
  광주: [1, 9],
  전남: [2, 10],
  제주: [1, 12],
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
    };
  });
}

function fmt(value, digits = 0) {
  return Number(value).toLocaleString("ko-KR", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function color(value, min, max) {
  const t = max === min ? 0 : (value - min) / (max - min);
  if (t < 0.22) return "#edf6f9";
  if (t < 0.44) return "#bfe3df";
  if (t < 0.66) return "#7dc7c4";
  if (t < 0.82) return "#f6bd60";
  return "#d95d39";
}

function buildHtml(rows) {
  const values = rows.map((row) => row.academiesPerSchool);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const totalSchools = rows.reduce((sum, row) => sum + row.schoolCount, 0);
  const totalAcademies = rows.reduce((sum, row) => sum + row.academyCount, 0);
  const top = rows[0];
  const bottom = rows.at(-1);
  const size = 76;
  const gap = 9;
  const mapWidth = 7 * (size + gap);
  const mapHeight = 13 * (size + gap);
  const tiles = rows.map((row) => {
    const [col, gridRow] = LAYOUT[row.name];
    const x = (col - 1) * (size + gap);
    const y = (gridRow - 1) * (size + gap);
    const fill = color(row.academiesPerSchool, min, max);
    const label = `${row.fullName}: 학교 ${fmt(row.schoolCount)}곳, 학원·교습소 ${fmt(row.academyCount)}곳, 학교 1곳당 ${fmt(row.academiesPerSchool, 2)}곳`;
    return `<g tabindex="0" aria-label="${label}">
      <title>${label}</title>
      <rect x="${x}" y="${y}" width="${size}" height="${size}" rx="8" fill="${fill}" stroke="#ffffff" stroke-width="2"/>
      <text x="${x + size / 2}" y="${y + 30}" class="region-name">${row.name}</text>
      <text x="${x + size / 2}" y="${y + 55}" class="region-value">${fmt(row.academiesPerSchool, 1)}</text>
    </g>`;
  }).join("\n");
  const tableRows = rows.map((row, i) => `<tr><td>${i + 1}</td><td>${row.fullName}</td><td>${fmt(row.schoolCount)}</td><td>${fmt(row.academyCount)}</td><td><strong>${fmt(row.academiesPerSchool, 2)}</strong></td></tr>`).join("");

  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>지역별 학교·학원 수 교육 격차 지도</title>
  <style>
    :root { --ink:#172033; --muted:#667085; --line:#d9e0e8; --paper:#fff; --bg:#f5f7fa; font-family:"Segoe UI","Malgun Gothic","Apple SD Gothic Neo",sans-serif; }
    * { box-sizing: border-box; }
    body { margin:0; background:var(--bg); color:var(--ink); }
    main { max-width:1180px; margin:0 auto; padding:28px; }
    h1 { margin:0 0 8px; font-size:clamp(26px,4vw,44px); line-height:1.1; letter-spacing:0; }
    .subtitle { margin:0 0 18px; max-width:850px; color:var(--muted); line-height:1.65; }
    .dashboard { display:grid; grid-template-columns:minmax(330px,.95fr) minmax(330px,1fr); gap:18px; align-items:start; }
    .panel { background:var(--paper); border:1px solid var(--line); border-radius:8px; padding:18px; }
    svg { width:100%; height:auto; display:block; }
    g rect { transition:filter .15s ease, stroke .15s ease; }
    g:hover rect, g:focus rect { filter:brightness(.96); stroke:#172033; outline:none; }
    .region-name { text-anchor:middle; font-size:17px; font-weight:800; fill:#172033; }
    .region-value { text-anchor:middle; font-size:18px; font-weight:900; fill:#172033; }
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
  <p class="subtitle">색이 진할수록 학교 1곳당 학원·교습소 수가 많습니다. 이 타일 지도는 행정구역의 실제 면적보다 지역 간 격차 비교가 잘 보이도록 만든 지도형 요약입니다.</p>
  <section class="dashboard">
    <div class="panel">
      <svg viewBox="0 0 ${mapWidth} ${mapHeight}" role="img" aria-label="대한민국 시도별 학교 대비 학원·교습소 수 타일 지도">${tiles}</svg>
      <div class="legend"><span><i style="background:#edf6f9"></i>낮음</span><span><i style="background:#bfe3df"></i></span><span><i style="background:#7dc7c4"></i>보통</span><span><i style="background:#f6bd60"></i></span><span><i style="background:#d95d39"></i>높음</span></div>
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
      <p class="note">자료: 나이스 교육정보 개방 API schoolInfo, acaInsTiInfo 조회. 생성일: ${new Date().toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })}</p>
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
await fs.writeFile(HTML_PATH, buildHtml(rows), "utf8");
console.log(HTML_PATH);
