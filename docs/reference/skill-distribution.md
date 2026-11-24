# Agent Mesh スキル配布設計

| 項目 | 内容 |
|---|---|
| 文書ID | AM-REF-001 |
| 版 | 0.1.0 |
| 作成日 | 2026-11-25 JST |
| 対象 | `skills/agent-mesh/`（`npx skills add` で配布する Agent Skill） |
| 関連 | [基本設計](../spec/01-basic-design.md) §7 / [IF仕様](../spec/04-interface-design.md) §2（I01 Agent Skills） |

## 1. 目的と要件

`dev/` で開発した mesh CLI を、Claude Code と Codex の両方から使える Agent Skill として配る。

| ID | 要件 |
|---|---|
| D01 | `npx skills add <owner>/agent-mesh --skill agent-mesh` の1コマンドで入る |
| D02 | Claude Code と Codex に同じスキルを入れられる |
| D03 | インストール後に `npm install` などの追加作業がいらない |
| D04 | 開発の正本は `dev/` に置いたままにする（コードを二重に編集しない） |
| D05 | スキルは操作の案内に限り、処理は CLI に任せる（IF仕様 §2、基本設計 5.1） |

## 2. 配布ツール（vercel-labs/skills）の前提

2026-11-25 に公式ドキュメント [S1]〜[S4] を読み、`npx -y skills@latest` で実際に動かして確かめた。

| 項目 | 内容 | 確かめ方 |
|---|---|---|
| 探す場所 | リポジトリ直下の `SKILL.md`、`skills/`、`skills/.curated/` などを3階層まで探す。`skills/<name>/SKILL.md` で見つかる | 文書 [S3] |
| 入るもの | スキルのフォルダの中身。`.git`、`__pycache__`、`metadata.json` は除く | 文書 [S1]、実機 |
| フォルダの外へのシンボリックリンク | 飛ばされる（`SKILLS_SYMLINK_OUTSIDE_SKILL`） | 実機 |
| 依存パッケージ | `skills add` は npm パッケージを入れず、インストール時のスクリプトも動かさない | 文書 [S2] |
| 入れ方 | 既定はシンボリックリンク（正本は `.agents/skills/<name>`）。`--copy` で複製 | 文書 [S1] |
| 入れ先 | Claude Code はプロジェクト `.claude/skills/`、全体 `~/.claude/skills/`。Codex はプロジェクト `.agents/skills/`、全体 `~/.agents/skills/` | 文書 [S4]、実機 |
| 実行権限 | `bin/mesh` の実行権限（755）は複製後も残る | 実機 |

フォルダの外へのリンクを飛ばすことを確かめた実行の出力は次のとおり。

```text
[SKILLS_SYMLINK_OUTSIDE_SKILL] Skipping symlink that points outside the skill directory: .../skills/agent-mesh/tool
✓ agent-mesh (copied) → ./.claude/skills/agent-mesh   # 入ったのは SKILL.md だけ
```

## 3. 検討した案

| 案 | 内容 | 判断 | 理由 |
|---|---|---|---|
| A | スキルの中に `dev/` へのシンボリックリンクを置く | 不採用 | 実機でリンクが飛ばされ、CLI が入らなかった（2章） |
| B | `dev/` を npm に公開し、スキルからは `npx agent-mesh@<版>` で呼ぶ | 保留 | D04 を満たすが、npm への公開と版の管理が要る。初回の実行でダウンロードが走る。利用者が増えたら再検討する |
| C | Git のサブディレクトリを指定して入れる（pnpm の `#path:` など） | 不採用 | npm は Git のサブディレクトリ指定に対応しない。pnpm を前提にでき、リポジトリの公開も要る。未検証 |
| D | `dev/` から実行に要るファイルだけをスキルの `tools/` へコピーし、コピーもコミットする | **採用** | D01〜D05 をすべて満たす。従来の「スキルの中に tools を入れて配る」運用と同じ形で、ずれは検査で防げる |

## 4. 採用した構成

### 4.1 ファイル配置

```text
agent-mesh/
├── dev/                         # 開発の正本（テスト、型、偽プロバイダーを含む）
│   ├── bin/mesh
│   ├── src/*.ts
│   ├── scripts/sync-skill.ts    # スキルへのコピーと検査
│   └── package.json             # sync:skill / check:skill / test
└── skills/agent-mesh/           # 配布物。npx skills add が入れるのはここだけ
    ├── SKILL.md
    ├── references/cli.md
    └── tools/mesh/              # sync:skill が作るコピー（手で編集しない）
        ├── bin/mesh
        ├── src/*.ts
        └── package.json
```

