package dev.loom.spike;

import com.destroystokyo.paper.profile.PlayerProfile;
import io.papermc.paper.datacomponent.item.ResolvableProfile;
import net.kyori.adventure.text.Component;
import org.bukkit.Bukkit;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Display;
import org.bukkit.entity.Entity;
import org.bukkit.entity.EntityType;
import org.bukkit.entity.ItemDisplay;
import org.bukkit.entity.Mannequin;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.inventory.ItemStack;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.scheduler.BukkitTask;
import org.java_websocket.WebSocket;
import org.java_websocket.handshake.ClientHandshake;
import org.java_websocket.server.WebSocketServer;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Spike plugin v2 (task-17): minimal world-facing surface needed to test
 * "two bots build a bridge" + visual fallbacks (Mannequin skin, ItemDisplay animation).
 *
 * RPC additions over v1:
 *  world.fill / world.block / events.drain / bots.set / player.teleport / player.gamemode /
 *  player.give / player.clear / entity.mannequin / display.spawnItem / display.animate / display.remove
 * Plus BlockPlaceEvent -> event log with actorType (bot vs player) for grading evidence.
 */
public final class LoomSpikePlugin extends JavaPlugin implements Listener {
    public static final int WS_PORT = 8765;
    private WsServer ws;
    private final AtomicInteger rpcCount = new AtomicInteger();
    private final Set<String> botNames = new HashSet<>();
    private final List<String> eventLog = new ArrayList<>();
    private final Map<UUID, ItemDisplay> displays = new HashMap<>();
    private final Map<UUID, BukkitTask> displayTasks = new HashMap<>();

    @Override
    public void onEnable() {
        Bukkit.getPluginManager().registerEvents(this, this);
        ws = new WsServer(new InetSocketAddress("127.0.0.1", WS_PORT));
        ws.start();
        getLogger().info("LOOM SPIKE v2 ENABLED on " + Bukkit.getVersion()
                + " / bukkit=" + Bukkit.getBukkitVersion());
    }

    @Override
    public void onDisable() {
        for (BukkitTask t : displayTasks.values()) t.cancel();
        if (ws != null) {
            try {
                ws.stop(1000);
            } catch (Exception ignored) {
            }
        }
    }

    // ---------------------------------------------------------------- events

    @EventHandler
    public void onBlockPlace(BlockPlaceEvent event) {
        Player p = event.getPlayer();
        Block b = event.getBlockPlaced();
        boolean isBot = botNames.contains(p.getName());
        synchronized (eventLog) {
            eventLog.add("{\"type\":\"block.place\",\"tick\":" + Bukkit.getCurrentTick()
                    + ",\"x\":" + b.getX() + ",\"y\":" + b.getY() + ",\"z\":" + b.getZ()
                    + ",\"block\":\"" + esc(b.getType().getKey().toString()) + "\""
                    + ",\"by\":\"" + esc(p.getName()) + "\""
                    + ",\"actorType\":\"" + (isBot ? "bot" : "player") + "\""
                    + ",\"byPlayer\":" + (!isBot) + "}");
        }
    }

