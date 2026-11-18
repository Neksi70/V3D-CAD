package com.volme3d.antwort

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.graphics.PixelFormat
import android.graphics.Rect
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.MotionEvent
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.widget.TextView
import android.widget.Toast
import kotlin.math.abs

/**
 * Schwebender 🤖-Knopf, solange in WhatsApp / WhatsApp Business ein Chat offen ist.
 * Tipp → sichtbare Nachrichten vom Bildschirm lesen → AntwortActivity.
 * „In WhatsApp einfügen“ schreibt den Text ins Eingabefeld; senden tippt Volker selbst.
 */
class BlaseService : AccessibilityService() {

    companion object {
        var instanz: BlaseService? = null
        val PAKETE = WaListener.PAKETE
        private val UHRZEIT = Regex("""^\d{1,2}:\d{2}( (AM|PM))?$""")
    }

    private val haupt = Handler(Looper.getMainLooper())
    private var knopf: TextView? = null
    private var paket: String? = null
    private var einfuegen: Pair<String, String>? = null   // paket → text
    private var pruefenGeplant = false

    override fun onServiceConnected() {
        instanz = this
    }

    override fun onDestroy() {
        verstecken()
        instanz = null
        super.onDestroy()
    }

    override fun onInterrupt() {}

    override fun onAccessibilityEvent(e: AccessibilityEvent?) {
        // Viele Ereignisse → höchstens alle 400 ms prüfen
        if (pruefenGeplant) return
        pruefenGeplant = true
        haupt.postDelayed({ pruefenGeplant = false; pruefen() }, 400)
    }

