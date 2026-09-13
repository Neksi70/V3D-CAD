package com.volme3d.handy

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Path
import android.graphics.Rect
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.util.Base64
import android.view.Display
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.view.accessibility.AccessibilityWindowInfo
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Die Bedienungshilfe: sieht den Bildschirm jeder App als Elementbaum und
 * kann tippen, wischen, Text setzen und Screenshots machen.
 *
 * Sie tut von sich aus nichts. Die Befehle kommen vom [AgentService], der sie
 * vom V3D-Server abholt. Element-Nummern gelten jeweils bis zum naechsten
 * [lesen] — danach ist der Baum neu durchnummeriert.
 */
class BedienService : AccessibilityService() {

    companion object {
        @Volatile var instanz: BedienService? = null
        val aktiv: Boolean get() = instanz != null
        private const val MAX_ELEMENTE = 700
        private const val MAX_ZEICHEN = 60_000
        private const val BILD_MAX = 1000        // laengste Bildkante im Screenshot
    }

    private class Eintrag(val knoten: AccessibilityNodeInfo, val rahmen: Rect)

    private val eintraege = ArrayList<Eintrag>()

    override fun onServiceConnected() {
        super.onServiceConnected()
        instanz = this
        Zustand.bedienhilfe = true
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) { /* wir hoeren nicht, wir fragen */ }

    override fun onInterrupt() {}

    override fun onUnbind(intent: Intent?): Boolean {
        instanz = null
        Zustand.bedienhilfe = false
        return super.onUnbind(intent)
    }

    override fun onDestroy() {
        instanz = null
        Zustand.bedienhilfe = false
        super.onDestroy()
    }

    // ------------------------------------------------------------ Bildschirm

    fun bildschirm(): Rect {
        val wm = getSystemService(Context.WINDOW_SERVICE) as WindowManager
        return wm.maximumWindowMetrics.bounds
    }

    private fun wurzel(): AccessibilityNodeInfo? {
        rootInActiveWindow?.let { return it }
        return windows.firstOrNull { it.type == AccessibilityWindowInfo.TYPE_APPLICATION }?.root
    }

    /** Elementbaum als Text; jede Zeile ein Element mit Nummer. */
    fun lesen(alles: Boolean): String {
        val root = wurzel() ?: return ""
        synchronized(eintraege) { eintraege.clear() }
        val sb = StringBuilder()
        sb.append("App: ").append(root.packageName ?: "?")
        val fenster = windows
        fenster.firstOrNull { it.type == AccessibilityWindowInfo.TYPE_APPLICATION }?.title?.let {
            if (it.isNotBlank()) sb.append(" | Fenster: ").append(it)
        }
        if (fenster.any { it.type == AccessibilityWindowInfo.TYPE_INPUT_METHOD }) sb.append(" | Tastatur eingeblendet")
        val schirm = bildschirm()
        sb.append(" | Bildschirm ").append(schirm.width()).append('x').append(schirm.height()).append('\n')
        val zaehler = IntArray(1)
        synchronized(eintraege) { gehen(root, 0, alles, sb, schirm, zaehler) }
        if (zaehler[0] >= MAX_ELEMENTE) sb.append("… (abgeschnitten, mehr als $MAX_ELEMENTE Elemente)\n")
        return sb.toString()
    }

    private fun gehen(n: AccessibilityNodeInfo, tiefe: Int, alles: Boolean, sb: StringBuilder,
                      schirm: Rect, zaehler: IntArray) {
        if (zaehler[0] >= MAX_ELEMENTE || sb.length > MAX_ZEICHEN) return
        if (!n.isVisibleToUser) return
        val r = Rect()
        n.getBoundsInScreen(r)
        if (!Rect.intersects(r, schirm)) return
        val text = n.text?.toString()?.trim().orEmpty()
        val desc = n.contentDescription?.toString()?.trim().orEmpty()
        val hinweis = n.hintText?.toString()?.trim().orEmpty()
        val interaktiv = n.isClickable || n.isLongClickable || n.isEditable || n.isCheckable || n.isScrollable
        val wichtig = alles || text.isNotEmpty() || desc.isNotEmpty() || interaktiv
        var kinderTiefe = tiefe
        if (wichtig) {
            val id = eintraege.size
            eintraege.add(Eintrag(n, r))
            zaehler[0]++
            sb.append("  ".repeat(min(tiefe, 8))).append('[').append(id).append("] ").append(typ(n))
            if (text.isNotEmpty()) sb.append(" \"").append(kuerzen(text, 160)).append('"')
            if (desc.isNotEmpty() && desc != text) sb.append(" (").append(kuerzen(desc, 100)).append(')')
            if (hinweis.isNotEmpty() && hinweis != text) sb.append(" Hinweis:\"").append(kuerzen(hinweis, 60)).append('"')
            n.viewIdResourceName?.substringAfter('/')?.let { if (it.isNotEmpty()) sb.append(" id=").append(it) }
            sb.append(" @").append(r.centerX()).append(',').append(r.centerY())
            val fl = ArrayList<String>(4)
            if (n.isClickable) fl.add("klickbar")
            if (n.isLongClickable && !n.isClickable) fl.add("lang-klickbar")
            if (n.isEditable) fl.add("editierbar")
            if (n.isScrollable) fl.add("scrollbar")
            if (n.isCheckable) fl.add(if (n.isChecked) "angehakt" else "nicht angehakt")
            if (n.isSelected) fl.add("ausgewaehlt")
            if (n.isFocused) fl.add("fokus")
            if (!n.isEnabled) fl.add("deaktiviert")
            if (n.isPassword) fl.add("passwort")
            if (fl.isNotEmpty()) sb.append(' ').append(fl.joinToString(" "))
            sb.append('\n')
            kinderTiefe = tiefe + 1
        }
        for (i in 0 until n.childCount) {
            val k = n.getChild(i) ?: continue
            gehen(k, kinderTiefe, alles, sb, schirm, zaehler)
        }
    }

