package com.volme3d.antwort

import android.Manifest
import android.app.Activity
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.text.format.DateUtils
import android.widget.EditText
import android.widget.ScrollView
import android.widget.Switch
import android.widget.Toast

/** Einrichtung (Server, Schlüssel, Benachrichtigungszugriff) und Liste der letzten Chats. */
class MainActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        einrichtungslink(intent)
        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
        WaListener.kanalAnlegen(this)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        einrichtungslink(intent)
    }

    override fun onResume() {
        super.onResume()
        aufbauen()
    }

    private fun einrichtungslink(i: Intent?) {
        val u = i?.data ?: return
        if (u.scheme != "v3dantwort") return
        u.getQueryParameter("url")?.let { Speicher.setzen(this, "url", it) }
        u.getQueryParameter("key")?.let { Speicher.setzen(this, "key", it) }
        Toast.makeText(this, "Eingerichtet ✔", Toast.LENGTH_SHORT).show()
    }

    private fun zugriffAn(): Boolean {
        val an = Settings.Secure.getString(contentResolver, "enabled_notification_listeners") ?: ""
        return an.contains(ComponentName(this, WaListener::class.java).flattenToString())
    }

    private fun aufbauen() {
        val c = this
        val w = Ui.spalte(c).apply {
            setPadding(Ui.dp(c, 16), Ui.dp(c, 16), Ui.dp(c, 16), Ui.dp(c, 32))
            setBackgroundColor(Ui.hinter(c))
        }
        w.addView(Ui.text(c, "🤖 V3D Antwort", 24f, true))
        w.addView(Ui.text(c, "Bei jeder WhatsApp-Nachricht erscheint ein Knopf „Mit Claude antworten“. " +
            "Claude schlägt eine nette Antwort mit freien Terminen aus deinem Kalender vor – " +
            "gesendet wird erst, wenn du „Senden“ tippst.", 14f, farbe = Ui.leise(c)))

        // 1. Schritt: Benachrichtigungszugriff
        w.addView(Ui.ueberschrift(c, "Einrichtung"))
        val zugriff = zugriffAn()
        w.addView(Ui.knopf(c, if (zugriff) "✔ Benachrichtigungen lesen: erlaubt" else "① Benachrichtigungen lesen erlauben", !zugriff) {
            startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
        })
        val eingerichtet = Speicher.key(c).isNotBlank()
        w.addView(Ui.text(c, if (eingerichtet) "✔ Server verbunden: ${Speicher.url(c)}"
            else "② Den Einrichtungs-Link aus dem Chat mit Claude antippen (oder unten Schlüssel eintragen).",
            13f, farbe = Ui.leise(c)).also { Ui.abstand(it, oben = 8) })

        // Schalter
        w.addView(Ui.ueberschrift(c, "Einstellungen"))
        fun schalter(t: String, wert: Boolean, name: String) = Switch(c).apply {
            text = t; isChecked = wert; setTextColor(Ui.schrift(c)); textSize = 15f
            setPadding(0, Ui.dp(c, 6), 0, Ui.dp(c, 6))
            setOnCheckedChangeListener { _, an -> Speicher.setzen(c, name, an) }
        }
        w.addView(schalter("Knopf bei jeder WhatsApp-Nachricht", Speicher.knopf(c), "knopf"))
        w.addView(schalter("Auch bei Gruppen", Speicher.gruppen(c), "gruppen"))
        w.addView(schalter("Termine standardmäßig vorschlagen", Speicher.termine(c), "termine"))

        // Letzte Chats
        w.addView(Ui.ueberschrift(c, "Letzte WhatsApp-Chats"))
        val chats = Speicher.neueste()
        if (chats.isEmpty()) {
            w.addView(Ui.text(c, if (zugriff) "Noch keine Nachricht seit dem App-Start." else "Erst Benachrichtigungen erlauben.", 14f, farbe = Ui.leise(c)))
        }
        for (ch in chats) {
            val zeit = DateUtils.getRelativeTimeSpanString(ch.zeit)
            val k = Ui.knopf(c, "${ch.titel}  ·  $zeit\n${ch.letzte.take(70)}") {
                startActivity(Intent(c, AntwortActivity::class.java).putExtra(AntwortActivity.EXTRA_CHAT, ch.schluessel))
            }
            k.textAlignment = android.view.View.TEXT_ALIGNMENT_VIEW_START
            k.setPadding(Ui.dp(c, 14), Ui.dp(c, 10), Ui.dp(c, 14), Ui.dp(c, 10))
            k.background = Ui.rund(Ui.karte(c), Ui.dp(c, 12).toFloat())
            w.addView(k)
            Ui.abstand(k, oben = 6)
            k.layoutParams.width = android.view.ViewGroup.LayoutParams.MATCH_PARENT
        }
        w.addView(Ui.knopf(c, "📋 Text aus Zwischenablage beantworten") {
            startActivity(Intent(c, AntwortActivity::class.java))
        }.also { Ui.abstand(it, oben = 12) })

        // Server von Hand
        w.addView(Ui.ueberschrift(c, "Server (nur falls nötig)"))
        val url = EditText(c).apply { setText(Speicher.url(c)); setSingleLine(); setTextColor(Ui.schrift(c)) }
        val key = EditText(c).apply { hint = "Schlüssel"; setText(Speicher.key(c)); setSingleLine(); setTextColor(Ui.schrift(c))
            inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD }
        w.addView(url); w.addView(key)
        w.addView(Ui.knopf(c, "Speichern") {
            Speicher.setzen(c, "url", url.text.toString().trim())
            Speicher.setzen(c, "key", key.text.toString().trim())
            Toast.makeText(c, "Gespeichert", Toast.LENGTH_SHORT).show()
            aufbauen()
        })
        w.addView(Ui.text(c, "Version ${packageManager.getPackageInfo(packageName, 0).versionName}", 12f, farbe = Ui.leise(c))
            .also { Ui.abstand(it, oben = 16) })

        setContentView(ScrollView(c).apply { addView(w); setBackgroundColor(Ui.hinter(c)); isFillViewport = true })
    }
}
