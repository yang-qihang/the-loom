package dev.loomcraft.mc;

import io.papermc.paper.event.player.AsyncChatEvent;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.Bukkit;
import org.bukkit.Difficulty;
import org.bukkit.GameMode;
import org.bukkit.GameRule;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.entity.Entity;
import org.bukkit.entity.EntityType;
import org.bukkit.entity.Mob;
import org.bukkit.entity.Player;
import org.bukkit.entity.TextDisplay;
import org.bukkit.entity.Display.Billboard;
import org.bukkit.util.Transformation;
import org.joml.AxisAngle4f;
import org.joml.Vector3f;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.player.PlayerMoveEvent;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.ItemMeta;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.UUID;

/**
 * Data-driven scene/session manager (T2).
 *
 * <p>Two-phase scene flow used by {@code packages/worldport/src/paper-port.ts}:
 * <ol>
 *   <li>{@code session.begin {levelId,seed}} — fresh session (sessionId + epoch), clear events.</li>
 *   <li>{@code content.prepare(port)} — content declares props through setBlocks/clearRegion/spawnEntity/
 *       setTime/setWeather; the plugin records what happened (no per-level Java branches).</li>
 *   <li>{@code session.finalize {layout}} — derive floor/pillars/walls from recorded scene + layout,
 *       spawn deferred NPCs, teleport bots, give kit, snapshot the checkpoint.</li>
 * </ol>
 * The legacy single-call {@code session.prepare {levelId,layout}} path (T1 / engine) is still supported.
 *
 * <p>"Virtual blocks" (item ids that level content uses as blocks: egg, wheat_sprout, …) are placed as
 * a physical fallback material and reported back with the requested id in snapshots; virtualPlace
 * records block.place events so grading is unchanged.
 */
public final class SceneManager implements Listener {
    private final LoomPlugin plugin;

    private String sessionId = "";
    private int epoch = 0;
    private String phase = "idle"; // idle | begin | ready
    private boolean prepared = false;
    private boolean building = false;

    private String levelId = "L01";
    private boolean annotationsVisible = true;
    private int seed = 1;
    private Map<String, Object> vars = new LinkedHashMap<>();
    private int[] regionFrom = {-20, 8, -10};
    private int[] regionTo = {8, 18, 28};
    private int floorY = 10;
    private int groundY = 11;
    private int timeTicks = 12000;
    private String weather = "clear";
    private final Map<String, Object> gamerules = new LinkedHashMap<>();

    private final Map<String, String> baseBlocks = new TreeMap<>(); // checkpoint: "x,y,z" -> physical id
    private final Map<String, String> baseAlias = new TreeMap<>();  // checkpoint: "x,y,z" -> requested id
    private final Map<String, String> alias = new TreeMap<>();      // live virtual ids
    private final Set<String> placedPositions = new LinkedHashSet<>();
    private final Set<String> tracked = new LinkedHashSet<>();

    private final Set<String> bots = new LinkedHashSet<>();
    private String agentId = "golem";
    private String agentName = "灰崽";
    private int[] agentSpawn = {0, 11, 0};
    private int[] rawAgentSpawn = null;
    private int[] playerSpawn = null;
    private final List<String> kit = new ArrayList<>();

    private static final class NpcSpec {
        String id;
        String type;
        String name;
        int[] rawPos;
        int[] pos;
    }

    private final List<NpcSpec> npcSpecs = new ArrayList<>();
    private final Map<String, Entity> npcEntities = new LinkedHashMap<>();

    private int[] recordedRegionFrom = null;
    private int[] recordedRegionTo = null;
    private Integer recordedTime = null;
    private String recordedWeather = null;

    private final List<Map<String, Object>> events = new ArrayList<>();
    private int seq = 0;
    private final Map<String, double[]> lastBotMove = new HashMap<>();

    private String lastResetHash = "";
    private long lastResetMs = 0L;

    public SceneManager(LoomPlugin plugin) {
        this.plugin = plugin;
        gamerules.put("doDaylightCycle", false);
        gamerules.put("doMobSpawning", false);
        gamerules.put("doFireTick", false);
        gamerules.put("keepInventory", true);
    }

    // ------------------------------------------------------------------ accessors

    public boolean isPrepared() {
        return prepared;
    }

    public Set<String> bots() {
        return bots;
    }

    public World world() {
        return plugin.getServer().getWorlds().get(0);
    }

    public void checkSession(Map<String, Object> params) {
        if (params != null && params.get("sessionId") instanceof String sid && !sid.equals(sessionId)) {
            throw new IllegalArgumentException("STALE_SESSION: expected " + sessionId + " got " + sid);
        }
    }

    public Map<String, Object> status() {
        Map<String, Object> m = Json.obj();
        m.put("ok", true);
        m.put("plugin", "loomcraft-mc");
        m.put("version", plugin.getPluginMeta().getVersion());
        m.put("mc", Bukkit.getMinecraftVersion());
        m.put("tick", Bukkit.getCurrentTick());
        m.put("phase", phase);
        m.put("prepared", prepared);
        m.put("levelId", levelId);
        m.put("sessionId", sessionId);
        m.put("epoch", epoch);
        m.put("groundY", groundY);
        m.put("bots", new ArrayList<>(bots));
        m.put("npcs", new ArrayList<>(npcEntities.keySet()));
        m.put("regionFrom", Json.vecList(regionFrom));
        m.put("regionTo", Json.vecList(regionTo));
        m.put("agentSpawn", Json.vecList(agentSpawn));
        m.put("playerSpawn", playerSpawn == null ? null : Json.vecList(playerSpawn));
        double cx = (regionFrom[0] + regionTo[0]) / 2.0;
        double cz = (regionFrom[2] + regionTo[2]) / 2.0;
        m.put("center", java.util.List.of(cx, (double) groundY, cz));
        m.put("tracked", tracked.size());
        m.put("events", events.size());
        m.put("lastResetHash", lastResetHash);
        m.put("lastResetMs", lastResetMs);
        return m;
    }

    // ------------------------------------------------------------------ session phases

