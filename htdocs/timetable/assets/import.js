// วางรายชื่อ ครู / วิชา / ภาระสอน จากข้อความที่คัดลอกมา (Excel, Google Sheets, LINE, Word) — ฟังก์ชันล้วน ไม่แตะ DOM ไม่ส่งอะไรขึ้นเซิร์ฟเวอร์
// ขั้นตอนของหน้าจอ: parseXxx(ข้อความ) → พรีวิว (แถวที่มี issues = สีส้ม, include = ช่องติ๊ก) → applyXxx(doc, ผลพรีวิว) → store.commit('import') ครั้งเดียว
// ทดสอบใน tests/import.test.mjs
import { groupFromText, SUBJECT_GROUP_CODES } from './rules.js';
import { SUBJECT_COLORS, uid } from './store.js';

// ---------- แยกตาราง ----------
const QUOTED = { '\t': true, ',': true }; // Excel/Sheets ใส่ "…" ครอบช่องที่มีขึ้นบรรทัดใหม่หรือตัวคั่น

/** แยกข้อความแบบมีเครื่องหมายคำพูด (tab/comma) — ช่องที่อยู่ใน "…" ขึ้นบรรทัดใหม่ได้ */
function splitQuoted(text, ch) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"' && cell.trim() === '') { q = true; cell = ''; } else if (c === ch) { row.push(cell); cell = ''; } else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; } else cell += c;
  }
  row.push(cell); rows.push(row);
  return rows;
}