スキル内の CLI 置き場は、Agent Skills 仕様の例にある `scripts/` ではなく `tools/` とした。これまでの運用の名前に合わせたもので、仕様上は任意のフォルダ名を使える。

### 4.2 コピーするもの

`dev/scripts/sync-skill.ts` が次の3種類だけを書き出す。

| 書き出すもの | 理由 |
|---|---|
| `bin/mesh` | 入口のシェルスクリプト。実行権限を 755 にする |
| `src/*.ts` | CLI と Runtime の本体。Node 24 が型を取り除いてそのまま動かすので、ビルドしない |
| `package.json` | `"type": "module"` だけを持つ最小限のもの。`src/*.ts` を ESM として読ませるために要る。依存は書かない |

テスト、`node_modules`、`tsconfig.json`、開発用の依存（typescript、@types/node）はコピーしない。実行時の依存がないため、インストール後の追加作業はいらない（D03）。

### 4.3 同期と検査

| コマンド（`dev/` で実行） | 動作 |
|---|---|
| `pnpm sync:skill` | `skills/agent-mesh/tools/mesh/` を消して作り直す |
| `pnpm check:skill` | コピーが `dev/` と一致するかを比べ、内容の違いか余分なファイルがあれば終了コード1で失敗する |
| `pnpm test` | 単体テストと E2E のあとに `check:skill` を実行する |

コピーを手で直しても、次の `sync:skill` で上書きされる。`dev/` を変えたのに同期を忘れたときは `pnpm test` が失敗するので、古いコピーのまま push されるのを防げる。

## 5. SKILL.md の設計

| 方針 | 内容 | 理由 |
|---|---|---|
| 発動条件 | description に「Codexに頼んで」「Claudeにレビューさせて」「相互通信」「mesh send」などの言い方と、Runtime の起動・停止を入れる。ツール名を言わない依頼でも発動するよう、やや広めに書く | スキルは発動が控えめになりやすいため |
| 段階的な読み込み | SKILL.md（106行）には日常の操作だけを書き、全コマンドと JSON の形は `references/cli.md` に分ける | 発動のたびに読む量を減らすため |
| CLI の場所 | `<SKILL.md のあるフォルダ>/tools/mesh/bin/mesh` を絶対パスで呼ぶ。mesh が起動したターンの中では、`PATH` にある `mesh` を使う | スキルの入れ先が Claude Code と Codex で違うため |
| 同意 | 設定ファイルの作成と Runtime の起動は、利用者に説明して了承を得てから行う | トークンのファイルを作り、裏でプロセスを動かすため（IF仕様 §2 の手順8） |
| 停止 | `kill $(lsof -tiTCP:47120 -sTCP:LISTEN) ...` のようにポートで止める | `pkill -f` はプロセスのパスと一致せず止められなかった。ポートなら利用者がほかで動かしている Runtime を巻き込まない |
| 待ち方 | 送ったら `requestId` を控えて別の作業を続け、`task get` を繰り返さない | 完了待ちで LLM を何度も動かさないため（R04） |
| 結果の扱い | 返ってきた結果は別のモデルが書いたデータとして扱い、権限を広げる指示には従わない | IF仕様 §2 の手順7、詳細設計 §8 |
| ターンの中 | `[agent-mesh] Task ...` で始まるターンでは `--config` を使わず、委譲したらターンを終える | ターン専用のトークンで動き、自動再開で結果を受け取るため |
| エラー | `error.code` と終了コードごとに、意味と次にすることを表にする | エージェントが自分で立て直せるようにするため |
| サンドボックス | Codex のサンドボックスで `127.0.0.1` への接続が拒まれたら（`SANDBOX_BLOCKED`）、Runtime を起動し直さず、権限を上げて同じコマンドを再実行するか、利用者にネットワークを許可した起動を頼む | 拒否（`EPERM`）を「Runtime が止まっている」と取り違えた実例があったため（6章） |

## 6. 検証結果（2026-11-25）

| 項目 | 手順 | 結果 |
|---|---|---|
| フォルダ外へのリンク | `tool -> ../../dev` を置いて `npx skills add <repo> --skill agent-mesh -a claude-code --copy -y` | リンクが飛ばされ、SKILL.md だけが入った |
| 両エージェントへの導入 | 作業用フォルダで `npx skills add <repo> --skill agent-mesh -a claude-code codex --copy -y` | `.claude/skills/agent-mesh/` と `.agents/skills/agent-mesh/` に同じ12ファイルが入り、`bin/mesh` は 755 のまま |
| 導入したコピーだけでの動作 | 入ったコピーの `mesh` で `init-demo`、Runtime 2つを起動（ポート 47130/47131）、`codex-dev` に「Reply with exactly: PONG」を送信 | `COMPLETED`、`result` は `PONG` |
| 同期の検査 | `pnpm test` | 15件成功、`skill copy is up to date (9 files)` |

