#!/usr/bin/env node
// สร้าง data/geo.json + data/schools/<จังหวัด>.json จากข้อมูลเปิด (ดู data/SOURCES.md)
// ใช้: node tools/build-data.mjs [--raw <dir>] [--refresh]
//   --raw      โฟลเดอร์เก็บไฟล์ดิบ (ค่าเริ่มต้น $TMPDIR/sricodeboon-data-raw) — ห้ามชี้เข้า htdocs
//   --refresh  ดาวน์โหลดไฟล์ดิบใหม่แม้มีอยู่แล้ว
// ไม่มี dependency ภายนอก (Node >= 18) — อ่าน .xlsx ด้วยตัวอ่าน zip ในไฟล์นี้
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(HERE, '../data');
const args = process.argv.slice(2);
const argVal = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const RAW = path.resolve(argVal('--raw', path.join(os.tmpdir(), 'sricodeboon-data-raw')));
const REFRESH = args.includes('--refresh');
if (RAW.startsWith(path.resolve(HERE, '../..'))) throw new Error('--raw ต้องอยู่นอก htdocs');

// ---------- แหล่งข้อมูล ----------
// thailand-geography-data/thailand-geography-json (MIT) — 77/928/7,436 ตรงจำนวนทางการ รวมแขวงใหม่ของ กทม.
const GEO_REPO = 'thailand-geography-data/thailand-geography-json';
const GEO_COMMIT = 'b8b3fb91c7df1129ff5b43cb46f7fcffadd2156b'; // 2026-06-23
const GEO_BASE = `https://raw.githubusercontent.com/${GEO_REPO}/${GEO_COMMIT}/src`;
const SRC = {
  province: `${GEO_BASE}/provinces.json`,
  district: `${GEO_BASE}/districts.json`,
  sub_district: `${GEO_BASE}/subdistricts.json`,
  // กระทรวงศึกษาธิการ: สถานศึกษาของประเทศไทย จำแนกตาม ระดับการศึกษา สังกัด และจังหวัด 2568 (Open Data Common)
  moe_school68: 'https://catalog.moe.go.th/dataset/e2130a82-304c-4acb-9a52-01db73b2d0cb/resource/6a4e41b3-7180-4a1f-86b3-a918165752fe/download/school68.xlsx',
};
const FILES = { province: 'tgj_provinces.json', district: 'tgj_districts.json', sub_district: 'tgj_subdistricts.json', moe_school68: 'moe_school68.xlsx' };

// สังกัดที่ไม่เอา: 12 กรมส่งเสริมการเรียนรู้ (กศน. อำเภอ), 55 สถาบันวิชาการป้องกันประเทศ
const EXCLUDE_AFFIL = new Set(['12', '55']);
// สังกัด 14 (อว.) เอาเฉพาะโรงเรียนสาธิต ไม่เอามหาวิทยาลัย
const SCHOOL_ONLY_AFFIL = new Set(['14']);

async function fetchRaw(key) {
  const f = path.join(RAW, FILES[key]);
  if (!REFRESH && fs.existsSync(f) && fs.statSync(f).size > 0) return f;
  process.stderr.write(`ดาวน์โหลด ${SRC[key]}\n`);
  const r = await fetch(SRC[key], { headers: { 'User-Agent': 'sricodeboon-timetable-data-build/1.0' } });
  if (!r.ok) throw new Error(`${key}: HTTP ${r.status}`);
  fs.writeFileSync(f, Buffer.from(await r.arrayBuffer()));
  return f;
}
const sha256 = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

