# Muse Custom Connector 接続試験 報告

| 項目 | 内容 |
|---|---|
| 文書ID | AM-RPT-001 |
| 実施日 | 2026-11-26 JST |
| 対象 | `mesh connector`（`dev/src/connector.ts`）を Meta Muse の Custom Connector として使う |
| ブランチ | `feat/muse-connector` |
| 関連 | [適用ガイド](../reference/muse-connector.md)（AM-REF-003） / [IF仕様](../spec/04-interface-design.md) §7 |

tailnet の名前、IP アドレス、利用者の名前は伏せて書く（`<mac>.<tailnet>.ts.net`、`100.x.x.x`、`<利用者>`）。

## 1. 結論

**Muse の Custom Connector から、インターネットに公開せず tailnet の中だけで agent-mesh を使えた。** Muse は Codex に2件の依頼を送り、どちらも `COMPLETED` で結果を受け取った。

適用ガイドで未確認としていた「Custom Connector の通信が tailnet を通るか」（Q01〜Q03 に関わる点）は、通ることを実機で確かめた。

## 2. 構成

```text
Muse（Tailscale コネクターで tailnet に参加したノード、tag:muse）
  │  https://<mac>.<tailnet>.ts.net/mcp （tailnet の中だけ）
  ▼
tailscale serve（443 → 127.0.0.1:47140、tailnet only）
  ▼
Connector Gateway（MCP、127.0.0.1:47140、API キーで認証）
  ▼ connector 専用トークン
Runtime host-a（127.0.0.1:47120） ──A2A──▶ Runtime host-b（127.0.0.1:47121） ──▶ Codex CLI（read-only サンドボックス）
```

| 要素 | 設定 |
|---|---|
| Tailscale | 1.104.4（macOS アプリ）。HTTPS 証明書を有効化 |
| Muse のノード | Muse の Tailscale コネクターで参加。`tag:muse` を付与 |
| ACL | 自分の機器（`autogroup:member`）は全部許可、`tag:muse` はこの Mac の `tcp:443` だけ。`tests` で 443 に届き、22・47120・47140 に届かないことを保存のたびに確かめる |
| コネクター | id `muse`、使えるエージェントは `codex-dev` だけ。最初は読み取り専用、途中で書き込みを許可 |
| Codex | `sandbox_mode="read-only"`（変更なし） |

## 3. 経過

| 時刻（JST） | 出来事 | 結果 |
|---|---|---|
| 22:0x | この Mac の Tailscale が停止していた（`WantRunning: false`） | 利用者が接続 |
| 22:1x | Muse のノードにタグがなく、ACL が既定の全部許可（`src: *`）だった | ポリシーを書き換え、`tag:muse` を付与 |
| 22:1x | `tailscale serve --bg 47140` | `(tailnet only)` で公開。この Mac から HTTPS で `tools/list` が 200、キーなしで 401 |
| 22:2x | Muse に Custom Connector の作成を依頼 | 最初の要求は 401（キーなし） |
| 22:2x | 2回目の要求 | 401。`Authorization: Bearer` で届いたが値が違った |
| 22:2x | 3回目の要求 | 401。届いた値は332文字（本物のキーは43文字） |
| 22:2x | 4回目以降 | `initialize`、`tools/list`、`mesh_list_agents` が成功 |
| 22:3x | Muse が「送信のツールがない」と報告 | 読み取り専用のため。API キーはそのままで書き込みを許可 |
| 22:31 | Muse が `mesh_submit_task`（ASCII アートの顔を描くプログラムを作って実行する依頼） | 約1分で `COMPLETED`。read-only のためファイルは作れず、Codex はその旨とアートを返した |
| 22:38 | Muse が2件目を送信（Codex への自己紹介と質問） | `COMPLETED`。Codex が自己紹介と得意なことを答えた |
| 22:4x | サーバーを停止 | `tailscale serve` を解除、Gateway と Runtime 2つを停止 |

Codex から Muse への返事（2件目、抜粋）:

> こんにちは、Mee！私は Codex、OpenAI のコーディングエージェントです。今は <利用者> さんの環境で、`agent-mesh/dev` ディレクトリを作業場所として動いています。

## 4. 分かったこと

### 4.1 Custom Connector の通信は tailnet を通る

Muse の Tailscale コネクターで Muse が tailnet に参加していれば、Custom Connector に tailnet の中だけの URL（`tailscale serve`）を指定して使える。Funnel や Cloudflare Tunnel でインターネットに公開する必要はなかった。

### 4.2 最初の接続では、キーの代わりに332文字の値が届いた

Muse は `Authorization: Bearer` でキーを送ってきたが、最初の数回は本物のキー（43文字）ではなく、332文字の値が届いた。その後、Muse がつなぎ直したあとは正しいキーで認証できた。332文字の値が何だったかは分かっていない（Muse の資格情報の保管庫が使う代わりの値の可能性がある）。