    public Map<String, Object> begin(Map<String, Object> params) {
        clearAnnotations();
        sessionId = UUID.randomUUID().toString();
        epoch += 1;
        phase = "begin";
        prepared = false;
        levelId = Json.str(params.get("levelId"), "L01");
        seed = Json.num(params.get("seed"), 1);
        vars = params.get("vars") instanceof Map<?, ?> ? Json.map(params.get("vars")) : new LinkedHashMap<>();
        if (params.get("groundY") != null) groundY = Json.num(params.get("groundY"), groundY);
        baseBlocks.clear();
        baseAlias.clear();
        alias.clear();
        placedPositions.clear();
        tracked.clear();
        npcSpecs.clear();
        npcEntities.clear();
        events.clear();
        seq = 0;
        lastBotMove.clear();
        recordedRegionFrom = null;
        recordedRegionTo = null;
        recordedTime = null;
        recordedWeather = null;
        rawAgentSpawn = null;
        agentId = "golem";
        agentName = "灰崽";
        playerSpawn = null;
        kit.clear();
        Map<String, Object> res = status();
        res.put("ok", true);
        return res;
    }

    /** Recorded content-painter calls, useful for layout derivation / debugging. */
    public Map<String, Object> prepareCalls() {
        Map<String, Object> m = Json.obj();
        if (recordedRegionFrom != null) {
            m.put("clearRegionFrom", Json.vecList(recordedRegionFrom));
            m.put("clearRegionTo", Json.vecList(recordedRegionTo));
        }
        if (recordedTime != null) m.put("timeTicks", recordedTime);
        if (recordedWeather != null) m.put("weather", recordedWeather);
        m.put("blocks", baseBlocks.size());
        m.put("regionFrom", Json.vecList(regionFrom));
        m.put("regionTo", Json.vecList(regionTo));
        m.put("agentSpawn", Json.vecList(agentSpawn));
        m.put("playerSpawn", playerSpawn == null ? null : Json.vecList(playerSpawn));
        double cx = (regionFrom[0] + regionTo[0]) / 2.0;
        double cz = (regionFrom[2] + regionTo[2]) / 2.0;
        m.put("center", java.util.List.of(cx, (double) groundY, cz));
        m.put("tracked", tracked.size());
        return m;
    }

    /**
     * Phase 3: derive the physical arena from the recorded scene + layout and make the session ready.
     * Layout keys: arena{from,to,floorY,groundY}, tracked, agentSpawn, playerSpawn, timeTicks,
     * weather, gamerules, kit[].
     */
    public Map<String, Object> finalizeScene(Map<String, Object> params) {
        if (!"begin".equals(phase) && !"idle".equals(phase)) {
            throw new IllegalStateException("SESSION_NOT_BEGIN: phase=" + phase);
        }
        Map<String, Object> layout = params.get("layout") instanceof Map<?, ?>
                ? Json.map(params.get("layout")) : params;
        if (sessionId.isEmpty()) {
            sessionId = UUID.randomUUID().toString();
            epoch += 1;
        }
        building = true;
        try {
            groundY = Json.num(layout.get("groundY"), rawAgentSpawn != null ? rawAgentSpawn[1] : groundY);
            floorY = Json.num(layout.get("floorY"), groundY - 1);
            if (layout.get("arena") instanceof Map<?, ?> arena) {
                if (arena.get("from") != null) regionFrom = Json.vec3(arena.get("from"));
                if (arena.get("to") != null) regionTo = Json.vec3(arena.get("to"));
            } else if (recordedRegionFrom != null) {
                regionFrom = recordedRegionFrom.clone();
                regionTo = recordedRegionTo.clone();
            } else {
                int[] bbox = bboxOfKnownPoints(10);
                regionFrom = new int[]{bbox[0], floorY - 1, bbox[2]};
                regionTo = new int[]{bbox[3], groundY + 4, bbox[5]};
            }

            if (layout.get("agentSpawn") != null) rawAgentSpawn = Json.vec3(layout.get("agentSpawn"));
            for (Object o : Json.list(layout.get("tracked"))) tracked.add(key(Json.vec3(o)));
            for (Object o : Json.list(layout.get("lamps"))) tracked.add(key(Json.vec3(o)));
            for (Object o : Json.list(layout.get("optionalLamp"))) tracked.add(key(Json.vec3(o)));

            agentSpawn = rawAgentSpawn != null ? snapToGround(rawAgentSpawn) : new int[]{0, groundY, 0};
            if (layout.get("playerSpawn") != null) {
                playerSpawn = Json.vec3(layout.get("playerSpawn"));
            } else {
                playerSpawn = new int[]{(regionFrom[0] + regionTo[0]) / 2, groundY,
                        (regionFrom[2] + regionTo[2]) / 2};
            }
            kit.clear();
            for (Object o : Json.list(layout.get("kit"))) {
                String name = Json.str(o, null);
                if (name != null) kit.add(name);
            }

            buildArena();
            spawnDeferredNpcs();

            if (layout.get("timeTicks") != null) timeTicks = Json.num(layout.get("timeTicks"), timeTicks);
            else if (recordedTime != null) timeTicks = recordedTime;
            if (layout.get("weather") != null) weather = Json.str(layout.get("weather"), weather);
            else if (recordedWeather != null) weather = recordedWeather;
            if (layout.get("gamerules") instanceof Map<?, ?> gr) {
                for (Map.Entry<String, Object> e : Json.map(gr).entrySet()) gamerules.put(e.getKey(), e.getValue());
            }
            applyWorldState();
            teleportActorsToSpawns();
            giveBotsKit();
            phase = "ready";
            prepared = true;
            clearEvents();
        } finally {
            building = false;
        }
        Map<String, Object> res = status();
        res.put("ok", true);
        res.put("layout", prepareCalls());
        return res;
    }