    private fun pruefen() {
        val wurzel = rootInActiveWindow
        val pkg = wurzel?.packageName?.toString() ?: return
        if (pkg !in PAKETE || !Speicher.blase(this)) {
            // Tastatur-Fenster o. ä. aktiv? Dann nicht flackern: nur verstecken, wenn eine andere App vorn ist
            if (pkg !in PAKETE || !Speicher.blase(this)) verstecken()
            return
        }
        val feld = eingabefeld(wurzel, pkg)
        if (feld == null) { verstecken(); return }
        paket = pkg
        zeigen()
        einfuegen?.let { (p, text) ->
            if (p == pkg) {
                val args = Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text) }
                feld.performAction(AccessibilityNodeInfo.ACTION_FOCUS)
                if (feld.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)) {
                    einfuegen = null
                    Toast.makeText(this, "Eingefügt – prüfen und auf Senden tippen", Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    /** Text merken; sobald der Chat wieder vorn ist, landet er im Eingabefeld. */
    fun spaeterEinfuegen(pkg: String, text: String) {
        einfuegen = pkg to text
        // Falls kein Ereignis kommt: ein paar Mal selbst nachsehen
        for (ms in longArrayOf(500, 1200, 2500)) haupt.postDelayed({ if (einfuegen != null) pruefen() }, ms)
        haupt.postDelayed({ einfuegen = null }, 10000)
    }

    private fun eingabefeld(w: AccessibilityNodeInfo, pkg: String): AccessibilityNodeInfo? {
        w.findAccessibilityNodeInfosByViewId("$pkg:id/entry")?.firstOrNull()?.let { return it }
        // Rückfall: unterstes bearbeitbares Feld
        return alle(w).filter { it.isEditable }.maxByOrNull { r(it).bottom }
    }

    private fun alle(n: AccessibilityNodeInfo, aus: MutableList<AccessibilityNodeInfo> = mutableListOf()): MutableList<AccessibilityNodeInfo> {
        aus += n
        for (i in 0 until n.childCount) n.getChild(i)?.let { alle(it, aus) }
        return aus
    }

    private fun r(n: AccessibilityNodeInfo) = Rect().also { n.getBoundsInScreen(it) }

    /** Chat-Name + sichtbare Nachrichten (links = vom Gegenüber, rechts = von mir). */
    private fun chatLesen(): Chat? {
        val pkg = paket ?: return null
        val w = rootInActiveWindow ?: return null
        val breite = resources.displayMetrics.widthPixels
        val feld = eingabefeld(w, pkg) ?: return null
        val titel = w.findAccessibilityNodeInfosByViewId("$pkg:id/conversation_contact_name")?.firstOrNull()?.text?.toString()
            ?: alle(w).firstOrNull { it.text != null && r(it).top < r(feld).top / 6 && it.className?.contains("TextView") == true }?.text?.toString()
            ?: "Chat"
        var texte = w.findAccessibilityNodeInfosByViewId("$pkg:id/message_text")?.toList().orEmpty()
        if (texte.isEmpty()) {
            // Rückfall: Textfelder zwischen Kopfzeile und Eingabefeld
            val oben = r(feld).top / 7
            texte = alle(w).filter {
                val t = it.text?.toString()?.trim().orEmpty()
                val b = r(it)
                t.isNotEmpty() && !it.isEditable && b.top > oben && b.bottom < r(feld).top &&
                    !UHRZEIT.matches(t) && t != titel && it.className?.contains("TextView") == true
            }
        }
        val verlauf = texte.sortedBy { r(it).top }.mapNotNull { n ->
            val t = n.text?.toString()?.trim().orEmpty()
            if (t.isEmpty()) return@mapNotNull null
            val b = r(n)
            // Bubble näher am linken Rand → Gegenüber
            val vonIhm = b.left < breite - b.right
            Nachricht(if (vonIhm) titel else null, t, System.currentTimeMillis())
        }
        if (verlauf.isEmpty()) return null
        return Chat("bildschirm:$pkg:$titel", titel, pkg, false, verlauf, null, null,
            System.currentTimeMillis(), vomBildschirm = true)
    }

    private fun geklickt() {
        val chat = chatLesen()
        if (chat == null || chat.verlauf.none { it.von != null }) {
            Toast.makeText(this, "Keine Nachricht vom Gegenüber auf dem Bildschirm gefunden", Toast.LENGTH_LONG).show()
            if (chat == null) return
        }
        Speicher.chats[chat.schluessel] = chat
        startActivity(Intent(this, AntwortActivity::class.java)
            .putExtra(AntwortActivity.EXTRA_CHAT, chat.schluessel)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP))
    }

    // --- Schwebender Knopf --------------------------------------------------------

    private fun zeigen() {
        if (knopf != null) return
        val wm = getSystemService(WindowManager::class.java)
        val gr = Ui.dp(this, 52)
        val k = TextView(this).apply {
            text = "🤖"
            textSize = 24f
            gravity = Gravity.CENTER
            background = Ui.rund(Ui.GRUEN, gr / 2f)
            elevation = Ui.dp(context, 6).toFloat()
            alpha = 0.92f
            contentDescription = "Mit Claude antworten"
        }
        val lp = WindowManager.LayoutParams(gr, gr, WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT).apply {
            gravity = Gravity.TOP or Gravity.START
            val dm = resources.displayMetrics
            x = Speicher.blaseX(this@BlaseService, dm.widthPixels - gr - Ui.dp(this@BlaseService, 8))
            y = Speicher.blaseY(this@BlaseService, (dm.heightPixels * 0.62).toInt())
        }
        // Ziehen verschiebt, kurzes Tippen löst aus
        var sx = 0f; var sy = 0f; var lx = 0; var ly = 0; var gezogen = false
        k.setOnTouchListener { v, ev ->
            when (ev.action) {
                MotionEvent.ACTION_DOWN -> { sx = ev.rawX; sy = ev.rawY; lx = lp.x; ly = lp.y; gezogen = false }
                MotionEvent.ACTION_MOVE -> {
                    val dx = ev.rawX - sx; val dy = ev.rawY - sy
                    if (abs(dx) + abs(dy) > Ui.dp(this, 8)) gezogen = true
                    if (gezogen) { lp.x = lx + dx.toInt(); lp.y = ly + dy.toInt(); wm.updateViewLayout(v, lp) }
                }
                MotionEvent.ACTION_UP -> {
                    if (gezogen) Speicher.blasePos(this, lp.x, lp.y) else geklickt()
                }
            }
            true
        }
        try {
            wm.addView(k, lp)
            knopf = k
        } catch (_: Exception) { }
    }

    private fun verstecken() {
        knopf?.let { try { getSystemService(WindowManager::class.java).removeView(it) } catch (_: Exception) { } }
        knopf = null
    }
}
