// インストールイベント（新しいSWファイルが検知されたとき）
self.addEventListener('install', (event) => {
    // 待機状態をスキップして、即座にアクティブ化を強制する
    skipWaiting();
});

// アクティベートイベント（新しいSWが有効になったとき）
self.addEventListener('activate', (event) => {
    // 古いSWが制御していたページも含め、即座にすべてのクライアント（タブ）を制御下に置く
    event.waitUntil(clients.claim());
});

// IndexedDBから非同期でドメインを取得するヘルパー関数
function getSavedDomain() {
    return new Promise((resolve) => {
        const request = indexedDB.open("ProxyConfig", 2);
        request.onsuccess = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains("settings")) {
                return resolve(null);
            }
            const tx = db.transaction("settings", "readonly");
            const getReq = tx.objectStore("settings").get("domain");
            getReq.onsuccess = () => resolve(getReq.result);
            getReq.onerror = () => resolve(null);
        };
        request.onerror = () => resolve(null);
    });
};

(async () => { console.log(await getSavedDomain()) })();

// リクエストの横取り
self.addEventListener('fetch', (event) => {
    const requestUrl = new URL(event.request.url);
    if (requestUrl.protocol.startsWith("chrome")) {
        return;
    }
    console.log(requestUrl.hostname);
    if (requestUrl.hostname === location.hostname) {
        // 1. すでに自分のサーバーの「/proxy」へのリクエストなら、無限ループを防ぐためスキップ
        if (requestUrl.pathname === '/proxy') {
            return;
        }

        // 2. パスが「/noproxy」の場合は、そのまま通常通り通信させる
        if (requestUrl.pathname === '/noproxy') {
            return;
        }

        // 非同期処理（IndexedDBの確認）を含むため、respondWithを使用
        event.respondWith(
            (async () => {
                const savedDomain = (await getSavedDomain()) || location.host;

                // 3. 保存されたドメインが存在し、かつ現在のドメインがその対象である場合
                //（または全てのリクエストを対象にする場合は条件を調整してください）

                // 独自のプロキシURLを組み立てる (/proxy?url=元のURL)
                const proxyUrl = `/proxy?url=${encodeURIComponent(event.request.url.replace(location.host, savedDomain))}`;

                // 新しいURL、元のメソッドやヘッダーを引き継いでリクエストを再作成
                const modifiedRequest = new Request(proxyUrl, {
                    method: event.request.method,
                    headers: event.request.headers,
                    body: event.request.method !== 'GET' && event.request.method !== 'HEAD' ? await event.request.blob() : null,
                    referrer: event.request.referrer,
                    mode: 'cors', // 必要に応じて調整
                    credentials: event.request.credentials
                });

                // サーバーへ送信
                return fetch(modifiedRequest);
            })()
        );
    } else {
        event.respondWith(
            (async () => {
                // 独自のプロキシURLを組み立てる (/proxy?url=元のURL)
                const proxyUrl = `/proxy?url=${encodeURIComponent(event.request.url)}`;

                // 新しいURL、元のメソッドやヘッダーを引き継いでリクエストを再作成
                const modifiedRequest = new Request(proxyUrl, {
                    method: event.request.method,
                    headers: event.request.headers,
                    body: event.request.method !== 'GET' && event.request.method !== 'HEAD' ? await event.request.blob() : null,
                    referrer: event.request.referrer,
                    mode: 'cors', // 必要に応じて調整
                    credentials: event.request.credentials
                });

                // サーバーへ送信
                return fetch(modifiedRequest);
            })()
        );
    }
});