    private int[] bboxOfKnownPoints(int margin) {
        int minX = Integer.MAX_VALUE, minZ = Integer.MAX_VALUE, maxX = Integer.MIN_VALUE, maxZ = Integer.MIN_VALUE;
        List<int[]> pts = new ArrayList<>(pointsFromVars(vars));
        for (String k : tracked) pts.add(parseKey(k));
        for (String k : baseBlocks.keySet()) pts.add(parseKey(k));
        if (rawAgentSpawn != null) pts.add(rawAgentSpawn);
        for (NpcSpec s : npcSpecs) if (s.rawPos != null) pts.add(s.rawPos);
        if (pts.isEmpty()) return new int[]{-16, floorY - 1, -16, 16, groundY + 4, 16};
        for (int[] p : pts) {
            minX = Math.min(minX, p[0]);
            maxX = Math.max(maxX, p[0]);
            minZ = Math.min(minZ, p[2]);
            maxZ = Math.max(maxZ, p[2]);
        }
        return new int[]{minX - margin, floorY - 1, minZ - margin, maxX + margin, groundY + 4, maxZ + margin};
    }

    private void buildArena() {
        World world = world();
        for (int x = regionFrom[0]; x <= regionTo[0]; x++) {
            for (int z = regionFrom[2]; z <= regionTo[2]; z++) {
                Block b = world.getBlockAt(x, floorY, z);
                if (b.getType() == Material.AIR) setBase(world, x, floorY, z, "minecraft:moss_block");
            }
        }
        for (int x = regionFrom[0]; x <= regionTo[0]; x++) {
            wallCell(world, x, groundY, regionFrom[2]);
            wallCell(world, x, groundY, regionTo[2]);
        }
        for (int z = regionFrom[2]; z <= regionTo[2]; z++) {
            wallCell(world, regionFrom[0], groundY, z);
            wallCell(world, regionTo[0], groundY, z);
        }
        // 墙上的暖光：每 8 格一盏灯笼，让边界不是一整片灰墙。
        for (int x = regionFrom[0] + 3; x < regionTo[0]; x += 8) {
            setBase(world, x, groundY + 1, regionFrom[2], "minecraft:lantern");
            setBase(world, x, groundY + 1, regionTo[2], "minecraft:lantern");
        }
        for (int z = regionFrom[2] + 3; z < regionTo[2]; z += 8) {
            setBase(world, regionFrom[0], groundY + 1, z, "minecraft:lantern");
            setBase(world, regionTo[0], groundY + 1, z, "minecraft:lantern");
        }
        for (String k : new ArrayList<>(tracked)) {
            int[] p = parseKey(k);
            if (p[1] <= groundY) continue;
            for (int py = groundY; py <= p[1] - 1; py++) {
                Block b = world.getBlockAt(p[0], py, p[2]);
                if (b.getType() == Material.AIR) setBase(world, p[0], py, p[2], "minecraft:stone_bricks");
            }
        }
    }

    private void wallCell(World world, int x, int y, int z) {
        Block b = world.getBlockAt(x, y, z);
        if (b.getType() != Material.AIR) return;
        int hash = Math.floorMod(x * 31 + z * 17, 7);
        String material = hash == 0 ? "minecraft:mossy_stone_bricks" : hash == 1 ? "minecraft:stone_bricks" : "minecraft:stone_bricks";
        setBase(world, x, y, z, material);
    }

    public Map<String, Object> setAnnotations(Map<String, Object> params) {
        checkSession(params);
        clearAnnotations();
        int count = 0;
        for (Object entryObj : Json.list(params.get("entries"))) {
            Map<String, Object> entry = Json.map(entryObj);
            int[] pos = Json.vec3(entry.get("pos"));
            String text = Json.str(entry.get("text"), "");
            if (text.isBlank()) continue;
            TextDisplay display = world().spawn(new Location(world(), pos[0] + 0.5, pos[1], pos[2] + 0.5), TextDisplay.class);
            display.text(net.kyori.adventure.text.Component.text(text));
            display.setBillboard(Billboard.CENTER);
            display.setSeeThrough(true);
            display.setShadowed(true);
            display.setDefaultBackground(false);
            display.setViewRange(64f);
            display.setTransformation(new Transformation(new Vector3f(0f, 0f, 0f), new AxisAngle4f(0f, 0f, 0f, 1f), new Vector3f(1.2f, 1.2f, 1.2f), new AxisAngle4f(0f, 0f, 0f, 1f)));
            display.addScoreboardTag("loom-annotation");
            count++;
        }
        plugin.getLogger().info("annotations spawned: " + count);
        Map<String, Object> res = Json.obj(); res.put("ok", true); res.put("count", count); return res;
    }

    public Map<String, Object> clearAnnotations() {
        if (world() == null) return Json.obj();
        for (TextDisplay display : world().getEntitiesByClass(TextDisplay.class)) {
            if (display.getScoreboardTags().contains("loom-annotation")) display.remove();
        }
        Map<String, Object> res = Json.obj(); res.put("ok", true); return res;
    }

    public Map<String, Object> setAnnotationsVisible(Map<String, Object> params) {
        annotationsVisible = Json.bool(params.get("visible"), true);
        for (TextDisplay display : world().getEntitiesByClass(TextDisplay.class)) {
            if (display.getScoreboardTags().contains("loom-annotation")) display.setViewRange(annotationsVisible ? 64f : 0f);
        }
        Map<String, Object> res = Json.obj(); res.put("ok", true); res.put("visible", annotationsVisible); return res;
    }

    private void spawnDeferredNpcs() {
        for (NpcSpec spec : npcSpecs) {
            spec.pos = snapToGround(spec.rawPos);
            npcEntities.put(spec.id, spawnNpc(spec.type, spec.name, spec.pos));
        }
    }

    private int[] snapToGround(int[] pos) {
        if (pos == null) return new int[]{0, groundY, 0};
        if (Math.abs(pos[1] - groundY) > 12) return new int[]{pos[0], groundY, pos[2]};
        return pos;
    }

    // ------------------------------------------------------------------ legacy single-call prepare (T1/engine)

