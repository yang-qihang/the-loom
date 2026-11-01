package dev.loomcraft.mc;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.title.Title;
import org.bukkit.entity.TextDisplay;
import org.bukkit.entity.Display.Billboard;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.Particle;
import org.bukkit.World;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.bukkit.plugin.java.JavaPlugin;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;

/**
 * LoomCraft Paper plugin (T1): WorldPort RPC over WebSocket for the MC line.
 *
 * <p>Service channel: {@code ws://127.0.0.1:8765} (JSON-RPC 2.0). See {@code plugin/README.md}
 * and {@code docs/21-t1-contracts.md} §4 for the method list.
 */
public final class LoomPlugin extends JavaPlugin {
    private SceneManager scene;
    private RpcServer rpc;

    @Override
    public void onEnable() {
        saveDefaultConfig();
        scene = new SceneManager(this);
        getServer().getPluginManager().registerEvents(scene, this);
        String host = getConfig().getString("ws.host", "127.0.0.1");
        int port = getConfig().getInt("ws.port", 8765);
        rpc = new RpcServer(host, port, getLogger(), this::dispatch);
        rpc.start();
        getLogger().info("LoomCraft MC plugin enabled | mc=" + Bukkit.getMinecraftVersion()
                + " | rpc=" + host + ":" + port);
    }

    @Override
    public void onDisable() {
        if (rpc != null) {
            try {
                rpc.stop(1000);
            } catch (Exception ignored) {
            }
        }
    }

    // ---------------------------------------------------------------- RPC dispatch

    private void dispatch(String message, Consumer<String> reply) {
        // Bukkit API must be touched on the main server thread.
        Bukkit.getScheduler().runTask(this, () -> reply.accept(process(message)));
    }

    private String process(String message) {
        String id = "null";
        try {
            Map<String, Object> request = Json.map(Json.parse(message));
            id = request.get("id") instanceof String s ? s : Json.stringify(request.get("id"));
            String method = Json.str(request.get("method"), "");
            Map<String, Object> params = request.get("params") instanceof Map<?, ?>
                    ? Json.map(request.get("params")) : new LinkedHashMap<>();
            Object result = switch (method) {
                case "health", "ping" -> scene.status();
                case "session.status" -> scene.status();
                case "session.begin" -> scene.begin(params);
                case "session.finalize" -> scene.finalizeScene(params);
                case "session.prepare" -> scene.prepare(params);
                case "session.end" -> scene.endSession(params);
                case "world.classify" -> scene.classify(params);
                case "world.block" -> scene.blockAt(params);
                case "world.blocks" -> scene.worldBlocks(params);
                case "world.regionCount" -> scene.regionCount(params);
                case "world.virtualPlace" -> scene.virtualPlace(params);
                case "world.reset" -> scene.reset(params);
                case "world.snapshot" -> scene.snapshot(params);
                case "world.setBlocks" -> scene.setBlocks(params);
                case "world.clearRegion" -> scene.clearRegion(params);
                case "world.setTime" -> scene.setTime(params);
                case "world.setWeather" -> scene.setWeather(params);
                case "entity.spawn" -> scene.spawnEntity(params);
                case "entity.clear" -> scene.clearEntities(stringList(params.get("ids")));
                case "player.teleport" -> scene.teleportPlayer(params);
                case "player.give" -> scene.givePlayer(params);
                case "player.inventory" -> scene.playerInventory(params);
                case "player.place", "session.playerBeat" -> scene.playerPlace(params);
                case "playerBeat.arm" -> scene.armPlayerBeat(params);
                case "playerBeat.activate" -> scene.activatePlayerBeat(params);
                case "playerBeat.status" -> scene.playerBeatStatus(params);
                case "bots.set" -> scene.setBots(stringList(params.get("names")));
                case "events.drain" -> scene.drainEvents(params);
                case "agent.mark" -> scene.markAgentMove(params);
                case "fx.title" -> fxTitle(params);
                case "fx.actionbar" -> fxActionBar(params);
                case "fx.sound" -> fxSound(params);
                case "fx.particle" -> fxParticle(params);
                case "annotations.set" -> scene.setAnnotations(params);
                case "annotations.clear" -> scene.clearAnnotations();
                case "annotations.visible" -> scene.setAnnotationsVisible(params);
                default -> throw new IllegalArgumentException("unknown method: " + method);
            };
            Map<String, Object> response = new LinkedHashMap<>();
            response.put("jsonrpc", "2.0");
            response.put("id", request.get("id"));
            response.put("result", result);
            return Json.stringify(response);
        } catch (Throwable t) {
            getLogger().warning("RPC failed: " + t.getMessage());
            Map<String, Object> error = new LinkedHashMap<>();
            error.put("code", -32000);
            error.put("message", t.getMessage() == null ? t.toString() : t.getMessage());
            Map<String, Object> response = new LinkedHashMap<>();
            response.put("jsonrpc", "2.0");
            response.put("id", id);
            response.put("error", error);
            return Json.stringify(response);
        }
    }

