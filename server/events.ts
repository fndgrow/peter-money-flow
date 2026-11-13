import type { Request, Response } from "express";

/**
 * Live updates: every signed-in browser keeps one Server-Sent Events connection open.
 * After any change we send a tiny "changed" event and the clients reload their data,
 * so a phone and a laptop stay in step without refreshing.
 */

const clients = new Set<Response>();
let version = Date.now();

export function currentVersion() {
  return version;
}

export function broadcastChange() {
  version = Date.now();
  const payload = `event: changed\ndata: ${version}\n\n`;
  for (const res of clients) {
    try {
      res.write(payload);
    } catch {
      clients.delete(res);
    }
  }
}

export function eventsHandler(req: Request, res: Response) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(`retry: 3000\nevent: hello\ndata: ${version}\n\n`);
  clients.add(res);
  const ping = setInterval(() => {
    try {
      res.write(`: ping\n\n`);
    } catch {
      /* closed */
    }
  }, 25_000);
  req.on("close", () => {
    clearInterval(ping);
    clients.delete(res);
  });
}
