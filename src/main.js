import "./style.css";
import * as mammoth from "mammoth/mammoth.browser";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import Tesseract from "tesseract.js";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

const STORAGE_KEY = "kids_dictation_words_v1";

const state = {
  words: [],
  queue: [],
  currentIndex: 0,
  currentWord: null,
  drawing: false,
  lastPoint: null,
};

const imageInput = document.getElementById("imageInput");
const fileInput = document.getElementById("fileInput");
const importLog = document.getElementById("importLog");
const startBtn = document.getElementById("startBtn");
const resetBtn = document.getElementById("resetBtn");
const clearDataBtn = document.getElementById("clearDataBtn");
const dictationPanel = document.getElementById("dictationPanel");
const progressText = document.getElementById("progressText");
const playEnBtn = document.getElementById("playEnBtn");
const playZhBtn = document.getElementById("playZhBtn");
const clearCanvasBtn = document.getElementById("clearCanvasBtn");
const ocrCanvasBtn = document.getElementById("ocrCanvasBtn");
const submitBtn = document.getElementById("submitBtn");
const feedback = document.getElementById("feedback");
const answerInput = document.getElementById("answerInput");
const canvas = document.getElementById("handwritingCanvas");
const stats = document.getElementById("stats");
const wrongList = document.getElementById("wrongList");

const ctx = canvas.getContext("2d");
setupCanvas();
bindCanvasEvents();
bindEvents();
loadWords();
renderStats();

function bindEvents() {
  imageInput.addEventListener("change", handleImageUpload);
  fileInput.addEventListener("change", handleFileUpload);
  startBtn.addEventListener("click", startDictation);
  resetBtn.addEventListener("click", resetCurrentAnswer);
  clearDataBtn.addEventListener("click", clearAllData);
  playEnBtn.addEventListener("click", () => speakCurrent("en"));
  playZhBtn.addEventListener("click", () => speakCurrent("zh"));
  clearCanvasBtn.addEventListener("click", clearCanvasAndGuides);
  ocrCanvasBtn.addEventListener("click", recognizeCanvasText);
  submitBtn.addEventListener("click", submitAnswer);
}

function setupCanvas() {
  const dpr = Math.max(window.devicePixelRatio || 1, 1);
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);
  clearCanvasAndGuides();
}

function clearCanvasAndGuides() {
  clearCanvas();
  drawGuideLines();
}

function drawGuideLines() {
  ctx.save();
  ctx.strokeStyle = "#e5e7eb";
  ctx.lineWidth = 1;
  for (let y = 40; y < canvas.clientHeight; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.clientWidth, y);
    ctx.stroke();
  }
  ctx.restore();
}

function bindCanvasEvents() {
  canvas.addEventListener("pointerdown", (e) => {
    state.drawing = true;
    state.lastPoint = getPoint(e);
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!state.drawing) return;
    const current = getPoint(e);
    ctx.strokeStyle = "#111827";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(state.lastPoint.x, state.lastPoint.y);
    ctx.lineTo(current.x, current.y);
    ctx.stroke();
    state.lastPoint = current;
  });

  function stopDrawing() {
    state.drawing = false;
    state.lastPoint = null;
  }

  canvas.addEventListener("pointerup", stopDrawing);
  canvas.addEventListener("pointercancel", stopDrawing);
}

function getPoint(e) {
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

async function handleImageUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  log(`开始识别图片：${file.name}`);
  try {
    const text = await extractTextFromImage(file);
    const parsed = parseWordList(text);
    mergeWords(parsed);
    log(`图片识别完成，新增/更新 ${parsed.length} 个词。`);
  } catch (error) {
    log(`图片识别失败：${error.message}`);
  } finally {
    imageInput.value = "";
  }
}

async function handleFileUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  log(`开始解析文件：${file.name}`);
  try {
    const text = await extractTextFromDocument(file);
    const parsed = parseWordList(text);
    mergeWords(parsed);
    log(`文件解析完成，新增/更新 ${parsed.length} 个词。`);
  } catch (error) {
    log(`文件解析失败：${error.message}`);
  } finally {
    fileInput.value = "";
  }
}

