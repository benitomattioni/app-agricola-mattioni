self.addEventListener("push", (event) => {
  let data = { title: "Fazenda", body: "Você tem uma nova notificação." };
  try {
    if (event.data) data = event.data.json();
  } catch (e) {
    // se não vier em JSON, usa o texto puro como corpo
    if (event.data) data.body = event.data.text();
  }

  event.waitUntil(
    self.registration.showNotification(data.title || "Fazenda", {
      body: data.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: "window" }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow("/");
    })
  );
});

// Handler mínimo, sem cache — só repassa a rede direto. Não guarda nada
// offline (os dados são sempre ao vivo do banco), mas garante que o app
// seja reconhecido como instalável em qualquer navegador.
self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});
