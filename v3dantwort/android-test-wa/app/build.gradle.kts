plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}
// Testattrappe: tut so, als wäre sie WhatsApp (nur Emulator!)
android {
    namespace = "com.whatsapp"
    compileSdk = 34
    defaultConfig { applicationId = "com.whatsapp"; minSdk = 29; targetSdk = 34; versionCode = 1; versionName = "test" }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
}
dependencies { implementation("androidx.core:core-ktx:1.13.1") }
