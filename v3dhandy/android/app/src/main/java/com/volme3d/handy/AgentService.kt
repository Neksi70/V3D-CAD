package com.volme3d.handy

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.os.Build
import android.os.IBinder
import android.view.WindowManager
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/** Verbindungszustand fuer die Oberflaeche — schlicht, ohne Broadcasts. */
object Zustand {
    @Volatile var laeuft = false
    @Volatile var verbunden = false
    @Volatile var bedienhilfe = false
    @Volatile var text = "Aus"
    @Volatile var letzterBefehl = ""
    @Volatile var befehle = 0
}

object Einstellungen {
    const val FUNNEL = "https://v3da.tailf05fe9.ts.net/handy"
    fun prefs(c: Context): SharedPreferences = c.getSharedPreferences("agent", Context.MODE_PRIVATE)
    fun url(c: Context) = prefs(c).getString("url", FUNNEL)!!.trim().trimEnd('/')
    fun schluessel(c: Context) = prefs(c).getString("key", "")!!.trim()
    fun autostart(c: Context) = prefs(c).getBoolean("autostart", false)
}

/**
 * Vordergrund-Dienst: holt per Long-Polling Befehle vom V3D-Server, laesst
 * sie von der Bedienungshilfe ausfuehren und schickt das Ergebnis mit der
 * naechsten Anfrage zurueck. Die Benachrichtigung ist der Not-Aus.
 */
class AgentService : Service() {

    companion object {
        const val KANAL = "v3dhandy"
        const val AKTION_STOPP = "com.volme3d.handy.STOPP"
        private const val WARTEN_S = 25
    }

