// ==== バージョン ====
// 更新するたびに数字を増やす。画面ごとに表示され、
// 「今開いている画面が最新のコードかどうか」を目で確認できるようにするためのもの。
// メモ入力画面はtextareaが長くスクロールしないと下の表示が見えないため、
// class="version-footer" が付いた要素すべてに書き込む(複数箇所に表示する)。
// (このscriptタグはdeferなのでDOMは既にパース済み。素直に書き込んでよい)
const APP_VERSION = "v12 (2026-08-26)";
document.querySelectorAll(".version-footer").forEach((el) => {
  el.textContent = APP_VERSION;
});

// ==== 設定 ====
const CONFIG = {
  owner: "Nabetoshi",
  repo: "Obsidian_Vault",
  branch: "main",
  diaryDir: "Diary",
};

// 合言葉のSHA-256ハッシュ値。変えたい時は new-passphrase.html (このリポジトリに同梱)
// で作り直して置き換える。
const PASSPHRASE_HASH = "77ba1e13197ae9cc08a59d7ce11f2a6ed36b6d60a81a8db7c72b89a78db6885e";

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

// 日付は "20260824" 形式(dateStr)と、<input type="date">用の "2026-08-24" 形式(iso)の
// 2種類を行き来する。ファイルパスは常にdateStr、カレンダー部品の値は常にiso。
function dateStrToday() {
  const jst = getJstNow();
  const y = jst.getFullYear();
  const m = String(jst.getMonth() + 1).padStart(2, "0");
  const d = String(jst.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function pathForDateStr(dateStr) {
  return `${CONFIG.diaryDir}/${dateStr}.md`;
}

function dateStrToIso(dateStr) {
  return `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
}

function isoToDateStr(iso) {
  return iso.replace(/-/g, "");
}

function nowHHMM() {
  const jst = getJstNow();
  return `${String(jst.getHours()).padStart(2, "0")}:${String(jst.getMinutes()).padStart(2, "0")}`;
}

function dateLabelForStr(dateStr) {
  const y = Number(dateStr.slice(0, 4));
  const m = Number(dateStr.slice(4, 6));
  const d = Number(dateStr.slice(6, 8));
  return `${y}/${m}/${d} の日記`;
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
    // 409だけでなく422も「他で更新されていた」時にGitHub側が返すことがある
    // (例: こちらは「まだ無い」と思っていたファイルが実は既にできていた場合)。
    // どちらも同じ「競合」として扱い、書きかけの内容を守る処理につなげる。
    if (res.status === 409 || res.status === 422) throw new Error("CONFLICT");
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
  // 書きかけの内容(保存に失敗した分など)があるときは、ここで読み込み直すと消えてしまうため触らない。
  // 初めて開いた時や、書きかけが無い時だけ読み込む(=トークンを入れ直した後の再読み込みは行う)。
  if (!editorLoaded || !dirty) {
    loadDateIntoEditor(dateStrToday());
  }
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
    loadDateIntoEditor(dateStrToday());
  }
}

// ==== 画面3: メモ入力・音声認識 ====
const noteInput = document.getElementById("note-input");
const saveButton = document.getElementById("save-button");
const statusMessage = document.getElementById("status-message");
const todayLabelEl = document.getElementById("today-label");
const micButton = document.getElementById("mic-button");
const liveTranscript = document.getElementById("live-transcript");
const datePicker = document.getElementById("date-picker");
const todayJumpButton = document.getElementById("today-jump-button");

// 今読み込んでいる日のファイルのSHA(更新時に必要)。ファイルがまだ無ければ null(=新規作成)。
let currentSha = null;
let editorLoaded = false;
let loadedPath = null; // 読み込んだ時点のファイルパス
let selectedDateStr = null; // 今カレンダーで選ばれている日("20260824"形式)
let loadedWasToday = false; // 読み込んだ時点で「今日」だったか(日付またぎの自動切り替え判定用)
let dateRolloverWarned = false;
let dirty = false; // 保存していない書きかけの内容があるか
let loadedContent = ""; // 読み込んだ時点の内容(コンフリクト時の自動マージに使う)

noteInput.addEventListener("input", () => {
  dirty = true;
});

function showStatus(text, isError) {
  statusMessage.textContent = text;
  statusMessage.hidden = false;
  statusMessage.style.color = isError ? "var(--error)" : "var(--ok)";
}

async function loadDateIntoEditor(dateStr) {
  const token = localStorage.getItem(STORAGE_KEYS.token);
  if (!token) return;
  editorLoaded = false;
  dateRolloverWarned = false;
  noteInput.disabled = true;
  saveButton.disabled = true;
  noteInput.placeholder = "読み込み中...";
  showStatus("読み込み中...", false);
  try {
    const path = pathForDateStr(dateStr);
    const { exists, content, sha } = await fetchTodayFile(token, path);
    currentSha = sha;
    loadedPath = path;
    selectedDateStr = dateStr;
    loadedWasToday = dateStr === dateStrToday();
    noteInput.value = content;
    loadedContent = content;
    noteInput.placeholder = "思いついたことを書く、または下の「話す」ボタンで話しかけてください";
    todayLabelEl.textContent = dateLabelForStr(dateStr);
    datePicker.value = dateStrToIso(dateStr);
    dirty = false;
    editorLoaded = true;
    if (exists) {
      showStatus("この日の日記を読み込みました。続きを書けます", false);
    } else {
      showStatus("この日の日記はまだありません。ここが最初の1行になります", false);
    }
  } catch (err) {
    editorLoaded = false;
    noteInput.placeholder = "読み込みに失敗しました。下のメッセージを確認してください";
    if (err.message === "AUTH") {
      showStatus("トークンが無効です。「設定を変える」から入れ直してください", true);
    } else {
      showStatus(`日記の読み込みに失敗しました: ${err.message || err}`, true);
    }
  } finally {
    noteInput.disabled = false;
    saveButton.disabled = false;
  }
}

datePicker.addEventListener("change", () => {
  if (!datePicker.value) return;
  if (dirty && !confirm("保存していない内容があります。このまま移動すると消えます。移動しますか?")) {
    datePicker.value = dateStrToIso(selectedDateStr);
    return;
  }
  loadDateIntoEditor(isoToDateStr(datePicker.value));
});

todayJumpButton.addEventListener("click", () => {
  if (dirty && !confirm("保存していない内容があります。このまま移動すると消えます。移動しますか?")) {
    return;
  }
  loadDateIntoEditor(dateStrToday());
});

saveButton.addEventListener("click", async () => {
  if (!editorLoaded) {
    showStatus("この日の日記をまだ読み込めていません。少し待つか、読み込みをやり直してください", true);
    return;
  }
  // 「今日」を開いたままタブを開きっぱなしで日付をまたいだ場合も、読み込んだ時のファイル
  // (=書いていた日)にちゃんと保存する。過去の日を選んで編集している時はこの判定はしない。
  const pathToSave = loadedPath;
  const isRollover = loadedWasToday && dateStrToday() !== selectedDateStr;
  const content = noteInput.value;
  const token = localStorage.getItem(STORAGE_KEYS.token);
  saveButton.disabled = true;
  saveButton.textContent = "保存中...";
  try {
    const result = await saveTodayFile(token, pathToSave, content, currentSha, `ふろ場日記: ${nowHHMM()}`);
    currentSha = result.content.sha; // 続けて保存できるよう最新のSHAに更新
    dirty = false;
    if (isRollover) {
      showStatus("保存しました。日付が変わったので今日の日記に切り替えます...", false);
      await loadDateIntoEditor(dateStrToday());
    } else {
      showStatus("保存しました", false);
    }
  } catch (err) {
    if (err.message === "CONFLICT") {
      await handleConflict(token, pathToSave, content);
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

// 他の端末で先に更新されていて保存できなかった時の処理。
// 書きかけの内容を消さず、可能なら自動で合体させる。
async function handleConflict(token, path, myContent) {
  try {
    const latest = await fetchTodayFile(token, path);
    if (myContent === latest.content) {
      // 中身は結局同じだった(相手が同じ内容を保存しただけ等)。番号だけ揃えれば解決。
      currentSha = latest.sha;
      loadedContent = latest.content;
      dirty = false;
      showStatus("他の端末の保存と内容が同じだったので、そのまま最新として扱いました", false);
      return;
    }
    if (myContent.startsWith(loadedContent)) {
      // 自分は「追記」しかしていない場合、その追記分を最新の内容の末尾にくっつける。
      const added = myContent.slice(loadedContent.length);
      const base = latest.content.replace(/\n+$/, "");
      const merged = added.trim()
        ? (base ? base + "\n\n" + added.replace(/^\n+/, "") : added)
        : latest.content;
      noteInput.value = merged;
      currentSha = latest.sha;
      loadedContent = latest.content;
      dirty = true;
      showStatus("他の端末の更新と、あなたが書いた分を自動で合体しました。内容を確認して、もう一度「保存する」を押してください", true);
    } else {
      // 追記だけではなく途中を書き換えていた等、安全に自動合体できないケース。
      // 何も上書きせず、今書いている内容はそのまま画面に残す。
      showStatus("他の端末で更新されていて自動では合体できませんでした。今書いている内容は消していません。念のため今の内容をどこかにコピーしてから、「今日」ボタンで読み込み直してください", true);
    }
  } catch (fetchErr) {
    showStatus("他の端末で更新されたようですが、最新の内容を確認できませんでした。今書いている内容は消していません: " + (fetchErr.message || fetchErr), true);
  }
}

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
      noteInput.value = buildAppendedContent(noteInput.value, text);
      dirty = true;
      noteInput.scrollTop = noteInput.scrollHeight;
      noteInput.setSelectionRange(noteInput.value.length, noteInput.value.length);
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
  if (!editorLoaded || !loadedWasToday || dateRolloverWarned || screens.main.hidden) return;
  if (dateStrToday() !== selectedDateStr) {
    dateRolloverWarned = true;
    showStatus("日付が変わりました。保存すると自動で今日の日記に切り替わります", false);
  }
}, 60000);

// ==== 起動 ====
if (localStorage.getItem(STORAGE_KEYS.authed) === "1") {
  routeToNextScreen();
} else {
  showScreen("gate");
}
initSpeech();