    public Map<String, Object> prepare(Map<String, Object> params) {
        Map<String, Object> layout = params.get("layout") instanceof Map<?, ?> ? Json.map(params.get("layout")) : params;
        begin(Json.obj("levelId", Json.str(params.get("levelId"), Json.str(layout.get("levelId"), "L01"))));
        this.seed = Json.num(layout.get("seed"), 1);
        vars = layout.get("vars") instanceof Map<?, ?> ? Json.map(layout.get("vars")) : new LinkedHashMap<>();
        building = true;
        try {
            if (layout.get("arena") instanceof Map<?, ?> arena) {
                if (arena.get("from") != null) regionFrom = Json.vec3(arena.get("from"));
                if (arena.get("to") != null) regionTo = Json.vec3(arena.get("to"));
                floorY = Json.num(arena.get("floorY"), groundY - 1);
                groundY = Json.num(arena.get("groundY"), groundY);
            }
            if (layout.get("agentSpawn") != null) agentSpawn = Json.vec3(layout.get("agentSpawn"));
            if (layout.get("playerSpawn") != null) playerSpawn = Json.vec3(layout.get("playerSpawn"));
            for (Object o : Json.list(layout.get("tracked"))) tracked.add(key(Json.vec3(o)));
            for (Object o : Json.list(layout.get("lamps"))) tracked.add(key(Json.vec3(o)));
            for (Object o : Json.list(layout.get("optionalLamp"))) tracked.add(key(Json.vec3(o)));
            if (layout.get("gamerules") instanceof Map<?, ?> gr) {
                for (Map.Entry<String, Object> e : Json.map(gr).entrySet()) gamerules.put(e.getKey(), e.getValue());
            }
            for (Object o : Json.list(layout.get("kit"))) {
                String name = Json.str(o, null);
                if (name != null) kit.add(name);
            }
            timeTicks = Json.num(layout.get("timeTicks"), 12000);
            clearBox(regionFrom, regionTo);
            buildArena();
            applyWorldState();
            teleportActorsToSpawns();
            giveBotsKit();
            clearEvents();
            phase = "ready";
            prepared = true;
        } finally {
            building = false;
        }
        return status();
    }

    // ------------------------------------------------------------------ content painter (recorded)

    public Map<String, Object> setBlocks(Map<String, Object> params) {
        checkSession(params);
        List<Object> entries = Json.list(params.get("entries"));
        World world = world();
        int applied = 0;
        building = true;
        try {
            for (Object entryObj : entries) {
                Map<String, Object> entry = Json.map(entryObj);
                int[] pos = Json.vec3(entry.get("pos"));
                setRecorded(world, pos, norm(Json.str(entry.get("block"), "minecraft:air")));
                applied++;
            }
        } finally {
            building = false;
        }
        Map<String, Object> res = Json.obj();
        res.put("ok", true);
        res.put("applied", applied);
        res.put("tick", Bukkit.getCurrentTick());
        return res;
    }

    public Map<String, Object> clearRegion(Map<String, Object> params) {
        checkSession(params);
        int[] from = Json.vec3(params.get("from"));
        int[] to = Json.vec3(params.get("to"));
        if (recordedRegionFrom == null) {
            recordedRegionFrom = from.clone();
            recordedRegionTo = to.clone();
        }
        clearBox(from, to);
        Map<String, Object> res = Json.obj();
        res.put("ok", true);
        res.put("tick", Bukkit.getCurrentTick());
        return res;
    }

    public Map<String, Object> setTime(Map<String, Object> params) {
        checkSession(params);
        timeTicks = Json.num(params.get("ticks"), 12000);
        recordedTime = timeTicks;
        world().setTime(timeTicks);
        Map<String, Object> res = Json.obj();
        res.put("ok", true);
        res.put("time", timeTicks);
        return res;
    }

    public Map<String, Object> setWeather(Map<String, Object> params) {
        checkSession(params);
        weather = Json.str(params.get("weather"), "clear");
        recordedWeather = weather;
        applyWeather();
        Map<String, Object> res = Json.obj();
        res.put("ok", true);
        res.put("weather", weather);
        return res;
    }

    /** Debug/read helper: physical block at a position plus the live virtual alias. */
    public Map<String, Object> blockAt(Map<String, Object> params) {
        int[] pos = Json.vec3(params.get("pos"));
        String k = key(pos);
        Block b = world().getBlockAt(pos[0], pos[1], pos[2]);
        Map<String, Object> res = Json.obj();
        res.put("ok", true);
        res.put("physical", b.getType().getKey().toString());
        res.put("id", alias.getOrDefault(k, b.getType().getKey().toString()));
        res.put("logical", alias.containsKey(k) || baseAlias.containsKey(k));
        return res;
    }

    /** Debug: count non-air physical blocks in the current arena slice. */
    public Map<String, Object> regionCount(Map<String, Object> params) {
        int fromY = Json.num(params.get("fromY"), floorY - 1);
        int toY = Json.num(params.get("toY"), groundY + 4);
        int nonAir = 0, floorNonAir = 0;
        for (int x = regionFrom[0]; x <= regionTo[0]; x++) {
            for (int z = regionFrom[2]; z <= regionTo[2]; z++) {
                if (world().getBlockAt(x, floorY, z).getType() != Material.AIR) floorNonAir++;
            }
        }
        for (int x = regionFrom[0]; x <= regionTo[0]; x++) {
            for (int y = fromY; y <= toY; y++) {
                for (int z = regionFrom[2]; z <= regionTo[2]; z++) {
                    if (world().getBlockAt(x, y, z).getType() != Material.AIR) nonAir++;
                }
            }
        }
        Map<String, Object> res = Json.obj();
        res.put("ok", true);
        res.put("region", Json.arr(Json.vecList(regionFrom), Json.vecList(regionTo)));
        res.put("floorY", floorY);
        res.put("groundY", groundY);
        res.put("floorNonAir", floorNonAir);
        res.put("floorCells", (regionTo[0] - regionFrom[0] + 1) * (regionTo[2] - regionFrom[2] + 1));
        res.put("nonAir", nonAir);
        return res;
    }

    public Map<String, Object> classify(Map<String, Object> params) {
        String requested = norm(Json.str(params.get("block"), "minecraft:air"));
        Material physical = physicalMaterial(requested);
        Map<String, Object> res = Json.obj();
        res.put("ok", true);
        res.put("block", requested);
        res.put("physical", physical.getKey().toString());
        boolean virtual = !requested.equals("minecraft:air") && !requested.equals(physical.getKey().toString());
        res.put("isBlock", !virtual);
        res.put("virtual", virtual);
        return res;
    }