    private var arbeiter: Thread? = null
    @Volatile private var stop = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == AKTION_STOPP) {
            Einstellungen.prefs(this).edit().putBoolean("autostart", false).apply()
            stopSelf()
            return START_NOT_STICKY
        }
        startForeground(1, benachrichtigung("Verbinde …"))
        Zustand.laeuft = true
        stop = false
        if (arbeiter?.isAlive != true) {
            arbeiter = Thread(::schleife, "v3dhandy-poll").apply { isDaemon = true; start() }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        stop = true
        arbeiter?.interrupt()
        Zustand.laeuft = false
        Zustand.verbunden = false
        Zustand.text = "Aus"
        super.onDestroy()
    }

    // ------------------------------------------------------------ Benachrichtigung

    private fun benachrichtigung(text: String): Notification {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (nm.getNotificationChannel(KANAL) == null) {
            nm.createNotificationChannel(NotificationChannel(KANAL, "V3D Handy Verbindung",
                NotificationManager.IMPORTANCE_LOW).apply { description = "Fernsteuerung durch Claude ist aktiv" })
        }
        val oeffnen = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE)
        val stoppen = PendingIntent.getService(this, 1,
            Intent(this, AgentService::class.java).setAction(AKTION_STOPP), PendingIntent.FLAG_IMMUTABLE)
        return Notification.Builder(this, KANAL)
            .setSmallIcon(R.drawable.ic_stat)
            .setContentTitle("V3D Handy: Fernsteuerung an")
            .setContentText(text)
            .setContentIntent(oeffnen)
            .setOngoing(true)
            .addAction(Notification.Action.Builder(null, "Stopp", stoppen).build())
            .build()
    }

    private fun melden(verbunden: Boolean, text: String) {
        Zustand.verbunden = verbunden
        Zustand.text = text
        try {
            (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(1, benachrichtigung(text))
        } catch (_: Exception) {}
    }

    // ------------------------------------------------------------ Schleife

    private fun geraetInfo(): JSONObject {
        val wm = getSystemService(Context.WINDOW_SERVICE) as WindowManager
        val b = wm.maximumWindowMetrics.bounds
        val version = try { packageManager.getPackageInfo(packageName, 0).versionName } catch (_: Exception) { "?" }
        return JSONObject()
            .put("modell", "${Build.MANUFACTURER} ${Build.MODEL}")
            .put("android", Build.VERSION.RELEASE)
            .put("breite", b.width()).put("hoehe", b.height())
            .put("bedienhilfe", BedienService.aktiv)
            .put("app", version)
    }

    private fun schleife() {
        var antwort: JSONObject? = null
        var pause = 2000L
        while (!stop) {
            val url = Einstellungen.url(this)
            val key = Einstellungen.schluessel(this)
            if (key.isEmpty()) {
                melden(false, "Kein Geraete-Schluessel eingetragen")
                schlafen(5000); continue
            }
            try {
                val body = JSONObject().put("geraet", geraetInfo()).put("warten", WARTEN_S)
                if (antwort != null) body.put("antwort", antwort)
                val res = post("$url/api/geraet/warten", key, body)
                antwort = null
                pause = 2000
                if (res.optBoolean("leer")) {
                    if (!Zustand.verbunden) melden(true, "Verbunden, warte auf Befehle")
                    continue
                }
                melden(true, "Befehl: ${res.optString("cmd")}")
                antwort = ausfuehren(res)
                Zustand.befehle++
                Zustand.letzterBefehl = res.optString("cmd") + " → " +
                    (if (antwort.optBoolean("ok")) antwort.optString("text", "ok").take(80)
                     else "Fehler: " + antwort.optString("fehler"))
            } catch (e: InterruptedException) {
                return
            } catch (e: Exception) {
                melden(false, "Keine Verbindung: ${e.message ?: e.javaClass.simpleName}")
                schlafen(pause)
                pause = minOf(pause * 2, 30_000)
            }
        }
    }

    private fun schlafen(ms: Long) {
        try { Thread.sleep(ms) } catch (_: InterruptedException) { stop = true }
    }

    private fun post(adresse: String, key: String, body: JSONObject): JSONObject {
        val c = URL(adresse).openConnection() as HttpURLConnection
        c.requestMethod = "POST"
        c.connectTimeout = 15_000
        c.readTimeout = (WARTEN_S + 20) * 1000
        c.doOutput = true
        c.setRequestProperty("Content-Type", "application/json; charset=utf-8")
        c.setRequestProperty("Authorization", "Bearer $key")
        c.setRequestProperty("User-Agent", "V3DHandy/1.0 Android")
        try {
            c.outputStream.use { it.write(body.toString().toByteArray()) }
            val code = c.responseCode
            if (code == 401) throw IOException("Server lehnt den Geraete-Schluessel ab")
            if (code != 200) throw IOException("HTTP $code")
            val text = c.inputStream.bufferedReader().readText()
            return JSONObject(text)
        } finally {
            c.disconnect()
        }
    }

    // ------------------------------------------------------------ Befehle

    private fun ausfuehren(b: JSONObject): JSONObject {
        val out = JSONObject().put("id", b.optInt("id"))
        val cmd = b.optString("cmd")
        val a = b.optJSONObject("args") ?: JSONObject()
        val bh = BedienService.instanz
        try {
            if (bh == null) throw IllegalStateException(
                "Bedienungshilfe ist aus — auf dem Handy: Einstellungen → Bedienungshilfen → V3D Handy einschalten")
            when (cmd) {
                "bildschirm_lesen" -> out.put("baum", bh.lesen(a.optBoolean("alles")))
                "screenshot" -> {
                    val s = bh.screenshot()
                    for (k in s.keys()) out.put(k, s.get(k))
                }
                "tippen" -> out.put("text", bh.tippen(
                    zahl(a, "element"), zahl(a, "x"), zahl(a, "y"), a.optBoolean("lang")))
                "text_eingeben" -> out.put("text", bh.text(
                    zahl(a, "element"), a.optString("text"), a.optBoolean("ersetzen", true), a.optBoolean("enter")))
                "wischen" -> out.put("text", bh.wischen(
                    if (a.has("richtung") && !a.isNull("richtung")) a.optString("richtung") else null,
                    zahl(a, "element"), zahl(a, "x1"), zahl(a, "y1"), zahl(a, "x2"), zahl(a, "y2"), zahl(a, "dauer_ms")))
                "taste" -> out.put("text", bh.taste(a.optString("name")))
                "app_oeffnen" -> out.put("text", bh.appOeffnen(a.optString("app")))
                "apps_auflisten" -> out.put("text", bh.apps(a.optString("suche", null)))
                else -> throw IllegalArgumentException("Unbekannter Befehl: $cmd")
            }
            out.put("ok", true)
        } catch (e: Exception) {
            out.put("ok", false).put("fehler", e.message ?: e.javaClass.simpleName)
        }
        return out
    }

    private fun zahl(a: JSONObject, k: String): Int? =
        if (a.has(k) && !a.isNull(k)) Math.round(a.optDouble(k)).toInt() else null
}
