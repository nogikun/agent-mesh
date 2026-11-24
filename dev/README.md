# Agent Mesh プロトタイプ（dev/）

`docs/spec` の設計（AM-BD/DD/FD/IF-001）を基にした G0〜G2 相当の最小実装です。Claude Code と Codex CLI（ChatGPT ログイン）が A2A（v0.3 JSON-RPC のサブセット）でお互いに非同期で仕事を頼み、完了をプッシュで受け取ります。必要なら依頼元のセッションを自動で再開します。

## 構成

| ファイル | 役割（設計書の対応） |
|---|---|
| `src/domain.ts` | タスク状態機械・上限（M01, 詳細設計 §3） |
| `src/store.ts` | SQLite（`node:sqlite`, WAL）: tasks / inbox / outbox / continuations / audit（M06, §4） |
| `src/a2a.ts` | A2A クライアント・Task 正規化（M03, IF §4） |
| `src/providers.ts` | `claude -p` / `codex exec` の起動・再開・出力解析（M08, IF §6） |
| `src/runtime.ts` | A2A 受信・worker・push outbox・自動再開・ローカル制御 API（M05/M07, §5） |
| `src/cli.ts`, `bin/mesh` | mesh CLI（M04, IF §3） |
| `../skills/agent-mesh/` | 配布用の Agent Skill（IF §2）。`tools/mesh/` は `pnpm sync:skill` で dev/ から作るコピー |

実行時の依存はありません（Node 24 の型除去・`node:sqlite`・`fetch` を使用）。pnpm で管理しているのは開発用の `typescript` と `@types/node` だけです。

## 使い方

```sh
cd dev
pnpm install
pnpm test                 # 単体テスト + E2E（偽プロバイダーを使うため LLM は起動しない）
./bin/mesh init-demo --workspace .   # ~/.config/agent-mesh/ に host-a(claude-dev :47120) / host-b(codex-dev :47121) を作成
./bin/mesh runtime --config ~/.config/agent-mesh/host-a.json &  # ノード A
./bin/mesh runtime --config ~/.config/agent-mesh/host-b.json &  # ノード B
export MESH_CONFIG=~/.config/agent-mesh/host-a.json
./bin/mesh doctor
./bin/mesh send --to codex-dev --message "src/domain.ts をレビューして"   # すぐに requestId が返る
./bin/mesh inbox                                  # 完了はプッシュで届く
./bin/mesh task get <requestId>
```

UC01（Claude が自分のターン内で Codex に依頼し、結果が届いたら同じセッションで自動再開される流れ）を試すには、`claude-dev` に「`mesh send --to codex-dev ...` で依頼してからターンを終えて」と送ります。委譲した結果を待つあいだ、Claude 側のタスクは WORKING のまま残ります。再開後のターンの答えが最終結果になり、依頼元に push されます。

## 安全側の既定

- 待ち受けは 127.0.0.1 のみです。ノード間は Bearer トークンで認証し、エージェントごとに `allowedSenders` で許可します。
- Push の送信先は、呼び出し元ごとに登録した origin だけに限ります（SSRF 対策）。Push は合図としてだけ扱い、確定状態は `tasks/get` で取り直します。
- Codex は `sandbox_mode="read-only"` で動きます。Claude は `--allowedTools` で許可したツールだけを使い、権限確認を飛ばすフラグは使いません。
- `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `CODEX_API_KEY` が設定されていると Runtime は起動しません（意図しない API 課金を防ぐため）。
- ターン内の `mesh` は、そのターン専用のトークンで認証します。`allowedPeers` 以外には依頼できず、`--config` で所有者に成り上がることもできません。
- トークンを含む設定はワークスペースの外（既定 `~/.config/agent-mesh`、0700/0600）に置きます。ワークスペース内には作れません。ただし Codex の read-only サンドボックスはディスク全体を読めるので、同じ OS ユーザーで動く限りトークンを完全には隠せません（OS キーチェーン化が今後の課題）。
- 上限: 依頼の深さは最大 3、root あたりの依頼は最大 10 件、本文は 64KiB まで、再開は 1 回にまとめて 5 件・32KiB まで。
- 再起動時、実行中だったタスクは FAILED(INTERRUPTED) にして、自動では再実行しません。再開中だったものは UNCERTAIN にします。

## 未実装（設計書のうちプロトタイプで省いた部分）

S モード（Runtime なしのレシート）、`setup` / `uninstall` / launchd 登録、SSE / subscribe、INPUT_REQUIRED への返信、CAO、Muse Connector、Tailscale 越しの実機試験、OS キーチェーンでのトークン保管、パッケージ分割（`packages/*`）。コード中の `shortcut:` コメントが格上げ条件を示しています。
