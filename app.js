// ==== 設定 ====
const CONFIG = {
  owner: "Nabetoshi",
  repo: "Obsidian_Vault",
  branch: "main",
  diaryDir: "Diary",
};

// 仮の合言葉「furoba」のSHA-256ハッシュ値。あとで自分の合言葉に変えたら、
// このハッシュ値も new-passphrase.html (このリポジトリに同梱) で作り直して置き換える。
const PASSPHRASE_HASH = "f5856827e89f6f656b6db5ecd70bf385c31bebf89361db93f5519153572d9708";

const STORAGE_KEYS = {
  authed: "furoba_authed",
  token: "furoba_gh_token",
};

// ==== 画面切り替え ====
const screens = {
  gate: document.getElementById("gate-screen"),
  setup: document.getElementById("setup-screen"),
  main: document.getElementById("main-screen"),
};

function showScreen(name) {
  Object.values(screens).forEach((el) => (el.hidden = true));
  screens[name].hidden = false;
}

// ==== ユーティリティ ====
async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function encodeBase64Utf8(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

function decodeBase64Utf8(b64) {
  const binary = atob(b64.replace(/\n/g, ""));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder("utf-8").decode(bytes);
}

function getJstNow() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
}

function getTodayPath() {
  const jst = getJstNow();
  const y = jst.getFullYear();
  const m = String(jst.getMonth() + 1).padStart(2, "0");
  const d = String(jst.getDate()).padStart(2, "0");
  return `${CONFIG.diaryDir}/${y}${m}${d}.md`;
}

function nowHHMM() {
  const jst = getJstNow();
  return `${String(jst.getHours()).padStart(2, "0")}:${String(jst.getMinutes()).padStart(2, "0")}`;
}

function todayLabel() {
  const jst = getJstNow();
  return `${jst.getFullYear()}/${jst.getMonth() + 1}/${jst.getDate()} の日記`;
}