// หัวตาราง → ชื่อคอลัมน์กลาง (เทียบหลังตัดช่องว่าง) · ความหมายของ name/subject ขึ้นกับว่ากำลังวางอะไร
const HEADER_KEYS = [
  ['no', /^(ที่|ลำดับ(ที่)?|no\.?|#)$/i],
  ['short', /^ชื่อย่อ$/],
  ['code', /^รหัส(วิชา)?$/],
  ['name', /^(ชื่อ|ชื่อ-?(นาม)?สกุล|ชื่อครู|ชื่อ-?สกุลครู|ครู|ครูผู้สอน|ผู้สอน)$/],
  ['subject', /^(วิชา|ชื่อวิชา|รายวิชา)$/],
  ['group', /^(วิชาเอก|เอก|กลุ่มสาระ(การเรียนรู้)?|สาระ(การเรียนรู้)?)$/],
  ['class', /^(ชั้น|ชั้นเรียน|ระดับ(ชั้น)?|ประจำชั้น|ครูประจำชั้น|ห้อง|ห้องเรียน)$/],
  ['perWeek', /^(คาบ|จำนวนคาบ|คาบ[:/]?(ต่อ)?สัปดาห์|คาบต่อสัปดาห์|ชม\.?|ชั่วโมง|ชม\.?\/สัปดาห์)$/],
  ['doubles', /^(คู่|คาบคู่)$/],
];
const headerKey = (cell) => { const s = String(cell).replace(/\s+/g, ''); for (const [k, re] of HEADER_KEYS) if (re.test(s)) return k; return null; };

/**
 * แยกข้อความเป็นตาราง: ตัวคั่น tab > `|` > `,` > ช่องว่าง ≥ 2 ตัว · ห้ามตัดที่ช่องว่างตัวเดียว (ชื่อ นามสกุล จาก LINE)
 * แถวแรกที่เป็นหัวตาราง (ชื่อ/วิชา/ชั้น/คาบ/รหัส …) → headers + keys · ตัดเลขลำดับหน้าแถว ("1." หรือคอลัมน์ "ที่")
 * คืน { headers: string[]|null, keys: (string|null)[]|null, rows: string[][], delim }
 */
export function parseTable(text) {
  const src = String(text ?? '').replace(/\r\n?/g, '\n').replace(/ /g, ' ').replace(/[​﻿]/g, '');
  const lines = src.split('\n').filter((l) => l.trim());
  let delim = 'line';
  if (src.includes('\t')) delim = '\t';
  else if (lines.some((l) => l.includes('|'))) delim = '|';
  else if (lines.length && lines.filter((l) => l.includes(',')).length * 2 >= lines.length) delim = ',';
  else if (lines.some((l) => /\S {2,}\S/.test(l.trim()))) delim = 'spaces';
  let rows;
  if (QUOTED[delim]) rows = splitQuoted(src, delim);
  else if (delim === '|') rows = lines.filter((l) => !/^[\s|:+-]+$/.test(l)).map((l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|')); // ข้ามเส้นคั่นแบบ |---|---|
  else if (delim === 'spaces') rows = lines.map((l) => l.trim().split(/ {2,}/));
  else rows = lines.map((l) => [l]);
  rows = rows.map((r) => r.map((c) => c.replace(/\s+/g, ' ').trim())).filter((r) => r.some(Boolean));
  let headers = null, keys = null;
  if (rows.length) {
    const k = rows[0].map(headerKey);
    if (rows[0].length > 1 && k.filter(Boolean).length >= 2) { headers = rows.shift(); keys = k; }
    else if (rows[0].length === 1 && k[0]) headers = rows.shift(); // หัวคอลัมน์เดียว ("ชื่อครู") ทิ้งไป แล้วเดาแบบไม่มีหัว
  }
  // เลขลำดับ: คอลัมน์แรกเป็นตัวเลขล้วน (ไม่มีรูปแบบไหนขึ้นต้นด้วยตัวเลข) หรือ "1. …" / "1) …" หน้าข้อความ
  rows = rows.map((r) => {
    if (keys) return r;
    if (r.length > 1 && /^\d{1,3}[.)]?$/.test(r[0])) r = r.slice(1);
    r[0] = r[0].replace(/^\d{1,3}\s*[.)]\s*/, '');
    return r;
  });
  return { headers, keys, rows, delim };
}

// ---------- ทำให้เทียบกันได้ ----------
// คำนำหน้า: ตัดซ้ำได้ (เช่น "ว่าที่ ร.ต. นาย…") · ยศตำรวจ/ทหารแบบมีจุด ด.ต. จ.ส.ต. ร.ต.อ. พ.ต.ท. (+หญิง)
const PREFIXES = ['ว่าที่ร้อยตรีหญิง', 'ว่าที่ร้อยตรี', 'ว่าที่', 'ร้อยตรีหญิง', 'ร้อยตรี', 'นางสาว', 'น.ส.', 'นส.', 'นาง', 'นาย', 'ครู', 'ดร.', 'mrs.', 'mr.', 'ms.', 'miss'];
const PREFIX_RE = new RegExp('^(?:' + PREFIXES.map((p) => p.replace(/\./g, '\\.')).join('|') + '|[สจดรพ]\\.(?:ส\\.)?[ตทอ]\\.(?:[ตทอ]\\.)?(?:\\s*หญิง)?)\\s*', 'i');
/** ตัดคำนำหน้าชื่อ (เหลืออย่างน้อย 2 ตัวอักษร ไม่งั้นคงเดิม) */
export function stripPrefix(s) {
  let out = String(s ?? '').trim();
  for (let i = 0; i < 4; i++) {
    const m = PREFIX_RE.exec(out);
    if (!m || out.length - m[0].length < 2) break;
    out = out.slice(m[0].length);
  }
  return out.trim();
}
/** ชื่อครูสำหรับเทียบ: ไม่มีคำนำหน้า วงเล็บ ช่องว่าง จุด */
export const normName = (s) => stripPrefix(String(s ?? '').replace(/\([^)]*\)/g, ' ')).replace(/[\s.]/g, '').toLowerCase();
/** ชื่อห้องสำหรับเทียบ: "ม.1/1" = "ม1/1" = "ม.1 /1" = "มัธยมศึกษาปีที่ 1/1" */
export const normClass = (s) => String(s ?? '').replace(/อนุบาล(?:ปีที่)?/g, 'อ').replace(/ประถม(?:ศึกษา)?(?:ปีที่)?/g, 'ป').replace(/มัธยม(?:ศึกษา)?(?:ปีที่)?/g, 'ม')
  .replace(/[–—]/g, '-').replace(/[\s.]/g, '').toLowerCase();
const normSubj = (s) => String(s ?? '').replace(/[\s.]/g, '').toLowerCase();
const normCode = (s) => String(s ?? '').replace(/\s+/g, '').toUpperCase();

const CODE_RE = /^([ก-ฮ]\s?\d{5})(?:\s+(.+))?$/; // รหัสวิชา ท21101 (+ชื่อวิชาต่อท้ายได้)
const CLASS_RE = /^(?:อ|ป|ม|อนุบาล|ประถม\S*|มัธยม\S*)\s?\.?\s?\d/;
const isClass = (s) => CLASS_RE.test(s) && !/^[ก-ฮ]\s?\d{5}/.test(s); // "อ21101" = รหัสวิชาภาษาอังกฤษ ไม่ใช่ห้อง อ.2
const NAME_RE = new RegExp('^(?:' + PREFIXES.slice(0, 12).map((p) => p.replace(/\./g, '\\.')).join('|') + '|[สจดรพ]\\.(?:ส\\.)?[ตทอ]\\.)');
const NUM_RE = /^\d{1,2}$/;
// คำที่ขึ้นต้นด้วยชื่อกลุ่มสาระ — ใช้ตัดสินว่าคำที่ 2 ในบรรทัดเป็นวิชาเอก ไม่ใช่นามสกุล ("สมชาย คณิต" กับ "สมชาย ศรีไทย")
const GROUP_START = /^(ภาษา|คณิต|วิทย|เทคโน|สังคม|ประวัติ|พระพุทธ|สุข|พละ|ศิลป|ดนตรี|นาฏ|การงาน|อาชีพ|อังกฤษ|ต่างประเทศ|จีน|ญี่ปุ่น|ปฐมวัย|อนุบาล|แนะแนว|ไทย$)/;
// ช่องว่างในชื่อห้อง "ป. 3" "ม.1 / 2" → "ป.3" "ม.1/2" ก่อนตัดคำ
const tidyClassText = (s) => String(s ?? '').replace(/([อปม])\s?\.\s+(\d)/g, '$1.$2').replace(/(\d)\s*\/\s*(\d)/g, '$1/$2');

/** กลุ่มสาระจากข้อความ (อาจหลายกลุ่ม "คณิต, วิทย์" "ไทย/สังคม") — คืนรหัสใน SUBJECT_GROUP_CODES ไม่ซ้ำ */
export function groupsFromText(s) {
  const out = [];
  for (const part of String(s ?? '').split(/[,/、;]|\s+และ\s+|\s+/)) {
    const g = part.trim() && groupFromText(part.trim());
    if (g && SUBJECT_GROUP_CODES.includes(g) && !out.includes(g)) out.push(g);
  }
  return out;
}

/**
 * หาห้องจากข้อความ → { ids, issue } · "ม.1 ทุกห้อง" / "ม.1 ทั้งหมด" = ทุกห้องของชั้น · "ม.1/1-3" = ม.1/1 ถึง ม.1/3
 * ชื่อห้องตรงตัวมาก่อน ("ป.1-2" ห้องคละชั้นต้องไม่ถูกขยายเป็นช่วง) · ชั้นเฉย ๆ ที่มีห้องเดียว → ห้องนั้น
 */
export function resolveClasses(text, classes, { allowLevel = true } = {}) {
  const raw = tidyClassText(text).replace(/^(?:ครูประจำชั้น|ประจำชั้น|ชั้น|ห้อง)\s*/, '').trim();
  if (!raw) return { ids: [], issue: '' };
  const named = classes.map((c) => [c, normClass(c.name)]);
  const exact = named.filter(([, n]) => n === normClass(raw));
  if (exact.length) return { ids: [exact[0][0].id], issue: '' };
  const all = /(ทุกห้อง|ทั้งหมด|ทุกชั้น)/.test(raw);
  const base = normClass(raw.replace(/(ทุกห้อง|ทั้งหมด|ทุกชั้น)/, ''));
  const ofLevel = named.filter(([c, n]) => n.startsWith(base + '/') || (c.level && normClass(c.level) === base)).map(([c]) => c.id);
  if (all) return ofLevel.length ? { ids: ofLevel, issue: '' } : { ids: [], issue: `ไม่พบห้องของชั้น ${raw}` };
  const rg = /^(.*\/)(\d+)-(\d+)$/.exec(base);
  if (rg) {
    const ids = [], miss = [];
    for (let i = +rg[2]; i <= +rg[3] && i - +rg[2] < 50; i++) {
      const hit = named.find(([, n]) => n === rg[1] + i);
      if (hit) ids.push(hit[0].id); else miss.push(i);
    }
    return { ids, issue: ids.length ? (miss.length ? `ไม่พบห้อง ${rg[1].replace(/\/$/, '')}/${miss.join(',')}` : '') : `ไม่พบห้อง ${raw}` };
  }
  if (allowLevel && ofLevel.length === 1) return { ids: ofLevel, issue: '' };
  if (ofLevel.length > 1) return { ids: [], issue: `${raw} มี ${ofLevel.length} ห้อง — ระบุห้อง เช่น ${raw}/1 หรือ "${raw} ทุกห้อง"` };
  return { ids: [], issue: `ไม่พบห้อง ${raw}` };
}

const firstLetter = (s) => (/[ก-ฮa-z]/i.exec(String(s ?? '')) || [''])[0]; // พยัญชนะตัวแรกแบบอักษรย่อไทย "ใจดี" → จ

/** แยกชื่อ-สกุล: { name: "สมชาย ใจดี", first: "สมชาย", last: "ใจดี" } (ไม่มีคำนำหน้า) */
function splitName(s) {
  const name = stripPrefix(String(s ?? '').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim());
  const [first = '', ...rest] = name.split(' ');
  return { name, first, last: rest.join(' ') };
}

/** ชื่อย่อ "ครู"+ชื่อตัว · ซ้ำกัน (ในรายการที่วาง หรือกับครูเดิม) → เติมอักษรแรกนามสกุล · ยังซ้ำ → เติมเลข */
function makeShorts(rows, existingShorts) {
  const count = new Map();
  for (const r of rows) count.set(r.first, (count.get(r.first) || 0) + 1);
  const used = new Set(existingShorts.map((s) => normSubj(s)).filter(Boolean));
  for (const r of rows) {
    if (r.short) { used.add(normSubj(r.short)); continue; }
    let s = 'ครู' + r.first;
    if ((count.get(r.first) > 1 || used.has(normSubj(s))) && r.last) s += ' ' + firstLetter(r.last) + '.';
    for (let n = 2, b = s; used.has(normSubj(s)); n++) s = b + n;
    used.add(normSubj(s));
    r.short = s;
  }
}

// ---------- ครู ----------
/**
 * วางรายชื่อครู → { rows } · แถว = { name, short, subjects[], homeroom: classId|null, homeroomText, status, include, dupOf, issues[] }
 * status: 'new' (นำเข้า) · 'dup' (ชื่อตรงกับครูเดิม/ซ้ำในรายการ → include=false ติ๊กเองได้) · 'unresolved' (ไม่มีชื่อ)
 * doc ใช้ doc.teachers (เทียบซ้ำ + ชื่อย่อ) และ doc.classes (ประจำชั้น) — ส่งอาร์เรย์ครูมาตรง ๆ ก็ได้
 */
export function parseTeachers(text, doc = {}) {
  const teachers = Array.isArray(doc) ? doc : doc?.teachers || [], classes = Array.isArray(doc) ? [] : doc?.classes || [];
  const { keys, rows: table } = parseTable(text);
  const out = [];
  for (const cells of table) {
    let nameText = '', short = '', groups = [], homeroomText = '';
    if (keys) {
      cells.forEach((c, i) => {
        const k = keys[i];
        if (k === 'name') nameText = c;
        else if (k === 'short') short = c;
        else if (k === 'group' || k === 'subject') groups.push(...groupsFromText(c));
        else if (k === 'class') homeroomText = c;
      });
    } else {
      // ไม่มีหัวตาราง: เดาทีละช่อง แล้วตัดคำในช่องชื่อ (LINE วางมาเป็นบรรทัดเดียว "1. นายสมชาย ใจดี คณิต ป.3")
      for (const cell of cells) {
        const c = tidyClassText(cell);
        if (!nameText && (NAME_RE.test(c) || cells.length === 1 || !(isClass(c) || groupsFromText(c).length))) { nameText = c; continue; }
        if (isClass(c.replace(/^(?:ครูประจำชั้น|ประจำชั้น)\s*/, ''))) { homeroomText = c; continue; }
        if (!groupsFromText(c).length && !/\s/.test(nameText.trim())) { nameText += ' ' + c; continue; } // "สมชาย  ใจดี" เว้น 2 ช่องโดยบังเอิญ → นามสกุลอยู่อีกช่อง
        // ช่องปน "วิทย์ ป.3" (LINE ที่มีจุลภาค) → ดูทีละคำ
        for (const t of c.replace(/^(?:ครูประจำชั้น|ประจำชั้น)\s*/, '').split(/\s+/)) if (isClass(t)) homeroomText = t; else groups.push(...groupsFromText(t));
      }
      const paren = (nameText.match(/\(([^)]*)\)/g) || []).join(' ');
      groups.push(...groupsFromText(paren.replace(/[()]/g, ' ')));
      const tokens = stripPrefix(nameText.replace(/\([^)]*\)/g, ' ')).split(/\s+/).filter(Boolean);
      const name = [];
      let tail = false; // เจอวิชาเอก/ห้องแล้ว — คำหลังจากนี้ไม่ใช่ชื่อ
      for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (/^(ครูประจำชั้น|ประจำชั้น)$/.test(t)) { if (tokens[i + 1]) homeroomText = tokens[++i]; tail = true; continue; }
        const hr = /^(?:ครูประจำชั้น|ประจำชั้น)(.+)$/.exec(t);
        if (hr && isClass(hr[1])) { homeroomText = hr[1]; tail = true; continue; }
        if (i > 0 && isClass(t)) { homeroomText = t; tail = true; continue; }
        // คำแรกเป็นชื่อตัวเสมอ · คำที่ 2 เป็นนามสกุล เว้นแต่ขึ้นต้นด้วยชื่อกลุ่มสาระ · คำที่ 3+ ที่เป็นกลุ่มสาระ = วิชาเอก ("สมชาย ณ อยุธยา" ยังเป็นชื่อ)
        const g = i === 0 ? [] : i === 1 && !GROUP_START.test(t) ? [] : groupsFromText(t);
        if (g.length) { groups.push(...g); tail = true; } else if (!tail) name.push(t);
      }
      nameText = name.join(' ');
    }
    const n = splitName(nameText);
    const row = { name: n.name, first: n.first, last: n.last, short: short.trim(), subjects: SUBJECT_GROUP_CODES.filter((g) => groups.includes(g)), homeroom: null, homeroomText: homeroomText.trim(), status: 'new', include: true, dupOf: null, issues: [] };
    if (!row.name) { row.status = 'unresolved'; row.include = false; row.issues.push('ไม่พบชื่อครู'); }
    if (row.homeroomText) {
      const r = resolveClasses(row.homeroomText, classes);
      if (r.ids.length === 1) row.homeroom = r.ids[0];
      else row.issues.push(r.issue || `ประจำชั้น ${row.homeroomText} ระบุได้ห้องเดียว`);
    }
    out.push(row);
  }
  // ซ้ำกับครูเดิม / ซ้ำกันเองในรายการ → ไม่นำเข้าโดยค่าเริ่มต้น
  const seen = new Map(teachers.map((t) => [normName(t.name), t.id]));
  out.forEach((r, i) => {
    if (r.status !== 'new') return;
    const k = normName(r.name);
    if (seen.has(k)) { r.status = 'dup'; r.include = false; r.dupOf = seen.get(k); r.issues.push(typeof r.dupOf === 'number' ? 'ซ้ำกับแถวก่อนหน้า' : 'มีครูชื่อนี้แล้ว'); } else seen.set(k, i);
  });
  makeShorts(out.filter((r) => r.status !== 'unresolved'), teachers.map((t) => t.short || ''));
  for (const r of out) { delete r.first; delete r.last; }
  return { rows: out };
}

