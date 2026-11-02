#include <chrono>
// Profiling prototype: parse JSON + canonical (sorted keys) + SHA-256, comparable to JS digestSnapshot.
// Not production code: no full JS-number-format parity beyond integers/plain decimals.
#include <openssl/sha.h>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <map>
#include <memory>
#include <string>
#include <string_view>
#include <vector>
#include <charconv>
#include <cmath>

struct Node {
  enum Kind { Null, Bool, Number, String, Array, Object } kind = Null;
  bool boolean = false;
  std::string text;            // string value or number raw token
  std::vector<Node> arr;
  std::map<std::string, Node> obj;
};

struct Parser {
  std::string_view s; size_t i = 0;
  explicit Parser(std::string_view sv) : s(sv) {}
  void ws() { while (i < s.size() && (s[i]==' '||s[i]=='\t'||s[i]=='\n'||s[i]=='\r')) i++; }
  [[noreturn]] void fail(const char* m) { fprintf(stderr, "parse error: %s at %zu\n", m, i); exit(2); }
  Node parse() { ws(); Node n = value(); ws(); return n; }
  Node value() {
    ws();
    if (i >= s.size()) fail("eof");
    char c = s[i];
    if (c == '{') return object();
    if (c == '[') return array();
    if (c == '"') { Node n; n.kind = Node::String; n.text = string(); return n; }
    if (c == 't') { expect("true"); Node n; n.kind = Node::Bool; n.boolean = true; return n; }
    if (c == 'f') { expect("false"); Node n; n.kind = Node::Bool; n.boolean = false; return n; }
    if (c == 'n') { expect("null"); return Node{}; }
    return number();
  }
  void expect(const char* t) { size_t n = strlen(t); if (s.substr(i, n) != t) fail(t); i += n; }
  Node object() {
    Node n; n.kind = Node::Object; i++; ws();
    if (i < s.size() && s[i] == '}') { i++; return n; }
    while (true) {
      ws(); if (s[i] != '"') fail("key"); std::string key = string(); ws();
      if (s[i] != ':') fail("colon"); i++; Node v = value(); n.obj.emplace(std::move(key), std::move(v)); ws();
      if (s[i] == ',') { i++; continue; }
      if (s[i] == '}') { i++; return n; }
      fail("object sep");
    }
  }
  Node array() {
    Node n; n.kind = Node::Array; i++; ws();
    if (i < s.size() && s[i] == ']') { i++; return n; }
    while (true) {
      n.arr.push_back(value()); ws();
      if (s[i] == ',') { i++; continue; }
      if (s[i] == ']') { i++; return n; }
      fail("array sep");
    }
  }
  static void appendUtf8(std::string& out, unsigned cp) {
    if (cp <= 0x7F) out.push_back((char)cp);
    else if (cp <= 0x7FF) { out.push_back((char)(0xC0 | (cp >> 6))); out.push_back((char)(0x80 | (cp & 0x3F))); }
    else if (cp <= 0xFFFF) { out.push_back((char)(0xE0 | (cp >> 12))); out.push_back((char)(0x80 | ((cp >> 6) & 0x3F))); out.push_back((char)(0x80 | (cp & 0x3F))); }
    else { out.push_back((char)(0xF0 | (cp >> 18))); out.push_back((char)(0x80 | ((cp >> 12) & 0x3F))); out.push_back((char)(0x80 | ((cp >> 6) & 0x3F))); out.push_back((char)(0x80 | (cp & 0x3F))); }
  }
  unsigned hex4() { unsigned v = 0; for (int k = 0; k < 4; k++) { char c = s[i++]; v <<= 4; if (c >= '0' && c <= '9') v |= (unsigned)(c - '0'); else if (c >= 'a' && c <= 'f') v |= (unsigned)(c - 'a' + 10); else if (c >= 'A' && c <= 'F') v |= (unsigned)(c - 'A' + 10); else fail("hex"); } return v; }
  std::string string() {
    std::string out; i++;
    while (i < s.size()) {
      char c = s[i++];
      if (c == '"') return out;
      if (c == '\\') {
        if (i >= s.size()) fail("esc");
        char e = s[i++];
        switch (e) {
          case '"': out.push_back('"'); break; case '\\': out.push_back('\\'); break; case '/': out.push_back('/'); break;
          case 'b': out.push_back('\b'); break; case 'f': out.push_back('\f'); break; case 'n': out.push_back('\n'); break;
          case 'r': out.push_back('\r'); break; case 't': out.push_back('\t'); break;
          case 'u': { unsigned cp = hex4(); if (cp >= 0xD800 && cp <= 0xDBFF && s.substr(i,2) == "\\u") { i += 2; unsigned lo = hex4(); cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00); } appendUtf8(out, cp); break; }
          default: fail("esc char");
        }
      } else out.push_back(c);
    }
    fail("unterminated string");
  }
  Node number() {
    size_t start = i;
    if (s[i] == '-') i++;
    while (i < s.size() && ((s[i] >= '0' && s[i] <= '9') || s[i] == '.' || s[i] == 'e' || s[i] == 'E' || s[i] == '+' || s[i] == '-')) i++;
    if (i == start) fail("number");
    Node n; n.kind = Node::Number; n.text = std::string(s.substr(start, i - start)); return n;
  }
};

