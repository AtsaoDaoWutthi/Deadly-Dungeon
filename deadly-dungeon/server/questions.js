// โหลดคลังคำถามจาก questions.json (มี fallback ในตัวเผื่อไฟล์ยังไม่พร้อม)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ชุดคำถามสำรอง (ใช้เมื่อ questions.json ยังไม่ถูกสร้าง)
const FALLBACK = [
  { question: 'หอไอเฟล (Eiffel Tower) เดิมทีถูกเสนอให้สร้างเป็นแห่งแรกที่ประเทศใด?', options: ['ฝรั่งเศส', 'สเปน', 'อังกฤษ', 'เยอรมนี'], answer: 1 },
  { question: 'ธาตุที่มีสัญลักษณ์ทางเคมีว่า "W" คือธาตุอะไร?', options: ['วานาเดียม', 'ทังสเตน', 'วุลแฟรม', 'ไทเทเนียม'], answer: 1 },
  { question: 'ทะเลทรายที่ใหญ่ที่สุดในโลก (ไม่นับขั้วโลก) คือทะเลทรายใด?', options: ['โกบี', 'สะฮารา', 'อาตากามา', 'คาลาฮารี'], answer: 1 },
  { question: 'ประเทศใดเป็นชาติแรกที่ให้สิทธิเลือกตั้งแก่สตรีอย่างถาวร?', options: ['สหรัฐอเมริกา', 'นิวซีแลนด์', 'อังกฤษ', 'สวิตเซอร์แลนด์'], answer: 1 },
  { question: 'ดาวเคราะห์ในระบบสุริยะที่มีดวงจันทร์บริวารมากที่สุดคือดวงใด?', options: ['ดาวพฤหัสบดี', 'ดาวเสาร์', 'ดาวยูเรนัส', 'ดาวเนปจูน'], answer: 1 },
  { question: '"อิล เลียรอนเต" (Il Rondò) — ข้อใดคือผลงานของจิตรกร เลโอนาร์โด ดา วินชี?', options: ['Mona Lisa', 'The Starry Night', 'The Scream', 'Girl with a Pearl Earring'], answer: 0 },
  { question: 'แม่น้ำที่ยาวที่สุดในโลกคือแม่น้ำใด?', options: ['แอมะซอน', 'ไนล์', 'แยงซี', 'มิสซิสซิปปี'], answer: 1 },
  { question: 'อวัยวะที่ใหญ่ที่สุดในร่างกายมนุษย์คืออะไร?', options: ['ตับ', 'สมอง', 'ผิวหนัง', 'ลำไส้เล็ก'], answer: 2 },
  { question: 'ธาตุที่พบมากที่สุดในชั้นบรรยากาศโลกคือธาตุใด?', options: ['ออกซิเจน', 'คาร์บอนไดออกไซด์', 'ไนโตรเจน', 'อาร์กอน'], answer: 2 },
  { question: 'ใครเป็นผู้ค้นพบกฎแรงโน้มถ่วง?', options: ['กาลิเลโอ', 'นิวตัน', 'ไอน์สไตน์', 'เคปเลอร์'], answer: 1 },
];

let questions = FALLBACK.slice();
try {
  const raw = JSON.parse(readFileSync(join(__dirname, 'questions.json'), 'utf8'));
  if (Array.isArray(raw) && raw.length && raw.every((q) => q.question && Array.isArray(q.options) && q.options.length === 4 && typeof q.answer === 'number')) {
    questions = raw;
  }
} catch {
  // ใช้ fallback
}

export function getQuestions() {
  return questions;
}

export function questionCount() {
  return questions.length;
}