/** เพิ่มครูที่ติ๊กไว้ลงเอกสาร (แก้อาร์เรย์เดิม) → { added: [id] } ใช้กับ undoImport */
export function applyTeachers(doc, rows, makeId = uid) {
  const added = [];
  for (const r of rows) {
    if (!r.include || !r.name) continue;
    const t = { id: makeId('t'), name: r.name, short: r.short || '', maxPerDay: 6, unavailable: [] };
    const subj = (r.subjects || []).filter((g) => SUBJECT_GROUP_CODES.includes(g));
    if (subj.length) t.subjects = subj;
    if (r.homeroom && doc.classes.some((c) => c.id === r.homeroom)) t.homeroom = r.homeroom;
    doc.teachers.push(t);
    added.push(t.id);
  }
  return { teachers: added };
}

// ---------- วิชา ----------
/**
 * วางรายชื่อวิชา (รหัส | ชื่อ | คาบ) → { rows } · แถว = { code, name, perWeek, color, status, include, issues[] }
 * ไม่มีคาบ → ตามหลักสูตร (curriculum: { รหัส: คาบ/สัปดาห์ }) ถ้ารหัสตรง ไม่งั้น 1 · รหัสซ้ำกับวิชาเดิม/ในรายการ → 'dup' ข้าม
 * แบบบรรทัดเดียวไม่มีตัวคั่น ("ค21101 คณิตศาสตร์ 1") เลขท้ายถือเป็นชื่อวิชา — คาบต้องเขียน "3 คาบ" หรือแยกคอลัมน์
 */
