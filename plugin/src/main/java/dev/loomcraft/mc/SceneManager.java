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
import org.bukkit.entity.ItemDisplay;
import org.bukkit.entity.Mob;
import org.bukkit.entity.Player;
import org.bukkit.entity.TextDisplay;
import org.bukkit.entity.Display.Billboard;
import org.bukkit.util.Transformation;
import org.bukkit.util.Vector;
import org.joml.AxisAngle4f;
import org.joml.Vector3f;
import org.bukkit.event.Event;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.block.Action;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.event.player.PlayerMoveEvent;
import org.bukkit.event.player.PlayerJoinEvent;
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
    /** 运行期被清成空气的格子（从 baseAlias 虚拟块上收走/挖掉）：快照必须报 air 而不是 checkpoint 里的旧虚拟块。 */
    private final Set<String> liveAir = new TreeSet<>();
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
    /**
     * 本会话通过 {@code player.give} 发给真人玩家的道具清单（item id -> 数量）。
     * begin/finalize/reset/onPlayerJoin 都按这份清单重建快捷栏：每关打开都是纯净背包，
     * 切关/重进不会残留上一关道具，也不再需要 pendingPlayerItems 补发旧道具。
     */
    private final Map<String, Integer> playerKit = new LinkedHashMap<>();

    /** 会话产物实体统一打 tag，begin/session.end 时按 tag 全局清理（覆盖进程重启残留）。 */
    private static final String TAG_SESSION_ENTITY = "loom-session-entity";
    private static final String TAG_ANNOTATION = "loom-annotation";
    private static final String TAG_BEAT_MARKER = "loom-beat-marker";
    /** 服务端本次启动后是否已做过一次高台沙盒带清扫。 */
    private boolean startupCleanupDone = false;

    /** finalize 时建立的 arena 全区域 checkpoint："x,y,z" -> 物理方块 id（只记非空气）。 */
    private final Map<String, String> checkpoint = new TreeMap<>();

    /** 玩家节拍（织者之印）的一条目标。 */
    private static final class BeatSpec {
        final int[] pos;
        final String block;
        boolean done = false;

        BeatSpec(int[] pos, String block) {
            this.pos = pos;
            this.block = block;
        }
    }

    /** 录制的玩家节拍：arm 静默登记，activate 后允许完成。 */
    private final List<BeatSpec> beats = new ArrayList<>();
    private final List<Entity> beatMarkers = new ArrayList<>();
    /** 允许触发容错交互的手持道具（本关 player.give 记录）。 */
    private final Set<String> beatItems = new LinkedHashSet<>();
    /** 全部 beat 完成后应用的特效（time/weather）。 */
    private final List<Map<String, Object>> beatEffects = new ArrayList<>();
    private String beatHint = "";
    private boolean beatArmed = false;
    private boolean beatActive = false;

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
        m.put("checkpointSize", checkpoint.size());
        m.put("playerKit", new LinkedHashMap<>(playerKit));
        m.put("playerBeat", playerBeatStatus(null));
        m.put("lastResetHash", lastResetHash);
        m.put("lastResetMs", lastResetMs);
        return m;
    }

    // ------------------------------------------------------------------ session phases

    public Map<String, Object> begin(Map<String, Object> params) {
        long t0 = System.nanoTime();
        // 服务端本次启动后的第一次 begin：专用沙盒世界里上一轮进程的残留（无 tag 的旧 NPC/标记/掉落物、
        // 高台沙盒带里的关卡方块）全部清掉，老用户的脏世界不用换世界也能自愈。
        if (!startupCleanupDone) {
            startupCleanup();
            startupCleanupDone = true;
        }
        // 清上一会话的物理场景 + 会话产物实体，再清内存状态：切关不把上一关世界带进下一关。
        clearBox(regionFrom, regionTo);
        removeAllNonPlayerEntities(false);
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
        liveAir.clear();
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
        playerKit.clear();
        checkpoint.clear();
        clearBeatState(true);
        // 每关打开都是纯净快捷栏：内容层 afterPrepare 的 player.give 会重新发本关道具。
        clearPlayerInventories();
        Map<String, Object> res = status();
        res.put("ok", true);
        res.put("cleanupMs", (System.nanoTime() - t0) / 1_000_000L);
        return res;
    }

    /** 专用沙盒世界的启动清扫（每次服务端进程只做一次）。 */
    private void startupCleanup() {
        // 先扫高台沙盒带（y 56–92、x/z ±48）：这个循环会把带内 chunk 载入，
        // 否则未加载 chunk 里上一轮进程留下的旧 NPC/标记实体扫不到。
        int blocks = 0;
        World world = world();
        for (int x = -48; x <= 48; x++) {
            for (int y = 56; y <= 92; y++) {
                for (int z = -48; z <= 48; z++) {
                    Block b = world.getBlockAt(x, y, z);
                    if (!b.getType().isAir()) {
                        b.setType(Material.AIR, false);
                        blocks++;
                    }
                }
            }
        }
        // chunk 载入后，专用沙盒世界里所有非玩家实体（旧 NPC/TextDisplay/掉落物）全是上一轮残留，清掉。
        int entities = removeAllNonPlayerEntities(false);
        plugin.getLogger().info("startup sandbox cleanup: entities=" + entities + " blocks=" + blocks);
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
            // 玩家快捷栏也重建：每关 finalize 后只保留本关 playerKit。
            clearPlayerInventories();
            givePlayerKits();
            // arena 全区域 checkpoint：reset 时按它全量还原（玩家挖掉的/乱放的都是这里记录的原始状态）。
            buildCheckpoint();
            phase = "ready";
            prepared = true;
            clearEvents();
            // 兼容接口契约里的 layout.playerBeat（正常流程由 paper-port 之后单独 playerBeat.arm）。
            if (layout.get("playerBeat") instanceof Map<?, ?> beatSpec) armBeat(Json.map(beatSpec));
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
            clearPlayerInventories();
            givePlayerKits();
            buildCheckpoint();
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
        liveAir.remove(k);
    }

    private void setLive(World world, int[] pos, String requested) {
        String k = key(pos);
        placedPositions.add(k);
        tracked.add(k);
        if (requested.equals("minecraft:air")) liveAir.add(k);
        else liveAir.remove(k);
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
        entity.addScoreboardTag(TAG_SESSION_ENTITY);
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
        String requestedName = Json.str(params.get("name"), null);
        Material mat = Material.matchMaterial(norm(Json.str(params.get("item"), "minecraft:lantern")));
        if (mat == null) return err("bad_item");
        int count = Math.max(1, Json.num(params.get("count"), 1));
        // 记录进本关 playerKit：begin/finalize/reset/onPlayerJoin 都按它重建快捷栏，
        // 所以这里不再依赖 pendingPlayerItems——没人在线时也直接入册，玩家进服时补发。
        playerKit.put(mat.getKey().toString(), count);
        int given = 0;
        for (Player p : Bukkit.getOnlinePlayers()) {
            if (bots.contains(p.getName())) continue;
            if (requestedName != null && !requestedName.equals(p.getName())) continue;
            clearPlayerInventory(p);
            givePlayerKit(p);
            given += 1;
        }
        Map<String, Object> res = Json.obj();
        res.put("ok", true);
        res.put("gave", mat.getKey().toString());
        res.put("count", count);
        res.put("players", given);
        res.put("kit", new LinkedHashMap<>(playerKit));
        if (given == 0) res.put("queued", true);
        return res;
    }

    /** 清空所有在线非 bot 玩家的背包（保留快捷栏纯净）。 */
    private void clearPlayerInventories() {
        for (Player p : Bukkit.getOnlinePlayers()) {
            if (!bots.contains(p.getName())) clearPlayerInventory(p);
        }
    }

    private static void clearPlayerInventory(Player p) {
        p.getInventory().clear();
        p.getInventory().setItemInOffHand(null);
    }

    /** 按本关 playerKit 给所有在线非 bot 玩家补道具。 */
    private void givePlayerKits() {
        for (Player p : Bukkit.getOnlinePlayers()) {
            if (!bots.contains(p.getName())) givePlayerKit(p);
        }
    }

    private void givePlayerKit(Player p) {
        int slot = 0;
        for (Map.Entry<String, Integer> entry : playerKit.entrySet()) {
            Material mat = Material.matchMaterial(entry.getKey());
            if (mat == null || mat == Material.AIR) continue;
            ItemStack stack = new ItemStack(mat, Math.max(1, entry.getValue()));
            if (slot == 0) p.getInventory().setItem(0, stack);
            else p.getInventory().addItem(stack);
            slot += 1;
        }
        if (slot > 0) p.getInventory().setHeldItemSlot(0);
    }

    /** reset/begin 后把非 bot 玩家放回基准位置。 */
    private void resetPlayersToSpawn() {
        for (Player p : Bukkit.getOnlinePlayers()) {
            if (bots.contains(p.getName())) continue;
            clearPlayerInventory(p);
            givePlayerKit(p);
            p.setGameMode(GameMode.SURVIVAL);
            if (playerSpawn != null) {
                p.teleport(new Location(world(), playerSpawn[0] + 0.5, playerSpawn[1], playerSpawn[2] + 0.5));
            }
        }
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

    // ------------------------------------------------------------------ player beat（织者之印）

    /**
     * 静默登记玩家节拍：只记录目标与允许道具，不显示标记、不允许完成。
     * paper-port 在 prepare 里以 recording 模式执行 content.playerBeat 后调用。
     */
    public Map<String, Object> armPlayerBeat(Map<String, Object> params) {
        checkSession(params);
        Map<String, Object> res = armBeat(params);
        res.put("ok", true);
        return res;
    }

    private Map<String, Object> armBeat(Map<String, Object> params) {
        clearBeatState(true);
        for (Object o : Json.list(params.get("beats"))) {
            Map<String, Object> beat = Json.map(o);
            int[] pos = Json.vec3(beat.get("pos"));
            String block = norm(Json.str(beat.get("block"), "minecraft:air"));
            if (block.equals("minecraft:air")) continue;
            beats.add(new BeatSpec(pos, block));
            tracked.add(key(pos));
        }
        for (Object o : Json.list(params.get("items"))) {
            String item = Json.str(o, null);
            if (item != null && !item.isBlank()) beatItems.add(norm(item));
        }
        beatEffects.clear();
        for (Object o : Json.list(params.get("effects"))) {
            Map<String, Object> effect = Json.map(o);
            if (!effect.isEmpty()) beatEffects.add(effect);
        }
        beatHint = Json.str(params.get("hint"), "");
        beatArmed = !beats.isEmpty();
        beatActive = false;
        // arm 在 afterPrepare 之后：此时场景才算最终（多 agent 起点等），刷新 checkpoint。
        if (prepared) buildCheckpoint();
        Map<String, Object> res = Json.obj();
        res.put("armed", beatArmed);
        res.put("beats", beats.size());
        res.put("items", new ArrayList<>(beatItems));
        return res;
    }

    /** 引擎判定 playerBeatReady 后调用：显示发光标记 + actionbar 提示，并允许完成。 */
    public Map<String, Object> activatePlayerBeat(Map<String, Object> params) {
        checkSession(params);
        if (!beatArmed || beats.isEmpty()) {
            Map<String, Object> res = err("player_beat_not_armed");
            res.put("ok", false);
            return res;
        }
        clearBeatMarkers();
        beatActive = true;
        for (int i = 0; i < beats.size(); i++) {
            if (!beats.get(i).done) spawnBeatMarker(i, beats.get(i));
        }
        String hint = beatHint.isBlank() ? "轮到你了：对准发光标记按右键" : beatHint;
        for (Player p : Bukkit.getOnlinePlayers()) {
            if (bots.contains(p.getName())) continue;
            p.sendActionBar(Component.text(hint));
            p.playSound(p.getLocation(), "minecraft:block.note_block.chime", 1.0f, 1.2f);
        }
        Map<String, Object> res = beatStatusMap();
        res.put("ok", true);
        res.put("hint", hint);
        plugin.getLogger().info("player beat activated: session=" + sessionId + " beats=" + beats.size());
        return res;
    }

    /** 调试/验收：armed/active/每条 beat 的完成状态。 */
    public Map<String, Object> playerBeatStatus(Map<String, Object> params) {
        checkSession(params);
        Map<String, Object> res = beatStatusMap();
        res.put("ok", true);
        return res;
    }

    private Map<String, Object> beatStatusMap() {
        Map<String, Object> m = Json.obj();
        m.put("sessionId", sessionId);
        m.put("armed", beatArmed);
        m.put("active", beatActive);
        m.put("hint", beatHint);
        List<Object> list = new ArrayList<>();
        boolean allDone = !beats.isEmpty();
        for (BeatSpec beat : beats) {
            Map<String, Object> entry = Json.obj();
            entry.put("pos", Json.vecList(beat.pos));
            entry.put("block", beat.block);
            entry.put("done", beat.done);
            list.add(entry);
            if (!beat.done) allDone = false;
        }
        m.put("beats", list);
        m.put("items", new ArrayList<>(beatItems));
        m.put("done", allDone);
        return m;
    }

    /** 引擎 dispose 会话时调用：清 NPC/标注/标记实体（方块留给下一次 begin 清）。 */
    public Map<String, Object> endSession(Map<String, Object> params) {
        checkSession(params);
        for (Entity e : npcEntities.values()) {
            if (e.isValid()) e.remove();
        }
        npcEntities.clear();
        clearBeatState(true);
        int purged = removeAllNonPlayerEntities(false);
        Map<String, Object> res = Json.obj();
        res.put("ok", true);
        res.put("purged", purged);
        return res;
    }

    // ------------------------------------------------------------------ player beat helpers

    private int beatIndexAt(int[] pos) {
        String k = key(pos);
        for (int i = 0; i < beats.size(); i++) {
            if (key(beats.get(i).pos).equals(k)) return i;
        }
        return -1;
    }

    /** 容错交互：手持本关道具 + 目标 6 格内 + 视线与目标方向点积 ≥ 0.7。 */
    private boolean toleranceMatch(Player p, BeatSpec beat) {
        ItemStack hand = p.getInventory().getItemInMainHand();
        if (hand == null || hand.getType().isAir()) return false;
        String held = hand.getType().getKey().toString();
        if (!beatItems.contains(held) && !held.equals(beat.block)) return false;
        Location eye = p.getEyeLocation();
        Vector toTarget = new Vector(
                beat.pos[0] + 0.5 - eye.getX(),
                beat.pos[1] + 0.5 - eye.getY(),
                beat.pos[2] + 0.5 - eye.getZ());
        double distance = toTarget.length();
        if (distance > 6.0 || distance < 0.01) return false;
        return eye.getDirection().dot(toTarget.normalize()) >= 0.7;
    }

    /** 完成一条 beat：必要时把方块放到目标坐标，发 block.place（actorType=player），给反馈。 */
    private void completeBeat(int index, Player p, String how) {
        BeatSpec beat = beats.get(index);
        if (beat.done) return;
        beat.done = true;
        removeBeatMarker(index);
        String block = beat.block;
        boolean placed = false;
        Block target = world().getBlockAt(beat.pos[0], beat.pos[1], beat.pos[2]);
        // 只有「真实方块 + 目标当前是空气」才由插件落块；交互型目标（钟/拉杆/笼门/护符盒）保持原方块。
        // 虚拟物品（loom_thread/potion）不是方块：只发事件+特效，不动世界。
        if (isBlockMaterial(block) && target.getType().isAir()) {
            target.setType(physicalMaterial(block), false);
            String physicalId = target.getType().getKey().toString();
            if (!block.equals(physicalId)) alias.put(key(beat.pos), block);
            else alias.remove(key(beat.pos));
            placed = true;
        }
        tracked.add(key(beat.pos));
        placedPositions.add(key(beat.pos));
        emit("block.place", p.getName(), "player", beat.pos, Map.of("block", block));
        Location at = new Location(world(), beat.pos[0] + 0.5, beat.pos[1] + 0.6, beat.pos[2] + 0.5);
        world().playSound(at, "minecraft:block.note_block.chime", 1.2f, 1.4f);
        world().spawnParticle(org.bukkit.Particle.END_ROD, at, 18, 0.3, 0.4, 0.3, 0.01);
        int remaining = 0;
        for (BeatSpec other : beats) if (!other.done) remaining++;
        if (remaining > 0) {
            p.sendActionBar(Component.text("织者之印 · 已记下（还剩 " + remaining + " 处）"));
            return;
        }
        applyBeatEffects();
        for (Player other : Bukkit.getOnlinePlayers()) {
            if (bots.contains(other.getName())) continue;
            other.showTitle(net.kyori.adventure.title.Title.title(
                    Component.text("最后一步完成"), Component.text("织者之印 · 已写入世界")));
            other.playSound(other.getLocation(), "minecraft:ui.toast.challenge_complete", 1.0f, 1.0f);
        }
        plugin.getLogger().info("player beat complete: beats=" + beats.size() + " actor=" + p.getName()
                + " via=" + how + " placed=" + placed);
    }

    private void applyBeatEffects() {
        World world = world();
        for (Map<String, Object> effect : beatEffects) {
            String kind = Json.str(effect.get("kind"), "");
            if (kind.equals("time")) {
                world.setTime(Json.num(effect.get("ticks"), timeTicks));
            } else if (kind.equals("weather")) {
                String value = Json.str(effect.get("weather"), "clear");
                world.setStorm(value.equals("rain") || value.equals("thunder"));
                world.setThundering(value.equals("thunder"));
            }
        }
    }

    private void spawnBeatMarker(int index, BeatSpec beat) {
        World world = world();
        boolean targetAir = world.getBlockAt(beat.pos[0], beat.pos[1], beat.pos[2]).getType().isAir();
        Location loc = new Location(world, beat.pos[0] + 0.5, beat.pos[1] + (targetAir ? 0.25 : 1.25), beat.pos[2] + 0.5);
        ItemDisplay display = world.spawn(loc, ItemDisplay.class);
        Material icon = Material.matchMaterial(beat.block);
        if (icon == null || icon == Material.AIR) icon = Material.STRING;
        display.setItemStack(new ItemStack(icon));
        display.setBillboard(Billboard.CENTER);
        display.setGlowing(true);
        display.setViewRange(64f);
        display.setPersistent(false);
        display.setTransformation(new Transformation(new Vector3f(0f, 0f, 0f), new AxisAngle4f(0f, 0f, 0f, 1f),
                new Vector3f(1.5f, 1.5f, 1.5f), new AxisAngle4f(0f, 0f, 0f, 1f)));
        display.addScoreboardTag(TAG_BEAT_MARKER);
        while (beatMarkers.size() <= index) beatMarkers.add(null);
        beatMarkers.set(index, display);
    }

    private void removeBeatMarker(int index) {
        if (index < beatMarkers.size()) {
            Entity marker = beatMarkers.get(index);
            if (marker != null && marker.isValid()) marker.remove();
            beatMarkers.set(index, null);
        }
    }

    private void clearBeatMarkers() {
        for (Entity marker : beatMarkers) {
            if (marker != null && marker.isValid()) marker.remove();
        }
        beatMarkers.clear();
        for (World w : Bukkit.getWorlds()) {
            for (Entity e : w.getEntities()) {
                if (!(e instanceof Player) && e.getScoreboardTags().contains(TAG_BEAT_MARKER)) e.remove();
            }
        }
    }

    private void clearBeatState(boolean clearArmed) {
        clearBeatMarkers();
        for (BeatSpec beat : beats) beat.done = false;
        beatActive = false;
        if (clearArmed) {
            beats.clear();
            beatItems.clear();
            beatEffects.clear();
            beatHint = "";
            beatArmed = false;
        }
    }

    /** 方块/物品判定：虚拟物品（loom_thread/potion）不是方块。 */
    private static boolean isBlockMaterial(String requested) {
        Material mat = Material.matchMaterial(requested);
        return mat != null && mat.isBlock();
    }

    // ------------------------------------------------------------------ debug / acceptance RPC

    /** 调试/验收：所有在线非 bot 玩家的背包物品名 + 数量。 */
    public Map<String, Object> playerInventory(Map<String, Object> params) {
        List<Object> players = new ArrayList<>();
        for (Player p : Bukkit.getOnlinePlayers()) {
            if (bots.contains(p.getName())) continue;
            List<Object> items = new ArrayList<>();
            for (ItemStack stack : p.getInventory().getContents()) {
                if (stack == null || stack.getType().isAir()) continue;
                Map<String, Object> item = Json.obj();
                item.put("item", stack.getType().getKey().toString());
                item.put("count", stack.getAmount());
                items.add(item);
            }
            Map<String, Object> entry = Json.obj();
            entry.put("name", p.getName());
            entry.put("items", items);
            players.add(entry);
        }
        Map<String, Object> res = Json.obj();
        res.put("ok", true);
        res.put("players", players);
        res.put("playerKit", new LinkedHashMap<>(playerKit));
        return res;
    }

    /** 调试/验收：批量读方块 id（先查虚拟方块别名，再读物理方块）。 */
    public Map<String, Object> worldBlocks(Map<String, Object> params) {
        checkSession(params);
        World world = world();
        Map<String, Object> blocks = new LinkedHashMap<>();
        for (Object o : Json.list(params.get("positions"))) {
            int[] pos = Json.vec3(o);
            String k = key(pos);
            // 与 snapshot 一致：live alias（player/golem 放的虚拟块）→ baseAlias（content prepare 摆的虚拟块，
            // 如蛋/幼苗）→ 物理方块。否则语义 API（collect/harvest）看不到 base 层的虚拟方块。
            String id = liveAir.contains(k) ? "minecraft:air" : alias.get(k);
            if (id == null) id = baseAlias.get(k);
            if (id == null) id = world.getBlockAt(pos[0], pos[1], pos[2]).getType().getKey().toString();
            blocks.put(k, id);
        }
        Map<String, Object> res = Json.obj();
        res.put("ok", true);
        res.put("blocks", blocks);
        return res;
    }


    @EventHandler
    public void onPlayerJoin(PlayerJoinEvent event) {
        if (!prepared) return;
        Player p = event.getPlayer();
        if (bots.contains(p.getName())) return;
        // 进服先清空背包再发本关 playerKit：不补发跨关旧道具，也不发“第 4 盏灯在哪”这类提前提示
        // （提前提示只允许由 playerBeat.activate 在引擎判定 ready 后触发）。
        clearPlayerInventory(p);
        givePlayerKit(p);
        if (playerSpawn != null) {
            p.teleport(new Location(world(), playerSpawn[0] + 0.5, playerSpawn[1], playerSpawn[2] + 0.5));
        }
        if (beatActive && !beatHint.isBlank()) p.sendActionBar(Component.text(beatHint));
    }

    @EventHandler
    public void onBlockPlace(BlockPlaceEvent event) {
        if (building || !prepared) return;
        Player p = event.getPlayer();
        boolean isBot = bots.contains(p.getName());
        Block b = event.getBlockPlaced();
        int[] pos = {b.getX(), b.getY(), b.getZ()};
        // 玩家节拍：真的把方块放到目标坐标就算完成；未 activate 前取消并提示（严格线性）。
        if (!isBot && beatArmed) {
            int hit = beatIndexAt(pos);
            if (hit >= 0 && !beats.get(hit).done) {
                if (!beatActive) {
                    event.setCancelled(true);
                    p.sendActionBar(Component.text("先让灰崽完成它那部分"));
                    return;
                }
                placedPositions.add(key(pos));
                tracked.add(key(pos));
                alias.remove(key(pos));
                completeBeat(hit, p, "place");
                return;
            }
        }
        String k = key(pos);
        placedPositions.add(k);
        tracked.add(k);
        alias.remove(k);
        emit("block.place", p.getName(), isBot ? "agent" : "player", pos,
                Map.of("block", b.getType().getKey().toString()));
    }

    @EventHandler
    public void onPlayerInteract(PlayerInteractEvent event) {
        if (building || !prepared || !beatArmed || beats.isEmpty()) return;
        Action action = event.getAction();
        if (action != Action.RIGHT_CLICK_BLOCK && action != Action.RIGHT_CLICK_AIR) return;
        Player p = event.getPlayer();
        if (bots.contains(p.getName())) return;
        Block clicked = event.getClickedBlock();
        int[] clickedPos = clicked == null ? null
                : new int[]{clicked.getX(), clicked.getY(), clicked.getZ()};
        int hit = -1;
        boolean onTarget = false;
        if (clickedPos != null) {
            hit = beatIndexAt(clickedPos);
            onTarget = hit >= 0 && !beats.get(hit).done;
        }
        if (!onTarget) {
            hit = -1;
            for (int i = 0; i < beats.size(); i++) {
                if (beats.get(i).done) continue;
                if (toleranceMatch(p, beats.get(i))) {
                    hit = i;
                    break;
                }
            }
        }
        if (hit < 0 || beats.get(hit).done) return;
        cancelInteraction(event);
        if (!beatActive) {
            // 严格线性：织偶那部分没完成前，会完成玩家节拍的操作一律拦下。
            p.sendActionBar(Component.text("先让灰崽完成它那部分"));
            return;
        }
        completeBeat(hit, p, onTarget ? "interact" : "tolerant");
    }

    private static void cancelInteraction(PlayerInteractEvent event) {
        event.setCancelled(true);
        event.setUseInteractedBlock(Event.Result.DENY);
        event.setUseItemInHand(Event.Result.DENY);
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
        return reset(null);
    }

    /**
     * 彻底 reset：按 checkpoint 全区域还原方块（玩家挖掉的、乱放的、上一关残留都还原/清掉），
     * 移除区域内的非会话实体，按登记重生 NPC，非 bot 玩家清背包→发 playerKit→回 playerSpawn，
     * 恢复时间/天气/gamerules，返回稳定 hash。
     */
    public Map<String, Object> reset(Map<String, Object> params) {
        checkSession(params);
        long t0 = System.nanoTime();
        if (!prepared) {
            Map<String, Object> err = Json.obj();
            err.put("ok", false);
            err.put("error", "not_prepared");
            return err;
        }
        int removedEntities;
        int restoredBlocks;
        building = true;
        try {
            World world = world();
            // 玩家节拍回到未激活：checkpoint 会还原目标方块状态，引擎之后会重新 activate。
            clearBeatState(false);
            removedEntities = removeAllNonPlayerEntities(true);
            for (Entity e : npcEntities.values()) {
                if (e.isValid()) e.remove();
            }
            npcEntities.clear();
            restoredBlocks = restoreCheckpoint();
            spawnDeferredNpcs();
            alias.clear();
            alias.putAll(baseAlias);
            liveAir.clear();
            placedPositions.clear();
            applyWorldState();
            teleportActorsToSpawns();
            giveBotsKit();
            resetPlayersToSpawn();
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
        res.put("checkpointSize", checkpoint.size());
        res.put("restoredBlocks", restoredBlocks);
        res.put("removedEntities", removedEntities);
        res.put("playerKit", new LinkedHashMap<>(playerKit));
        return res;
    }

    /** 构造 arena 全区域 checkpoint（只记非空气的物理方块 + 区域外由内容层登记的方块）。 */
    private void buildCheckpoint() {
        checkpoint.clear();
        World world = world();
        int minX = Math.min(regionFrom[0], regionTo[0]), maxX = Math.max(regionFrom[0], regionTo[0]);
        int minY = Math.min(regionFrom[1], regionTo[1]), maxY = Math.max(regionFrom[1], regionTo[1]);
        int minZ = Math.min(regionFrom[2], regionTo[2]), maxZ = Math.max(regionFrom[2], regionTo[2]);
        for (int x = minX; x <= maxX; x++) {
            for (int y = minY; y <= maxY; y++) {
                for (int z = minZ; z <= maxZ; z++) {
                    Block b = world.getBlockAt(x, y, z);
                    if (!b.getType().isAir()) checkpoint.put(key(x, y, z), b.getType().getKey().toString());
                }
            }
        }
        // 内容层摆到 arena 外面（例如高过区域上界的屋顶）的登记方块也纳入 checkpoint。
        for (Map.Entry<String, String> entry : baseBlocks.entrySet()) {
            if (checkpoint.containsKey(entry.getKey())) continue;
            Material mat = physicalMaterial(norm(entry.getValue()));
            if (mat != Material.AIR) checkpoint.put(entry.getKey(), mat.getKey().toString());
        }
    }

    /** 按 checkpoint 还原全区域：登记过的恢复原方块，没登记的（玩家乱放/挖掉后留空）恢复为空气。 */
    private int restoreCheckpoint() {
        World world = world();
        int changed = 0;
        for (Map.Entry<String, String> entry : checkpoint.entrySet()) {
            int[] p = parseKey(entry.getKey());
            Material want = Material.matchMaterial(entry.getValue());
            if (want == null) continue;
            Block b = world.getBlockAt(p[0], p[1], p[2]);
            if (b.getType() != want) {
                b.setType(want, false);
                changed++;
            }
        }
        int minX = Math.min(regionFrom[0], regionTo[0]), maxX = Math.max(regionFrom[0], regionTo[0]);
        int minY = Math.min(regionFrom[1], regionTo[1]), maxY = Math.max(regionFrom[1], regionTo[1]);
        int minZ = Math.min(regionFrom[2], regionTo[2]), maxZ = Math.max(regionFrom[2], regionTo[2]);
        for (int x = minX; x <= maxX; x++) {
            for (int y = minY; y <= maxY; y++) {
                for (int z = minZ; z <= maxZ; z++) {
                    String k = key(x, y, z);
                    if (checkpoint.containsKey(k)) continue;
                    Block b = world.getBlockAt(x, y, z);
                    if (!b.getType().isAir()) {
                        b.setType(Material.AIR, false);
                        changed++;
                    }
                }
            }
        }
        return changed;
    }

    /**
     * 专用沙盒世界：移除所有非玩家实体（旧 NPC/标注/玩家节拍标记/掉落物/误刷怪）。
     * keepAnnotations=true 时保留当前会话的浮空标注（reset 不该让场景标签消失）。
     */
    private int removeAllNonPlayerEntities(boolean keepAnnotations) {
        int removed = 0;
        for (World w : Bukkit.getWorlds()) {
            for (Entity e : w.getEntities()) {
                if (e instanceof Player) continue;
                if (keepAnnotations && e.getScoreboardTags().contains(TAG_ANNOTATION)) continue;
                e.remove();
                removed++;
            }
        }
        return removed;
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
            // 与 world.blocks 一致：live alias → baseAlias（content prepare 的虚拟块）→ 物理方块。
            // 快照真值必须还原学生/关卡声明的逻辑 id（egg、wheat_sprout…），否则 digest 与 Mock 对不上。
            String id = liveAir.contains(k) ? "minecraft:air" : alias.get(k);
            if (id == null) id = baseAlias.get(k);
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
        // 稳定 checkpoint 摘要：两次 reset 必须得到同一 hash（e2e 的 reset-hash-stable 检查）。
        canonical.put("checkpoint", new TreeMap<>(checkpoint));
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