この切り分けのため、Gateway の 401 のログに「どのヘッダーで届いたか」「受け取った値の長さ」を出すようにした。キーの値そのものはログに出さない。

### 4.3 ACL が既定のままだと Muse の届く範囲が広すぎた

Tailscale の既定のポリシー（`src: *`、`dst: *`、`ip: *`）のままだと、タグのない Muse のノードは、tailnet にあるすべての機器（ルーターや仮想化基盤を含む）のすべてのポートに届き得た。Muse は機器ごとに接続の承認を求めるが、承認の単位はホストで、ポートではない。

`tag:muse` を付け、grant を `autogroup:member` と `tag:muse`（この Mac の `tcp:443` だけ）に分けて絞った。grants は許可を足していく方式なので、`*` を送り元にした規則が1つでも残っていると絞れない。

### 4.4 Tailscale Serve は本当の送信元の IP を渡す

一時的な Serve（8443番）で確かめた。`X-Forwarded-For` に偽の値を付けて送ると、Serve が本当の tailnet の IP で上書きした。自分の機器からの要求には `Tailscale-User-Login` などの身元のヘッダーも付く。API キーが使えないときは、送信元の IP を `tailscale whois` で調べてタグで確かめる方式に切り替えられる（今回は API キーで通ったので実装していない）。

### 4.5 読み取り専用の制限は効いた

Muse が「プログラムを作って実行して」と頼んだが、Codex は read-only サンドボックスのためファイルを作れず、そう報告した。Codex が「端末に表示した」アートは Codex のサンドボックスの中での出力で、利用者の画面には出ていない。

実際にファイルを作らせるなら、`codex-dev` 専用の作業フォルダを作り、そこだけ `workspace-write` を許す必要がある。今の作業フォルダは `agent-mesh/dev` そのものなので、そのまま書き込みを許すと、このリポジトリのコードを書き換えられる。

### 4.6 Codex にとって依頼は1件ごとに別の会話になる

Codex は2件目で「羊の顔を作ったやり取りは見えていない」と答えた。受け取った依頼ごとに新しい Codex のセッションを始めるため、前の依頼の続きにはならない。続けて頼む使い方には、A2A の `contextId` などで依頼を同じセッションにつなぐ機能が要る。

### 4.7 Muse の振る舞い

- 読み取り専用のコネクターで送信のツールがないことに気づき、理由（サーバーの案内文は送信できる前提で書かれていた）まで報告した。案内文は、読み取り専用のときに送信に触れないよう直した。
- 代わりの案として、Muse の仮想マシンに mesh を組んで Codex を動かす方法を出してきた。これは利用者の Mac の外で Codex を動かすことになるので採らなかった。
- 結果を待ち続けず、あとで `mesh_get_task` を呼んで確かめた（完了を待つために LLM を動かさない、という設計どおり）。
- Streamable HTTP の要求ごとに `initialize` からやり直し、`tools/list` も何度も取得した。

## 5. 今回変えたコード

| ファイル | 変更 |
|---|---|
| `dev/src/connector.ts` | 400番台の応答と POST 以外の要求をログに出す（メソッド、パス、状態コードだけ） |
| 同 | 401 のとき、届いた認証らしいヘッダーの名前、方式、値の長さをログに出す（値は出さない） |
| 同 | 読み取り専用のコネクターでは、案内文で送信と取消に触れない |
| `skills/agent-mesh/tools/mesh/` | `pnpm sync:skill` で上の変更をコピー |

`pnpm test` は19件すべて成功した。

## 6. 試験後の状態

| 項目 | 状態 |
|---|---|
| `tailscale serve` | 解除した（`No serve config`） |
| Gateway、Runtime 2つ | 停止した。tailnet の URL は応答しない |
| Tailscale の接続 | つないだまま |
| ACL | 変更後のまま（`tag:muse` はこの Mac の 443 だけ。今は何も待ち受けていない） |
| コネクター `muse` | `~/.config/agent-mesh/host-a.json` に書き込みできる設定のまま残る。Muse は同じ API キーを持っている |

しばらく使わないなら、同じ `--id` で `mesh connector add` を実行してキーを作り直すか、設定ファイルからコネクターを消す。

## 7. 次の課題

- キーの代わりに届いた332文字の値の正体を確かめる。再接続や時間の経過で再び起きるかを見る。
- 依頼を同じ Codex のセッションにつなぐ機能（4.6）。
- Codex にファイルを作らせる場合の、専用の作業フォルダと `workspace-write` の設定（4.5）。
- 適用ガイド（AM-REF-003）に、tailnet だけで使う手順（Tailscale コネクター、Serve、ACL）を書き足す。
- トークンを OS の資格情報ストアに移す（Issue #2）。
