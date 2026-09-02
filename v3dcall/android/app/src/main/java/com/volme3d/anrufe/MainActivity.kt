package com.volme3d.anrufe

import android.Manifest
import android.annotation.SuppressLint
import android.app.AlertDialog
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.text.InputType
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat

const val BASIS = "https://v3da.tailf05fe9.ts.net/anrufe/"
const val PREFS = "v3dcall"
const val PREF_KEY = "schluessel"

class MainActivity : AppCompatActivity() {

    private lateinit var web: WebView

    /** Bruecke: die Weboberflaeche reicht den Schluessel nach dem Anmelden
     *  durch, damit der Hintergrund-Waechter ihn ebenfalls kennt. */
    inner class Bruecke {
        @JavascriptInterface
        fun schluesselMerken(key: String) {
            getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit().putString(PREF_KEY, key).apply()
            Waechter.planen(applicationContext)
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
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false   // Aufnahmen direkt abspielen
            useWideViewPort = true
            loadWithOverviewMode = true
        }
        web.webChromeClient = WebChromeClient()
        web.webViewClient = WebViewClient()
        web.addJavascriptInterface(Bruecke(), "AndroidBruecke")

        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (web.canGoBack()) web.goBack() else finish()
            }
        })

        benachrichtigungErlauben()

        val key = getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(PREF_KEY, "") ?: ""
        if (key.isEmpty()) frageSchluessel() else starte(key)
    }

    private fun starte(key: String) {
        if (key.isNotEmpty()) {
            CookieManager.getInstance()
                .setCookie("https://v3da.tailf05fe9.ts.net", "v3dcall=$key; Path=/; Secure")
            CookieManager.getInstance().flush()
        }
        Waechter.planen(applicationContext)
        web.loadUrl(BASIS)
    }

    /** Beim ersten Start einmalig nach dem Zugangsschluessel fragen. */
    private fun frageSchluessel() {
        val feld = EditText(this).apply {
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            hint = "Zugangsschlüssel"
        }
        AlertDialog.Builder(this)
            .setTitle("V3D Anrufannahme")
            .setMessage("Zugangsschlüssel eingeben. Er wird auch für die " +
                        "Benachrichtigungen im Hintergrund gebraucht.")
            .setView(feld)
            .setCancelable(false)
            .setPositiveButton("Weiter") { _, _ ->
                val k = feld.text.toString().trim()
                getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                    .edit().putString(PREF_KEY, k).apply()
                starte(k)
            }
            .setNegativeButton("Später") { _, _ -> starte("") }
            .show()
    }

    private fun benachrichtigungErlauben() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
        }
    }
}
