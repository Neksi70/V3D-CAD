package com.volme3d.v3dabos

import android.app.AppOpsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.os.Process
import android.provider.Settings
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/**
 * Misst, wie lange welche App tatsächlich im Vordergrund war.
 *
 * Grundlage ist der UsageStatsManager. Dafür braucht die App die Sonderberechtigung
 * „Zugriff auf Nutzungsdaten“ — die lässt sich nicht per Dialog anfragen, sondern nur
 * in den Systemeinstellungen setzen ([einstellungenIntent]).
 */
object NutzungQuelle {

    fun hatBerechtigung(ctx: Context): Boolean {
        val ops = ctx.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
        val modus = ops.unsafeCheckOpNoThrow(
            AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), ctx.packageName
        )
        return modus == AppOpsManager.MODE_ALLOWED
    }

    fun einstellungenIntent(): Intent = Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)

    /**
     * Nutzung je Paketname über die letzten 30 bzw. 90 Tage.
     *
     * Zwei Quellen, weil eine allein luegt: die aggregierten Tagesbloecke reichen weit
     * zurueck, enthalten den laufenden Tag aber erst nach dem naechsten Flush des Systems —
     * eine App, die man gerade benutzt hat, saehe damit tot aus. Deshalb kommt die
     * Ereignisliste der letzten Woche dazu; genommen wird jeweils der groessere Wert
     * (die Woche ist Teilmenge der 30 Tage, also wird nichts doppelt gezaehlt).
     *
     * Wie weit die Statistik zurueckreicht, entscheidet das System — aeltere Tagesbloecke
     * werden irgendwann verworfen. Der 90-Tage-Wert ist deshalb eine Untergrenze.
     */
    fun messe(ctx: Context): Map<String, Nutzung> {
        if (!hatBerechtigung(ctx)) return emptyMap()
        val usm = ctx.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
        val jetzt = System.currentTimeMillis()
        val tag = 24L * 60 * 60 * 1000

        val s90 = usm.queryAndAggregateUsageStats(jetzt - 90 * tag, jetzt)
        val s30 = usm.queryAndAggregateUsageStats(jetzt - 30 * tag, jetzt)
        val (frischMs, frischZuletzt) = ausEreignissen(usm, jetzt - 7 * tag, jetzt)

        val pakete = s90.keys + s30.keys + frischMs.keys
        val out = HashMap<String, Nutzung>()
        for (paket in pakete) {
            val frisch = (frischMs[paket] ?: 0L) / 60000
            val min90 = maxOf((s90[paket]?.totalTimeInForeground ?: 0L) / 60000, frisch)
            val min30 = maxOf((s30[paket]?.totalTimeInForeground ?: 0L) / 60000, frisch)
            val stempel = maxOf(s90[paket]?.lastTimeUsed ?: 0L, frischZuletzt[paket] ?: 0L)
            val zuletzt = stempel.takeIf { it > 0 }?.let {
                Instant.ofEpochMilli(it).atZone(ZoneId.systemDefault()).toLocalDate()
            }
            out[paket] = Nutzung(paket, zuletzt, min30, min90)
        }
        return out
    }

    /**
     * Vordergrundzeit und letzter Start aus der Ereignisliste.
     * Eine noch offene Sitzung (App laeuft gerade) zaehlt bis jetzt mit.
     */
    private fun ausEreignissen(
        usm: UsageStatsManager, von: Long, bis: Long
    ): Pair<Map<String, Long>, Map<String, Long>> {
        val summe = HashMap<String, Long>()
        val zuletzt = HashMap<String, Long>()
        val offen = HashMap<String, Long>()
        val ereignisse = runCatching { usm.queryEvents(von, bis) }.getOrNull()
            ?: return summe to zuletzt
        val e = UsageEvents.Event()
        while (ereignisse.hasNextEvent()) {
            ereignisse.getNextEvent(e)
            val p = e.packageName ?: continue
            when (e.eventType) {
                // Die Werte 1/2 heissen je nach Android-Fassung MOVE_TO_FOREGROUND bzw.
                // ACTIVITY_RESUMED — dieselbe Konstante, nur umbenannt.
                UsageEvents.Event.MOVE_TO_FOREGROUND -> {
                    offen[p] = e.timeStamp
                    if (e.timeStamp > (zuletzt[p] ?: 0L)) zuletzt[p] = e.timeStamp
                }
                UsageEvents.Event.MOVE_TO_BACKGROUND -> {
                    offen.remove(p)?.let { start ->
                        if (e.timeStamp > start) summe[p] = (summe[p] ?: 0L) + (e.timeStamp - start)
                    }
                    if (e.timeStamp > (zuletzt[p] ?: 0L)) zuletzt[p] = e.timeStamp
                }
            }
        }
        for ((p, start) in offen) if (bis > start) summe[p] = (summe[p] ?: 0L) + (bis - start)
        return summe to zuletzt
    }

    data class InstallierteApp(val paket: String, val label: String, val system: Boolean)

    /** Alle Apps mit Starter-Symbol — via <queries> im Manifest, ohne QUERY_ALL_PACKAGES. */
    fun installierteApps(ctx: Context): List<InstallierteApp> {
        val pm = ctx.packageManager
        val i = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        return pm.queryIntentActivities(i, 0).mapNotNull { ri ->
            val ai = ri.activityInfo?.applicationInfo ?: return@mapNotNull null
            InstallierteApp(
                paket = ai.packageName,
                label = pm.getApplicationLabel(ai).toString(),
                system = (ai.flags and ApplicationInfo.FLAG_SYSTEM) != 0
            )
        }.distinctBy { it.paket }.sortedBy { it.label.lowercase() }
    }

    fun label(ctx: Context, paket: String): String = runCatching {
        val pm = ctx.packageManager
        pm.getApplicationLabel(pm.getApplicationInfo(paket, 0)).toString()
    }.getOrDefault(paket)

    fun istInstalliert(ctx: Context, paket: String): Boolean = runCatching {
        ctx.packageManager.getApplicationInfo(paket, 0); true
    }.getOrDefault(false)

    fun heute(): LocalDate = LocalDate.now()
}
