package com.volme3d.beleg

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Base64
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.FileProvider
import java.io.File

const val BASIS = "https://v3da.tailf05fe9.ts.net/rechnung/scan.html"

/**
 * Hülle um scan.html (VolmeRechnung): Papierrechnung scannen, Zahlungsdaten
 * einzeln kopieren, in SumUp einfügen.
 *
 * Was der WebView von sich aus nicht kann und hier nachgerüstet wird:
 *   - <input type=file>: ohne onShowFileChooser passiert beim Tippen NICHTS.
 *     Mit capture -> Kamera-App (TakePicture in eine FileProvider-Datei),
 *     sonst Dateiauswahl für Bild/PDF.
 *   - „Teilen → V3D Beleg": geteilte PDFs/Bilder gehen als Base64 an die Seite.
 *   - Kopieren über den Android-ClipboardManager (zuverlässiger als die
 *     Clipboard-API im WebView) und Sprung in die Banking-App (SumUp oder bunq).
 */
class MainActivity : AppCompatActivity() {

    private lateinit var web: WebView
    private var seiteBereit = false
    private var wartendeDatei: Uri? = null

    private var dateiRueckgabe: ValueCallback<Array<Uri>>? = null
    private var fotoUri: Uri? = null

    private val foto = registerForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        val u = fotoUri
        dateiRueckgabe?.onReceiveValue(if (ok && u != null) arrayOf(u) else null)
        dateiRueckgabe = null
    }
    private val datei = registerForActivityResult(ActivityResultContracts.OpenDocument()) { u ->
        dateiRueckgabe?.onReceiveValue(if (u != null) arrayOf(u) else null)
        dateiRueckgabe = null
    }

    inner class Bruecke {
        @JavascriptInterface
        fun kopieren(text: String) {
            runOnUiThread {
                val cm = getSystemService(CLIPBOARD_SERVICE) as ClipboardManager
                cm.setPrimaryClip(ClipData.newPlainText("V3D Beleg", text))
            }
        }

        /** Erste installierte App aus der Liste öffnen (SumUp Business, sonst SumUp). */
        @JavascriptInterface
        fun appOeffnen(paket1: String, paket2: String) {
            runOnUiThread {
                val i = listOf(paket1, paket2).firstNotNullOfOrNull { packageManager.getLaunchIntentForPackage(it) }
                if (i != null) startActivity(i)
                else Toast.makeText(this@MainActivity, "SumUp-App nicht gefunden.", Toast.LENGTH_SHORT).show()
            }
        }

        /** Wie appOeffnen, aber beliebig viele Pakete (Komma-Liste) und passende Meldung. */
        @JavascriptInterface
        fun appOeffnenListe(pakete: String, name: String) {
            runOnUiThread {
                val i = pakete.split(',').map { it.trim() }.filter { it.isNotEmpty() }
                    .firstNotNullOfOrNull { packageManager.getLaunchIntentForPackage(it) }
                if (i != null) startActivity(i)
                else Toast.makeText(this@MainActivity, "$name-App nicht gefunden.", Toast.LENGTH_SHORT).show()
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        web = WebView(this)
        setContentView(web, ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))

        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true        // Login-Schlüssel liegt im localStorage
            allowFileAccess = false
            setSupportZoom(false)
            setSupportMultipleWindows(false)
        }
        web.setBackgroundColor(0xFFF4F5F9.toInt())
        CookieManager.getInstance().setAcceptCookie(true)
        web.addJavascriptInterface(Bruecke(), "AndroidBruecke")

        web.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(v: WebView, rueckgabe: ValueCallback<Array<Uri>>,
                                           p: FileChooserParams): Boolean {
                dateiRueckgabe?.onReceiveValue(null)   // offene Anfrage sauber beenden
                dateiRueckgabe = rueckgabe
                return try {
                    if (p.isCaptureEnabled) {
                        val ordner = File(cacheDir, "fotos").apply { mkdirs() }
                        ordner.listFiles()?.forEach { it.delete() }   // alte Fotos weg
                        val f = File(ordner, "rechnung-${System.currentTimeMillis()}.jpg")
                        fotoUri = FileProvider.getUriForFile(this@MainActivity, "com.volme3d.beleg.dateien", f)
                        foto.launch(fotoUri)
                    } else {
                        datei.launch(arrayOf("image/*", "application/pdf"))
                    }
                    true
                } catch (e: ActivityNotFoundException) {
                    dateiRueckgabe = null
                    Toast.makeText(this@MainActivity, "Keine Kamera-/Datei-App gefunden.", Toast.LENGTH_SHORT).show()
                    false
                }
            }
        }

        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(v: WebView, anfrage: WebResourceRequest): Boolean {
                val u = anfrage.url.toString()
                if (u.startsWith(BASIS)) return false
                // Scan-Vorschau (/api/belege/…) und alles andere im Browser öffnen
                return try { startActivity(Intent(Intent.ACTION_VIEW, anfrage.url)); true }
                catch (e: ActivityNotFoundException) { true }
            }

            override fun onPageFinished(v: WebView, url: String) {
                CookieManager.getInstance().flush()
                if (url.startsWith(BASIS)) {
                    seiteBereit = true
                    wartendeDatei?.let { wartendeDatei = null; uebergeben(it) }
                }
            }

            override fun onReceivedError(v: WebView, anfrage: WebResourceRequest, fehler: WebResourceError) {
                if (!anfrage.isForMainFrame) return
                seiteBereit = false
                v.loadDataWithBaseURL(null, FEHLERSEITE, "text/html", "UTF-8", null)
            }
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                // In der Kopieransicht: zurück zur Übersicht statt App verlassen
                web.evaluateJavascript(
                    "(function(){var b=document.getElementById('kopfZurueck');" +
                    "if(b&&!b.hidden){start();return true}return false})()") { antwort ->
                    if (antwort != "true") moveTaskToBack(true)
                }
            }
        })

        if (savedInstanceState == null) web.loadUrl(BASIS) else web.restoreState(savedInstanceState)
        geteilt(intent)
    }

    override fun onNewIntent(neu: Intent) {
        super.onNewIntent(neu)
        geteilt(neu)
    }

    /** „Teilen → V3D Beleg": Datei merken und an die Seite geben, sobald sie geladen ist. */
    private fun geteilt(i: Intent?) {
        if (i?.action != Intent.ACTION_SEND) return
        val u: Uri = (if (Build.VERSION.SDK_INT >= 33) i.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
                      else @Suppress("DEPRECATION") i.getParcelableExtra(Intent.EXTRA_STREAM)) ?: return
        i.action = null   // nicht beim Drehen erneut hochladen
        if (seiteBereit) uebergeben(u) else wartendeDatei = u
    }

    private fun uebergeben(u: Uri) {
        try {
            val bytes = contentResolver.openInputStream(u)?.use { it.readBytes() } ?: return
            if (bytes.size > 25 * 1024 * 1024) {
                Toast.makeText(this, "Datei zu groß (max. 25 MB).", Toast.LENGTH_LONG).show(); return
            }
            val typ = contentResolver.getType(u) ?: "application/octet-stream"
            val b64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
            web.evaluateJavascript("belegVonApp('$b64','${typ.replace("'", "")}')", null)
        } catch (e: Exception) {
            Toast.makeText(this, "Datei konnte nicht gelesen werden.", Toast.LENGTH_LONG).show()
        }
    }

    override fun onPause() {
        super.onPause()
        CookieManager.getInstance().flush()
    }

    override fun onSaveInstanceState(out: Bundle) {
        super.onSaveInstanceState(out)
        web.saveState(out)
    }

    companion object {
        const val FEHLERSEITE = """
            <html><head><meta name="viewport" content="width=device-width,initial-scale=1">
            <style>body{background:#f4f5f9;color:#1c2030;font:16px system-ui;
            display:flex;height:90vh;flex-direction:column;align-items:center;
            justify-content:center;text-align:center;gap:16px;margin:0;padding:20px}
            button{background:#F97316;color:#fff;border:0;border-radius:12px;
            padding:13px 22px;font:inherit;font-weight:700}</style></head>
            <body><div style="font-size:44px">🧾</div>
            <b>Kein Kontakt zum Server</b>
            <div style="color:#5b6172;font-size:14px">Der Rechner zuhause ist gerade
            nicht erreichbar — oder das Handy hat kein Netz.</div>
            <button onclick="location.href='$BASIS'">Nochmal versuchen</button>
            </body></html>"""
    }
}