    // ---------------------------------------------------------------- commands

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        String sub = args.length > 0 ? args[0].toLowerCase(Locale.ROOT) : "hello";
        switch (sub) {
            case "hello" -> sender.sendMessage(Component.text(
                    "LOOM hello from plugin v2 on " + Bukkit.getBukkitVersion() + " tick=" + Bukkit.getCurrentTick()));
            case "snapshot" -> sender.sendMessage(Component.text(snapshotJson(2)));
            case "ws" -> sender.sendMessage(Component.text(
                    "ws://127.0.0.1:" + WS_PORT + " clients=" + ws.getConnections().size()
                            + " rpc=" + rpcCount.get() + " events=" + eventLog.size()));
            case "spawn" -> {
                Player p = firstPlayer();
                if (p != null) spawnTestEntity(p.getLocation().add(2, 0, 0));
            }
            default -> sender.sendMessage(Component.text("usage: /loom <hello|snapshot|ws|spawn>"));
        }
        return true;
    }

    private Player firstPlayer() {
        for (Player p : Bukkit.getOnlinePlayers()) return p;
        return null;
    }

    private World world() {
        return Bukkit.getWorlds().get(0);
    }

    private Entity spawnTestEntity(Location loc) {
        return loc.getWorld().spawnEntity(loc, EntityType.ARMOR_STAND);
    }

    // --------------------------------------------------------------- snapshot

    private String snapshotJson(int radius) {
        Player p = firstPlayer();
        if (p == null) return "{\"ok\":false,\"error\":\"no_player\"}";
        Location c = p.getLocation();
        World w = p.getWorld();
        StringBuilder sb = new StringBuilder();
        sb.append("{\"ok\":true,\"tick\":").append(Bukkit.getCurrentTick());
        sb.append(",\"player\":{\"name\":\"").append(esc(p.getName()))
                .append("\",\"world\":\"").append(esc(w.getKey().toString()))
                .append("\",\"x\":").append(fmt(c.getX()))
                .append(",\"y\":").append(fmt(c.getY()))
                .append(",\"z\":").append(fmt(c.getZ()))
                .append(",\"gamemode\":\"").append(esc(p.getGameMode().name())).append("\"}");
        sb.append(",\"blocks\":[");
        boolean first = true;
        int bx = c.getBlockX(), by = c.getBlockY(), bz = c.getBlockZ();
        for (int dx = -radius; dx <= radius; dx++)
            for (int dy = -radius - 1; dy <= radius; dy++)
                for (int dz = -radius; dz <= radius; dz++) {
                    Block b = w.getBlockAt(bx + dx, by + dy, bz + dz);
                    if (b.getType() == Material.AIR) continue;
                    if (!first) sb.append(',');
                    first = false;
                    sb.append("{\"x\":").append(bx + dx).append(",\"y\":").append(by + dy)
                            .append(",\"z\":").append(bz + dz)
                            .append(",\"type\":\"").append(esc(b.getType().getKey().toString())).append("\"}");
                }
        sb.append("],\"entities\":[");
        first = true;
        for (Entity e : w.getNearbyEntities(c, radius + 4, radius + 4, radius + 4)) {
            if (!first) sb.append(',');
            first = false;
            Location el = e.getLocation();
            sb.append("{\"uuid\":\"").append(e.getUniqueId())
                    .append("\",\"type\":\"").append(esc(e.getType().getKey().toString()))
                    .append("\",\"x\":").append(fmt(el.getX()))
                    .append(",\"y\":").append(fmt(el.getY()))
                    .append(",\"z\":").append(fmt(el.getZ())).append('}');
        }
        sb.append("]}");
        return sb.toString();
    }

    // ---------------------------------------------------------------- JSON-RPC

    private String handleRpc(String message) {
        try {
            if (message.contains("\"method\":\"ping\"")) {
                return "{\"ok\":true,\"pong\":true,\"rpc\":" + rpcCount.get() + "}";
            }
            if (message.contains("\"method\":\"world.fill\"")) {
                int[] from = triple(message, "from");
                int[] to = triple(message, "to");
                String blockId = optString(message, "block", "minecraft:air");
                if (from == null || to == null) return "{\"ok\":false,\"error\":\"bad_coords\"}";
                Material mat = Material.matchMaterial(blockId);
                if (mat == null) return "{\"ok\":false,\"error\":\"bad_block\"}";
                World w = world();
                int n = 0;
                for (int x = Math.min(from[0], to[0]); x <= Math.max(from[0], to[0]); x++)
                    for (int y = Math.min(from[1], to[1]); y <= Math.max(from[1], to[1]); y++)
                        for (int z = Math.min(from[2], to[2]); z <= Math.max(from[2], to[2]); z++) {
                            w.getBlockAt(x, y, z).setType(mat, false);
                            n++;
                        }
                return "{\"ok\":true,\"filled\":" + n + ",\"tick\":" + Bukkit.getCurrentTick() + "}";
            }
            if (message.contains("\"method\":\"world.block\"")) {
                int x = optInt(message, "x", 0), y = optInt(message, "y", 0), z = optInt(message, "z", 0);
                Block b = world().getBlockAt(x, y, z);
                return "{\"ok\":true,\"block\":\"" + esc(b.getType().getKey().toString()) + "\""
                        + ",\"data\":\"" + esc(b.getBlockData().getAsString()) + "\"}";
            }
            if (message.contains("\"method\":\"events.drain\"")) {
                List<String> copy;
                synchronized (eventLog) {
                    copy = new ArrayList<>(eventLog);
                    eventLog.clear();
                }
                return "{\"ok\":true,\"events\":[" + String.join(",", copy) + "]}";
            }
            if (message.contains("\"method\":\"bots.set\"")) {
                botNames.clear();
                Matcher m = Pattern.compile("\"names\"\\s*:\\s*\\[([^\\]]*)]").matcher(message);
                if (m.find()) {
                    for (String s : m.group(1).split(",")) {
                        String name = s.trim().replace("\"", "");
                        if (!name.isEmpty()) botNames.add(name);
                    }
                }
                return "{\"ok\":true,\"bots\":[" + String.join(",",
                        botNames.stream().map(n -> "\"" + esc(n) + "\"").toList()) + "]}";
            }
            if (message.contains("\"method\":\"player.say\"")) {
                String name = optString(message, "name", "");
                String text = optString(message, "text", "");
                Player p = Bukkit.getPlayerExact(name);
                if (p == null) return "{\"ok\":false,\"error\":\"no_such_player\"}";
                p.sendMessage(Component.text(text));
                return "{\"ok\":true,\"sent_to\":\"" + esc(name) + "\"}";
            }
            if (message.contains("\"method\":\"player.teleport\"")) {
                String name = optString(message, "name", "");
                Player p = Bukkit.getPlayerExact(name);
                if (p == null) return "{\"ok\":false,\"error\":\"no_such_player\"}";
                double x = optDouble(message, "x", 0), y = optDouble(message, "y", 0), z = optDouble(message, "z", 0);
                float yaw = (float) optDouble(message, "yaw", 0), pitch = (float) optDouble(message, "pitch", 0);
                p.teleport(new Location(p.getWorld(), x, y, z, yaw, pitch));
                return "{\"ok\":true,\"pos\":\"" + fmt(x) + "," + fmt(y) + "," + fmt(z) + "\"}";
            }
            if (message.contains("\"method\":\"player.gamemode\"")) {
                String name = optString(message, "name", "");
                Player p = Bukkit.getPlayerExact(name);
                if (p == null) return "{\"ok\":false,\"error\":\"no_such_player\"}";
                p.setGameMode(GameMode.valueOf(optString(message, "mode", "survival").toUpperCase(Locale.ROOT)));
                return "{\"ok\":true,\"gamemode\":\"" + p.getGameMode().name() + "\"}";
            }
            if (message.contains("\"method\":\"player.give\"")) {
                String name = optString(message, "name", "");
                Player p = Bukkit.getPlayerExact(name);
                if (p == null) return "{\"ok\":false,\"error\":\"no_such_player\"}";
                Material mat = Material.matchMaterial(optString(message, "item", "minecraft:oak_planks"));
                if (mat == null) return "{\"ok\":false,\"error\":\"bad_item\"}";
                int count = optInt(message, "count", 1);
                p.getInventory().addItem(new ItemStack(mat, count));
                return "{\"ok\":true,\"gave\":\"" + esc(mat.getKey().toString()) + "x" + count + "\"}";
            }
            if (message.contains("\"method\":\"player.clear\"")) {
                Player p = Bukkit.getPlayerExact(optString(message, "name", ""));
                if (p == null) return "{\"ok\":false,\"error\":\"no_such_player\"}";
                p.getInventory().clear();
                return "{\"ok\":true}";
            }
            if (message.contains("\"method\":\"entity.spawn\"")) {
                Player p = firstPlayer();
                if (p == null) return "{\"ok\":false,\"error\":\"no_player\"}";
                Entity e = spawnTestEntity(p.getLocation().add(2, 0, 0));
                return "{\"ok\":true,\"uuid\":\"" + e.getUniqueId() + "\",\"type\":\""
                        + esc(e.getType().getKey().toString()) + "\"}";
            }
            if (message.contains("\"method\":\"entity.mannequin\"")) {
                double x = optDouble(message, "x", 0), y = optDouble(message, "y", 0), z = optDouble(message, "z", 0);
                String name = optString(message, "name", "Mannequin");
                String skin = optString(message, "skin", "");
                World w = world();
                Mannequin mannequin = (Mannequin) w.spawnEntity(new Location(w, x, y, z), EntityType.MANNEQUIN);
                mannequin.setImmovable(true);
                mannequin.customName(Component.text(name));
                mannequin.setCustomNameVisible(true);
                String profileInfo = "none";
                try {
                    UUID uuid = UUID.nameUUIDFromBytes(("OfflinePlayer:" + name).getBytes(StandardCharsets.UTF_8));
                    PlayerProfile profile = Bukkit.createProfile(uuid, name);
                    if (!skin.isEmpty()) {
                        org.bukkit.profile.PlayerTextures textures = profile.getTextures();
                        textures.setSkin(new java.net.URL(skin));
                        profile.setTextures(textures);
                    }
                    mannequin.setProfile(ResolvableProfile.resolvableProfile(profile));
                    profileInfo = String.valueOf(mannequin.getProfile());
                } catch (Exception ex) {
                    profileInfo = "profile_error:" + ex.getMessage();
                }
                return "{\"ok\":true,\"uuid\":\"" + mannequin.getUniqueId() + "\",\"type\":\""
                        + esc(mannequin.getType().getKey().toString()) + "\",\"profile\":\"" + esc(profileInfo) + "\"}";
            }
            if (message.contains("\"method\":\"display.spawnItem\"")) {
                double x = optDouble(message, "x", 0), y = optDouble(message, "y", 0), z = optDouble(message, "z", 0);
                Material mat = Material.matchMaterial(optString(message, "item", "minecraft:oak_planks"));
                if (mat == null) return "{\"ok\":false,\"error\":\"bad_item\"}";
                World w = world();
                ItemDisplay display = w.spawn(new Location(w, x, y, z), ItemDisplay.class);
                display.setItemStack(new ItemStack(mat, 1));
                display.setBillboard(Display.Billboard.CENTER);
                display.setTeleportDuration(2);
                display.setInterpolationDuration(4);
                display.setInterpolationDelay(0);
                displays.put(display.getUniqueId(), display);
                return "{\"ok\":true,\"uuid\":\"" + display.getUniqueId() + "\"}";
            }
            if (message.contains("\"method\":\"display.animate\"")) {
                UUID uuid;
                try {
                    uuid = UUID.fromString(optString(message, "uuid", ""));
                } catch (IllegalArgumentException ex) {
                    return "{\"ok\":false,\"error\":\"bad_uuid\"}";
                }
                ItemDisplay display = displays.get(uuid);
                if (display == null) return "{\"ok\":false,\"error\":\"no_such_display\"}";
                int[] from = triple(message, "from");
                int[] to = triple(message, "to");
                int ticks = Math.max(1, optInt(message, "ticks", 100));
                if (from == null || to == null) return "{\"ok\":false,\"error\":\"bad_coords\"}";
                BukkitTask[] holder = new BukkitTask[1];
                final int[] t = {0};
                holder[0] = Bukkit.getScheduler().runTaskTimer(this, () -> {
                    t[0]++;
                    double ratio = Math.min(1.0, (double) t[0] / ticks);
                    double x = from[0] + (to[0] - from[0]) * ratio;
                    double y = from[1] + (to[1] - from[1]) * ratio;
                    double z = from[2] + (to[2] - from[2]) * ratio;
                    display.teleport(new Location(display.getWorld(), x, y, z));
                    if (t[0] >= ticks) {
                        holder[0].cancel();
                    }
                }, 0L, 1L);
                displayTasks.put(uuid, holder[0]);
                return "{\"ok\":true,\"ticks\":" + ticks + "}";
            }
            if (message.contains("\"method\":\"display.remove\"")) {
                UUID uuid;
                try {
                    uuid = UUID.fromString(optString(message, "uuid", ""));
                } catch (IllegalArgumentException ex) {
                    return "{\"ok\":false,\"error\":\"bad_uuid\"}";
                }
                ItemDisplay display = displays.remove(uuid);
                BukkitTask task = displayTasks.remove(uuid);
                if (task != null) task.cancel();
                if (display == null) return "{\"ok\":false,\"error\":\"no_such_display\"}";
                display.remove();
                return "{\"ok\":true}";
            }
            if (message.contains("\"method\":\"world.snapshot\"")) {
                int firstComma = message.indexOf(',');
                String body = firstComma < 0 ? "" : message.substring(firstComma);
                Matcher mx = Pattern.compile("\"x\"\\s*:\\s*(-?\\d+)").matcher(body);
                Matcher my = Pattern.compile("\"y\"\\s*:\\s*(-?\\d+)").matcher(body);
                Matcher mz = Pattern.compile("\"z\"\\s*:\\s*(-?\\d+)").matcher(body);
                if (!mx.find() || !my.find() || !mz.find()) return "{\"ok\":false,\"error\":\"missing_x_y_z\"}";
                int x = Integer.parseInt(mx.group(1));
                int y = Integer.parseInt(my.group(1));
                int z = Integer.parseInt(mz.group(1));
                int radius = optInt(message, "radius", 2);
                StringBuilder sb = new StringBuilder();
                sb.append("{\"ok\":true,\"tick\":").append(Bukkit.getCurrentTick())
                        .append(",\"center\":{\"x\":").append(x).append(",\"y\":").append(y)
                        .append(",\"z\":").append(z).append("},\"blocks\":[");
                World w = world();
                boolean first = true;
                for (int dx = -radius; dx <= radius; dx++)
                    for (int dy = -radius; dy <= radius; dy++)
                        for (int dz = -radius; dz <= radius; dz++) {
                            Block b = w.getBlockAt(x + dx, y + dy, z + dz);
                            if (b.getType() == Material.AIR) continue;
                            if (!first) sb.append(',');
                            first = false;
                            sb.append("{\"x\":").append(x + dx).append(",\"y\":").append(y + dy)
                                    .append(",\"z\":").append(z + dz)
                                    .append(",\"type\":\"").append(esc(b.getType().getKey().toString())).append("\"}");
                        }
                sb.append("]}");
                return sb.toString();
            }
            if (message.contains("\"method\":\"world.setblock\"")) {
                int x = optInt(message, "x", 0), y = optInt(message, "y", 0), z = optInt(message, "z", 0);
                Material mat = Material.matchMaterial(optString(message, "block", "minecraft:gold_block"));
                if (mat == null) return "{\"ok\":false,\"error\":\"bad_block\"}";
                world().getBlockAt(x, y, z).setType(mat, false);
                return "{\"ok\":true,\"set\":\"" + esc(mat.getKey().toString()) + "\"}";
            }
            return "{\"ok\":false,\"error\":\"unknown_method\"}";
        } catch (Exception ex) {
            return "{\"ok\":false,\"error\":\"" + esc(String.valueOf(ex.getMessage())) + "\"}";
        }
    }

    // ---------------------------------------------------------------- helpers

    private static int[] triple(String message, String key) {
        Matcher m = Pattern.compile("\"" + key + "\"\\s*:\\s*\\[\\s*(-?\\d+)\\s*,\\s*(-?\\d+)\\s*,\\s*(-?\\d+)\\s*]")
                .matcher(message);
        if (!m.find()) return null;
        return new int[]{Integer.parseInt(m.group(1)), Integer.parseInt(m.group(2)), Integer.parseInt(m.group(3))};
    }

    private static String optString(String message, String key, String def) {
        Matcher m = Pattern.compile("\"" + key + "\"\\s*:\\s*\"([^\"]*)\"").matcher(message);
        return m.find() ? m.group(1) : def;
    }

    private static int optInt(String message, String key, int def) {
        Matcher m = Pattern.compile("\"" + key + "\"\\s*:\\s*(-?\\d+)").matcher(message);
        return m.find() ? Integer.parseInt(m.group(1)) : def;
    }

    private static double optDouble(String message, String key, double def) {
        Matcher m = Pattern.compile("\"" + key + "\"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)").matcher(message);
        return m.find() ? Double.parseDouble(m.group(1)) : def;
    }

    private static String esc(String s) {
        return s == null ? "" : s.replace("\\", "\\\\").replace("\"", "\\\"");
    }

    private static String fmt(double d) {
        return String.format(Locale.ROOT, "%.2f", d);
    }

    // ------------------------------------------------------------- WS server

    private final class WsServer extends WebSocketServer {
        WsServer(InetSocketAddress address) {
            super(address);
            setReuseAddr(true);
        }

        @Override
        public void onOpen(WebSocket conn, ClientHandshake handshake) {
            getLogger().info("WS client connected: " + conn.getRemoteSocketAddress());
        }

        @Override
        public void onClose(WebSocket conn, int code, String reason, boolean remote) {
            getLogger().info("WS client closed: " + conn.getRemoteSocketAddress() + " code=" + code);
        }

        @Override
        public void onMessage(WebSocket conn, String message) {
            rpcCount.incrementAndGet();
            Bukkit.getScheduler().runTask(LoomSpikePlugin.this, () -> {
                String response = handleRpc(message);
                conn.send(response);
            });
        }

        @Override
        public void onError(WebSocket conn, Exception ex) {
            getLogger().warning("WS error: " + ex.getMessage());
        }

        @Override
        public void onStart() {
            getLogger().info("WS listening on ws://127.0.0.1:" + WS_PORT);
        }
    }
}