// ==== GitHub Contents API ====
async function fetchTodayFile(token, path) {
  const url = `https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}/contents/${path}?ref=${CONFIG.branch}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
    },
  });
  if (res.status === 404) return { exists: false, content: "", sha: null };
  if (res.status === 401 || res.status === 403) throw new Error("AUTH");
  if (!res.ok) throw new Error(`読み込み失敗(${res.status})`);
  const data = await res.json();
  return { exists: true, content: decodeBase64Utf8(data.content), sha: data.sha };
}

function buildAppendedContent(existingContent, entryLine) {
  if (!existingContent) return entryLine + "\n";
  const trimmed = existingContent.replace(/\n+$/, "");
  return trimmed + "\n\n" + entryLine + "\n";
}

async function saveTodayFile(token, path, newContent, sha, commitMessage) {
  const url = `https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}/contents/${path}`;
  const body = {
    message: commitMessage,
    content: encodeBase64Utf8(newContent),
    branch: CONFIG.branch,
  };
  if (sha) body.sha = sha;
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    if (res.status === 409) throw new Error("CONFLICT");
    if (res.status === 401 || res.status === 403) throw new Error("AUTH");
    throw new Error(`保存失敗(${res.status})`);
  }
  return res.json();
}

// ==== 画面1: 合言葉ゲート ====
const passphraseInput = document.getElementById("passphrase-input");
const gateSubmit = document.getElementById("gate-submit");
const gateError = document.getElementById("gate-error");

async function tryUnlock() {
  const hash = await sha256Hex(passphraseInput.value);
  if (hash === PASSPHRASE_HASH) {
    localStorage.setItem(STORAGE_KEYS.authed, "1");
    gateError.hidden = true;
    routeToNextScreen();
  } else {
    gateError.hidden = false;
  }
}

gateSubmit.addEventListener("click", tryUnlock);
passphraseInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") tryUnlock();
});

// ==== 画面2: トークン設定 ====
const tokenInput = document.getElementById("token-input");
const setupSubmit = document.getElementById("setup-submit");
const setupError = document.getElementById("setup-error");

setupSubmit.addEventListener("click", () => {
  const value = tokenInput.value.trim();
  if (!value) {
    setupError.textContent = "トークンを入力してください";
    setupError.hidden = false;
    return;
  }
  localStorage.setItem(STORAGE_KEYS.token, value);
  showScreen("main");
  loadTodayIntoEditor();
});

document.getElementById("settings-button").addEventListener("click", () => {
  tokenInput.value = localStorage.getItem(STORAGE_KEYS.token) || "";
  showScreen("setup");
});

function routeToNextScreen() {
  const token = localStorage.getItem(STORAGE_KEYS.token);
  if (!token) {
    showScreen("setup");
  } else {
    showScreen("main");
    loadTodayIntoEditor();
  }
}

// ==== 画面3: メモ入力・音声認識 ====
const noteInput = document.getElementById("note-input");
const saveButton = document.getElementById("save-button");
const statusMessage = document.getElementById("status-message");
const todayLabelEl = document.getElementById("today-label");
const micButton = document.getElementById("mic-button");
const liveTranscript = document.getElementById("live-transcript");

todayLabelEl.textContent = todayLabel();

// 今日のファイルのSHA(更新時に必要)。ファイルがまだ無ければ null のまま(=新規作成)。
let currentSha = null;
let editorLoaded = false;
let loadedPath = null; // 読み込んだ時点の「今日」のファイルパス。日付をまたいだ判定に使う
let dateRolloverWarned = false;

function showStatus(text, isError) {
  statusMessage.textContent = text;
  statusMessage.hidden = false;
  statusMessage.style.color = isError ? "var(--error)" : "var(--ok)";
}

async function loadTodayIntoEditor() {
  const token = localStorage.getItem(STORAGE_KEYS.token);
  if (!token) return;
  editorLoaded = false;
  dateRolloverWarned = false;
  noteInput.disabled = true;
  saveButton.disabled = true;
  showStatus("今日の日記を読み込み中...", false);
  try {
    const path = getTodayPath();
    const { exists, content, sha } = await fetchTodayFile(token, path);
    currentSha = sha;
    loadedPath = path;
    noteInput.value = content;
    todayLabelEl.textContent = todayLabel();
    editorLoaded = true;
    if (exists) {
      showStatus("今日の日記を読み込みました。続きを書けます", false);
    } else {
      statusMessage.hidden = true;
    }
  } catch (err) {
    editorLoaded = false;
    if (err.message === "AUTH") {
      showStatus("トークンが無効です。「設定を変える」から入れ直してください", true);
    } else {
      showStatus(`今日の日記の読み込みに失敗しました: ${err.message || err}`, true);
    }
  } finally {
    noteInput.disabled = false;
    saveButton.disabled = false;
  }
}

saveButton.addEventListener("click", async () => {
  if (!editorLoaded) {
    showStatus("今日の日記をまだ読み込めていません。少し待つか、読み込みをやり直してください", true);
    return;
  }
  const path = getTodayPath();
  if (path !== loadedPath) {
    showStatus("日付が変わったようです。保存する前にページを再読み込みしてください(このメモはまだ送信していません)", true);
    return;
  }
  const content = noteInput.value;
  const token = localStorage.getItem(STORAGE_KEYS.token);
  saveButton.disabled = true;
  saveButton.textContent = "保存中...";
  try {
    const result = await saveTodayFile(token, path, content, currentSha, `ふろ場日記: ${nowHHMM()}`);
    currentSha = result.content.sha; // 続けて保存できるよう最新のSHAに更新
    showStatus("保存しました", false);
  } catch (err) {
    if (err.message === "CONFLICT") {
      showStatus("他の端末で更新されたようです。「設定を変える」→ 戻る、で読み込み直してください", true);
    } else if (err.message === "AUTH") {
      showStatus("トークンが無効です。「設定を変える」から入れ直してください", true);
    } else {
      showStatus(err.message || "保存に失敗しました", true);
    }
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = "保存する";
  }
});

// ==== 音声入力 ====
function initSpeech() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    micButton.hidden = true;
    return;
  }
  const recognition = new SR();
  recognition.lang = "ja-JP";
  recognition.continuous = false;
  recognition.interimResults = true;

  let recording = false;

  recognition.addEventListener("result", (e) => {
    const text = Array.from(e.results).map((r) => r[0].transcript).join("");
    liveTranscript.hidden = false;
    liveTranscript.textContent = text;
    if (e.results[e.results.length - 1].isFinal) {
      const entry = `- ${nowHHMM()} ${text}`;
      noteInput.value = buildAppendedContent(noteInput.value, entry);
      liveTranscript.hidden = true;
      liveTranscript.textContent = "";
    }
  });

  recognition.addEventListener("error", (e) => {
    showStatus(`音声認識エラー: ${e.error}(テキスト入力もお使いいただけます)`, true);
    recording = false;
    micButton.classList.remove("recording");
    micButton.textContent = "🎙️ 話す";
  });

  recognition.addEventListener("end", () => {
    recording = false;
    micButton.classList.remove("recording");
    micButton.textContent = "🎙️ 話す";
  });

  micButton.addEventListener("click", () => {
    if (recording) {
      recognition.stop();
    } else {
      recognition.start();
      recording = true;
      micButton.classList.add("recording");
      micButton.textContent = "⏹️ 止める";
    }
  });
}

// ==== 日付をまたいだらタブを開きっぱなしでも気づけるようにする ====
setInterval(() => {
  if (!editorLoaded || dateRolloverWarned || screens.main.hidden) return;
  if (getTodayPath() !== loadedPath) {
    dateRolloverWarned = true;
    showStatus("日付が変わりました。保存する前にページを再読み込みしてください", true);
  }
}, 60000);

// ==== 起動 ====
if (localStorage.getItem(STORAGE_KEYS.authed) === "1") {
  routeToNextScreen();
} else {
  showScreen("gate");
}
initSpeech();
