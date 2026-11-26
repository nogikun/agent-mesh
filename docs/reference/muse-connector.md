# Muse Custom Connector 適用ガイド

| 項目 | 内容 |
|---|---|
| 文書ID | AM-REF-003 |
| 版 | 0.1.0 |
| 作成日 | 2026-11-26 JST |
| 対象 | `mesh connector`（`dev/src/connector.ts`）を Meta Muse の Custom Connector として使う |
| 関連 | [IF仕様](../spec/04-interface-design.md) §7 / [セットアップガイド](../../connectors/muse/setup-guide.md) / [ツールカタログ](../../connectors/muse/tool-catalog.md) |

## 1. 結論

**この実装で Muse の Custom Connector として使える見込みが高い。ただし、次の3つが前提になる。**

1. Muse のアカウントがあること。提供地域は米国（とカナダ）と報告されているが、利用者のアカウントでは Muse を使えることを確かめた（2026-11-26、利用者の申告。3.4）。
2. Gateway をインターネットから HTTPS で届くようにすること。Muse は Meta のクラウドから接続するので、localhost のままでは届かない（3.2）。
3. 認証は API キー（`Authorization: Bearer`）で行うこと。この実装は API キーに対応していて、調べた資料でもいちばん安定する方法とされている。OAuth には対応していない（3.3）。

Meta 公式のヘルプページ（How Muse works with Connectors）は、自動取得では題名しか返らず、本文を読めなかった。以下の Custom Connector の仕様は、2026年9〜11月に公開された第三者のガイド5本と、Meta の開発者向けガイドライン・規約から整理したものである。実際の Muse の画面で確かめるまでは「見込み」として扱う。

## 2. 調べた資料

| 資料 | 種類 | 読めたか |
|---|---|---|
| Meta Help Center「How Muse works with Connectors」[M1] | Meta 公式 | 題名だけ（3つの URL で試したが本文は返らなかった） |
| Muse Connector guidelines [M2] | Meta 公式（開発者向け） | 読めた（2026-11-24） |
| Muse Connector Terms [M3] | Meta 公式（規約） | 読めた（2026-11-24） |
| crosswalk [T1]、superagnt [T2]、Parallel [T3]、tokenrip [T4]、AnythingMCP [T5] | 第三者のガイド | 読めた |

第三者の資料どうしで食い違う点は、表の中に「食い違い」と書いた。

## 3. 仕様と、この実装との照合

### 3.1 追加のしかた

| 項目 | 資料に書かれていること | この実装 |
|---|---|---|
| 追加する場所 | チャットで Muse に頼んで作らせる [T1][T3][T4]。食い違い: 設定画面の「Add custom connector」から URL を入れるという資料もある [T5]。その項目は一部のアカウントにしか出ず、最近のアプリのバージョンでは消えたという報告もある [T2] | どちらの経路でも、渡すのは URL と認証情報なので影響はない |
| 渡す情報 | MCP サーバーの URL、トランスポート（Streamable HTTP）、認証方式、名前 [T1][T2][T5] | URL は `https://<公開URL>/mcp`、トランスポートは Streamable HTTP |
| 資格情報の入力 | チャットに貼らず、Muse の安全な資格情報の入力欄（Secure Credentials Store）に入れる [T1][T2][T3][T4]。Meta は鍵をエージェントの外に保管し、ネットワークのエッジで代わりのトークン（stand-in token）と入れ替えるとされる [T1] | API キーは `mesh connector add` が作る。チャットに貼らない |
| Meta の審査 | Custom Connector は審査されない [T1][T3][T4][T5]。公式ディレクトリへの掲載は別の手続きで、審査がある [M2] | 個人で使う範囲なら審査は不要 |
| 誰が使えるか | 作った人の Muse に保存され、ほかの人はそれぞれ自分で作る [T1] | Gateway はコネクターごとに API キーを分けている |

### 3.2 トランスポートとネットワーク

| 項目 | 資料に書かれていること | この実装 | 判定 |
|---|---|---|---|
| トランスポート | Streamable HTTP [T1][T2][T3][T5]。SSE に触れた資料はない | Streamable HTTP（POST、JSON 応答、セッションなし）。GET は 405（サーバーからのストリームを出さないことは MCP の仕様で認められている） | 合う |
| 公開 | 公開 HTTPS の URL が要る [T1][T2][T5]。localhost やプライベートネットワークは届かない [T1][T2][T3] | 127.0.0.1 で待ち受ける。公開の入口は利用者が用意する（4.3） | 前提あり |
| Origin | 資料に記述なし | ブラウザからの Origin は既定で拒否する。拒否した値はログに出る | 未確認（4.5） |

### 3.3 認証