async function extractTextFromImage(file) {
  const { data } = await Tesseract.recognize(file, "eng+chi_sim");
  return data.text || "";
}

async function extractTextFromDocument(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".txt")) {
    return await file.text();
  }
  if (name.endsWith(".docx")) {
    const buffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer: buffer });
    return result.value || "";
  }
  if (name.endsWith(".pdf")) {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
    let text = "";
    for (let i = 1; i <= pdf.numPages; i += 1) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const line = content.items.map((item) => item.str).join(" ");
      text += `${line}\n`;
    }
    return text;
  }
  if (name.endsWith(".doc")) {
    throw new Error("浏览器端无法稳定解析 .doc，请先转成 .docx 或 .pdf");
  }
  throw new Error("不支持的文件类型");
}

function parseWordList(rawText) {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const list = [];
  for (const line of lines) {
    const normalized = line.replace(/[，；]/g, " ").replace(/\s{2,}/g, " ");
    const match = normalized.match(/^([A-Za-z][A-Za-z' -]{0,40})\s*[-:：]?\s*(.+)$/);
    if (!match) continue;
    const en = sanitizeEnglish(match[1]);
    const zh = match[2].trim();
    if (!en) continue;
    list.push(createWord(en, zh));
  }
  return dedupeWords(list);
}

function sanitizeEnglish(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z' -]/g, "")
    .trim();
}

function createWord(en, zh) {
  const now = Date.now();
  return {
    en,
    zh,
    repetitions: 0,
    easiness: 2.5,
    interval: 0,
    dueAt: now,
    wrongCount: 0,
    history: [],
  };
}

function dedupeWords(words) {
  const map = new Map();
  for (const w of words) map.set(w.en, w);
  return [...map.values()];
}

function mergeWords(newWords) {
  if (!newWords.length) {
    log("未识别到可用的词条，请检查格式。");
    return;
  }

  const byEn = new Map(state.words.map((w) => [w.en, w]));
  for (const item of newWords) {
    const existing = byEn.get(item.en);
    if (existing) {
      existing.zh = item.zh || existing.zh;
    } else {
      byEn.set(item.en, item);
    }
  }
  state.words = [...byEn.values()];
  saveWords();
  renderStats();
}

function startDictation() {
  if (!state.words.length) {
    feedback.textContent = "请先导入单词表。";
    return;
  }
  state.queue = buildQueue(state.words);
  if (!state.queue.length) {
    feedback.textContent = "今天没有到期单词，已自动抽取 5 个复习词。";
    state.queue = shuffle([...state.words]).slice(0, Math.min(5, state.words.length));
  }

  state.currentIndex = 0;
  dictationPanel.classList.remove("hidden");
  feedback.textContent = "";
  nextQuestion();
}

function buildQueue(words) {
  const now = Date.now();
  const due = words.filter((w) => w.dueAt <= now);
  return shuffle(due);
}

function nextQuestion() {
  if (state.currentIndex >= state.queue.length) {
    state.currentWord = null;
    progressText.textContent = `完成啦！本轮共 ${state.queue.length} 题`;
    feedback.textContent = "你真棒，今天听写完成！";
    renderStats();
    return;
  }
  state.currentWord = state.queue[state.currentIndex];
  progressText.textContent = `第 ${state.currentIndex + 1}/${state.queue.length} 题`;
  answerInput.value = "";
  clearCanvasAndGuides();
  speakCurrent("en");
}

function speakCurrent(lang) {
  if (!state.currentWord) return;
  const text = lang === "en" ? state.currentWord.en : state.currentWord.zh || state.currentWord.en;
  speak(text, lang === "en" ? "en-US" : "zh-CN");
}

function speak(text, lang) {
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang;
  utterance.rate = 0.85;
  utterance.pitch = 1;
  const voices = window.speechSynthesis.getVoices();
  const selected = voices.find((voice) => voice.lang.toLowerCase().startsWith(lang.slice(0, 2).toLowerCase()));
  if (selected) utterance.voice = selected;
  window.speechSynthesis.speak(utterance);
}

function submitAnswer() {
  if (!state.currentWord) return;
  const userAnswer = sanitizeEnglish(answerInput.value);
  if (!userAnswer) {
    feedback.textContent = "请先写出单词再提交。";
    return;
  }

  const target = sanitizeEnglish(state.currentWord.en);
  const isCorrect = userAnswer === target;
  updateMemorySchedule(state.currentWord, isCorrect);

  if (isCorrect) {
    feedback.textContent = `✅ 正确：${state.currentWord.en}`;
  } else {
    feedback.textContent = `❌ 错误，正确答案：${state.currentWord.en}`;
  }

  saveWords();
  state.currentIndex += 1;
  setTimeout(nextQuestion, 900);
}

function updateMemorySchedule(word, isCorrect) {
  const now = Date.now();
  if (!Array.isArray(word.history)) word.history = [];
  word.history.push({ at: now, correct: isCorrect });
  if (word.history.length > 50) word.history.shift();

  if (!isCorrect) {
    word.wrongCount = (word.wrongCount || 0) + 1;
    word.repetitions = 0;
    word.interval = 1;
    word.easiness = Math.max(1.3, (word.easiness || 2.5) - 0.25);
    word.dueAt = now + hoursToMs(12);
    return;
  }

  if (word.repetitions === 0) {
    word.interval = 1;
  } else if (word.repetitions === 1) {
    word.interval = 3;
  } else {
    word.interval = Math.round(word.interval * (word.easiness || 2.5));
  }
  word.repetitions += 1;
  word.easiness = Math.min(2.8, (word.easiness || 2.5) + 0.03);
  word.dueAt = now + daysToMs(word.interval);
}

function clearCanvas() {
  ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
}

async function recognizeCanvasText() {
  try {
    ocrCanvasBtn.disabled = true;
    ocrCanvasBtn.textContent = "识别中...";
    const { data } = await Tesseract.recognize(canvas, "eng");
    const text = sanitizeEnglish((data.text || "").replace(/\s+/g, ""));
    answerInput.value = text;
    feedback.textContent = text ? `识别结果：${text}` : "没有识别出文字，请再写清楚一些。";
  } catch (error) {
    feedback.textContent = `识别失败：${error.message}`;
  } finally {
    ocrCanvasBtn.disabled = false;
    ocrCanvasBtn.textContent = "识别手写为文本";
  }
}

function resetCurrentAnswer() {
  answerInput.value = "";
  feedback.textContent = "";
  clearCanvasAndGuides();
}

function clearAllData() {
  const ok = window.confirm("确定清空全部词表与学习记录吗？");
  if (!ok) return;
  state.words = [];
  state.queue = [];
  state.currentWord = null;
  localStorage.removeItem(STORAGE_KEY);
  dictationPanel.classList.add("hidden");
  renderStats();
  feedback.textContent = "已清空。";
  importLog.textContent = "";
}

function loadWords() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    state.words = raw ? JSON.parse(raw) : [];
  } catch {
    state.words = [];
  }
}

function saveWords() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.words));
}