    private fun typ(n: AccessibilityNodeInfo): String {
        val k = n.className?.toString()?.substringAfterLast('.') ?: "Element"
        return when (k) {
            "TextView" -> "Text"
            "EditText", "AutoCompleteTextView" -> "Eingabe"
            "ImageView" -> "Bild"
            "ImageButton" -> "Bildknopf"
            "Switch", "SwitchCompat", "ToggleButton" -> "Schalter"
            "CheckBox" -> "Haken"
            "RadioButton" -> "Auswahl"
            "RecyclerView", "ListView", "ScrollView", "HorizontalScrollView", "ViewPager", "ViewPager2" -> "Liste"
            "View", "ViewGroup", "FrameLayout", "LinearLayout", "RelativeLayout", "ConstraintLayout" ->
                if (n.isClickable) "Fläche" else "Gruppe"
            else -> k
        }
    }

    private fun kuerzen(s: String, n: Int) =
        (if (s.length > n) s.substring(0, n) + "…" else s).replace('\n', ' ')

    private fun eintrag(id: Int): Eintrag = synchronized(eintraege) {
        eintraege.getOrNull(id) ?: throw IllegalArgumentException(
            "Element $id gibt es nicht (${eintraege.size} bekannt) — erst bildschirm_lesen")
    }

    // ------------------------------------------------------------ Gesten

