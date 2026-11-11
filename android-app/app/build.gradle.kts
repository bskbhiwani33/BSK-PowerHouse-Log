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
        versionCode = 2
        versionName = "1.1"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

}
