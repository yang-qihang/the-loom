package dev.loomcraft.mc;

import org.java_websocket.WebSocket;
import org.java_websocket.handshake.ClientHandshake;
import org.java_websocket.server.WebSocketServer;

import java.net.InetSocketAddress;
import java.util.function.BiConsumer;
import java.util.logging.Logger;

/** JSON-RPC 2.0 over WebSocket server (service channel; bound to 127.0.0.1 by default). */
public final class RpcServer extends WebSocketServer {
    private final Logger log;
    private final BiConsumer<String, java.util.function.Consumer<String>> dispatch;

    public RpcServer(String host, int port, Logger log,
                     BiConsumer<String, java.util.function.Consumer<String>> dispatch) {
        super(new InetSocketAddress(host, port));
        this.log = log;
        this.dispatch = dispatch;
        setReuseAddr(true);
        setConnectionLostTimeout(30);
    }

    @Override
    public void onOpen(WebSocket conn, ClientHandshake handshake) {
        log.info("RPC client connected " + conn.getRemoteSocketAddress());
    }

    @Override
    public void onClose(WebSocket conn, int code, String reason, boolean remote) {
        log.info("RPC client closed " + conn.getRemoteSocketAddress() + " code=" + code);
    }

    @Override
    public void onMessage(WebSocket conn, String message) {
        dispatch.accept(message, response -> conn.send(response));
    }

    @Override
    public void onError(WebSocket conn, Exception ex) {
        log.warning("RPC error: " + ex);
    }

    @Override
    public void onStart() {
        log.info("RPC listening on ws://" + getAddress().getHostString() + ":" + getPort());
    }
}
