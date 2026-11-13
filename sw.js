const CACHE = "movo-v336-dee129b6ef";
const SHELL = [
  "./",
  "./index.html",
  "./app.dee129b6ef.js",
  "./vendor/react.js",
  "./vendor/react-dom.js",
  "./vendor/supabase.js",
  "./vendor/lottie.js",
  "./vendor/fonts/oswald-latin-500-normal.woff2",
  "./vendor/fonts/oswald-latin-600-normal.woff2",
  "./vendor/fonts/oswald-latin-700-normal.woff2",
  "./vendor/fonts/inter-latin-400-normal.woff2",
  "./vendor/fonts/inter-latin-500-normal.woff2",
  "./vendor/fonts/inter-latin-600-normal.woff2",
  "./vendor/fonts/inter-latin-700-normal.woff2",
  "./vendor/fonts/roboto-mono-latin-500-normal.woff2",
  "./vendor/fonts/fonts.css",
  "./privacidade.html",
  "./termos.html",
  "./races.json",
  "./runner.json",
  "./manifest.json",
  "./icon-192.png",
  "./badge-96.png",
  "./icon-512.png",
  "./icon-mono-192.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  // Ícones das notificações vêm do cache primeiro: com sinal ruim (academia) o network-first
  // demorava e o Android mostrava o aviso do descanso com o quadrado branco no lugar do ícone.
  if (/\/(badge-96|icon-192|icon-512|icon-mono-192|icon-mono-512)\.png$/.test(new URL(req.url).pathname)) {
    event.respondWith(caches.match(req).then((cached) => cached || fetch(req)));
    return;
  }
  // Network-first for the app shell (so updates show up), cache fallback offline.
  event.respondWith(
    fetch(req, { cache: "no-store" })
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req).then((cached) => cached || caches.match("./index.html")))
  );
});

// Push do servidor (edge function enviar-push): { title, body, url, tag }.
self.addEventListener("push", (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = { body: event.data ? event.data.text() : "" }; }
  event.waitUntil(
    self.registration.showNotification(d.title || "Movo", {
      body: d.body || "",
      icon: "./icon-192.png",
      badge: "./badge-96.png",
      tag: d.tag || "movo",
      // Botões (v300): ex.: "Compartilhar" na vitória do desafio. Cada um abre o seu endereço.
      ...(Array.isArray(d.acoes) && d.acoes.length ? { actions: d.acoes.slice(0, 2).map((x) => ({ action: String(x.a), title: String(x.t) })) } : {}),
      data: { url: d.url || "./", acoes: Array.isArray(d.acoes) ? d.acoes : [] },
    })
  );
});

// Aviso local do app (fim do descanso, cronômetro de bloco): a página pede e o service worker
// mostra, como no push do servidor, com o ícone do Movo em endereço absoluto.
// O fim do descanso também é agendado aqui quando ele começa ({ tipo: "descanso", endsAt }): com o
// app em segundo plano o Android congela a página, mas não o service worker. endsAt marca qual
// descanso já foi avisado, para a página e o agendamento não avisarem duas vezes.
let descansoPendente = null; // { endsAt, timer, fim }
let descansoAvisado = 0;
function avisoMostrar(title, opts, endsAt) {
  if (endsAt && descansoAvisado === endsAt) return Promise.resolve();
  if (endsAt) descansoAvisado = endsAt;
  const abs = (u) => new URL(u, self.registration.scope).href;
  return self.registration.showNotification(title, {
    ...(opts || {}),
    icon: abs("./icon-192.png"),
    badge: abs("./badge-96.png"),
    data: { url: "./" },
  });
}
function descansoCancelar() {
  if (!descansoPendente) return;
  clearTimeout(descansoPendente.timer);
  descansoPendente.fim();
  descansoPendente = null;
}
// App Android: descanso em andamento na barra ("movo-descanso-ativo", silenciosa, timestamp = fim).
// O app troca pelo cronômetro regressivo nativo e marca o alarme do fim; fechar esta notificação
// avisa o app que o descanso parou.
const DESCANSO_ATIVO = "movo-descanso-ativo";
function descansoAtivoFechar() {
  return self.registration.getNotifications({ tag: DESCANSO_ATIVO })
    .then((ns) => ns.forEach((n) => n.close()))
    .catch(() => {});
}
function descansoAtivoMostrar(d) {
  const abs = (u) => new URL(u, self.registration.scope).href;
  return self.registration.showNotification(d.ativo.title || "Descanso", {
    body: d.ativo.body || "",
    tag: DESCANSO_ATIVO,
    silent: true,
    renotify: false,
    timestamp: d.endsAt,
    icon: abs("./icon-192.png"),
    badge: abs("./badge-96.png"),
    data: { url: "./" },
  }).catch(() => {});
}
self.addEventListener("message", (event) => {
  const d = event.data || {};
  if (d.tipo === "descanso") {
    descansoCancelar();
    if (!d.endsAt || !d.title) { event.waitUntil(descansoAtivoFechar()); return; }
    // v321: o aviso do fim do descanso anterior sai da barra (não acumula um por descanso).
    event.waitUntil(self.registration.getNotifications({ tag: "movo-rest-timer" }).then((ns) => ns.forEach((n) => n.close())).catch(() => {}));
    if (d.ativo) event.waitUntil(descansoAtivoMostrar(d));
    // waitUntil mantém o service worker vivo até o fim do descanso (o Chrome segura até ~5 min).
    event.waitUntil(new Promise((fim) => {
      const timer = setTimeout(() => {
        descansoPendente = null;
        descansoAtivoFechar()
          .then(() => avisoMostrar(d.title, d.opts, d.endsAt))
          .catch(() => {}).then(fim);
      }, Math.max(0, d.endsAt - Date.now()));
      descansoPendente = { endsAt: d.endsAt, timer, fim };
    }));
    return;
  }
  if (d.tipo !== "notificar" || !d.title) return;
  if (d.endsAt && descansoPendente && descansoPendente.endsAt === d.endsAt) descansoCancelar();
  event.waitUntil(
    (d.endsAt ? descansoAtivoFechar() : Promise.resolve())
      .then(() => avisoMostrar(d.title, d.opts, d.endsAt))
      .then(() => { if (event.ports && event.ports[0]) event.ports[0].postMessage("ok"); })
  );
});

// Toque na notificação (descanso acabou, push do servidor) foca uma aba já
// aberta do app, se tiver, ou abre uma nova — sem isso o toque só fecha a
// notificação e não leva a pessoa de volta pro treino.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const dados = event.notification.data || {};
  const botao = event.action && Array.isArray(dados.acoes) ? dados.acoes.find((x) => String(x.a) === event.action) : null;
  const url = (botao && botao.url) || dados.url || "./";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientsArr) => {
      const existing = clientsArr.find((c) => "focus" in c);
      if (existing) {
        // App já aberto: pede para abrir a tela do aviso (ex.: ?abrir=medidas) e traz para a frente.
        const m = /[?&]abrir=([a-z]+)/.exec(url);
        if (m) existing.postMessage({ tipo: "abrir", alvo: m[1] });
        return existing.focus();
      }
      return self.clients.openWindow(url);
    })
  );
});