| 項目 | 資料に書かれていること | この実装 | 判定 |
|---|---|---|---|
| API キー | 使える。`Authorization: Bearer` ヘッダーで渡す [T1][T2][T3][T4]。いちばん安定する方法とされる [T1][T3] | `Authorization: Bearer <apiKey>` で認証する | 合う |
| OAuth | 食い違い: OAuth が前提とする資料 [T5]、Bearer は安定するが OAuth はやり取りが増えるとする資料 [T1][T3]、OAuth でクライアント ID を求められる、トークンが約1時間で切れるという報告 [T2]。公式ガイドラインは「OAuth client credentials or an API key」とする [M2] | 対応していない。API キーで足りる | 不要 |

### 3.4 アカウントと地域

| 項目 | 資料に書かれていること |
|---|---|
| 提供地域 | 開始時は米国のみ、成人のみ [T3]。米国とカナダ [T5]。日本に触れた資料はない |
| 料金 | 大半は無料。Power 月20ドル、Maximum 月100ドル。無料でも支払いカードの登録が要る [T3] |

利用者のアカウントでは Muse を使えることを確かめた（2026-11-26、利用者の申告）。Custom Connector を実際に作れるかは、4.4 の手順で確かめる。

### 3.5 ツールの許可と制限

| 項目 | 資料に書かれていること | この実装 |
|---|---|---|
| 許可 | 設定の Permissions で、コネクターを読み取り専用にする、操作ごとに許可を求める、許可する、を選べる [T2][T3] | `--read-only` のコネクターは送信と取消のツールを出さない |
| 分類 | 公式ディレクトリは Read / Write / Sensitive write に分類する [M2]。Custom Connector にも当てはまるかは書かれていない [T2] | 分類の提案は [ツールカタログ](../../connectors/muse/tool-catalog.md) にある |
| 件数・サイズ・時間の制限 | 記述なし | 送信はすぐに返るので、Muse 側の待ち時間の制限にかかりにくい |

### 3.6 外部からの起動

外部から Muse を起こす（結果が届いたら Muse が自動で続きを始める）仕組みは、どの資料にもない。Muse から呼ぶだけで、Muse を起こすことはできない。この実装でも、結果は Muse が `mesh_get_task` で読みにいく。設計書の ADR-08、F13 と同じ扱いである。

## 4. 適用手順

### 4.1 前提を確かめる

- Muse にログインでき、チャットで Custom Connector を作れる（3.4）
- agent-mesh の Runtime が動いている（README の「セットアップ」）
- 公開の入口に使う道具がある。この Mac には `cloudflared` 2025.1.0、`tailscale` 1.104.4、`ngrok` 3.25.1 が入っている

### 4.2 コネクターを作り、Gateway を起動する

```sh
cd dev
./bin/mesh connector add --config ~/.config/agent-mesh/host-a.json --id muse --peers codex-dev
kill $(lsof -tiTCP:47120 -sTCP:LISTEN)
nohup ./bin/mesh runtime --config ~/.config/agent-mesh/host-a.json >> ~/.config/agent-mesh/host-a.log 2>&1 &
./bin/mesh connector serve --config ~/.config/agent-mesh/host-a.json --id muse
```

- `--peers` で Muse が使えるエージェントを絞る。最初は1つにしておくと確かめやすい。
- 最初は `--read-only` で作り、一覧と結果の取得だけで動きを見てから、送信できるコネクターに作り直してもよい。
- 出力の `apiKey` は 4.4 で Muse に入れる。チャットやドキュメントには貼らない。
- Runtime は起動時に設定を読むので、コネクターを足したら再起動する。

### 4.3 インターネットから届くようにする

公開すると、Gateway の API キーだけが防御になる。どの方法を使うかは利用者が決める。

| 方法 | コマンド | 特徴と注意 |
|---|---|---|
| Cloudflare の一時トンネル | `cloudflared tunnel --url http://127.0.0.1:47140` | アカウントなしで `https://<ランダム>.trycloudflare.com` が出る。起動するたびに URL が変わるので、試すとき向け |
| ngrok | `ngrok http 47140` | ngrok のアカウントが要る |
| Tailscale Funnel | `tailscale funnel 47140` | 設計書では既定で禁止（公開インターネットに出るため）。使うなら明示的に決める |

どの方法でも、Gateway は 127.0.0.1 で待ち受けたまま、HTTPS はトンネルの側で終端する。Muse に入れる URL は出てきた公開 URL の末尾に `/mcp` を付けたものになる。

公開したら、手元のネットワークの外から届くかを確かめる。API キーは環境変数で渡し、コマンドの履歴に残さない。