    private fun geste(pfad: Path, dauer: Long): Boolean {
        val latch = CountDownLatch(1)
        var ok = false
        val g = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(pfad, 0, dauer)).build()
        val los = dispatchGesture(g, object : GestureResultCallback() {
            override fun onCompleted(gestureDescription: GestureDescription?) { ok = true; latch.countDown() }
            override fun onCancelled(gestureDescription: GestureDescription?) { latch.countDown() }
        }, null)
        if (!los) return false
        latch.await(dauer + 3000, TimeUnit.MILLISECONDS)
        return ok
    }

    private fun tippenXY(x: Int, y: Int, lang: Boolean): Boolean {
        val p = Path().apply { moveTo(x.toFloat(), y.toFloat()) }
        return geste(p, if (lang) 900 else 60)
    }

    fun tippen(id: Int?, x: Int?, y: Int?, lang: Boolean): String {
        if (id != null) {
            val e = eintrag(id)
            if (!lang) {
                var k: AccessibilityNodeInfo? = e.knoten
                var stufe = 0
                while (k != null && stufe < 4) {
                    if (k.isClickable && k.performAction(AccessibilityNodeInfo.ACTION_CLICK))
                        return "getippt: Element $id"
                    k = k.parent; stufe++
                }
            } else if (e.knoten.isLongClickable && e.knoten.performAction(AccessibilityNodeInfo.ACTION_LONG_CLICK)) {
                return "lang gedrueckt: Element $id"
            }
            val cx = e.rahmen.centerX(); val cy = e.rahmen.centerY()
            if (tippenXY(cx, cy, lang)) return "getippt (Geste) bei $cx,$cy fuer Element $id"
            throw IllegalStateException("Tippen auf Element $id fehlgeschlagen")
        }
        if (x == null || y == null) throw IllegalArgumentException("element oder x/y angeben")
        val s = bildschirm()
        if (x !in 0..s.width() || y !in 0..s.height())
            throw IllegalArgumentException("$x,$y liegt ausserhalb des Bildschirms (${s.width()}x${s.height()})")
        if (tippenXY(x, y, lang)) return "getippt bei $x,$y"
        throw IllegalStateException("Geste bei $x,$y wurde abgebrochen")
    }

    fun wischen(richtung: String?, id: Int?, x1: Int?, y1: Int?, x2: Int?, y2: Int?, dauerMs: Int?): String {
        val dauer = (dauerMs ?: 350).coerceIn(50, 5000).toLong()
        if (richtung == null) {
            if (x1 == null || y1 == null || x2 == null || y2 == null)
                throw IllegalArgumentException("richtung oder x1,y1,x2,y2 angeben")
            val p = Path().apply { moveTo(x1.toFloat(), y1.toFloat()); lineTo(x2.toFloat(), y2.toFloat()) }
            if (geste(p, dauer)) return "gewischt von $x1,$y1 nach $x2,$y2"
            throw IllegalStateException("Wischen abgebrochen")
        }
        var rahmen: Rect
        if (id != null) {
            val e = eintrag(id)
            if (e.knoten.isScrollable) {
                val aktion = when (richtung) {
                    "hoch", "links" -> AccessibilityNodeInfo.ACTION_SCROLL_FORWARD
                    else -> AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD
                }
                if (e.knoten.performAction(aktion)) return "gescrollt ($richtung) in Element $id"
            }
            rahmen = Rect(e.rahmen)
        } else {
            rahmen = bildschirm()
            rahmen.inset(rahmen.width() / 8, rahmen.height() / 6)   // Systemleisten und Kanten meiden
        }
        val cx = rahmen.centerX().toFloat(); val cy = rahmen.centerY().toFloat()
        val dx = rahmen.width() * 0.35f; val dy = rahmen.height() * 0.35f
        // Finger bewegt sich mit dem Inhalt: „hoch“ = Inhalt nach oben = Finger von unten nach oben
        val (ax, ay, bx, by) = when (richtung) {
            "hoch" -> listOf(cx, cy + dy, cx, cy - dy)
            "runter" -> listOf(cx, cy - dy, cx, cy + dy)
            "links" -> listOf(cx + dx, cy, cx - dx, cy)
            "rechts" -> listOf(cx - dx, cy, cx + dx, cy)
            else -> throw IllegalArgumentException("richtung: hoch, runter, links oder rechts")
        }
        val p = Path().apply { moveTo(ax, ay); lineTo(bx, by) }
        if (geste(p, dauer)) return "gewischt $richtung" + (if (id != null) " in Element $id" else "")
        throw IllegalStateException("Wischen abgebrochen")
    }

    // ------------------------------------------------------------ Text & Tasten

    private fun fokusFeld(): AccessibilityNodeInfo? = wurzel()?.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)

    fun text(id: Int?, text: String, ersetzen: Boolean, enter: Boolean): String {
        val n = if (id != null) eintrag(id).knoten else fokusFeld()
            ?: throw IllegalStateException("Kein Eingabefeld hat den Fokus — element angeben oder das Feld erst antippen")
        if (!n.isFocused) {
            n.performAction(AccessibilityNodeInfo.ACTION_FOCUS)
            if (n.isClickable) n.performAction(AccessibilityNodeInfo.ACTION_CLICK)
        }
        val neu = if (ersetzen) text else (n.text?.toString() ?: "") + text
        val b = Bundle()
        b.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, neu)
        var ok = n.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, b)
        var weg = "gesetzt"
        if (!ok) {
            // Ersatzweg: ueber die Zwischenablage einfuegen (manche Web-Felder nehmen SET_TEXT nicht)
            val cm = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            cm.setPrimaryClip(ClipData.newPlainText("V3D Handy", text))
            if (ersetzen) {
                val alles = Bundle()
                alles.putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_START_INT, 0)
                alles.putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_END_INT, n.text?.length ?: 0)
                n.performAction(AccessibilityNodeInfo.ACTION_SET_SELECTION, alles)
            }
            ok = n.performAction(AccessibilityNodeInfo.ACTION_PASTE)
            weg = "eingefuegt"
        }
        if (!ok) throw IllegalStateException("Text konnte nicht gesetzt werden — ist das ein Eingabefeld?")
        var meldung = "Text $weg" + (if (id != null) " in Element $id" else "")
        if (enter) meldung += if (this.enter(n)) ", Enter gesendet" else ", Enter NICHT moeglich (Feld kennt keine Enter-Aktion)"
        return meldung
    }

    private fun enter(feld: AccessibilityNodeInfo?): Boolean {
        val ziel = feld ?: fokusFeld() ?: return false
        return ziel.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_IME_ENTER.id)
    }

    fun taste(name: String): String {
        val ok = when (name) {
            "zurueck" -> performGlobalAction(GLOBAL_ACTION_BACK)
            "home" -> performGlobalAction(GLOBAL_ACTION_HOME)
            "uebersicht" -> performGlobalAction(GLOBAL_ACTION_RECENTS)
            "benachrichtigungen" -> performGlobalAction(GLOBAL_ACTION_NOTIFICATIONS)
            "schnelleinstellungen" -> performGlobalAction(GLOBAL_ACTION_QUICK_SETTINGS)
            "sperren" -> performGlobalAction(GLOBAL_ACTION_LOCK_SCREEN)
            "enter" -> enter(null)
            "wecken" -> wecken()
            else -> throw IllegalArgumentException("Unbekannte Taste: $name")
        }
        if (!ok) throw IllegalStateException("Taste $name wurde nicht angenommen")
        return "Taste $name"
    }

    @Suppress("DEPRECATION")
    private fun wecken(): Boolean {
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        val wl = pm.newWakeLock(
            PowerManager.SCREEN_BRIGHT_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP or PowerManager.ON_AFTER_RELEASE,
            "v3dhandy:wecken")
        wl.acquire(3000)
        return true
    }

    // ------------------------------------------------------------ Apps

    private fun appListe(): List<Pair<String, String>> {
        val pm = packageManager
        return pm.getInstalledApplications(0)
            .filter { pm.getLaunchIntentForPackage(it.packageName) != null }
            .map { pm.getApplicationLabel(it).toString() to it.packageName }
            .sortedBy { it.first.lowercase() }
    }

    fun apps(suche: String?): String {
        val s = suche?.trim()?.lowercase().orEmpty()
        val liste = appListe().filter { s.isEmpty() || it.first.lowercase().contains(s) || it.second.contains(s) }
        if (liste.isEmpty()) return "Keine App passt zu „$suche“."
        return liste.joinToString("\n") { "${it.first}  (${it.second})" }
    }

    fun appOeffnen(app: String): String {
        val pm = packageManager
        val a = app.trim()
        var paket: String? = if (pm.getLaunchIntentForPackage(a) != null) a else null
        if (paket == null) {
            val liste = appListe()
            paket = liste.firstOrNull { it.first.equals(a, true) }?.second
                ?: liste.firstOrNull { it.first.lowercase().startsWith(a.lowercase()) }?.second
                ?: liste.firstOrNull { it.first.lowercase().contains(a.lowercase()) || it.second.contains(a.lowercase()) }?.second
        }
        val intent = paket?.let { pm.getLaunchIntentForPackage(it) }
            ?: throw IllegalArgumentException("Keine App „$a“ gefunden — apps_auflisten hilft")
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)
        startActivity(intent)
        return "gestartet: $paket"
    }

    // ------------------------------------------------------------ Screenshot

    fun screenshot(): JSONObject {
        val latch = CountDownLatch(1)
        var bmp: Bitmap? = null
        var fehler = -1
        takeScreenshot(Display.DEFAULT_DISPLAY, mainExecutor, object : TakeScreenshotCallback {
            override fun onSuccess(r: ScreenshotResult) {
                try {
                    val hw = Bitmap.wrapHardwareBuffer(r.hardwareBuffer, r.colorSpace)
                    bmp = hw?.copy(Bitmap.Config.ARGB_8888, false)
                    hw?.recycle()
                } finally {
                    r.hardwareBuffer.close()
                    latch.countDown()
                }
            }
            override fun onFailure(errorCode: Int) { fehler = errorCode; latch.countDown() }
        })
        latch.await(8, TimeUnit.SECONDS)
        val voll = bmp ?: throw IllegalStateException(
            when (fehler) {
                ERROR_TAKE_SCREENSHOT_INTERVAL_TIME_SHORT -> "Screenshot: zu schnell hintereinander, kurz warten"
                ERROR_TAKE_SCREENSHOT_NO_ACCESSIBILITY_ACCESS -> "Screenshot: Bedienungshilfe hat kein Screenshot-Recht"
                ERROR_TAKE_SCREENSHOT_INVALID_DISPLAY -> "Screenshot: Bildschirm nicht verfuegbar (aus?)"
                -1 -> "Screenshot: keine Antwort vom System (Bildschirm aus oder gesperrt?)"
                else -> "Screenshot fehlgeschlagen (Code $fehler)"
            })
        val faktor = maxOf(voll.width, voll.height).toFloat() / BILD_MAX
        val klein = if (faktor > 1f)
            Bitmap.createScaledBitmap(voll, (voll.width / faktor).roundToInt(), (voll.height / faktor).roundToInt(), true)
        else voll
        val out = ByteArrayOutputStream()
        klein.compress(Bitmap.CompressFormat.JPEG, 70, out)
        val schirm = bildschirm()
        return JSONObject()
            .put("bild", Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP))
            .put("mime", "image/jpeg")
            .put("bild_breite", klein.width).put("bild_hoehe", klein.height)
            .put("breite", schirm.width()).put("hoehe", schirm.height())
            .put("faktor", voll.width.toDouble() / klein.width)
    }
}