export function parseSubjects(text, doc = null, curriculum = null) {
  const subjects = doc?.subjects || [];
  const { keys, rows: table } = parseTable(text);
  const out = [];
  for (const cells of table) {
    let code = '', name = '', per = null;
    if (keys) {
      cells.forEach((c, i) => {
        const k = keys[i];
        if (k === 'code') code = c;
        else if (k === 'name' || k === 'subject') name = c;
        else if (k === 'perWeek') per = c;
      });
      const m = !code && CODE_RE.exec(name);
      if (m) { code = m[1]; name = m[2] || ''; }
    } else {
      const rest = [];
      for (const cell of cells) {
        const m = !code && CODE_RE.exec(cell);
        if (m) { code = m[1]; if (m[2]) rest.push(m[2]); } else if (cells.length > 1 && per == null && NUM_RE.test(cell)) per = cell;
        else rest.push(cell);
      }
      name = rest.join(' ');
    }
    const pm = /^(.*?)\s*(\d{1,2})\s*คาบ(?:\s*[:/]?\s*(?:ต่อ)?\s*สัปดาห์)?$/.exec(name);
    if (pm && per == null) { name = pm[1]; per = pm[2]; }
    code = normCode(code);
    const n = Math.trunc(Number(String(per ?? '').replace(/[^\d]/g, '')));
    const cur = curriculum && Number.isInteger(curriculum[code]) && curriculum[code] > 0 ? curriculum[code] : null;
    const row = { code, name: name.trim(), perWeek: n >= 1 ? Math.min(40, n) : cur || 1, color: '', status: 'new', include: true, issues: [] };
    if (!row.name && !row.code) { row.status = 'unresolved'; row.include = false; row.issues.push('ไม่พบชื่อหรือรหัสวิชา'); }
    else if (!row.name) row.issues.push('ไม่มีชื่อวิชา');
    out.push(row);
  }
  const seen = new Set(subjects.map((s) => normCode(s.code)).filter(Boolean));
  const seenName = new Set(subjects.filter((s) => !s.code).map((s) => normSubj(s.name)));
  for (const r of out) {
    if (r.status !== 'new') continue;
    const dup = r.code ? seen.has(r.code) : seenName.has(normSubj(r.name));
    if (dup) { r.status = 'dup'; r.include = false; r.issues.push(r.code ? `มีรหัส ${r.code} แล้ว` : 'มีวิชาชื่อนี้แล้ว'); }
    if (r.code) seen.add(r.code); else seenName.add(normSubj(r.name));
  }
  let ci = subjects.length;
  for (const r of out) r.color = SUBJECT_COLORS[ci++ % SUBJECT_COLORS.length]; // ชุดสีเดียวกับปุ่ม "+ เพิ่มวิชา" (ไม่มีเขียว)
  return { rows: out };
}