    /** Place a virtual block / overwrite (mock "place" semantics): records block.place for grading. */
    public Map<String, Object> virtualPlace(Map<String, Object> params) {
        checkSession(params);
        int[] pos = Json.vec3(params.get("pos"));
        String requested = norm(Json.str(params.get("block"), "minecraft:air"));
        String actor = Json.str(params.get("actor"), "golem");
        building = true;
        try {
            setLive(world(), pos, requested);
        } finally {
            building = false;
        }
        boolean isBot = bots.contains(actor);
        emit("block.place", actor, isBot ? "agent" : "player", pos, Map.of("block", requested));
        Map<String, Object> res = Json.obj();
        res.put("ok", true);
        res.put("pos", Json.vecList(pos));
        res.put("block", requested);
        return res;
    }

    private void setRecorded(World world, int[] pos, String requested) {
        String k = key(pos);
        tracked.add(k);
        placedPositions.remove(k);
        if (isLogicalPlane(requested, pos[1])) {
            baseAlias.put(k, requested);
            alias.put(k, requested);
            baseBlocks.remove(k);
            return;
        }
        Material physical = physicalMaterial(requested);
        world.getBlockAt(pos[0], pos[1], pos[2]).setType(physical, false);
        String physicalId = physical.getKey().toString();
        baseBlocks.put(k, physicalId);
        if (!requested.equals(physicalId)) baseAlias.put(k, requested);
        else baseAlias.remove(k);
    }

    private void setLive(World world, int[] pos, String requested) {
        String k = key(pos);
        placedPositions.add(k);
        tracked.add(k);
        String prior = alias.containsKey(k) ? alias.get(k) : baseAlias.get(k);
        boolean priorLogical = prior != null && LOGICAL_PLANE.contains(prior);
        if (isLogicalPlane(requested, pos[1]) || (pos[1] == groundY && requested.equals("minecraft:air") && priorLogical)) {
            if (requested.equals("minecraft:air")) alias.remove(k);
            else alias.put(k, requested);
            return;
        }
        Material physical = physicalMaterial(requested);
        world.getBlockAt(pos[0], pos[1], pos[2]).setType(physical, false);
        String physicalId = physical.getKey().toString();
        if (!requested.equals(physicalId) && !requested.equals("minecraft:air")) alias.put(k, requested);
        else alias.remove(k);
    }

    /**
     * Blocks that live on the "logical plane" at {@code groundY} (farm soil/crops/water): storing them
     * physically would make the whole field a 1-block-high obstacle wall. They are kept as checkpoint
     * aliases and reported through snapshots; the walkable floor beneath them stays at floorY.
     */
    private static final Set<String> LOGICAL_PLANE = new LinkedHashSet<>(Set.of(
            "minecraft:farmland", "minecraft:water", "minecraft:wheat", "minecraft:wheat_sprout",
            "minecraft:wheat_seeds", "minecraft:carrots", "minecraft:potatoes", "minecraft:beetroots",
            // field border decoration must not become a 1-block wall the pathfinder cannot cross
            "minecraft:hay_block"));

    private boolean isLogicalPlane(String requested, int y) {
        return y == groundY && LOGICAL_PLANE.contains(requested);
    }

    private static final Map<String, String> FALLBACK = new LinkedHashMap<>();
    static {
        FALLBACK.put("minecraft:egg", "minecraft:turtle_egg");
        FALLBACK.put("minecraft:cake", "minecraft:cake");
        FALLBACK.put("minecraft:pumpkin", "minecraft:carved_pumpkin");
        FALLBACK.put("minecraft:wheat_sprout", "minecraft:wheat");
        FALLBACK.put("minecraft:wheat_seeds", "minecraft:wheat");
        FALLBACK.put("minecraft:fence", "minecraft:oak_fence");
    }

    private static Material physicalMaterial(String requested) {
        if (requested == null || requested.equals("minecraft:air")) return Material.AIR;
        Material mat = Material.matchMaterial(requested);
        if (mat != null && mat.isBlock()) return mat;
        String fallback = FALLBACK.get(requested);
        if (fallback != null) {
            Material fb = Material.matchMaterial(fallback);
            if (fb != null && fb.isBlock()) return fb;
        }
        Material wheat = Material.matchMaterial("minecraft:wheat");
        return wheat != null ? wheat : Material.STONE;
    }

    // ------------------------------------------------------------------ world state / actors

    private void applyWorldState() {
        World world = world();
        world.setTime(timeTicks);
        applyWeather();
        world.setDifficulty(Difficulty.PEACEFUL);
        for (Map.Entry<String, Object> e : gamerules.entrySet()) {
            GameRule<?> rule = gameRule(e.getKey());
            if (rule != null) setRule(world, rule, e.getValue());
        }
    }

    private void applyWeather() {
        World world = world();
        world.setStorm(weather.equals("rain") || weather.equals("thunder"));
        world.setThundering(weather.equals("thunder"));
    }

    @SuppressWarnings("unchecked")
    private static void setRule(World world, GameRule<?> rule, Object value) {
        if (rule.getType() == Boolean.class) world.setGameRule((GameRule<Boolean>) rule, Json.bool(value, false));
        else if (rule.getType() == Integer.class) world.setGameRule((GameRule<Integer>) rule, Json.num(value, 0));
    }

    private static GameRule<?> gameRule(String name) {
        return switch (name) {
            case "doDaylightCycle" -> GameRule.DO_DAYLIGHT_CYCLE;
            case "doMobSpawning" -> GameRule.DO_MOB_SPAWNING;
            case "doFireTick" -> GameRule.DO_FIRE_TICK;
            case "keepInventory" -> GameRule.KEEP_INVENTORY;
            case "doWeatherCycle" -> GameRule.DO_WEATHER_CYCLE;
            case "mobGriefing" -> GameRule.MOB_GRIEFING;
            case "randomTickSpeed" -> GameRule.RANDOM_TICK_SPEED;
            default -> null;
        };
    }

