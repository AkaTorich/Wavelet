package top.globthe.wavelet

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioManager
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  private var keptAlive = false

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    askPermissions()
  }

  // Wavelet: без этих разрешений библиотека не видит музыку, видео и обложки-картинки в памяти телефона
  private fun askPermissions() {
    val wanted = if (Build.VERSION.SDK_INT >= 33) {
      arrayOf(
        Manifest.permission.READ_MEDIA_AUDIO,
        Manifest.permission.READ_MEDIA_VIDEO,
        Manifest.permission.READ_MEDIA_IMAGES,
        Manifest.permission.POST_NOTIFICATIONS,
      )
    } else {
      arrayOf(Manifest.permission.READ_EXTERNAL_STORAGE)
    }
    val missing = wanted.filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
    if (missing.isNotEmpty()) requestPermissions(missing.toTypedArray(), 1)
  }

  // Wavelet: оболочка ставит WebView на паузу при сворачивании — вместе со звуком.
  // Если в этот момент играет музыка, WebView пускается снова, а служба проигрывания
  // не даёт Android усыпить приложение.
  override fun onPause() {
    val playing = (getSystemService(Context.AUDIO_SERVICE) as AudioManager).isMusicActive
    super.onPause()
    if (playing) {
      findWebView(window.decorView)?.onResume()
      try {
        val i = Intent(this, PlaybackService::class.java)
        if (Build.VERSION.SDK_INT >= 26) startForegroundService(i) else startService(i)
        keptAlive = true
      } catch (_: Exception) {
        // служба не запустилась — звук может замолчать, но приложение работает
      }
    }
  }

  override fun onResume() {
    super.onResume()
    if (keptAlive) {
      stopService(Intent(this, PlaybackService::class.java))
      keptAlive = false
    }
  }

  private fun findWebView(v: View): WebView? {
    if (v is WebView) return v
    if (v is ViewGroup) {
      for (i in 0 until v.childCount) {
        findWebView(v.getChildAt(i))?.let { return it }
      }
    }
    return null
  }
}