static void appendJsonString(std::string& out, const std::string& v) {
  out.push_back('"');
  for (unsigned char c : v) {
    switch (c) {
      case '"': out += "\\\""; break; case '\\': out += "\\\\"; break;
      case '\b': out += "\\b"; break; case '\f': out += "\\f"; break; case '\n': out += "\\n"; break;
      case '\r': out += "\\r"; break; case '\t': out += "\\t"; break;
      default:
        if (c < 0x20) { char buf[8]; snprintf(buf, sizeof buf, "\\u%04x", c); out += buf; }
        else out.push_back((char)c);
    }
  }
  out.push_back('"');
}
static void canonical(const Node& n, std::string& out) {
  switch (n.kind) {
    case Node::Null: out += "null"; break;
    case Node::Bool: out += n.boolean ? "true" : "false"; break;
    case Node::Number: out += n.text; break;   // snapshots: integers; see README caveat
    case Node::String: appendJsonString(out, n.text); break;
    case Node::Array: {
      out.push_back('[');
      for (size_t k = 0; k < n.arr.size(); k++) { if (k) out.push_back(','); canonical(n.arr[k], out); }
      out.push_back(']'); break;
    }
    case Node::Object: {
      out.push_back('{');
      bool first = true;
      for (auto& [k, v] : n.obj) { if (!first) out.push_back(','); first = false; appendJsonString(out, k); out.push_back(':'); canonical(v, out); }
      out.push_back('}'); break;
    }
  }
}
int main(int argc, char** argv) {
  if (argc < 2) { fprintf(stderr, "usage: %s <snapshot.json> [iterations]\n", argv[0]); return 1; }
  FILE* f = fopen(argv[1], "rb"); if (!f) { perror("open"); return 1; }
  fseek(f, 0, SEEK_END); long sz = ftell(f); fseek(f, 0, SEEK_SET);
  std::string raw; raw.resize((size_t)sz); if (fread(raw.data(), 1, (size_t)sz, f) != (size_t)sz) return 1; fclose(f);
  int iters = argc >= 3 ? atoi(argv[2]) : 100;
  std::string canon, digest;
  auto t0 = std::chrono::steady_clock::now();
  for (int k = 0; k < iters; k++) {
    Parser p(raw); Node root = p.parse();
    canon.clear(); canonical(root, canon);
    unsigned char out[32]; SHA256((const unsigned char*)canon.data(), canon.size(), out);
    static const char* hex = "0123456789abcdef";
    digest.clear(); digest.reserve(71); digest = "sha256:";
    for (unsigned char b : out) { digest.push_back(hex[b >> 4]); digest.push_back(hex[b & 15]); }
  }
  auto t1 = std::chrono::steady_clock::now();
  double ms = std::chrono::duration<double, std::milli>(t1 - t0).count() / iters;
  printf("{\"file\":\"%s\",\"rawKB\":%.1f,\"canonKB\":%.1f,\"iterations\":%d,\"cppParseCanonShaMs\":%.3f,\"digest\":\"%s\"}\n", argv[1], raw.size()/1024.0, canon.size()/1024.0, iters, ms, digest.c_str());
  return 0;
}