    private void teleportActorsToSpawns() {
        for (String name : bots) {
            Player p = player(name);
            if (p != null) {
                p.teleport(new Location(world(), agentSpawn[0] + 0.5, agentSpawn[1], agentSpawn[2] + 0.5));
                p.setGameMode(GameMode.SURVIVAL);
                p.setHealth(Math.min(20.0, p.getHealth()));
                p.setFoodLevel(20);
            }
        }
        for (Player p : Bukkit.getOnlinePlayers()) {
            if (!bots.contains(p.getName())) {
                p.teleport(new Location(world(), playerSpawn[0] + 0.5, playerSpawn[1], playerSpawn[2] + 0.5));
            }
        }
    }

    private void giveBotsKit() {
        for (String name : bots) {
            Player p = player(name);
            if (p == null) continue;
            p.getInventory().clear();
            ItemStack lanterns = new ItemStack(Material.LANTERN, 16);
            ItemMeta meta = lanterns.getItemMeta();
            meta.displayName(Component.text("织偶提灯"));
            lanterns.setItemMeta(meta);
            p.getInventory().addItem(lanterns);
            for (String item : kit) {
                Material mat = Material.matchMaterial(norm(item));
                if (mat == null || mat == Material.AIR) continue;
                p.getInventory().addItem(new ItemStack(mat, 64));
            }
            p.setGameMode(GameMode.SURVIVAL);
        }
    }

    // ------------------------------------------------------------------ entities

    public Map<String, Object> spawnEntity(Map<String, Object> params) {
        checkSession(params);
        String type = Json.str(params.get("type"), "villager");
        String id = Json.str(params.get("id"), type);
        String name = Json.str(params.get("name"), id);
        int[] rawPos = Json.vec3(params.get("pos"));
        if (type.equalsIgnoreCase("golem") || type.equalsIgnoreCase("agent")) {
            agentId = id;
            agentName = name;
            rawAgentSpawn = rawPos;
            Map<String, Object> res = Json.obj();
            res.put("ok", true);
            res.put("agent", id);
            res.put("name", name);
            res.put("rawPos", Json.vecList(rawPos));
            if ("ready".equals(phase)) {
                agentSpawn = snapToGround(rawPos);
                teleportActorsToSpawns();
                res.put("pos", Json.vecList(agentSpawn));
            }
            return res;
        }
        NpcSpec spec = new NpcSpec();
        spec.id = id;
        spec.type = type;
        spec.name = name;
        spec.rawPos = rawPos;
        npcSpecs.add(spec);
        Map<String, Object> res = Json.obj();
        res.put("ok", true);
        res.put("id", id);
        res.put("type", type);
        if ("ready".equals(phase)) {
            spec.pos = snapToGround(rawPos);
            Entity e = spawnNpc(type, name, spec.pos);
            npcEntities.put(id, e);
            res.put("uuid", e.getUniqueId().toString());
            res.put("pos", Json.vecList(spec.pos));
        } else {
            res.put("deferred", true);
            res.put("rawPos", Json.vecList(rawPos));
        }
        return res;
    }

    private Entity spawnNpc(String type, String name, int[] pos) {
        World world = world();
        EntityType entityType = EntityType.fromName(type.toLowerCase(Locale.ROOT));
        if (entityType == null) entityType = EntityType.VILLAGER;
        Entity entity = world.spawnEntity(new Location(world, pos[0] + 0.5, pos[1], pos[2] + 0.5), entityType);
        entity.customName(Component.text(name));
        entity.setCustomNameVisible(true);
        entity.setPersistent(true);
        if (entity instanceof Mob mob) {
            mob.setAI(false);
            mob.setSilent(true);
        }
        return entity;
    }

    public Map<String, Object> clearEntities(List<String> ids) {
        if (ids == null || ids.isEmpty()) {
            for (Entity e : npcEntities.values()) e.remove();
            npcEntities.clear();
            npcSpecs.clear();
        } else {
            for (String id : ids) {
                Entity e = npcEntities.remove(id);
                if (e != null) e.remove();
                npcSpecs.removeIf(s -> s.id.equals(id));
            }
        }
        Map<String, Object> res = Json.obj();
        res.put("ok", true);
        res.put("remaining", npcEntities.size());
        return res;
    }

    // ------------------------------------------------------------------ players / events

    public Map<String, Object> teleportPlayer(Map<String, Object> params) {
        checkSession(params);
        int[] pos = Json.vec3(params.get("pos"));
        String name = Json.str(params.get("name"), null);
        Location loc = new Location(world(), pos[0] + 0.5, pos[1], pos[2] + 0.5);
        float yaw = Json.num(params.get("yaw"), 180);
        float pitch = Json.num(params.get("pitch"), 10);
        if (name != null) {
            Player p = player(name);
            if (p == null) return err("no_such_player:" + name);
            p.teleport(loc);
            p.setRotation(yaw, pitch);
        } else {
            for (Player p : Bukkit.getOnlinePlayers()) if (!bots.contains(p.getName())) { p.teleport(loc); p.setRotation(yaw, pitch); }
        }
        Map<String, Object> res = Json.obj();
        res.put("ok", true);
        res.put("pos", Json.vecList(pos));
        return res;
    }

    public Map<String, Object> givePlayer(Map<String, Object> params) {
        checkSession(params);
        Player p = player(Json.str(params.get("name"), null));
        if (p == null) return err("no_such_player");
        Material mat = Material.matchMaterial(norm(Json.str(params.get("item"), "minecraft:lantern")));
        if (mat == null) return err("bad_item");
        int count = Json.num(params.get("count"), 1);
        p.getInventory().addItem(new ItemStack(mat, count));
        Map<String, Object> res = Json.obj();
        res.put("ok", true);
        res.put("gave", mat.getKey().toString());
        res.put("count", count);
        return res;
    }

    public Map<String, Object> setBots(List<String> names) {
        bots.clear();
        bots.addAll(names);
        Map<String, Object> res = Json.obj();
        res.put("ok", true);
        res.put("bots", new ArrayList<>(bots));
        return res;
    }