/** เพิ่มวิชาที่ติ๊กไว้ → { subjects: [id] } */
export function applySubjects(doc, rows, makeId = uid) {
  const added = [];
  for (const r of rows) {
    if (!r.include || (!r.name && !r.code)) continue;
    const s = { id: makeId('s'), code: r.code || '', name: r.name || r.code, color: r.color || SUBJECT_COLORS[doc.subjects.length % SUBJECT_COLORS.length], perWeek: r.perWeek || null };
    doc.subjects.push(s);
    added.push(s.id);
  }
  return { subjects: added };
}

// ---------- ภาระสอน ----------
/** หาวิชา: รหัสก่อน แล้วชื่อตรงตัว แล้วชื่อที่มีคำนี้อยู่ (ต้องเหลือวิชาเดียว) */
function findSubject(text, subjects) {
  const t = String(text ?? '').trim();
  if (!t) return null;
  const m = CODE_RE.exec(t);
  if (m) {
    const hit = subjects.find((s) => normCode(s.code) === normCode(m[1]));
    if (hit) return hit;
  }
  const n = normSubj(m ? m[2] || '' : t);
  if (!n) return null;
  const exact = subjects.filter((s) => normSubj(s.name) === n || normCode(s.code) === normCode(t));
  if (exact.length === 1) return exact[0];
  const part = subjects.filter((s) => normSubj(s.name).includes(n));
  return part.length === 1 ? part[0] : null;
}

