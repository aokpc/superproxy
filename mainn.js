import { Resolver } from "node:dns/promises";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { Agent, fetch, Request } from "undici";

// 1. カスタムDNSリゾルバーを作成
const resolver = new Resolver();
resolver.setServers(["1.1.1.1"]); // ここに指定したいDNSサーバーのIPを入れる

// 2. DNS解決（lookup）をカスタムリゾルバーに差し替えたAgentを作成
const agent = new Agent({
    connect: {
        lookup: async (hostname, options, callback) => {
            try {
                // 独自DNSでAレコードを解決
                const addresses = await resolver.resolve4(hostname);

                if (!addresses || addresses.length === 0) {
                    return callback(new Error(`No addresses found for ${hostname}`));
                }

                // Node.jsの内部（undiciなど）が、詳細な配列形式を求めてきた場合のハンドリング
                if (options && options.all) {
                    const result = addresses.map(ip => ({ address: ip, family: 4 }));
                    return callback(null, result);
                }

                // 通常のシンプルな名前解決を求めてきた場合（文字列を返す）
                callback(null, addresses[0], 4);
            } catch (err) {
                console.error(`DNS Lookup Error for ${hostname}:`, err);
                callback(err instanceof Error ? err : new Error(String(err)));
            }
        }
    },
    allowH2: true
});

const r404 = (res) => {
    res.writeHead(404, { "content-type": "text/html" });
    res.end("not found");
};

// 3. Node.jsのHTTPサーバーを作成
const server = createServer(async (req, res) => {
    // 互換性のため絶対URLをパース（ホスト名はダミー）
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    console.log(req.method, req.url);

    if (url.pathname === "/proxy") {
        const realurl = url.searchParams.get("url");
        if (!realurl) {
            return r404(res);
        }

        try {
            // Node.jsのストリーム（req）からボディを取得するための準備
            let body = undefined;
            if (req.method !== 'GET' && req.method !== 'HEAD') {
                // Node.jsのreqオブジェクトをそのままundiciのRequestボディに渡せます
                body = req;
            }

            // node:httpのヘッダー（string | string[]）をundiciが扱える形式に変換
            const headers = new Headers();
            for (const [key, value] of Object.entries(req.headers)) {
                if (value === undefined) continue;
                if (Array.isArray(value)) {
                    value.forEach(v => headers.append(key, v));
                } else {
                    headers.set(key, value);
                }
            }

            const proxyReq = new Request(realurl, {
                method: req.method,
                headers: headers,
                body: body,
                // Node.jsのreqにはreferrerやcredentialsが直接生えていないため、必要ならヘッダー等から手動で抽出してください
                mode: 'cors',
                dispatcher: agent, // undiciのfetchでは `agent` ではなく `dispatcher` を使用します
                duplex: "half"
            });

            const targetRes = await fetch(proxyReq);

            // ターゲットからのレスポンスヘッダーをコピー
            const resHeaders = {};
            targetRes.headers.forEach((value, key) => {
                // 以下のヘッダーは undici が自動解凍して中身が変わるため、ブラウザに引き継いではいけない
                if (
                    key.toLowerCase() === 'content-encoding' ||
                    key.toLowerCase() === 'content-length' ||
                    key.toLowerCase() === 'transfer-encoding'
                ) {
                    return; // コピーせずにスキップ
                }
                resHeaders[key] = value;
            });

            // ブラウザが適切に受け取れるよう、必要に応じて接続維持やCORSなどのヘッダーを調整
            resHeaders['connection'] = 'keep-alive';
            res.writeHead(targetRes.status, resHeaders);

            // レスポンスボディをNode.jsのレスポンス（WritableStream）に流し込む
            if (targetRes.body) {
                const reader = targetRes.body.getReader();
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    res.write(value);
                }
            }
            res.end();

        } catch (error) {
            console.error("Proxy Error:", error);
            res.writeHead(502, { "content-type": "text/plain" });
            res.end(`Bad Gateway: ${error}`);
        }

    } else if (url.pathname === "/index.html" || url.pathname === "/noproxy") {
        try {
            const html = await readFile("index.html", "utf-8");
            res.writeHead(200, { "content-type": "text/html" });
            res.end(html);
        } catch {
            r404(res);
        }
    } else if (url.pathname === "/sw.js") {
        try {
            const js = await readFile("sw.js", "utf-8");
            res.writeHead(200, { "content-type": "application/javascript" });
            res.end(js);
        } catch {
            r404(res);
        }
    } else {
        r404(res);
    }
});

// ポート8000で起動
server.listen(8000, () => {
    console.log("Server running at http://localhost:8000/");
});