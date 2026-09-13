package com.volme3d.handy

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.widget.Button
import android.widget.EditText
import android.widget.Switch
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat

/**
 * Einstellungsseite: Bedienungshilfe einschalten, Server + Geraete-Schluessel
 * eintragen, Verbindung an/aus. Mehr braucht die App nicht — die eigentliche
 * Arbeit machen [BedienService] und [AgentService].
 */
class MainActivity : AppCompatActivity() {

    private lateinit var zustand: TextView
    private lateinit var bedienhilfe: TextView
    private lateinit var url: EditText
    private lateinit var schluessel: EditText
    private lateinit var schalter: Switch
    private val uhr = Handler(Looper.getMainLooper())
    private val tick = object : Runnable {
        override fun run() { anzeigen(); uhr.postDelayed(this, 1000) }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.main)
        zustand = findViewById(R.id.zustand)
        bedienhilfe = findViewById(R.id.bedienhilfe)
        url = findViewById(R.id.url)
        schluessel = findViewById(R.id.schluessel)
        schalter = findViewById(R.id.schalter)

        val p = Einstellungen.prefs(this)
        url.setText(p.getString("url", Einstellungen.FUNNEL))
        schluessel.setText(p.getString("key", ""))

        findViewById<Button>(R.id.bedienhilfeKnopf).setOnClickListener {
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
            Toast.makeText(this, "„V3D Handy“ in der Liste einschalten", Toast.LENGTH_LONG).show()
        }
        findViewById<Button>(R.id.speichern).setOnClickListener { speichern(); Toast.makeText(this, "Gespeichert", Toast.LENGTH_SHORT).show() }
        findViewById<Button>(R.id.akku).setOnClickListener { akkuAusnahme() }
        schalter.setOnCheckedChangeListener { _, an -> if (an) starten() else stoppen() }

        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)

        testExtras(intent)
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        testExtras(intent)
    }

    /** Nur in Debug-Builds (Emulator-Tests): Server/Schluessel per adb-Intent setzen. */
    private fun testExtras(i: Intent?) {
        if (i == null || applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE == 0) return
        var geaendert = false
        i.getStringExtra("url")?.let { url.setText(it); geaendert = true }
        i.getStringExtra("key")?.let { schluessel.setText(it); geaendert = true }
        if (geaendert) speichern()
        if (i.getBooleanExtra("start", false)) starten()
    }

    override fun onResume() { super.onResume(); uhr.post(tick) }
    override fun onPause() { super.onPause(); uhr.removeCallbacks(tick) }

    private fun speichern() {
        Einstellungen.prefs(this).edit()
            .putString("url", url.text.toString().trim().trimEnd('/'))
            .putString("key", schluessel.text.toString().trim())
            .apply()
    }

    private fun starten() {
        speichern()
        if (Einstellungen.schluessel(this).isEmpty()) {
            Toast.makeText(this, "Erst den Geraete-Schluessel eintragen", Toast.LENGTH_LONG).show()
            schalter.isChecked = false
            return
        }
        Einstellungen.prefs(this).edit().putBoolean("autostart", true).apply()
        ContextCompat.startForegroundService(this, Intent(this, AgentService::class.java))
    }

    private fun stoppen() {
        Einstellungen.prefs(this).edit().putBoolean("autostart", false).apply()
        stopService(Intent(this, AgentService::class.java))
    }

    private fun akkuAusnahme() {
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        if (pm.isIgnoringBatteryOptimizations(packageName)) {
            Toast.makeText(this, "Akku-Ausnahme ist schon gesetzt", Toast.LENGTH_SHORT).show(); return
        }
        startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName")))
    }

    private fun anzeigen() {
        val bh = BedienService.aktiv
        bedienhilfe.text = if (bh) "✔ Bedienungshilfe aktiv" else "✘ Bedienungshilfe aus — bitte einschalten"
        bedienhilfe.setTextColor(getColor(if (bh) R.color.gut else R.color.schlecht))
        if (schalter.isChecked != Zustand.laeuft) {
            schalter.setOnCheckedChangeListener(null)
            schalter.isChecked = Zustand.laeuft
            schalter.setOnCheckedChangeListener { _, an -> if (an) starten() else stoppen() }
        }
        val sb = StringBuilder()
        sb.append(if (!Zustand.laeuft) "Verbindung aus" else if (Zustand.verbunden) "● " + Zustand.text else "○ " + Zustand.text)
        if (Zustand.befehle > 0) sb.append("\nBefehle: ").append(Zustand.befehle)
        if (Zustand.letzterBefehl.isNotEmpty()) sb.append("\nZuletzt: ").append(Zustand.letzterBefehl)
        zustand.text = sb
        zustand.setTextColor(getColor(if (Zustand.laeuft && Zustand.verbunden) R.color.gut else R.color.text2))
    }
}
