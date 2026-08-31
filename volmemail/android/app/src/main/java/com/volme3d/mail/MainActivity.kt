package com.volme3d.mail

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ContentValues
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity

/**
 * V3D Mail als App: dünne WebView-Hülle um den Web-Client.
 * Kann Anhänge hochladen (Dateiauswahl), Anhänge speichern (blob:-Brücke
 * in den Download-Ordner) und meldet sich für mailto:-Links an.
 */
class MainActivity : AppCompatActivity() {

    companion object {
        const val BASE = "https://v3da.tailf05fe9.ts.net/mail/"
        const val HOST = "v3da.tailf05fe9.ts.net"
    }

    private lateinit var web: WebView
    private var dateiwahlRueckgabe: ValueCallback<Array<Uri>>? = null

    private val dateiwahl = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val cb = dateiwahlRueckgabe ?: return@registerForActivityResult
        dateiwahlRueckgabe = null
        if (result.resultCode != Activity.RESULT_OK || result.data == null) {
            cb.onReceiveValue(null); return@registerForActivityResult
        }
        val data = result.data!!
        val uris = mutableListOf<Uri>()
        data.clipData?.let { clip -> for (i in 0 until clip.itemCount) uris.add(clip.getItemAt(i).uri) }
        data.data?.let { if (uris.isEmpty()) uris.add(it) }
        cb.onReceiveValue(if (uris.isEmpty()) null else uris.toTypedArray())
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        web = WebView(this)
        setContentView(web)

        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            loadsImagesAutomatically = true
            mediaPlaybackRequiresUserGesture = true
        }
        CookieManager.getInstance().setAcceptCookie(true)
        web.addJavascriptInterface(SpeicherBruecke(), "AndroidBridge")

        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url
                // mailto in der Seite selbst -> Verfassen-Dialog im Client
                if (url.scheme == "mailto") {
                    view.loadUrl(BASE + "?compose=" + Uri.encode(url.toString()))
                    return true
                }
                // eigene Seite bleibt in der App, alles Fremde geht in den Browser
                if (url.host == HOST && (url.path ?: "").startsWith("/mail")) return false
                return try {
                    startActivity(Intent(Intent.ACTION_VIEW, url)); true
                } catch (e: Exception) { true }
            }

            override fun onPageFinished(view: WebView, url: String) {
                // blob:-Downloads (Anhänge speichern) über die Brücke umleiten,
                // dabei den Dateinamen aus dem download-Attribut retten
                view.evaluateJavascript(
                    """
                    (function(){
                      if (window.__v3dBridgeOk) return;
                      window.__v3dBridgeOk = true;
                      var orig = URL.createObjectURL.bind(URL);
                      var karte = new Map();
                      URL.createObjectURL = function(b){ var u = orig(b); try{ karte.set(u, b); }catch(e){} return u; };
                      document.addEventListener('click', function(ev){
                        var a = ev.target && ev.target.closest ? ev.target.closest('a[download]') : null;
                        if (!a || !a.href || a.href.indexOf('blob:') !== 0) return;
                        var blob = karte.get(a.href);
                        if (!blob) return;
                        ev.preventDefault(); ev.stopPropagation();
                        var fr = new FileReader();
                        fr.onload = function(){
                          var b64 = String(fr.result).split(',')[1] || '';
                          AndroidBridge.speichereBase64(b64, blob.type || '', a.getAttribute('download') || 'datei');
                        };
                        fr.readAsDataURL(blob);
                      }, true);
                    })();
                    """.trimIndent(), null
                )
            }
        }

        web.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                view: WebView, callback: ValueCallback<Array<Uri>>,
                params: FileChooserParams
            ): Boolean {
                dateiwahlRueckgabe?.onReceiveValue(null)
                dateiwahlRueckgabe = callback
                val intent = Intent(Intent.ACTION_GET_CONTENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = "*/*"
                    putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                }
                return try {
                    dateiwahl.launch(Intent.createChooser(intent, "Anhang wählen")); true
                } catch (e: Exception) {
                    dateiwahlRueckgabe = null; false
                }
            }
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (web.canGoBack()) web.goBack()
                else { isEnabled = false; onBackPressedDispatcher.onBackPressed() }
            }
        })

        web.loadUrl(zielUrl(intent))
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        val mailto = intent.dataString
        if (mailto != null && mailto.startsWith("mailto:")) {
            web.loadUrl(BASE + "?compose=" + Uri.encode(mailto))
        }
    }

    private fun zielUrl(intent: Intent?): String {
        val mailto = intent?.dataString
        if (mailto != null && mailto.startsWith("mailto:")) {
            return BASE + "?compose=" + Uri.encode(mailto)
        }
        return BASE
    }

    /** Nimmt Base64-Daten aus der Seite entgegen und legt sie in Downloads ab. */
    inner class SpeicherBruecke {
        @JavascriptInterface
        fun speichereBase64(b64: String, mime: String, name: String) {
            try {
                val daten = Base64.decode(b64, Base64.DEFAULT)
                val werte = ContentValues().apply {
                    put(MediaStore.Downloads.DISPLAY_NAME, name.ifBlank { "datei" })
                    put(MediaStore.Downloads.MIME_TYPE, mime.ifBlank { "application/octet-stream" })
                    put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
                }
                val uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, werte)
                    ?: throw IllegalStateException("kein Downloads-Eintrag")
                contentResolver.openOutputStream(uri)?.use { it.write(daten) }
                runOnUiThread {
                    Toast.makeText(this@MainActivity, "Gespeichert: $name", Toast.LENGTH_SHORT).show()
                }
            } catch (e: Exception) {
                runOnUiThread {
                    Toast.makeText(this@MainActivity, "Speichern fehlgeschlagen", Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    override fun onPause() {
        super.onPause()
        CookieManager.getInstance().flush()
    }
}