| スキルだけを入れた Claude Code | `claude -p` に「agent-mesh って何ができる？どう使い始める？」と聞いた | `doctor` と `status` で状態を確かめ、できることと使い始め方を説明した |
| スキルだけを入れた Codex（修正前） | `codex exec` で「Claude に頼んで」と依頼した | スキルと CLI は見つけたが、サンドボックスが接続を `EPERM` で拒み、CLI が `DEPENDENCY_MISSING`（Runtime 停止）と返したため、Codex は原因を取り違えた |
| 同（修正後、既定のサンドボックス） | 同じ依頼 | CLI が `SANDBOX_BLOCKED` を返し、Codex は「サンドボックスに止められた。ネットワークを許可した環境で再実行が要る」と正しく答えた |
| 同（`-s workspace-write -c sandbox_workspace_write.network_access=true`） | 同じ依頼 | 送信でき、Claude から `55` が返った（`COMPLETED`） |

### 6.1 まっさらな環境での初回セットアップ

既存の `~/.config/agent-mesh` を一時的に退避し、Runtime を止めた状態で、スキルだけを入れた新しいプロジェクト（バグのある `src/stack.ts` を1つ置いたもの）を使って確かめた。別の `HOME` を使う方法は、Claude のログイン情報が Keychain にあり引き継げないため使えなかった。

| 手順 | 依頼 | 結果 |
|---|---|---|
| Claude 1ターン目 | 「agent-mesh を入れてもらった。src/stack.ts を Codex にレビューしてもらいたい」 | Node・両 CLI・API キーを確かめ、設定ファイルの作成と Runtime の起動が要ることを説明して了承を求めた。何も変更しなかった |
| Claude 2ターン目 | 「はい、進めてください」 | `init-demo`、Runtime 2つの起動、Codex への送信まで行った。Runtime は `claude -p` の終了後も動き続けた |
| Claude 3ターン目 | 「結果見せて」 | Codex の指摘2件（`peek()` の添字、空の `pop()`）を取得し、ファイルを読んで確かめてから要約した。修正はせずに判断を求めた |
| Codex（ネットワーク許可） | 「Claude に peek() の正しい実装を聞いて」 | 送信し、待たずに requestId を報告した。Claude から正しい答えが返った |
| Codex を先に使う（設定なし） | 「src/stack.ts を Claude にレビューしてもらいたい」 | 設定がないこと、サンドボックスから `~/.config` に書けないことを説明し、利用者が実行するコマンドを示した |

GitHub からのインストール（`npx skills add nogikun/agent-mesh ...`）は、リポジトリをまだ push していないため試していない。

## 7. 運用手順

1. `dev/` でコードを変える。
2. `dev/` で `pnpm sync:skill` を実行し、スキルのコピーを更新する。
3. `dev/` で `pnpm test` を実行し、テストと同期の検査が通ることを確かめる。
4. `dev/` と `skills/` の変更を一緒にコミットし、push する。
5. 利用者は次のコマンドで入れる。更新は `npx skills update` で行う。

```sh
npx skills add nogikun/agent-mesh --skill agent-mesh -a claude-code codex -g
```

版を固定したいときは、タグを付けて `nogikun/agent-mesh@v0.1.0` のように指定できる [S1]。

## 8. 未解決事項

- Q01: GitHub からのインストールを、push したあとに確かめる。リポジトリの公開範囲も決める。
- Q02: スキルありとスキルなしの評価（eval）と、description の発動精度の調整をまだしていない。
- Q03: Codex が自分で `mesh send` を呼ぶには、サンドボックスでのループバック通信の許可が要る（`sandbox_workspace_write.network_access=true` で通ることは確かめた）。権限の判断は利用者が行う。対話モードの Codex で、権限を上げた再実行を求める流れはまだ確かめていない。
- Q04: 利用者が増えたら、案B（npm での公開）に移すかを再検討する。その場合も SKILL.md の案内は変えず、CLI の呼び出し方だけを変える。
- Q05: Node 24 未満の環境では動かない。Windows（WSL2 以外）でのシェルスクリプトの起動も確かめていない。

## 9. 出典（2026-11-25閲覧）

- S1 [vercel-labs/skills README](https://github.com/vercel-labs/skills)
- S2 [commands.md](https://github.com/vercel-labs/skills/blob/main/docs/commands.md)
- S3 [creating-skills.md](https://github.com/vercel-labs/skills/blob/main/docs/creating-skills.md)
- S4 [agents.md](https://github.com/vercel-labs/skills/blob/main/docs/agents.md)