/**
 * วางตารางภาระงาน (ครู | วิชา | ห้อง | คาบ | คู่) → { rows, newTeachers }
 * แถว = { teacherId, newTeacher (คีย์ใน newTeachers), subjectId, classId, perWeek, doubles, status, include, action, dupOf, issues[], raw }
 * status: 'ok' · 'dup' (วิชา+ห้องนี้มีการสอนอยู่แล้ว → action 'skip' ค่าเริ่มต้น / 'merge' = ใช้ครู+คาบที่วางแทนแถวเดิม) · 'unresolved' (สีส้ม แก้ด้วย select ก่อนยืนยัน)
 * ครูที่ยังไม่มีในระบบ → newTeachers [{ key, name, short, include }] ติ๊กเพื่อสร้างให้ · ไม่ throw ไม่ว่าข้อความจะเป็นอะไร
 */
export function parseWorkload(text, doc) {
  const teachers = doc?.teachers || [], subjects = doc?.subjects || [], classes = doc?.classes || [], assignments = doc?.assignments || [];
  const { keys, rows: table } = parseTable(text);
  const tByName = new Map();
  for (const t of teachers) { tByName.set(normName(t.name), t); if (t.short) tByName.set(normName(t.short), t); }
  const isTeacher = (c) => NAME_RE.test(c) || tByName.has(normName(c));
  const fresh = new Map(); // ครูใหม่ normName → แถวเสนอสร้าง
  const out = [];
  const existing = new Map(assignments.map((a) => [a.subjectId + '|' + a.classId, a]));
  const pasted = new Map();
  for (const cells of table) {
    let tText = '', sText = '', cText = '', per = '', dbl = '';
    if (keys) {
      let code = '';
      cells.forEach((c, i) => {
        const k = keys[i];
        if (k === 'name') tText = c;
        else if (k === 'subject') sText = c;
        else if (k === 'code') code = c;
        else if (k === 'class') cText = c;
        else if (k === 'perWeek') per = c;
        else if (k === 'doubles') dbl = c;
      });
      if (code) sText = (code + ' ' + sText).trim(); // findSubject จับรหัสก่อน ไม่ตรงค่อยใช้ชื่อ
    } else {
      // ไม่มีหัวตาราง: ห้อง/ตัวเลข/รหัสวิชาดูจากรูปแบบ ช่องข้อความที่เหลือ = ครู แล้ววิชา (ตามลำดับ ครู | วิชา)
      const text = [], nums = [];
      for (const cell of cells) {
        const c = tidyClassText(cell);
        if (!cText && (isClass(c) || resolveClasses(c, classes).ids.length) && !isTeacher(c) && !findSubject(c, subjects)) cText = c;
        else if (NUM_RE.test(c)) nums.push(c);
        else text.push(c);
      }
      const ti = text.findIndex(isTeacher);
      if (ti >= 0) tText = text.splice(ti, 1)[0];
      else if (text.length >= 2) tText = text.shift();
      sText = text.find((c) => CODE_RE.test(c)) || text[0] || '';
      [per = '', dbl = ''] = nums;
    }
    const raw = { teacher: tText, subject: sText, class: cText };
    const issues = [];
    // ครู
    let teacherId = null, newTeacher = null;
    const tk = normName(tText);
    if (tk) {
      const hit = tByName.get(tk);
      if (hit) teacherId = hit.id;
      else {
        if (!fresh.has(tk)) fresh.set(tk, { key: tk, ...splitName(tText), short: '', include: true });
        newTeacher = tk;
      }
    } else issues.push('ไม่พบครู');
    // วิชา
    const subj = findSubject(sText, subjects);
    if (!subj) issues.push(sText ? `ไม่พบวิชา "${sText}"` : 'ไม่พบวิชา');
    // ห้อง (ขยายหลายห้องได้)
    const cr = cText ? resolveClasses(cText, classes) : { ids: [], issue: 'ไม่พบห้อง' };
    if (cr.issue) issues.push(cr.issue);
    const n = Math.trunc(Number(String(per).replace(/[^\d]/g, '')));
    const perWeek = n >= 1 ? Math.min(40, n) : subj?.perWeek || 1;
    const doubles = Math.max(0, Math.min(Math.floor(perWeek / 2), Math.trunc(Number(String(dbl).replace(/[^\d]/g, ''))) || 0));
    for (const classId of cr.ids.length ? cr.ids : [null]) {
      const row = { teacherId, newTeacher, subjectId: subj?.id || null, classId, perWeek, doubles, status: 'ok', include: true, action: 'add', dupOf: null, issues: [...issues], raw };
      if (!row.subjectId || !row.classId || (!row.teacherId && !row.newTeacher)) { row.status = 'unresolved'; row.include = false; }
      else {
        const k = row.subjectId + '|' + row.classId;
        const prev = existing.get(k);
        if (prev) { row.status = 'dup'; row.include = false; row.action = 'skip'; row.dupOf = prev.id; row.issues.push('ห้องนี้มีการสอนวิชานี้แล้ว'); }
        else if (pasted.has(k)) { row.status = 'dup'; row.include = false; row.action = 'skip'; row.dupOf = pasted.get(k); row.issues.push('ซ้ำกับแถวก่อนหน้า'); }
        else pasted.set(k, out.length);
      }
      out.push(row);
    }
  }
  const newTeachers = [...fresh.values()];
  makeShorts(newTeachers, teachers.map((t) => t.short || ''));
  for (const t of newTeachers) { delete t.first; delete t.last; }
  return { rows: out, newTeachers };
}