```sh
export MESH_KEY='<apiKey>'   # 確認が済んだら unset MESH_KEY
curl -s https://<公開URL>/mcp \
  -H "Authorization: Bearer $MESH_KEY" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

ツールの一覧が JSON で返れば届いている。キーなしで呼んで 401 が返ることも確かめる。

### 4.4 Muse で Custom Connector を作る

Muse のチャットで次のように頼む（英語の例。Muse の提供地域に合わせた）。

```text
Please build a custom connector named "Agent Mesh".
It is a remote MCP server over Streamable HTTP at https://<public-url>/mcp.
It takes my API key as an Authorization: Bearer header.
I will enter the key in the secure credentials prompt, not in this chat.
It lets you delegate tasks to my AI coding agents and read their results.
```

- 資格情報の入力欄が出たら、4.2 の `apiKey` を入れる。チャットには貼らない。
- 設定画面に「Add custom connector」があるアカウントなら、そこに同じ URL と API キーを入れてもよい（3.1）。

### 4.5 動きを確かめる

1. 「Agent Mesh で使えるエージェントを一覧して」と頼み、`mesh_list_agents` が呼ばれて `codex-dev` が出るかを見る。
2. 「codex-dev に、Reply with exactly: PONG と頼んで」と頼み、`taskId` が返るかを見る。
3. 少し待ってから「さっきのタスクの結果を見せて」と頼み、`PONG` が返るかを見る。
4. Gateway のログ（`connector serve` の端末）に `initialize`、`tools/list`、`tools/call` が並ぶかを見る。

うまくいかないときは、Gateway のログで原因を分ける。

| ログ・症状 | 原因と対処 |
|---|---|
| 何も出ない | Muse から届いていない。公開 URL と末尾の `/mcp`、トンネルが動いているかを見る |
| `rejected Origin: <値>` | Muse が Origin を付けてきた。値が Muse のものと確かめられたら、設定ファイルのコネクターの `allowedOrigins` に足して Gateway を再起動する |
| HTTP 401 が続く | API キーが違う。資格情報を入れ直すか、`connector add` で作り直す |
| `RATE_LIMITED` | 1分あたりの上限（読み取り30回、書き込み10回）を超えた |
| `DEPENDENCY_MISSING` | Runtime が止まっている |

Muse の Permissions で、このコネクターに操作ごとの許可を求める設定にしておくと、送信のたびに確認できる。

### 4.6 止める・作り直す

- 公開をやめる: トンネル（`cloudflared` や `ngrok`）を止める。Funnel を使ったときは `tailscale funnel reset`。
- 鍵を作り直す: 同じ `--id` で `mesh connector add` を実行し、Runtime と Gateway を再起動して、Muse の資格情報を入れ直す。古い鍵はその時点で使えなくなる。
- コネクターをなくす: 設定ファイルの `connectors` から消し、Runtime を再起動する。Muse 側のコネクターも消す。

## 5. リスク

- 公開中は、API キーを知っている人なら誰でも、許可したエージェントに依頼を送れる。Muse に入れる鍵はこのコネクター専用にし、`--peers` で使えるエージェントを絞る。
- エージェントは既定で読み取り専用で動く（Codex は read-only サンドボックス、Claude は読み取り系のツールだけ）。書き込みを許す設定にした場合は、Muse の Permissions で操作ごとに許可を求める設定にする。
- 依頼文とその結果は Meta のクラウドを通る。ソースコードや秘密情報を含む依頼をしてよいかは、利用者の判断になる。
- トークンを平文で置いている点は、Issue #2（Keychain への移行）で扱う。公開する前に済ませるのが望ましい。

## 6. 未確認事項

- Q01: 利用者のアカウントで Custom Connector を作れるか（Muse 自体は使えることを確かめた。2026-11-26）。
- Q02: Muse のクラウドからの要求に `Origin` ヘッダーが付くか。付くなら、その値を `allowedOrigins` に足す。
- Q03: Muse が GET（サーバーからのストリーム）や `Mcp-Session-Id` を求めてこないか。この実装はどちらも使わない。
- Q04: Custom Connector にも Read / Write / Sensitive write の分類と許可の既定値が当てはまるか。
- Q05: Meta 公式のヘルプページの本文。ブラウザで開いて読み、この文書と食い違う点があれば直す。

## 7. 出典（2026-11-24〜26閲覧）

- M1 [How Muse works with Connectors](https://www.meta.com/help/superintelligence/1687253048996149/)（本文は読めず。別の URL: [artificial-intelligence](https://www.meta.com/help/artificial-intelligence/1687253048996149/)）
- M2 [Muse Connector guidelines](https://platform.muse.ai/docs)
- M3 [Muse Connector Terms](https://platform.muse.ai/terms)
- T1 [crosswalk: How to add a custom connector to Muse (MCP)](https://crosswalk.to/agents/muse/custom-connector)
- T2 [superagnt: Meta Muse Custom Connector](https://www.superagnt.com/muse/custom-connector)
- T3 [Parallel: Meta Muse Custom Integrations](https://parallel.ai/articles/meta-muse-custom-integrations)
- T4 [tokenrip: Muse custom connector](https://tokenrip.com/blog/meta-muse-custom-connector)
- T5 [AnythingMCP: Meta Muse MCP](https://anythingmcp.com/guides/clients/muse)