function renderStats() {
  const total = state.words.length;
  const now = Date.now();
  const due = state.words.filter((w) => (w.dueAt || 0) <= now).length;
  const wrong = state.words.filter((w) => (w.wrongCount || 0) > 0);

  stats.innerHTML = `<p>词条总数：<strong>${total}</strong>，今日到期：<strong>${due}</strong>，累计错词：<strong>${wrong.length}</strong></p>`;

  wrongList.innerHTML = "";
  wrong
    .sort((a, b) => (b.wrongCount || 0) - (a.wrongCount || 0))
    .slice(0, 20)
    .forEach((w) => {
      const li = document.createElement("li");
      const nextTime = new Date(w.dueAt || now).toLocaleString();
      li.textContent = `${w.en}（${w.zh || "无中文"}）- 错误 ${w.wrongCount} 次，下次复习：${nextTime}`;
      wrongList.appendChild(li);
    });
}

function log(message) {
  const now = new Date().toLocaleTimeString();
  importLog.textContent = `[${now}] ${message}\n${importLog.textContent || ""}`.trim();
  renderStats();
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function daysToMs(days) {
  return days * 24 * 60 * 60 * 1000;
}

function hoursToMs(hours) {
  return hours * 60 * 60 * 1000;
}

window.addEventListener("resize", setupCanvas);