/**
 * ยืนยันภาระสอน: สร้างครูใหม่ที่ติ๊กไว้ → เพิ่มแถวการสอน (include + จับคู่ครบ) · dup + action 'merge' = แก้แถวเดิม
 * แถวที่ครูใหม่ไม่ได้ติ๊กสร้างจะถูกข้าม · คืน { teachers, assignments, changed: [{ id, before }] } ใช้กับ undoImport
 */
export function applyWorkload(doc, { rows, newTeachers = [] }, makeId = uid) {
  const tid = new Map(), teachersAdded = [], added = [], changed = [];
  for (const nt of newTeachers) {
    if (!nt.include || !nt.name) continue;
    const t = { id: makeId('t'), name: nt.name, short: nt.short || '', maxPerDay: 6, unavailable: [] };
    doc.teachers.push(t);
    teachersAdded.push(t.id);
    tid.set(nt.key, t.id);
  }
  const has = (arr, id) => arr.some((x) => x.id === id);
  for (const r of rows) {
    const teacherId = r.teacherId || (r.newTeacher && tid.get(r.newTeacher)) || null;
    if (!teacherId || !has(doc.teachers, teacherId) || !has(doc.subjects, r.subjectId) || !has(doc.classes, r.classId)) continue;
    const perWeek = Math.max(1, Math.trunc(r.perWeek) || 1), doubles = Math.max(0, Math.trunc(r.doubles) || 0);
    if (r.status === 'dup') {
      if (r.action !== 'merge' || typeof r.dupOf !== 'string') continue;
      const a = doc.assignments.find((x) => x.id === r.dupOf);
      if (!a) continue;
      changed.push({ id: a.id, before: { teacherId: a.teacherId, perWeek: a.perWeek, doubles: a.doubles } });
      Object.assign(a, { teacherId, perWeek, doubles });
      continue;
    }
    if (!r.include) continue;
    const a = { id: makeId('a'), subjectId: r.subjectId, classId: r.classId, teacherId, roomId: null, perWeek, doubles };
    doc.assignments.push(a);
    added.push(a.id);
  }
  return { teachers: teachersAdded, assignments: added, changed };
}

