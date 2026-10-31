plugins {
    java
}

group = "dev.loom"
version = "0.1.0"

repositories {
    maven("https://repo.papermc.io/repository/maven-public/") {
        name = "papermc"
    }
    mavenCentral()
}

dependencies {
    // Paper API for Minecraft 26.1.2, stable build 74 (version scheme changed in 26.1:
    // old style was 1.21.11-R0.1-SNAPSHOT, new style is <version>.build.<n>-stable)
    compileOnly("io.papermc.paper:paper-api:26.1.2.build.74-stable")
    // Provided at runtime by plugin.yml `libraries:` (Paper downloads it on first start)
    compileOnly("org.java-websocket:Java-WebSocket:1.6.0")
}

java {
    toolchain.languageVersion.set(JavaLanguageVersion.of(25))
}

tasks.withType<JavaCompile>().configureEach {
    options.encoding = "UTF-8"
}
