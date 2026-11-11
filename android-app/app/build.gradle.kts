plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "com.bsk.powerhouselog"
    compileSdk { version = release(37) }

    defaultConfig {
        applicationId = "com.bsk.powerhouselog"
        minSdk = 23
        targetSdk = 37
        versionCode = 1
        versionName = "1.0"
    }

    // The root build:hosting task generates this folder with a local Firebase
    // SDK bundle and the initial offline-capable BSK app shell.
    sourceSets {
        getByName("main") {
            assets.srcDir("../../public")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
    buildFeatures { compose = true }
}

dependencies {
    implementation(libs.androidx.core.ktx)
}