    private static List<String> stringList(Object value) {
        List<String> out = new ArrayList<>();
        for (Object o : Json.list(value)) {
            String s = Json.str(o, null);
            if (s != null) out.add(s);
        }
        return out;
    }

    // ---------------------------------------------------------------- fx

    private Map<String, Object> fxTitle(Map<String, Object> params) {
        String text = Json.str(params.get("text"), "");
        Title title = Title.title(Component.text(text), Component.empty());
        for (Player p : Bukkit.getOnlinePlayers()) p.showTitle(title);
        return okFx();
    }

    private Map<String, Object> fxActionBar(Map<String, Object> params) {
        String text = Json.str(params.get("text"), "");
        for (Player p : Bukkit.getOnlinePlayers()) p.sendActionBar(Component.text(text));
        return okFx();
    }

    private Map<String, Object> fxSound(Map<String, Object> params) {
        String sound = Json.str(params.get("id"), "minecraft:block.note_block.chime");
        int[] at = params.get("at") != null ? Json.vec3(params.get("at")) : null;
        World world = scene.world();
        if (at != null) {
            world.playSound(new Location(world, at[0] + 0.5, at[1], at[2] + 0.5), sound, 1.0f, 1.0f);
        } else {
            for (Player p : Bukkit.getOnlinePlayers()) p.playSound(p.getLocation(), sound, 1.0f, 1.0f);
        }
        return okFx();
    }

    private Map<String, Object> fxParticle(Map<String, Object> params) {
        String id = Json.str(params.get("id"), "minecraft:end_rod");
        int[] at = Json.vec3(params.get("at"));
        int count = Math.max(1, Json.num(params.get("count"), 10));
        Particle particle;
        try {
            String normalized = id.replace("minecraft:", "").toUpperCase().replace('-', '_');
            particle = Particle.valueOf(normalized);
        } catch (Exception e) {
            particle = Particle.END_ROD;
        }
        World world = scene.world();
        world.spawnParticle(particle, new Location(world, at[0] + 0.5, at[1] + 0.5, at[2] + 0.5), count);
        return okFx();
    }

    private static Map<String, Object> okFx() {
        Map<String, Object> m = Json.obj();
        m.put("ok", true);
        m.put("tick", Bukkit.getCurrentTick());
        return m;
    }

    // ---------------------------------------------------------------- commands

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        String sub = args.length > 0 ? args[0].toLowerCase() : "status";
        switch (sub) {
            case "status" -> sender.sendMessage(Component.text(Json.stringify(scene.status())));
            case "reset" -> sender.sendMessage(Component.text(Json.stringify(scene.reset())));
            default -> sender.sendMessage(Component.text("usage: /loom <status|reset>"));
        }
        return true;
    }
}
