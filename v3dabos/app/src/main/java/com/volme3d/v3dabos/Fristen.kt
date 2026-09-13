package com.volme3d.v3dabos

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.time.LocalDate
import java.time.temporal.ChronoUnit
import java.util.concurrent.TimeUnit

/**
 * Erinnert daran, dass eine Kündigungsfrist ausläuft — der eigentliche Grund, warum
 * Abos weiterlaufen, ist selten Absicht, sondern ein verpasster Termin.
 */
object Fristen {
    private const val KANAL = "fristen"
    private const val ARBEIT = "fristen-taeglich"

    fun plane(ctx: Context) {
        val anfrage = PeriodicWorkRequestBuilder<FristenWorker>(1, TimeUnit.DAYS)
            .setConstraints(Constraints.Builder().setRequiresBatteryNotLow(true).build())
            .build()
        WorkManager.getInstance(ctx).enqueueUniquePeriodicWork(
            ARBEIT, ExistingPeriodicWorkPolicy.UPDATE, anfrage
        )
    }

    /**
     * Schiebt abgelaufene Zahltermine auf den nächsten Turnus vor. Ohne das stünde nach
     * ein paar Monaten überall eine Frist in der Vergangenheit.
     * Gibt true zurück, wenn etwas geändert wurde.
     */
    fun schreibeTermineFort(ctx: Context, heute: LocalDate = LocalDate.now()): Boolean {
        var geaendert = false
        for (a in Store.alle(ctx)) {
            if (a.status != Status.AKTIV) continue
            var d = a.naechsteZahlung ?: continue
            var schutz = 0
            while (d.isBefore(heute) && schutz++ < 500) {
                d = a.intervall.naechsterTermin(d)
            }
            if (d != a.naechsteZahlung) { a.naechsteZahlung = d; geaendert = true }
        }
        if (geaendert) Store.speichere(ctx)
        return geaendert
    }

    /** Abos, deren letzter Kündigungstag innerhalb der Vorwarnzeit liegt. */
    fun faellige(ctx: Context, heute: LocalDate = LocalDate.now()): List<Pair<Abo, Long>> {
        val vorwarn = Store.vorwarnTage(ctx)
        return Store.alle(ctx).filter { it.status == Status.AKTIV }.mapNotNull { a ->
            val tag = a.spaetesterKuendigungstag() ?: return@mapNotNull null
            val tage = ChronoUnit.DAYS.between(heute, tag)
            if (tage in 0..vorwarn.toLong()) a to tage else null
        }.sortedBy { it.second }
    }

    fun melde(ctx: Context, faellige: List<Pair<Abo, Long>>) {
        if (faellige.isEmpty()) return
        if (Build.VERSION.SDK_INT >= 33 &&
            ctx.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) return

        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.createNotificationChannel(
                NotificationChannel(KANAL, "Kündigungsfristen", NotificationManager.IMPORTANCE_DEFAULT)
                    .apply { description = "Erinnert, bevor eine Kündigungsfrist abläuft" }
            )
        }

        val titel = if (faellige.size == 1) "Kündigungsfrist läuft"
                    else "${faellige.size} Kündigungsfristen laufen"
        val zeilen = faellige.take(5).map { (a, tage) ->
            val wann = when (tage) {
                0L -> "heute letzter Tag"
                1L -> "noch 1 Tag"
                else -> "noch $tage Tage"
            }
            "${a.name} – $wann (${Fmt.euro(a.jahresCent)}/Jahr)"
        }

        val tippen = PendingIntent.getActivity(
            ctx, 0, Intent(ctx, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        val stil = NotificationCompat.InboxStyle()
        zeilen.forEach { stil.addLine(it) }

        val n = NotificationCompat.Builder(ctx, KANAL)
            .setSmallIcon(android.R.drawable.ic_popup_reminder)
            .setContentTitle(titel)
            .setContentText(zeilen.first())
            .setStyle(stil)
            .setContentIntent(tippen)
            .setAutoCancel(true)
            .build()

        runCatching { NotificationManagerCompat.from(ctx).notify(4711, n) }
    }
}

class FristenWorker(ctx: Context, p: WorkerParameters) : Worker(ctx, p) {
    override fun doWork(): Result {
        Store.neuLaden()
        Fristen.schreibeTermineFort(applicationContext)
        Fristen.melde(applicationContext, Fristen.faellige(applicationContext))
        return Result.success()
    }
}
