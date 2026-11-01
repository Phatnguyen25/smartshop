package com.smartshop.scanner_app

import android.media.AudioManager
import android.media.ToneGenerator
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    private var toneGen: ToneGenerator? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        toneGen = ToneGenerator(AudioManager.STREAM_MUSIC, 100)

        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "com.smartshop.scanner/beep")
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "success" -> {
                        toneGen?.startTone(ToneGenerator.TONE_PROP_BEEP2, 160)
                        result.success(null)
                    }
                    "error" -> {
                        toneGen?.startTone(ToneGenerator.TONE_SUP_ERROR, 260)
                        result.success(null)
                    }
                    else -> result.notImplemented()
                }
            }
    }

    override fun onDestroy() {
        toneGen?.release()
        toneGen = null
        super.onDestroy()
    }
}
