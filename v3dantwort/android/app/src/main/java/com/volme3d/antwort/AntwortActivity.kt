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
    /** Alle gelesenen Nachrichten des Chats; auswahl = Indizes, auf die geantwortet wird. */
    private var alle: List<Nachricht> = emptyList()
    private val auswahl = sortedSetOf<Int>()
    private var aelter = false

    private lateinit var feld: EditText
    private lateinit var status: TextView
    private lateinit var warten: ProgressBar
    private lateinit var termine: CheckBox
    private lateinit var wunschFeld: EditText
    private lateinit var hinweis: TextView
    private var wunschMerk = ""
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
            alle = c.verlauf
            // Vorauswahl: alles seit meiner letzten eigenen Nachricht
            val abMir = alle.indexOfLast { it.von == null }
            auswahl.clear()
            auswahl += ((abMir + 1) until alle.size)
            if (auswahl.isEmpty()) auswahl += alle.indices.last
            auswahlUebernehmen()
        } else {
            // Geteilter oder markierter Text
            absender = i.getStringExtra(Intent.EXTRA_SUBJECT) ?: ""
            nachricht = (i.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT)
                ?: i.getCharSequenceExtra(Intent.EXTRA_TEXT))?.toString() ?: ""
            verlauf = emptyList()
            alle = emptyList()
            auswahl.clear()
            aelter = false
        }
    }

    /** nachricht/verlauf aus der Auswahl ableiten. */
    private fun auswahlUebernehmen() {
        val gruppe = chat?.gruppe == true
        nachricht = auswahl.map { alle[it] }
            .joinToString("\n") { if (gruppe && it.von != null) "${it.von}: ${it.text}" else it.text }
        verlauf = alle.filterIndexed { i, _ -> i !in auswahl }
        // Ältere Nachricht gewählt? (danach kam noch etwas vom Gegenüber)
        val letzteVonIhm = alle.indexOfLast { it.von != null }
        aelter = auswahl.isNotEmpty() && auswahl.last() < letzteVonIhm
    }

    /** Liste der Chat-Nachrichten zum Antippen. */
    private fun listeZeichnen(liste: LinearLayout) {
        val c = this
        liste.removeAllViews()
        alle.forEachIndexed { i, m ->
            val ich = m.von == null
            val gewaehlt = i in auswahl
            val t = Ui.text(c, (if (gewaehlt) "✓ " else "") + (if (ich) "Ich: " else "") + m.text,
                if (ich) 13f else 15f, farbe = if (ich) Ui.leise(c) else null).apply {
                setTextIsSelectable(false)
                background = Ui.rund(if (ich) Ui.hinter(c) else Ui.karte(c), Ui.dp(c, 12).toFloat(),
                    if (gewaehlt) Ui.GRUEN else null)
                setPadding(Ui.dp(c, 12), Ui.dp(c, 8), Ui.dp(c, 12), Ui.dp(c, 8))
                if (!ich) setOnClickListener {
                    if (laeuft) return@setOnClickListener
                    if (gewaehlt && auswahl.size > 1) auswahl -= i else if (!gewaehlt) auswahl += i
                    auswahlUebernehmen()
                    listeZeichnen(liste)
                }
            }
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT)
            lp.topMargin = Ui.dp(c, 6)
            lp.gravity = if (ich) Gravity.END else Gravity.START
            if (ich) lp.leftMargin = Ui.dp(c, 48) else lp.rightMargin = Ui.dp(c, 24)
            liste.addView(t, lp)
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
        if (alle.size > 1) {
            (wurzel.getChildAt(wurzel.childCount - 1) as TextView).text = "Worauf antworten? – Nachricht antippen"
            val liste = Ui.spalte(c)
            listeZeichnen(liste)
            wurzel.addView(liste)
            val aufAuswahl = Ui.knopf(c, "↻ Auf Auswahl antworten") { fragen() }
            knoepfe += aufAuswahl
            wurzel.addView(Ui.raster(c, 1, listOf(aufAuswahl)))
            (wurzel.getChildAt(wurzel.childCount - 1)).let { Ui.abstand(it, oben = 8) }
        } else {
            wurzel.addView(Ui.text(c, nachricht).apply {
                background = Ui.rund(Ui.karte(c), Ui.dp(c, 12).toFloat())
                setPadding(Ui.dp(c, 12), Ui.dp(c, 10), Ui.dp(c, 12), Ui.dp(c, 10))
            })
        }

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
        hinweis = Ui.text(c, "", 14f, farbe = 0xFFFFB74D.toInt()).apply {
            background = Ui.rund(if (Ui.dunkel(c)) 0xFF3E2C10.toInt() else 0xFFFFF3E0.toInt(), Ui.dp(c, 10).toFloat())
            setPadding(Ui.dp(c, 12), Ui.dp(c, 8), Ui.dp(c, 12), Ui.dp(c, 8))
            visibility = View.GONE
        }
        wurzel.addView(hinweis)
        Ui.abstand(hinweis, oben = 6)

        // Einfügen / Senden / Kopieren
        val hatAktion = chat?.antwortAktion != null
        val vomBildschirm = chat?.vomBildschirm == true
        sendenKnopf = when {
            vomBildschirm -> Ui.knopf(c, "📝 Einfügen", haupt = true) { einfuegen() }
            hatAktion -> Ui.knopf(c, "✅ Senden", haupt = true) { senden() }
            else -> Ui.knopf(c, "📋 Kopieren & öffnen", haupt = true) { kopierenUndOeffnen() }
        }
        val zweit = if (hatAktion || vomBildschirm) Ui.knopf(c, "📋 Kopieren") { kopieren() } else null
        knoepfe += sendenKnopf
        zweit?.let { knoepfe += it }
        wurzel.addView(Ui.raster(c, if (zweit != null) 2 else 1, listOfNotNull(sendenKnopf, zweit)))
        (wurzel.getChildAt(wurzel.childCount - 1)).let { Ui.abstand(it, oben = 10) }

        // Eigene Anweisung auf Deutsch – Claude übernimmt sie in der Chatsprache
        wurzel.addView(Ui.ueberschrift(c, "💬 Was soll rein? (auf Deutsch)"))
        wunschFeld = EditText(c).apply {
            hint = "z. B. „Lieber erst um 15:30, wir sind vorher noch bei 3devo“"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
            minLines = 2
            gravity = Gravity.TOP
            setTextColor(Ui.schrift(c))
            setHintTextColor(Ui.leise(c))
            background = Ui.rund(Ui.karte(c), Ui.dp(c, 12).toFloat())
            setPadding(Ui.dp(c, 12), Ui.dp(c, 10), Ui.dp(c, 12), Ui.dp(c, 10))
            setText(wunschMerk)
        }
        wurzel.addView(wunschFeld)
        val eigen = Ui.knopf(c, "✍️ In die Antwort übernehmen") {
            val t = wunschFeld.text.toString().trim()
            if (t.isNotEmpty()) fragen(t)
        }
        knoepfe += eigen
        wurzel.addView(Ui.raster(c, 1, listOf(eigen)))
        (wurzel.getChildAt(wurzel.childCount - 1)).let { Ui.abstand(it, oben = 8) }

        // Nachbessern
        wurzel.addView(Ui.ueberschrift(c, "Anders formulieren"))
        val w = listOf(
            "↻ Neu" to "Bitte eine andere Formulierung.",
            "Kürzer" to "Bitte deutlich kürzer.",
            "Förmlicher" to "Bitte förmlicher, mit Sie.",
            "Lockerer" to "Bitte lockerer, mit du.",
            "Andere Termine" to "Bitte andere Terminvorschläge als im bisherigen Entwurf.",
            "Absagen" to "Bitte freundlich absagen, ohne Termine.",
            "🇬🇧 English" to "Please write the reply in English (dates in English format).",
            "🇩🇪 Deutsch" to "Bitte auf Deutsch antworten.",
        ).map { (name, bitte) -> Ui.knopf(c, name) { fragen(bitte) } }
        knoepfe += w
        wurzel.addView(Ui.raster(c, 3, w))

        if (alle.size <= 1 && verlauf.isNotEmpty()) {
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
        hinweis.visibility = View.GONE
        wunschMerk = wunschFeld.text.toString()
        val vorher = if (wunsch.isNotEmpty()) feld.text.toString() else ""
        val mitTerminen = termine.isChecked && !wunsch.startsWith("Bitte freundlich absagen")
        Thread {
            try {
                val v = Api.vorschlag(this, absender, nachricht, verlauf, mitTerminen, wunsch, vorher, aelter)
                runOnUiThread {
                    feld.setText(v.antwort)
                    status.text = "Fertig in ${"%.0f".format(v.dauer)} s"
                    hinweis.text = "⚠️ " + v.hinweise.joinToString("\n⚠️ ")
                    hinweis.visibility = if (v.hinweise.isEmpty()) View.GONE else View.VISIBLE
                    beschaeftigt(false)
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

    private fun kopieren() {
        getSystemService(ClipboardManager::class.java)
            .setPrimaryClip(ClipData.newPlainText("Antwort", feld.text.toString().trim()))
        Toast.makeText(this, "Kopiert – im Chat lange drücken → Einfügen", Toast.LENGTH_LONG).show()
    }

    /** Zurück in den WhatsApp-Chat; die Bedienungshilfe schreibt den Text ins Eingabefeld. */
    private fun einfuegen() {
        val text = feld.text.toString().trim()
        val c = chat ?: return
        if (text.isEmpty()) return
        val dienst = BlaseService.instanz
        if (dienst == null) { kopieren(); finish(); return }
        // Zur Sicherheit auch in die Zwischenablage
        getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText("Antwort", text))
        dienst.spaeterEinfuegen(c.paket, text)
        finish()
    }

    private fun kopierenUndOeffnen() {
        kopieren()
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
