package top.globthe.wavelet

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper

// Wavelet: служба «играет в фоне». Держит приложение живым, пока оно свёрнуто и звучит музыка;
// когда звук молчит дольше минуты, сама останавливается. Касание уведомления возвращает в программу.
class PlaybackService : Service() {
  private val handler = Handler(Looper.getMainLooper())
  private var silentChecks = 0

  private val watch = object : Runnable {
    override fun run() {
      val audio = getSystemService(Context.AUDIO_SERVICE) as AudioManager
      silentChecks = if (audio.isMusicActive) 0 else silentChecks + 1
      if (silentChecks >= 4) {
        stopSelf()
      } else {
        handler.postDelayed(this, 15_000)
      }
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val channel = "wavelet_playback"
    if (Build.VERSION.SDK_INT >= 26) {
      val nm = getSystemService(NotificationManager::class.java)
      nm.createNotificationChannel(NotificationChannel(channel, "Playback", NotificationManager.IMPORTANCE_LOW))
    }
    val open = PendingIntent.getActivity(
      this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
    val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, channel) else Notification.Builder(this)
    val note = builder
      .setContentTitle("Wavelet")
      .setContentText("Playing in the background")
      .setSmallIcon(R.drawable.ic_stat_wavelet)
      .setContentIntent(open)
      .setOngoing(true)
      .build()
    if (Build.VERSION.SDK_INT >= 29) {
      startForeground(1, note, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
    } else {
      startForeground(1, note)
    }
    silentChecks = 0
    handler.removeCallbacks(watch)
    handler.postDelayed(watch, 15_000)
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    handler.removeCallbacks(watch)
    super.onDestroy()
  }
}
