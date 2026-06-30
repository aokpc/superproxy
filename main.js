const r404 = () => {
    return new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
};

// 3. DenoのHTTPサーバーを作成
Deno.serve(async (req) => {
    // DenoのRequestオブジェクトはurlプロパティがURLオブジェクト
    const url = new URL(req.url);
    console.log(req.method, url.pathname);

    if (url.pathname === "/proxy") {
        const realurl = url.searchParams.get("url");
        if (!realurl) {
            return r404();
        }

        try {
            // DenoのRequestオブジェクトはボディを直接持つため、特別な処理は不要
            const proxyReq = new Request(realurl, {
                method: req.method,
                headers: req.headers, // DenoのRequestヘッダーは直接利用可能
                body: req.body, // DenoのRequestボディは直接利用可能
                mode: 'cors',
                // undiciのdispatcherはDenoのfetchでは不要
                // duplexはDenoのfetchで自動的に処理される
            });

            const targetRes = await fetch(proxyReq);

            // ターゲットからのレスポンスヘッダーをコピー
            const resHeaders = new Headers();
            targetRes.headers.forEach((value, key) => {
                // 以下のヘッダーは Deno の fetch が自動解凍して中身が変わるため、ブラウザに引き継いではいけない
                if (
                    key.toLowerCase() === 'content-encoding' ||
                    key.toLowerCase() === 'content-length' ||
                    key.toLowerCase() === 'transfer-encoding'
                ) {
                    return; // コピーせずにスキップ
                }
                resHeaders.set(key, value);
            });

            // ブラウザが適切に受け取れるよう、必要に応じて接続維持やCORSなどのヘッダーを調整
            resHeaders.set('connection', 'keep-alive'); // DenoのHTTPサーバーはデフォルトでkeep-aliveをサポート
            // DenoのResponseオブジェクトを返す
            return new Response((resHeaders.has("content-length") ? (await targetRes.blob()) : (targetRes.body)), {
                status: targetRes.status,
                headers: resHeaders,
            });

        } catch (error) {
            console.error("Proxy Error:", error);
            return new Response(`Bad Gateway: ${error}`, {
                status: 502,
                headers: { "content-type": "text/plain" },
            });
        }

    } else if (url.pathname === "/index.html" || url.pathname === "/noproxy") {
        try {
            const html = await Deno.readTextFile("./static/index.html"); // Denoのファイル読み込みAPI
            return new Response(html, {
                status: 200,
                headers: { "content-type": "text/html" },
            });
        } catch {
            return r404();
        }
    } else if (url.pathname === "/sw.js") {
        try {
            const js = await Deno.readTextFile("./static/sw.js"); // Denoのファイル読み込みAPI
            return new Response(js, {
                status: 200,
                headers: { "content-type": "application/javascript" },
            });
        } catch {
            return r404();
        }
    } else {
        return r404();
    }
});

// ポート8000で起動
// server.listen(8000, () => { // Deno.serveが起動を処理
console.log("Server running at http://localhost:8000/");
// });