# Muse Custom Connector セットアップガイド

Meta Muse から agent-mesh のエージェント（Claude Code、Codex）に仕事を頼み、あとで結果を読むための手順です。設計は [IF仕様 §7](../../docs/spec/04-interface-design.md) に沿っています。

## 構成

```text
Muse（クラウド） ──HTTPS + API キー──▶ 公開の入口（利用者が選ぶ） ──▶ Connector Gateway（MCP、127.0.0.1:47140）
                                                                          │ connector 専用トークン
                                                                          ▼
                                                                  Runtime（host-a） ──A2A──▶ Claude / Codex
```

- Connector Gateway は Runtime とは別のプロセスで、別の認可境界です。Muse が使う API キーと、Gateway が Runtime に使うトークンは別物です。
- Gateway のトークンでできるのは、許可したエージェントへの送信、自分が送ったタスクの取得と取消だけです。持ち主（human）のタスクや、ほかのコネクターのタスクは見えません。`status` などの管理用の操作もできません。
- Muse から Muse 自身を起動する（結果が届いたら Muse が自動で続きを始める）機能はありません。結果は Muse から `mesh_get_task` で読みにいきます（設計書 ADR-08、F13）。

## 前提

- agent-mesh の Runtime が動いていること（README の「セットアップ」）
- Node.js 24 以上

## 手順

### 1. コネクターを登録する

```sh
cd dev
./bin/mesh connector add --config ~/.config/agent-mesh/host-a.json --id muse --peers codex-dev,claude-dev
```

- `--peers` で、Muse が使えるエージェントを絞ります。省くと、設定にあるすべての相手が対象になります。
- `--read-only` を付けると、一覧と結果の取得だけができるコネクターになります（送信と取消のツールが出ません）。Muse のガイドラインは、OAuth で接続するときに読み取り専用を選べるようにすることを求めています。
- `--port` で Gateway のポートを変えられます（既定は 47140）。
- 出力の `apiKey` が、MCP クライアント（Muse）に渡す Bearer トークンです。設定ファイルにも保存されます。チャットに貼り付けないでください。
- 同じ `--id` でもう一度実行すると、トークンと API キーを作り直します（漏れたときの差し替え）。コネクターを無効にするには、設定ファイルの `connectors` から該当の項目を消して Runtime を再起動します。

### 2. Runtime を再起動し、Gateway を起動する

Runtime は起動時に設定を読むので、コネクターを足したら再起動します。

```sh
kill $(lsof -tiTCP:47120 -sTCP:LISTEN)
./bin/mesh runtime --config ~/.config/agent-mesh/host-a.json &
./bin/mesh connector serve --config ~/.config/agent-mesh/host-a.json --id muse
```

`[mesh-connector] muse MCP endpoint http://127.0.0.1:47140/mcp` と出れば起動しています。

### 3. 手元の MCP クライアントで確かめる

Muse につなぐ前に、Claude Code を MCP クライアントとして使って確かめられます。設定を変えずに試すには、`--mcp-config` で一時的な設定ファイルを渡します。

```json
{
  "mcpServers": {
    "agent-mesh": {
      "type": "http",
      "url": "http://127.0.0.1:47140/mcp",
      "headers": { "Authorization": "Bearer <apiKey>" }
    }
  }
}
```

```sh
claude -p --strict-mcp-config --mcp-config ./mcp-client.json \
  --allowedTools "mcp__agent-mesh__mesh_list_agents,mcp__agent-mesh__mesh_submit_task,mcp__agent-mesh__mesh_get_task" \
  -- "agent-mesh の MCP ツールで codex-dev に「Reply with exactly: PONG」と依頼して、taskId を教えて"
```

このファイルには API キーが入るので、作業が済んだら消してください。

### 4. インターネットから届くようにする（利用者が決める）

Muse はクラウドで動くので、Gateway にはインターネットから HTTPS で届く必要があります。どれを選ぶかは利用者が決めます。どの方法でも、Gateway の API キーが唯一の防御になる点に注意してください。

| 方法 | 特徴 | 注意 |
|---|---|---|
| Tailscale Funnel | 既存の Tailscale で公開 URL を出せる | 設計書では既定で禁止（公開インターネットに出るため）。使うなら明示的に決める |
| Cloudflare Tunnel など | ポートを開けずに公開できる | 外部サービスのアカウントが要る |
| クラウドに Gateway を置く | 常時動かせる | Runtime への経路（VPN など）と運用費が要る |
| 公開しない | 手元の MCP クライアントだけで使う | Muse からは使えない |

公開する場合も、Gateway は 127.0.0.1 で待ち受けたまま、トンネルの側で HTTPS を終端します。ブラウザからの呼び出しは `Origin` で拒否します（`allowedOrigins` に書いたものだけ許可）。

### 5. Muse に登録する

公開 URL（末尾は `/mcp`）と API キーを、Muse のチャットで Custom Connector として登録します。調べた仕様、この実装との照合、頼み方の例、うまくいかないときの切り分けは [Muse Custom Connector 適用ガイド](../../docs/reference/muse-connector.md) にまとめました。

## 例示プロンプト（Muse に話しかける例）

- 「Agent Mesh で使えるエージェントを見せて」
- 「codex-dev に、リポジトリの README を読んで改善点を3つ挙げるよう頼んで。ファイルは変更しないこと」
- 「さっき頼んだタスクの結果を見せて」

## 上限

- 1分あたり、読み取り（一覧・取得）30回、書き込み（送信・取消）10回（IF仕様 §7.4 の初期値）
- 依頼文は16,000文字まで（UTF-8 で 64KiB まで）
- 受け付けた依頼の深さやルートあたりの件数は、Runtime の上限（深さ3、10件）に従う
