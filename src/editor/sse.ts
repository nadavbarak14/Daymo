import type { ServerResponse } from "node:http";

export interface SseEvent { type: string; [key: string]: unknown; }

export class SseBus {
  private clients = new Set<ServerResponse>();

  attach(res: ServerResponse): void {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      "connection": "keep-alive",
    });
    res.write(": connected\n\n");
    this.clients.add(res);
    res.on("close", () => this.clients.delete(res));
  }

  publish(evt: SseEvent): void {
    const payload = `data: ${JSON.stringify(evt)}\n\n`;
    for (const c of this.clients) c.write(payload);
  }

  closeAll(): void {
    for (const c of this.clients) c.end();
    this.clients.clear();
  }
}
