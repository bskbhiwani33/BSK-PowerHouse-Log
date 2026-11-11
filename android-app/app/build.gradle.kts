plugins {
    id("com.android.application")
}

android {
    namespace = "com.bsk.powerhouselog"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.bsk.powerhouselog"
        minSdk = 23
        targetSdk = 37
        versionCode = 1
        versionName = "1.0"
    }

    sourceSets {
        getByName("main") {
            assets.srcDir("../../public")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }

}
