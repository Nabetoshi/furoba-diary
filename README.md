# ふろ場日記

風呂場でも思いついたことをすぐメモできるWebアプリ。音声かテキストで書いた内容を、Obsidian Vaultの `Diary/YYYYMMDD.md`(今日の日記)にそのまま追記します。

- 使う画面: このリポジトリをGitHub Pagesで公開したURL(スマホのホーム画面に追加しておくと便利)
- 保存先: `Nabetoshi/Obsidian_Vault` リポジトリの `Diary/` フォルダ
- 音声入力はAndroid Chromeで動作。iPhoneのSafariは非対応だが、iOS標準キーボードのマイクボタンで代用可能

## 最初の設定(1回だけ)

### 1. GitHubのアクセス用トークンを発行する

1. GitHub右上のアイコン → **Settings** → 左メニュー一番下 **Developer settings**
2. **Personal access tokens** → **Fine-grained tokens** → **Generate new token**
3. Token name: `furoba-diary` など分かる名前
4. Expiration: 90日〜1年など、期限を設定(無期限は選べないことが多い)
5. Resource owner: 自分のアカウント
6. Repository access: **Only select repositories** → `Obsidian_Vault` を選択
7. Permissions → Repository permissions → **Contents: Read and write** に設定。他はすべて「No access」のまま
8. **Generate token** → 表示された文字列をコピー(この画面を閉じると二度と表示されないので注意)

### 2. アプリを開いて設定する

1. アプリのURLを開く(初回は合言葉の入力を求められます。仮の合言葉は `furoba`)
2. 「トークンを貼り付けて保存」の画面が出るので、1で発行した文字列を貼り付けて保存
3. 以後はこの端末では自動でログインされます

### 3. 合言葉を自分のものに変える

初期状態の合言葉は仮の `furoba` です。必ず自分の合言葉に変えてください。

1. `new-passphrase.html` をブラウザで開く(このリポジトリの同じ場所にあります)
2. 新しい合言葉を入力して「ハッシュ値を作る」を押す
3. 出てきた文字列をコピーし、`app.js` の `PASSPHRASE_HASH` の値と入れ替える
4. GitHubにcommit・pushすれば数十秒でサイトに反映されます

※ この合言葉は「他人が偶然URLを開いても中身が見えない」程度の簡易ロックです。ソースコードが公開されているため、本気で狙われた場合の強度はありません。本当に守るべきGitHubのトークンは、このロックとは別に、各自のブラウザ内にのみ保存されます。

## トークンの期限が切れたら

アプリ内で「トークンが無効です」と出たら、GitHubで新しいトークンを発行し、アプリの「設定を変える」ボタンから入れ直してください。
