import { nanoid } from "nanoid";

type ConnectorSocket = {
  send: (data: string) => void;
  readyState?: number;
};

type PendingCall = {
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
  timer: ReturnType<typeof setTimeout>;
  connectorId: string;
  tool: string;
};

const connectors = new Map<string, ConnectorSocket>();
const socketToConnector = new WeakMap<ConnectorSocket, string>();
const pending = new Map<string, PendingCall>();

export function registerConnector(connectorId: string, socket: ConnectorSocket) {
  const id = (connectorId || "").trim();
  if (!id) throw new Error("connectorId is required");

  const old = connectors.get(id);
  if (old && old !== socket) {
    try {
      old.send(JSON.stringify({ type: "event", event: "connector.replaced", data: { connectorId: id } }));
    } catch {
      // ignore
    }
  }

  connectors.set(id, socket);
  socketToConnector.set(socket, id);
  console.log(`[connector] registered: ${id} (total=${connectors.size})`);
}

export function unregisterConnectorBySocket(socket: ConnectorSocket) {
  const connectorId = socketToConnector.get(socket);
  if (!connectorId) return;

  const current = connectors.get(connectorId);
  if (current === socket) {
    connectors.delete(connectorId);
  }

  socketToConnector.delete(socket);
  console.log(`[connector] disconnected: ${connectorId}`);

  for (const [requestId, p] of pending.entries()) {
    if (p.connectorId !== connectorId) continue;
    clearTimeout(p.timer);
    pending.delete(requestId);
    p.reject(new Error(`Connector offline: ${connectorId}`));
  }
}

export function hasConnector(connectorId: string): boolean {
  return connectors.has((connectorId || "").trim());
}

export function getConnectedConnectorIds(): string[] {
  return Array.from(connectors.keys());
}

export async function invokeConnectorTool(opts: {
  connectorId: string;
  tool: string;
  args: any;
  timeoutMs?: number;
}): Promise<any> {
  const connectorId = (opts.connectorId || "").trim();
  if (!connectorId) throw new Error("connectorId is required");

  const socket = connectors.get(connectorId);
  if (!socket) {
    console.warn(`[connectorHub] invokeConnectorTool: missing connector ${connectorId}. connected: ${Array.from(connectors.keys()).join(", ")}`);
    throw new Error(`Connector not connected: ${connectorId}`);
  }

  const requestId = nanoid(12);
  const timeoutMs = Math.max(1_000, opts.timeoutMs ?? 90_000);

  const resultPromise = new Promise<any>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error(`Connector tool timeout: ${opts.tool} (${connectorId})`));
    }, timeoutMs);

    pending.set(requestId, {
      resolve,
      reject,
      timer,
      connectorId,
      tool: opts.tool,
    });
  });

  try {
    socket.send(
      JSON.stringify({
        type: "connector.invoke",
        data: {
          requestId,
          tool: opts.tool,
          args: opts.args,
        },
      }),
    );
  } catch (e: any) {
    const p = pending.get(requestId);
    if (p) {
      clearTimeout(p.timer);
      pending.delete(requestId);
    }
    throw new Error(`Failed to send invoke to connector ${connectorId}: ${e?.message || String(e)}`);
  }

  return resultPromise;
}

/**
 * Get the connector ID associated with a given socket, if any.
 * Used to detect which connector disconnected on ws close.
 */
export function getConnectorIdBySocket(socket: ConnectorSocket): string | undefined {
  return socketToConnector.get(socket);
}

export function resolveConnectorResult(params: {
  requestId: string;
  ok: boolean;
  result?: any;
  error?: string;
}) {
  const requestId = (params.requestId || "").trim();
  if (!requestId) return;

  const p = pending.get(requestId);
  if (!p) return;

  clearTimeout(p.timer);
  pending.delete(requestId);

  if (params.ok) {
    p.resolve(params.result);
  } else {
    p.reject(new Error(params.error || `Connector tool failed: ${p.tool}`));
  }
}
