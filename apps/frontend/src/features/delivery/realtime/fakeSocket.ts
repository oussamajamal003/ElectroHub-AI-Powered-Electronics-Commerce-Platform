import type { Socket } from 'socket.io-client';

/**
 * Test double for the `/delivery` socket: the client-side surface the hook uses, plus `serverEmit` / `serverDrop` / `serverAccept` to
 * drive it. Acks are answered by `onSubscribe` so a test decides what the server says.
 */
export class FakeDeliverySocket {
  connected = false;
  disconnects = 0;
  emitted: { event: string; payload: unknown }[] = [];
  onSubscribe: (payload: { orderReference: string }) => unknown = () => ({ ok: true, revision: 0 });
  private handlers = new Map<string, Set<(...args: unknown[]) => void>>();
  io = { removeAllListeners: () => undefined };

  on(event: string, handler: (...args: unknown[]) => void) { (this.handlers.get(event) ?? this.handlers.set(event, new Set()).get(event)!).add(handler); return this; }
  off(event: string, handler: (...args: unknown[]) => void) { this.handlers.get(event)?.delete(handler); return this; }
  removeAllListeners() { this.handlers.clear(); return this; }
  emit(event: string, payload: unknown) { this.emitted.push({ event, payload }); return this; }
  timeout() {
    return { emitWithAck: async (event: string, payload: { orderReference: string }) => {
      this.emitted.push({ event, payload });
      if (!this.connected) throw new Error('timeout');
      return this.onSubscribe(payload);
    } };
  }
  connect() { return this; }
  disconnect() { this.connected = false; this.disconnects++; return this; }
  listeners(event: string) { return this.handlers.get(event)?.size ?? 0; }

  serverEmit(event: string, payload?: unknown) { for (const handler of [...(this.handlers.get(event) ?? [])]) handler(payload); }
  serverAccept() { this.connected = true; this.serverEmit('connect'); }
  serverDrop(reason = 'transport close') { this.connected = false; this.serverEmit('disconnect', reason); }
  asSocket() { return this as unknown as Socket; }
}