    public Map<String, Object> playerPlace(Map<String, Object> params) {
        checkSession(params);
        int[] pos = Json.vec3(params.get("pos"));
        String requested = norm(Json.str(params.get("block"), "minecraft:lantern"));
        building = true;
        try {
            setLive(world(), pos, requested);
        } finally {
            building = false;
        }
        emit("block.place", "player", "player", pos, Map.of("block", requested));
        Map<String, Object> res = Json.obj();
        res.put("ok", true);
        res.put("pos", Json.vecList(pos));
        res.put("block", requested);
        return res;
    }

    @EventHandler
    public void onBlockPlace(BlockPlaceEvent event) {
        if (building || !prepared) return;
        Player p = event.getPlayer();
        boolean isBot = bots.contains(p.getName());
        Block b = event.getBlockPlaced();
        int[] pos = {b.getX(), b.getY(), b.getZ()};
        String k = key(pos);
        placedPositions.add(k);
        tracked.add(k);
        alias.remove(k);
        emit("block.place", p.getName(), isBot ? "agent" : "player", pos,
                Map.of("block", b.getType().getKey().toString()));
    }

    @EventHandler
    public void onPlayerMove(PlayerMoveEvent event) {
        if (building || !prepared) return;
        String name = event.getPlayer().getName();
        if (!bots.contains(name)) return;
        Location to = event.getTo();
        double[] last = lastBotMove.get(name);
        double moved = last == null ? 99 : Math.hypot(to.getX() - last[0], to.getZ() - last[2]);
        if (moved < 0.4) return;
        lastBotMove.put(name, new double[]{to.getX(), to.getY(), to.getZ()});
        emit("agent.move", name, "agent", new int[]{(int) Math.floor(to.getX()),
                (int) Math.floor(to.getY()), (int) Math.floor(to.getZ())}, Map.of());
    }

    @EventHandler
    public void onChat(AsyncChatEvent event) {
        if (building || !prepared) return;
        String name = event.getPlayer().getName();
        if (!bots.contains(name)) return;
        String text = PlainTextComponentSerializer.plainText().serialize(event.message());
        Player p = event.getPlayer();
        int[] pos = {(int) Math.floor(p.getLocation().getX()), (int) Math.floor(p.getLocation().getY()),
                (int) Math.floor(p.getLocation().getZ())};
        emit("say", name, "agent", pos, Map.of("text", text));
    }

    /** Record an explicit agent position (bot adapter uses it when it skips walking because it is already near). */
    public Map<String, Object> markAgentMove(Map<String, Object> params) {
        checkSession(params);
        int[] pos = Json.vec3(params.get("pos"));
        String actor = Json.str(params.get("actor"), firstBot() != null ? firstBot().getName() : "golem");
        emit("agent.move", actor, "agent", pos, Map.of());
        Map<String, Object> res = Json.obj();
        res.put("ok", true);
        return res;
    }

    private void emit(String type, String actor, String actorType, int[] pos, Map<String, Object> data) {
        seq += 1;
        Map<String, Object> ev = new LinkedHashMap<>();
        ev.put("seq", seq);
        ev.put("type", type);
        ev.put("tick", Bukkit.getCurrentTick());
        ev.put("actor", actor);
        ev.put("actorType", actorType);
        ev.put("pos", Json.vecList(pos));
        ev.put("data", data == null ? new LinkedHashMap<>() : data);
        events.add(ev);
        if (events.size() > 8000) events.subList(0, events.size() - 8000).clear();
    }

