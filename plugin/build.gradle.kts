plugins {
    java
    id("com.gradleup.shadow") version "9.6.1"
}

group = "dev.loomcraft"
version = "0.1.0"

repositories {
    maven("https://repo.papermc.io/repository/maven-public/") { name = "papermc" }
    mavenCentral()
}

dependencies {
    // Paper API for Minecraft 26.1.2 (locked; see docs/02 + AGENTS.md §2)
    compileOnly("io.papermc.paper:paper-api:26.1.2.build.74-stable")
    // Service channel; shaded into the plugin jar so demos work offline.
    implementation("org.java-websocket:Java-WebSocket:1.6.0")
}

java {
    toolchain.languageVersion.set(JavaLanguageVersion.of(25))
}

tasks.withType<JavaCompile>().configureEach {
    options.encoding = "UTF-8"
}

tasks.shadowJar {
    archiveBaseName.set("loomcraft-plugin")
    archiveClassifier.set("")
    archiveVersion.set("")
    minimize()
}

tasks.build {
    dependsOn(tasks.shadowJar)
}
