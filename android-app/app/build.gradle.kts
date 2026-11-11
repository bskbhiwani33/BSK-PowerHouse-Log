plugins {
    id("com.android.application")
}

android {
    namespace = "com.bsk.powerhouselog"
    compileSdk = 37

    buildTypes {
        release {
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

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
            assets.exclude("bsk-updates/**")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

}