    public Map<String, Object> drainEvents(Map<String, Object> params) {
        checkSession(params);
        int since = Json.num(params != null ? params.get("since") : null, 0);
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> ev : events) if (Json.num(ev.get("seq"), 0) > since) out.add(ev);
        Map<String, Object> res = Json.obj();
        res.put("ok", true);
        res.put("events", out);
        res.put("lastSeq", seq);
        res.put("tick", Bukkit.getCurrentTick());
        return res;
    }

    private void clearEvents() {
        events.clear();
        seq = 0;
        lastBotMove.clear();
    }

    // ------------------------------------------------------------------ reset

    public Map<String, Object> reset() {
        long t0 = System.nanoTime();
        if (!prepared) {
            Map<String, Object> err = Json.obj();
            err.put("ok", false);
            err.put("error", "not_prepared");
            return err;
        }
        teleportActorsToSpawns();
        building = true;
        try {
            World world = world();
            Set<String> positions = new TreeSet<>();
            positions.addAll(baseBlocks.keySet());
            positions.addAll(placedPositions);
            positions.addAll(alias.keySet());
            positions.addAll(baseAlias.keySet());
            for (String k : positions) {
                int[] p = parseKey(k);
                Block b = world.getBlockAt(p[0], p[1], p[2]);
                String expected = baseBlocks.get(k);
                if (expected != null) {
                    Material want = Material.matchMaterial(expected);
                    if (want != null && b.getType() != want) b.setType(want, false);
                } else if (b.getType() != Material.AIR) {
                    b.setType(Material.AIR, false);
                }
            }
            alias.clear();
            alias.putAll(baseAlias);
            for (Entity e : npcEntities.values()) e.remove();
            npcEntities.clear();
            spawnDeferredNpcs();
            applyWorldState();
            teleportActorsToSpawns();
            giveBotsKit();
            placedPositions.clear();
            clearEvents();
        } finally {
            building = false;
        }
        lastResetHash = checkpointHash();
        lastResetMs = (System.nanoTime() - t0) / 1_000_000L;
        Map<String, Object> res = Json.obj();
        res.put("ok", true);
        res.put("ms", lastResetMs);
        res.put("hash", lastResetHash);
        res.put("tick", Bukkit.getCurrentTick());
        res.put("sessionId", sessionId);
        res.put("epoch", epoch);
        return res;
    }

    // ------------------------------------------------------------------ snapshot

    public Map<String, Object> snapshot(Map<String, Object> params) {
        checkSession(params);
        World world = world();
        Map<String, Object> snap = new LinkedHashMap<>();
        snap.put("levelId", Json.str(params != null ? params.get("levelId") : null, levelId));
        snap.put("seed", seed);
        snap.put("vars", vars);
        Map<String, Object> blocks = new LinkedHashMap<>();
        Set<String> positions = new LinkedHashSet<>(tracked);
        positions.addAll(placedPositions);
        positions.addAll(alias.keySet());
        positions.addAll(baseAlias.keySet());
        for (String k : positions) {
            int[] p = parseKey(k);
            String id = alias.get(k);
            if (id == null) id = world.getBlockAt(p[0], p[1], p[2]).getType().getKey().toString();
            blocks.put(k, id);
        }
        snap.put("blocks", blocks);
        Map<String, Object> agents = new LinkedHashMap<>();
        Map<String, Object> golem = new LinkedHashMap<>();
        Player agent = firstBot();
        if (agent != null) {
            Location l = agent.getLocation();
            golem.put("pos", Json.arr((int) Math.floor(l.getX()), (int) Math.floor(l.getY()), (int) Math.floor(l.getZ())));
        } else {
            golem.put("pos", Json.vecList(agentSpawn));
        }
        agents.put(agentId, golem);
        snap.put("agents", agents);
        Map<String, Object> npcs = new LinkedHashMap<>();
        for (Map.Entry<String, Entity> e : npcEntities.entrySet()) {
            if (!e.getValue().isValid()) continue;
            Location l = e.getValue().getLocation();
            Map<String, Object> npc = new LinkedHashMap<>();
            npc.put("pos", Json.arr((int) Math.floor(l.getX()), (int) Math.floor(l.getY()), (int) Math.floor(l.getZ())));
            npcs.put(e.getKey(), npc);
        }
        snap.put("npcs", npcs);
        snap.put("events", new ArrayList<>(events));
        snap.put("tick", Bukkit.getCurrentTick());
        snap.put("sessionId", sessionId);
        snap.put("epoch", epoch);
        return snap;
    }

    private String checkpointHash() {
        Map<String, Object> canonical = new LinkedHashMap<>();
        canonical.put("levelId", levelId);
        canonical.put("seed", seed);
        canonical.put("vars", vars);
        canonical.put("blocks", new TreeMap<>(baseBlocks));
        canonical.put("aliases", new TreeMap<>(baseAlias));
        Map<String, Object> agents = new LinkedHashMap<>();
        Map<String, Object> golem = new LinkedHashMap<>();
        golem.put("pos", Json.vecList(agentSpawn));
        agents.put(agentId, golem);
        canonical.put("agents", agents);
        canonical.put("npcs", npcSpecs.stream().map(s -> s.id).sorted().toList());
        canonical.put("bots", bots.stream().sorted().toList());
        String json = Json.stringify(canonical);
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] digest = md.digest(json.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder("sha256:");
            for (byte b : digest) sb.append(String.format("%02x", b));
            return sb.toString();
        } catch (Exception e) {
            return "unhashable";
        }
    }

    // ------------------------------------------------------------------ helpers

    public Player player(String name) {
        if (name == null) return null;
        Player exact = Bukkit.getPlayerExact(name);
        if (exact != null) return exact;
        for (Player p : Bukkit.getOnlinePlayers()) if (p.getName().equalsIgnoreCase(name)) return p;
        return null;
    }

    public Player firstBot() {
        for (String name : bots) {
            Player p = player(name);
            if (p != null) return p;
        }
        return null;
    }

    private void clearBox(int[] from, int[] to) {
        World world = world();
        for (int x = Math.min(from[0], to[0]); x <= Math.max(from[0], to[0]); x++) {
            for (int y = Math.min(from[1], to[1]); y <= Math.max(from[1], to[1]); y++) {
                for (int z = Math.min(from[2], to[2]); z <= Math.max(from[2], to[2]); z++) {
                    world.getBlockAt(x, y, z).setType(Material.AIR, false);
                    String k = key(x, y, z);
                    baseBlocks.remove(k);
                    baseAlias.remove(k);
                    alias.remove(k);
                    placedPositions.remove(k);
                }
            }
        }
        Location center = new Location(world, (from[0] + to[0]) / 2.0, (from[1] + to[1]) / 2.0, (from[2] + to[2]) / 2.0);
        double dx = Math.abs(to[0] - from[0]) / 2.0 + 1, dy = Math.abs(to[1] - from[1]) / 2.0 + 1,
                dz = Math.abs(to[2] - from[2]) / 2.0 + 1;
        for (Entity e : world.getNearbyEntities(center, dx, dy, dz)) if (!(e instanceof Player)) e.remove();
    }

    private void setBase(World world, int x, int y, int z, String blockId) {
        world.getBlockAt(x, y, z).setType(physicalMaterial(norm(blockId)), false);
        baseBlocks.put(key(x, y, z), blockId);
    }

    private static List<int[]> pointsFromVars(Map<String, Object> vars) {
        List<int[]> out = new ArrayList<>();
        collectPoints(vars, out);
        return out;
    }

    @SuppressWarnings("unchecked")
    private static void collectPoints(Object node, List<int[]> out) {
        if (node instanceof Map<?, ?> m) {
            for (Object v : ((Map<String, Object>) m).values()) collectPoints(v, out);
        } else if (node instanceof List<?> l) {
            if (l.size() == 3 && l.get(0) instanceof Number && l.get(1) instanceof Number && l.get(2) instanceof Number) {
                out.add(new int[]{((Number) l.get(0)).intValue(), ((Number) l.get(1)).intValue(),
                        ((Number) l.get(2)).intValue()});
            } else {
                for (Object v : l) collectPoints(v, out);
            }
        }
    }

    private static String norm(String blockId) {
        if (blockId == null || blockId.isEmpty()) return "minecraft:air";
        String s = blockId.toLowerCase(Locale.ROOT);
        return s.contains(":") ? s : "minecraft:" + s;
    }

    private static String key(int x, int y, int z) {
        return x + "," + y + "," + z;
    }

    private static String key(int[] p) {
        return key(p[0], p[1], p[2]);
    }

    private static int[] parseKey(String k) {
        String[] parts = k.split(",");
        return new int[]{Integer.parseInt(parts[0]), Integer.parseInt(parts[1]), Integer.parseInt(parts[2])};
    }

    public static Map<String, Object> err(String message) {
        Map<String, Object> m = Json.obj();
        m.put("ok", false);
        m.put("error", message);
        return m;
    }
}