/** เลิกทำการนำเข้า (ปุ่ม "เลิกทำ" ใน toast) — ลบรายการที่เพิ่ม คืนค่าแถวที่แก้ แก้อาร์เรย์เดิม */
export function undoImport(doc, res) {
  const drop = (arr, ids) => { const s = new Set(ids || []); for (let i = arr.length - 1; i >= 0; i--) if (s.has(arr[i].id)) arr.splice(i, 1); };
  drop(doc.assignments, res.assignments);
  drop(doc.subjects, res.subjects);
  drop(doc.teachers, res.teachers);
  for (const c of res.changed || []) { const a = doc.assignments.find((x) => x.id === c.id); if (a) Object.assign(a, c.before); }
}

/** ตัวอย่างรูปแบบ (ปุ่ม "ตัวอย่างรูปแบบ") — คัดลอกจาก Excel ได้ตรงรูปแบบนี้ (คั่นด้วย tab) */
export const EXAMPLES = {
  teachers: 'ชื่อ-สกุล\tกลุ่มสาระ\tประจำชั้น\nนายสมชาย ใจดี\tคณิตศาสตร์\tป.3\nนางสาวสมศรี รักเรียน\tภาษาไทย, สังคม\tป.4\nครูวิไล มีสุข\tภาษาอังกฤษ\t',
  subjects: 'รหัส\tชื่อวิชา\tคาบ\nท21101\tภาษาไทย 1\t3\nค21101\tคณิตศาสตร์ 1\t3\nส21101\tสังคมศึกษา 1\t3',
  workload: 'ครู\tวิชา\tห้อง\tคาบ\nครูสมชาย\tค21101\tม.1 ทุกห้อง\t3\nนางสาวสมศรี รักเรียน\tภาษาไทย 1\tม.1/1-2\t3',
};

/**
 * เปิดกล่องวางรายชื่อในแอป (teachers | subjects | workload) — UI อยู่ใน data.js · โหลดเมื่อเรียกเท่านั้น
 * โมดูลนี้จึงยังเป็นฟังก์ชันล้วนใน node (tests/import.test.mjs ไม่โหลด data.js / ไม่แตะ DOM)
 */
export async function openPaste(kind = 'teachers') {
  const ui = await import('./data.js');
  return ui.openPaste(kind);
}
