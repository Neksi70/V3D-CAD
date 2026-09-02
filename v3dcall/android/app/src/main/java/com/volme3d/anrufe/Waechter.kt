package com.volme3d.anrufe

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.work.*
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.TimeUnit

/**
 * Sieht regelmaessig nach, ob neue Nachrichten vorliegen, und meldet sie
 * als Benachrichtigung.
 *
 * Android laesst Hintergrundarbeit fruehestens alle 15 Minuten zu — sofortige
 * Meldungen liefert nur die Web-Push-Variante (Startbildschirm-Verknuepfung
 * aus Chrome). Beide Wege koennen nebeneinander laufen.
 */
class Waechter(ctx: Context, p: WorkerParameters) : CoroutineWorker(ctx, p) {

    override suspend fun doWork(): Result {
        val prefs = applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val key = prefs.getString(PREF_KEY, "") ?: ""
        if (key.isEmpty()) return Result.success()

        return try {
            val verb = (URL(BASIS + "api/calls?limit=20").openConnection() as HttpURLConnection)
                .apply {
                    setRequestProperty("X-V3D-Key", key)
                    connectTimeout = 15000
                    readTimeout = 15000
                }
            if (verb.responseCode != 200) return Result.success()
            val daten = JSONObject(verb.inputStream.bufferedReader().use { it.readText() })
            val liste = daten.getJSONArray("calls")
            if (liste.length() == 0) return Result.success()

            val neueste = liste.getJSONObject(0)
            val id = neueste.getString("id")
            val ungelesen = daten.optInt("ungelesen", 0)

            if (id != prefs.getString("zuletzt", "") && ungelesen > 0) {
                melde(neueste.optString("caller").ifEmpty { "Unbekannte Nummer" },
                      neueste.optString("text").ifEmpty { "Ohne Nachricht" },
                      ungelesen)
                prefs.edit().putString("zuletzt", id).apply()
            }
            Result.success()
        } catch (e: Exception) {
            Result.retry()
        }
    }

    private fun melde(nummer: String, text: String, ungelesen: Int) {
        val mgr = applicationContext.getSystemService(Context.NOTIFICATION_SERVICE)
                as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            mgr.createNotificationChannel(NotificationChannel(
                KANAL, "Neue Nachrichten", NotificationManager.IMPORTANCE_HIGH))
        }
        val tippen = PendingIntent.getActivity(
            applicationContext, 0,
            Intent(applicationContext, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)

        val bau = NotificationCompat.Builder(applicationContext, KANAL)
            .setSmallIcon(android.R.drawable.stat_notify_voicemail)
            .setContentTitle("Anruf von $nummer")
            .setContentText(text.take(120))
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setContentIntent(tippen)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
        if (ungelesen > 1) bau.setNumber(ungelesen)

        try {
            NotificationManagerCompat.from(applicationContext).notify(4711, bau.build())
        } catch (_: SecurityException) { /* Benachrichtigungen nicht erlaubt */ }
    }

    companion object {
        const val KANAL = "v3dcall_neu"

        fun planen(ctx: Context) {
            val arbeit = PeriodicWorkRequestBuilder<Waechter>(15, TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder()
                    .setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.LINEAR, 5, TimeUnit.MINUTES)
                .build()
            WorkManager.getInstance(ctx).enqueueUniquePeriodicWork(
                "v3dcall-waechter", ExistingPeriodicWorkPolicy.KEEP, arbeit)
        }
    }
}
