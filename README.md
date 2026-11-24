# agent-mesh

Claude Code と Codex CLI が A2A でお互いに非同期で仕事を頼み、完了をプッシュで受け取るプロトタイプです。設計は `docs/spec/`、実装の説明は `dev/README.md` にあります。

## スキルとして入れる

`skills/agent-mesh/` に、Claude Code と Codex の両方で使える Agent Skill があります。main に取り込んだあとは、次のコマンドで入れられます。main 以外のブランチから入れるときは `nogikun/agent-mesh#<ブランチ名>` と指定します。リポジトリは非公開なので、入れられるのはリポジトリを読める人だけです。

```sh
npx skills add nogikun/agent-mesh --skill agent-mesh -a claude-code codex -g
```

スキルの中の `tools/mesh/` は `dev/` のコピーです。`dev/` のコードを変えたら、`dev/` で `pnpm sync:skill` を実行してコピーを更新します。`pnpm test` は、コピーが古いと失敗します。

## 必要なもの

- Node.js 24 以上（`dev/package.json` の `engines` は `node >=24`。動作を確かめたのは v24.13.0）
- pnpm（動作を確かめたのは 10.4.1）
- Claude Code CLI（動作を確かめたのは 2.1.331）。ログインを済ませておきます。`~/.local/bin/claude` にあれば自動で見つけます。
- Codex CLI（動作を確かめたのは 0.167.0-alpha.3.2）。ChatGPT でログインを済ませておきます。PATH になくても、ChatGPT アプリに入っている `/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex` を自動で見つけます。

ほかの場所に入れた CLI は環境変数 `MESH_CLAUDE_BIN` と `MESH_CODEX_BIN` で場所を指定できます。

`ANTHROPIC_API_KEY`、`OPENAI_API_KEY`、`CODEX_API_KEY` のどれかが設定されていると、Runtime は起動しません。API キーでの従量課金に切り替わるのを防ぐためです。

## セットアップ

1. 依存パッケージを入れます。

   ```sh
   cd dev
   pnpm install
   ```

2. 2つのノードの設定ファイルを作ります。

   ```sh
   ./bin/mesh init-demo --workspace .
   ```

   `~/.config/agent-mesh/` に、Claude 側の `host-a.json`（`claude-dev`、ポート 47120）と Codex 側の `host-b.json`（`codex-dev`、ポート 47121）ができます。中のトークンは実行のたびに新しく作ります。設定ファイルはワークスペースの中には作れません。もうファイルがあるときは `--force` を付けます。

3. CLI が見つかるかとログインの状態を確かめます。

   ```sh
   ./bin/mesh doctor --config ~/.config/agent-mesh/host-a.json
   ```

## テスト

テストには LLM を呼ばない自動テストと、本物の Claude Code と Codex を動かす実機テストの2つがあります。

### 自動テスト

数秒で終わり、サブスクリプションの利用枠も使いません。

```sh
cd dev
pnpm test       # 全15件。最後に「pass 15」「fail 0」と出れば成功
pnpm typecheck  # 型チェック
```

本物の Claude と Codex の代わりに偽物のエージェント（`test/fake-agent.ts`）を使い、依頼から完了通知、自動再開までの流れをすべて確かめます。

### 実機テスト

本物の Claude と Codex が動くので、サブスクリプションの利用枠を少し使います。ターミナルを3つ開き、どれも `dev` に移動しておきます。

1. ターミナル1で、Claude 側の Runtime を起動します。

   ```sh
   ./bin/mesh runtime --config ~/.config/agent-mesh/host-a.json
   ```

2. ターミナル2で、Codex 側の Runtime を起動します。

   ```sh
   ./bin/mesh runtime --config ~/.config/agent-mesh/host-b.json
   ```

   どちらも `listening on ...` と出たら起動しています。ポートが使用中と出たら、その Runtime はもう動いています。

3. ターミナル3で、どちらのノードから依頼を送るかを決めます。

   ```sh
   export MESH_CONFIG=~/.config/agent-mesh/host-a.json
   ```

4. Codex に依頼を送ります。

   ```sh
   ./bin/mesh send --to codex-dev --message "1から10の和を数字だけで答えて"
   ```

   すぐに `requestId` が返り、Codex はその裏で作業を続けます。

5. 結果を見ます。

   ```sh
   ./bin/mesh inbox                 # 完了すると数十秒でここに届く
   ./bin/mesh task get <requestId>  # "result" に答えが入る
   ```

#### Claude と Codex どうしでやり取りさせる

Claude に「Codex に頼んで、結果をまとめて」と依頼します。

```sh
./bin/mesh send --to claude-dev --message 'codex-dev に「1から10の和を数字だけで答えて」と mesh send で依頼し、依頼したらすぐターンを終えてください。結果が届いて再開されたら「codexの答え: <数字>」とだけ答えてください。'
./bin/mesh task get <requestId>  # 1分ほどで "codexの答え: 55" のようになる
```

このとき、次の順に進みます。

1. Claude が Codex に依頼して、いったん作業を終えます。
2. Codex が答えます。
3. Claude が自動で再開され、結果をまとめます。

#### Codex 側のノードから Claude に依頼する

```sh
./bin/mesh send --config ~/.config/agent-mesh/host-b.json --to claude-dev --message "こんにちはと返して"
```

### 状態を見るコマンド

- `./bin/mesh status`: 件数のまとめ
- `./bin/mesh doctor`: 両方の CLI が見つかるか、ログインしているかの確認

### 止めるとき

ターミナル1と2で Ctrl+C を押します。

## 開発環境（任意）

このリポジトリには Nix と mise で開発環境をそろえる設定（`flake.nix`、`.mise.toml`、`Taskfile.yml`）も入っています。Nix は次のコマンドで入れます。

```bash
curl --proto '=https' --tlsv1.2 -sSf -L https://install.determinate.systems/nix | sh -s -- install
```

Determinate Systems 版をおすすめします。`nix-command` と `flakes` が最初から有効になっているので、追加の設定がいりません。
