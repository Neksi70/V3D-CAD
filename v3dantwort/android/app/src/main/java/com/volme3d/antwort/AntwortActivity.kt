package com.volme3d.antwort

import android.app.Activity
import android.app.ActivityOptions
import android.app.NotificationManager
import android.app.RemoteInput
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.widget.CheckBox
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast

/**
 * Zeigt die WhatsApp-Nachricht, holt einen Antwortvorschlag mit Terminen
 * und sendet ihn erst auf Tipp („Senden“) über den Antworten-Knopf der
 * WhatsApp-Benachrichtigung – oder kopiert ihn und öffnet den Chat.
 */
class AntwortActivity : Activity() {

    companion object {
        const val EXTRA_CHAT = "chat"
    }

    private var chat: Chat? = null
    private var absender = ""
    private var nachricht = ""
    private var verlauf: List<Nachricht> = emptyList()

    private lateinit var feld: EditText
    private lateinit var status: TextView
    private lateinit var warten: ProgressBar
    private lateinit var termine: CheckBox
    private lateinit var wunschFeld: EditText
    private lateinit var sendenKnopf: View
    private val knoepfe = mutableListOf<View>()
    private var laeuft = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        lesen(intent)
        aufbauen()
        if (savedInstanceState == null) fragen()
        else if (::feld.isInitialized) feld.setText(savedInstanceState.getString("entwurf", ""))
    }

    override fun onSaveInstanceState(out: Bundle) {
        super.onSaveInstanceState(out)
        if (::feld.isInitialized) out.putString("entwurf", feld.text.toString())
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        lesen(intent)
        aufbauen()
        fragen()
    }

    private fun lesen(i: Intent) {
        chat = i.getStringExtra(EXTRA_CHAT)?.let { Speicher.chats[it] }
        val c = chat
        if (c != null) {
            absender = c.titel
            // Alles seit meiner letzten eigenen Nachricht ist „die neue Nachricht“
            val abMir = c.verlauf.indexOfLast { it.von == null }
            val neu = c.verlauf.drop(abMir + 1).ifEmpty { listOf(c.verlauf.last()) }
            nachricht = neu.joinToString("\n") { if (c.gruppe && it.von != null) "${it.von}: ${it.text}" else it.text }
            verlauf = c.verlauf.take(c.verlauf.size - neu.size)
        } else {
            // Geteilter oder markierter Text
            absender = i.getStringExtra(Intent.EXTRA_SUBJECT) ?: ""
            nachricht = (i.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT)
                ?: i.getCharSequenceExtra(Intent.EXTRA_TEXT))?.toString() ?: ""
            verlauf = emptyList()
        }
    }

    private fun aufbauen() {
        knoepfe.clear()
        val c = this
        val wurzel = Ui.spalte(c).apply {
            setPadding(Ui.dp(c, 16), Ui.dp(c, 12), Ui.dp(c, 16), Ui.dp(c, 24))
            setBackgroundColor(Ui.hinter(c))
        }

        wurzel.addView(Ui.text(c, if (absender.isNotBlank()) "Antwort an $absender" else "Antwort formulieren", 20f, true))

        // Die eingegangene Nachricht
        wurzel.addView(Ui.ueberschrift(c, "Nachricht"))
        if (nachricht.isBlank()) {
            val ein = EditText(c).apply {
                hint = "Nachricht hier einfügen"
                minLines = 3
                setTextColor(Ui.schrift(c))
                background = Ui.rund(Ui.karte(c), Ui.dp(c, 12).toFloat())
                setPadding(Ui.dp(c, 12), Ui.dp(c, 10), Ui.dp(c, 12), Ui.dp(c, 10))
            }
            wurzel.addView(ein)
            wurzel.addView(Ui.knopf(c, "📋 Aus Zwischenablage") {
                val cm = getSystemService(ClipboardManager::class.java)
                ein.setText(cm.primaryClip?.getItemAt(0)?.coerceToText(c) ?: "")
            }.also { Ui.abstand(it, oben = 6) })
            wurzel.addView(Ui.knopf(c, "Antwort vorschlagen", haupt = true) {
                nachricht = ein.text.toString(); aufbauen(); fragen()
            }.also { Ui.abstand(it, oben = 6) })
            setContentView(ScrollView(c).apply { addView(wurzel); setBackgroundColor(Ui.hinter(c)) })
            return
        }
        wurzel.addView(Ui.text(c, nachricht).apply {
            background = Ui.rund(Ui.karte(c), Ui.dp(c, 12).toFloat())
            setPadding(Ui.dp(c, 12), Ui.dp(c, 10), Ui.dp(c, 12), Ui.dp(c, 10))
        })

        termine = CheckBox(c).apply {
            text = "Terminvorschläge aus dem Kalender"
            setTextColor(Ui.schrift(c))
            isChecked = Speicher.termine(c)
            setOnCheckedChangeListener { _, an -> Speicher.setzen(c, "termine", an) }
        }
        wurzel.addView(termine)

        // Vorschlag
        wurzel.addView(Ui.ueberschrift(c, "Vorschlag – kannst du ändern"))
        feld = EditText(c).apply {
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
            minLines = 5
            gravity = Gravity.TOP
            setTextColor(Ui.schrift(c))
            textSize = 16f
            background = Ui.rund(Ui.blase(c), Ui.dp(c, 12).toFloat())
            setPadding(Ui.dp(c, 12), Ui.dp(c, 10), Ui.dp(c, 12), Ui.dp(c, 10))
        }
        wurzel.addView(feld)

        val zeile = LinearLayout(c).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        warten = ProgressBar(c).apply { isIndeterminate = true }
        zeile.addView(warten, LinearLayout.LayoutParams(Ui.dp(c, 22), Ui.dp(c, 22)))
        status = Ui.text(c, "", 13f, farbe = Ui.leise(c)).apply { setPadding(Ui.dp(c, 8), 0, 0, 0) }
        zeile.addView(status)
        wurzel.addView(zeile)
        Ui.abstand(zeile, oben = 6)

        // Senden / Kopieren
        val hatAktion = chat?.antwortAktion != null
        sendenKnopf = Ui.knopf(c, if (hatAktion) "✅ Senden" else "📋 Kopieren & öffnen", haupt = true) {
            if (hatAktion) senden() else kopierenUndOeffnen()
        }
        val zweit = if (hatAktion) Ui.knopf(c, "📋 Kopieren & öffnen") { kopierenUndOeffnen() } else null
        knoepfe += sendenKnopf
        zweit?.let { knoepfe += it }
        wurzel.addView(if (zweit != null) Ui.reihe(c, sendenKnopf, zweit) else Ui.reihe(c, sendenKnopf))
        (wurzel.getChildAt(wurzel.childCount - 1)).let { Ui.abstand(it, oben = 10) }

        // Nachbessern
        wurzel.addView(Ui.ueberschrift(c, "Anders formulieren"))
        val w = listOf(
            "↻ Neu" to "Bitte eine andere Formulierung.",
            "Kürzer" to "Bitte deutlich kürzer.",
            "Förmlicher" to "Bitte förmlicher, mit Sie.",
            "Lockerer" to "Bitte lockerer, mit du.",
            "Andere Termine" to "Bitte andere Terminvorschläge als im bisherigen Entwurf.",
            "Absagen" to "Bitte freundlich absagen, ohne Termine.",
        ).map { (name, bitte) -> Ui.knopf(c, name) { fragen(bitte) } }
        knoepfe += w
        wurzel.addView(Ui.reihe(c, *w.toTypedArray()))

        wunschFeld = EditText(c).apply {
            hint = "Eigener Wunsch, z. B. „Preis 89 € nennen“"
            setSingleLine()
            setTextColor(Ui.schrift(c))
            background = Ui.rund(Ui.karte(c), Ui.dp(c, 12).toFloat())
            setPadding(Ui.dp(c, 12), Ui.dp(c, 10), Ui.dp(c, 12), Ui.dp(c, 10))
        }
        val eigen = Ui.knopf(c, "Los") { if (wunschFeld.text.isNotBlank()) fragen(wunschFeld.text.toString()) }
        knoepfe += eigen
        val wz = LinearLayout(c).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        wz.addView(wunschFeld, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        wz.addView(eigen)
        wurzel.addView(wz)
        Ui.abstand(wz, oben = 8)

        if (!verlauf.isEmpty()) {
            wurzel.addView(Ui.ueberschrift(c, "Davor im Chat"))
            wurzel.addView(Ui.text(c, verlauf.takeLast(6).joinToString("\n") { "${it.von ?: "Ich"}: ${it.text}" }, 13f, farbe = Ui.leise(c)))
        }

        setContentView(ScrollView(c).apply { addView(wurzel); setBackgroundColor(Ui.hinter(c)); isFillViewport = true })
        beschaeftigt(false)
    }

    private fun beschaeftigt(an: Boolean) {
        laeuft = an
        warten.visibility = if (an) View.VISIBLE else View.GONE
        knoepfe.forEach { it.isEnabled = !an; it.alpha = if (an) 0.5f else 1f }
    }

    private fun fragen(wunsch: String = "") {
        if (nachricht.isBlank() || laeuft) return
        beschaeftigt(true)
        status.text = "Claude schreibt … (dauert ca. 10 s)"
        val vorher = if (wunsch.isNotEmpty()) feld.text.toString() else ""
        val mitTerminen = termine.isChecked && !wunsch.startsWith("Bitte freundlich absagen")
        Thread {
            try {
                val v = Api.vorschlag(this, absender, nachricht, verlauf, mitTerminen, wunsch, vorher)
                runOnUiThread {
                    feld.setText(v.antwort)
                    status.text = "Fertig in ${"%.0f".format(v.dauer)} s" +
                        (if (v.hinweise.isNotEmpty()) " – " + v.hinweise.joinToString("; ") else "")
                    beschaeftigt(false)
                    wunschFeld.setText("")
                }
            } catch (e: Exception) {
                runOnUiThread {
                    status.text = "⚠️ ${e.message}"
                    beschaeftigt(false)
                }
            }
        }.start()
    }

    private fun senden() {
        val text = feld.text.toString().trim()
        val aktion = chat?.antwortAktion
        if (text.isEmpty() || aktion == null) return
        try {
            val ergebnis = Bundle()
            aktion.remoteInputs.forEach { ergebnis.putCharSequence(it.resultKey, text) }
            val i = Intent()
            RemoteInput.addResultsToIntent(aktion.remoteInputs, i, ergebnis)
            aktion.actionIntent.send(this, 0, i)
            chat?.let { getSystemService(NotificationManager::class.java).cancel(it.schluessel.hashCode()) }
            Toast.makeText(this, "Gesendet an $absender ✔", Toast.LENGTH_SHORT).show()
            finish()
        } catch (e: Exception) {
            // Benachrichtigung schon weg → Antworten-Knopf ungültig
            status.text = "Direkt senden ging nicht mehr – kopiere und öffne WhatsApp"
            kopierenUndOeffnen()
        }
    }

    private fun kopierenUndOeffnen() {
        val text = feld.text.toString().trim()
        getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText("Antwort", text))
        Toast.makeText(this, "Kopiert – im Chat lange drücken → Einfügen", Toast.LENGTH_LONG).show()
        val c = chat
        try {
            if (c?.oeffnen != null) {
                val opt = ActivityOptions.makeBasic()
                if (Build.VERSION.SDK_INT >= 34)
                    opt.setPendingIntentBackgroundActivityStartMode(ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED)
                c.oeffnen.send(this, 0, null, null, null, null, opt.toBundle())
                return
            }
        } catch (_: Exception) { }
        val paket = c?.paket ?: "com.whatsapp"
        packageManager.getLaunchIntentForPackage(paket)?.let { startActivity(it) }
    }
}