// ---------- ตัวอ่าน xlsx ขั้นต่ำ ----------
function unzip(buf) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('ไม่ใช่ไฟล์ zip');
  const n = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = {};
  for (let i = 0; i < n; i++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const loff = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    const ds = loff + 30 + buf.readUInt16LE(loff + 26) + buf.readUInt16LE(loff + 28);
    const data = buf.subarray(ds, ds + csize);
    out[name] = () => (method === 8 ? zlib.inflateRawSync(data) : data);
    p += 46 + nlen + xlen + clen;
  }
  return out;
}
const unxml = (s) => s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (m, e) =>
  ({ lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }[e] ?? (e[1] === 'x' || e[1] === 'X' ? String.fromCodePoint(parseInt(e.slice(2), 16)) : String.fromCodePoint(+e.slice(1)))));
function readXlsx(file) {
  const z = unzip(fs.readFileSync(file));
  const ss = [];
  if (z['xl/sharedStrings.xml']) {
    const x = z['xl/sharedStrings.xml']().toString('utf8');
    for (const m of x.matchAll(/<si>([\s\S]*?)<\/si>/g)) ss.push(unxml([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')));
  }
  const sheet = z['xl/worksheets/sheet1.xml']().toString('utf8');
  const col = (s) => [...s].reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0) - 1;
  const rows = [];
  for (const rm of sheet.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const cm of rm[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const t = (cm[2].match(/t="(\w+)"/) || [])[1];
      const body = cm[3] || '';
      let v = '';
      if (t === 's') v = ss[+(body.match(/<v>(.*?)<\/v>/) || [])[1]] ?? '';
      else if (t === 'inlineStr') v = unxml([...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(''));
      else v = unxml((body.match(/<v>([\s\S]*?)<\/v>/) || [, ''])[1]);
      row[col(cm[1])] = v;
    }
    rows.push(Array.from(row, (x) => x ?? ''));
  }
  return rows;
}

// ---------- normalize ----------
const th = new Intl.Collator('th');
// \s ของ JS ครอบคลุม NBSP และ BOM อยู่แล้ว; ลบ zero-width space (U+200B) แยก
const ZWSP = new RegExp(String.fromCharCode(0x200b), 'g');
const clean = (s) => String(s ?? '').replace(ZWSP, '').replace(/\s+/g, ' ').trim();
const stripProv = (s) => clean(s).replace(/^(จังหวัด|จ\.)\s*/, '');
const stripAmp = (s, bkk) => clean(s).replace(bkk ? /^(เขต|อำเภอ|อ\.)\s*/ : /^(กิ่งอำเภอ|อำเภอ|อ\.)\s*/, '');
const stripTam = (s, bkk) => clean(s).replace(bkk ? /^(แขวง|ตำบล|ต\.)\s*/ : /^(ตำบล|ต\.)\s*/, '');
const key = (s) => clean(s).replace(/[\s.\-()]/g, '');
// ค้นด้วย key; ถ้าไม่เจอ ลองตัดวงเล็บชื่อสะกดอื่นท้ายชื่อ เช่น "ปอภาร (ปอพาน)" → "ปอภาร"
const look = (m, s) => m?.get(key(s)) ?? m?.get(key(s.replace(/\s*\([^)]*\)\s*$/, '')));

// ชื่อในแหล่งของ สพฐ./สช./กทม./พศ. ไม่มีคำว่า "โรงเรียน" นำหน้า → เติมให้ (ยกเว้นศูนย์การศึกษาพิเศษ ซึ่งไม่ใช่ชื่อโรงเรียน)
// สังกัดอื่นมีคำนำหน้าอยู่แล้ว (โรงเรียน/วิทยาลัย/ศูนย์การเรียน ตชด./สถาบัน) หรือย่อเป็น "รร."
const NO_PREFIX_AFFIL = new Set(['10', '11', '31', '70']);
function schoolName(raw, aff) {
  let n = clean(raw).replace(/^(รร\.|ร\.ร\.)\s*/, 'โรงเรียน');
  const add = NO_PREFIX_AFFIL.has(aff) ? !/^(โรงเรียน|ศูนย์การศึกษาพิเศษ)/.test(n) : !/^(โรงเรียน|วิทยาลัย|ศูนย์|สถาบัน)/.test(n);
  if (add) n = 'โรงเรียน' + n;
  return n.replace(/\s+\)/g, ')').replace(/\(\s+/g, '(');
}
// สถานพัฒนาเด็กเล็ก/รับเลี้ยงเด็ก ไม่ใช่โรงเรียนที่ต้องจัดตาราง
const CHILD_CENTRE = /^(ศพด|ศูนย์พัฒนาเด็ก|ศูนย์อบรมเด็กก่อนเกณฑ์|ศูนย์รับเลี้ยง|ศูนย์สาธิตการบริบาล)/;

// ---------- main ----------
fs.mkdirSync(RAW, { recursive: true });
const f = {};
for (const k of Object.keys(SRC)) f[k] = await fetchRaw(k);

// geo
const P = JSON.parse(fs.readFileSync(f.province));
const D = JSON.parse(fs.readFileSync(f.district));
const S = JSON.parse(fs.readFileSync(f.sub_district));
const tamByDist = new Map();
for (const t of S) (tamByDist.get(t.districtCode) || tamByDist.set(t.districtCode, []).get(t.districtCode)).push(t);
const geo = []; // [{n, a:[{n,t:[]}]}]
const G = new Map(); // จังหวัด -> {amp: Map(key->ชื่อ), tam: Map(อำเภอ -> Map(key->ชื่อ)), tamAll: Map(key -> Set(อำเภอ))}
const droppedDist = [];
for (const p of P) {
  const pn = stripProv(p.provinceNameTh), bkk = pn === 'กรุงเทพมหานคร';
  const g = { amp: new Map(), tam: new Map(), tamAll: new Map() };
  const amps = [];
  for (const d of D.filter((d) => d.provinceCode === p.provinceCode)) {
    const ts = tamByDist.get(d.districtCode) || [];
    if (!ts.length) { droppedDist.push(`${pn}/${d.districtNameTh}`); continue; }
    const an = stripAmp(d.districtNameTh, bkk);
    const tn = [...new Set(ts.map((t) => stripTam(t.subdistrictNameTh, bkk)))].sort(th.compare);
    amps.push({ n: an, t: tn });
    g.amp.set(key(an), an);
    const tm = new Map(tn.map((x) => [key(x), x]));
    g.tam.set(an, tm);
    for (const k of tm.keys()) (g.tamAll.get(k) || g.tamAll.set(k, new Set()).get(k)).add(an);
  }
  amps.sort((a, b) => th.compare(a.n, b.n));
  geo.push({ n: pn, a: amps });
  G.set(pn, g);
}
geo.sort((a, b) => th.compare(a.n, b.n));

// schools
const rows = readXlsx(f.moe_school68);
const H = rows[0].map(clean);
const ix = (name) => { const i = H.indexOf(name); if (i < 0) throw new Error(`ไม่พบคอลัมน์ ${name}`); return i; };
const C = { aff: ix('รหัสสังกัด'), code: ix('รหัสสถานศึกษา'), name: ix('ชื่อสถานศึกษา'), t: ix('ตำบล'), a: ix('อำเภอ'), p: ix('จังหวัด') };
const stat = { total: rows.length - 1, excludedAffil: 0, excludedChildCentre: 0, excludedNonSchool: 0, dupCode: 0, kept: 0,
  provNoMatch: 0, ampNoMatch: 0, tamNoMatch: 0, ampFixedByTambon: 0, byAffil: {} };
const unmatched = [];
const byProv = new Map();
const seen = new Set();
for (const r of rows.slice(1)) {
  const aff = clean(r[C.aff]), rawName = clean(r[C.name]);
  if (!rawName) continue;
  if (EXCLUDE_AFFIL.has(aff)) { stat.excludedAffil++; continue; }
  if (CHILD_CENTRE.test(rawName)) { stat.excludedChildCentre++; continue; }
  if (SCHOOL_ONLY_AFFIL.has(aff) && !/โรงเรียน|สาธิต/.test(rawName)) { stat.excludedNonSchool++; continue; }
  const code = clean(r[C.code]);
  if (code && seen.has(code)) { stat.dupCode++; continue; }
  if (code) seen.add(code);

  let p = stripProv(r[C.p]);
  const g = G.get(p);
  const bkk = p === 'กรุงเทพมหานคร';
  let a = stripAmp(r[C.a], bkk), t = stripTam(r[C.t], bkk);
  let why = '';
  if (!g) { stat.provNoMatch++; why = 'จังหวัด'; }
  else {
    const am = look(g.amp, a);
    if (am) a = am;
    const tm = am && look(g.tam.get(am), t);
    if (tm) t = tm;
    else {
      // ตำบลไม่อยู่ในอำเภอนั้น (หรืออำเภอสะกดต่าง/ตั้งใหม่) → ถ้าชื่อตำบลมีอำเภอเดียวในจังหวัด ใช้อำเภอนั้น
      const cand = look(g.tamAll, t);
      if (cand && cand.size === 1) {
        const na = [...cand][0];
        t = look(g.tam.get(na), t); a = na; stat.ampFixedByTambon++;
      } else if (!am) { stat.ampNoMatch++; why = 'อำเภอ'; }
      else { stat.tamNoMatch++; why = 'ตำบล'; }
    }
  }
  if (why) unmatched.push(`${why}\t${p}\t${a}\t${t}\t${code}\t${rawName}`);
  const rec = { n: schoolName(rawName, aff), c: code, t, a, p };
  (byProv.get(p) || byProv.set(p, []).get(p)).push(rec);
  stat.kept++;
  stat.byAffil[aff] = (stat.byAffil[aff] || 0) + 1;
}

// ---------- เขียนไฟล์ ----------
const today = new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD ตามเวลาเครื่อง
fs.mkdirSync(path.join(DATA, 'schools'), { recursive: true });
fs.writeFileSync(path.join(DATA, 'geo.json'), JSON.stringify({
  v: 1,
  source: `${GEO_REPO}@${GEO_COMMIT.slice(0, 7)} (MIT) · โรงเรียน: กระทรวงศึกษาธิการ สถานศึกษา 2568 (Open Data Common) — ดู SOURCES.md`,
  updated: today,
  provinces: geo,
}));
for (const old of fs.readdirSync(path.join(DATA, 'schools'))) if (old.endsWith('.json')) fs.unlinkSync(path.join(DATA, 'schools', old));
const perProv = [];
for (const pv of geo) {
  const list = (byProv.get(pv.n) || []).sort((x, y) => th.compare(x.n, y.n) || x.c.localeCompare(y.c));
  fs.writeFileSync(path.join(DATA, 'schools', `${pv.n}.json`), JSON.stringify(list));
  perProv.push([pv.n, list.length]);
}
const orphan = [...byProv.keys()].filter((k) => !G.has(k));
fs.writeFileSync(path.join(RAW, 'unmatched.tsv'), 'ระดับ\tจังหวัด\tอำเภอ\tตำบล\tรหัส\tชื่อ\n' + unmatched.join('\n') + '\n');
const report = {
  date: today,
  sha256: Object.fromEntries(Object.entries(f).map(([k, v]) => [k, sha256(v)])),
  geo: { provinces: geo.length, amphoe: geo.reduce((s, p) => s + p.a.length, 0), tambon: geo.reduce((s, p) => s + p.a.reduce((x, a) => x + a.t.length, 0), 0), droppedDist },
  schools: stat, orphanProvinces: orphan, perProvince: perProv,
};
fs.writeFileSync(path.join(RAW, 'build-report.json'), JSON.stringify(report, null, 1));
console.log(JSON.stringify({ ...report, perProvince: undefined }, null, 1));
console.log(`รายการจับคู่ไม่ได้: ${path.join(RAW, 'unmatched.tsv')}`);
