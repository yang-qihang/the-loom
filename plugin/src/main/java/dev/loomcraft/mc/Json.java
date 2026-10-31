package dev.loomcraft.mc;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Minimal dependency-free JSON reader/writer (keeps the plugin jar free of shaded JSON libs). */
public final class Json {
    private final String src;
    private int i = 0;

    private Json(String src) {
        this.src = src;
    }

    public static Object parse(String text) {
        if (text == null) throw new IllegalArgumentException("null json");
        Json p = new Json(text);
        Object value = p.value();
        p.ws();
        if (p.i != p.src.length()) throw new IllegalArgumentException("trailing json at " + p.i);
        return value;
    }

    // ------------------------------------------------------------- parsing

    private void ws() {
        while (i < src.length() && Character.isWhitespace(src.charAt(i))) i++;
    }

    private Object value() {
        ws();
        if (i >= src.length()) throw new IllegalArgumentException("unexpected end");
        char c = src.charAt(i);
        switch (c) {
            case '{':
                return object();
            case '[':
                return array();
            case '"':
                return string();
            case 't':
                expect("true");
                return Boolean.TRUE;
            case 'f':
                expect("false");
                return Boolean.FALSE;
            case 'n':
                expect("null");
                return null;
            default:
                return number();
        }
    }

    private void expect(String literal) {
        if (!src.startsWith(literal, i)) throw new IllegalArgumentException("expected " + literal + " at " + i);
        i += literal.length();
    }

    private Map<String, Object> object() {
        Map<String, Object> map = new LinkedHashMap<>();
        i++;
        ws();
        if (i < src.length() && src.charAt(i) == '}') {
            i++;
            return map;
        }
        while (true) {
            ws();
            String key = string();
            ws();
            if (src.charAt(i) != ':') throw new IllegalArgumentException("expected ':' at " + i);
            i++;
            map.put(key, value());
            ws();
            char c = src.charAt(i++);
            if (c == '}') return map;
            if (c != ',') throw new IllegalArgumentException("expected ',' at " + (i - 1));
        }
    }

    private List<Object> array() {
        List<Object> list = new ArrayList<>();
        i++;
        ws();
        if (i < src.length() && src.charAt(i) == ']') {
            i++;
            return list;
        }
        while (true) {
            list.add(value());
            ws();
            char c = src.charAt(i++);
            if (c == ']') return list;
            if (c != ',') throw new IllegalArgumentException("expected ',' at " + (i - 1));
        }
    }

    private String string() {
        if (src.charAt(i) != '"') throw new IllegalArgumentException("expected string at " + i);
        i++;
        StringBuilder sb = new StringBuilder();
        while (true) {
            char c = src.charAt(i++);
            if (c == '"') return sb.toString();
            if (c != '\\') {
                sb.append(c);
                continue;
            }
            char e = src.charAt(i++);
            switch (e) {
                case '"' -> sb.append('"');
                case '\\' -> sb.append('\\');
                case '/' -> sb.append('/');
                case 'b' -> sb.append('\b');
                case 'f' -> sb.append('\f');
                case 'n' -> sb.append('\n');
                case 'r' -> sb.append('\r');
                case 't' -> sb.append('\t');
                case 'u' -> {
                    sb.append((char) Integer.parseInt(src.substring(i, i + 4), 16));
                    i += 4;
                }
                default -> throw new IllegalArgumentException("bad escape at " + i);
            }
        }
    }

    private Double number() {
        int start = i;
        while (i < src.length() && "-+.eE0123456789".indexOf(src.charAt(i)) >= 0) i++;
        return Double.parseDouble(src.substring(start, i));
    }

    // ----------------------------------------------------------- helpers

    @SuppressWarnings("unchecked")
    public static Map<String, Object> map(Object value) {
        if (value instanceof Map<?, ?> m) return (Map<String, Object>) m;
        return new LinkedHashMap<>();
    }

    @SuppressWarnings("unchecked")
    public static List<Object> list(Object value) {
        if (value instanceof List<?> l) return (List<Object>) l;
        return new ArrayList<>();
    }

    public static String str(Object value, String def) {
        return value instanceof String s ? s : def;
    }

    public static int num(Object value, int def) {
        return value instanceof Number n ? n.intValue() : def;
    }

    public static boolean bool(Object value, boolean def) {
        return value instanceof Boolean b ? b : def;
    }

    public static Map<String, Object> obj() {
        return new LinkedHashMap<>();
    }

    public static Map<String, Object> obj(String k, Object v) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put(k, v);
        return m;
    }

    /** Parse a JSON [x,y,z] array into int[3]. */
    public static int[] vec3(Object value) {
        List<Object> l = list(value);
        if (l.size() < 3) throw new IllegalArgumentException("expected vec3, got " + value);
        return new int[]{num(l.get(0), 0), num(l.get(1), 0), num(l.get(2), 0)};
    }

    public static List<Object> arr(Object... values) {
        List<Object> l = new ArrayList<>();
        for (Object v : values) l.add(v);
        return l;
    }

    public static List<Object> vecList(int[] v) {
        return arr(v[0], v[1], v[2]);
    }

    // --------------------------------------------------------- stringify

    public static String stringify(Object value) {
        StringBuilder sb = new StringBuilder();
        write(sb, value);
        return sb.toString();
    }

    private static void write(StringBuilder sb, Object value) {
        if (value == null) {
            sb.append("null");
        } else if (value instanceof String s) {
            writeString(sb, s);
        } else if (value instanceof Boolean || value instanceof Integer || value instanceof Long) {
            sb.append(value);
        } else if (value instanceof Number n) {
            double d = n.doubleValue();
            if (d == Math.rint(d) && !Double.isInfinite(d) && Math.abs(d) < 1e15) {
                sb.append((long) d);
            } else {
                sb.append(d);
            }
        } else if (value instanceof Map<?, ?> m) {
            sb.append('{');
            boolean first = true;
            for (Map.Entry<?, ?> e : m.entrySet()) {
                if (!first) sb.append(',');
                first = false;
                writeString(sb, String.valueOf(e.getKey()));
                sb.append(':');
                write(sb, e.getValue());
            }
            sb.append('}');
        } else if (value instanceof Iterable<?> it) {
            sb.append('[');
            boolean first = true;
            for (Object v : it) {
                if (!first) sb.append(',');
                first = false;
                write(sb, v);
            }
            sb.append(']');
        } else if (value instanceof int[] v) {
            sb.append('[');
            for (int k = 0; k < v.length; k++) {
                if (k > 0) sb.append(',');
                sb.append(v[k]);
            }
            sb.append(']');
        } else {
            writeString(sb, String.valueOf(value));
        }
    }

    private static void writeString(StringBuilder sb, String s) {
        sb.append('"');
        for (int k = 0; k < s.length(); k++) {
            char c = s.charAt(k);
            switch (c) {
                case '"' -> sb.append("\\\"");
                case '\\' -> sb.append("\\\\");
                case '\n' -> sb.append("\\n");
                case '\r' -> sb.append("\\r");
                case '\t' -> sb.append("\\t");
                default -> {
                    if (c < 0x20) sb.append(String.format("\\u%04x", (int) c));
                    else sb.append(c);
                }
            }
        }
        sb.append('"');
    }
}
