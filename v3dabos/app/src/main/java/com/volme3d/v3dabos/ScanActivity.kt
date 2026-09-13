package com.volme3d.v3dabos

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Menu
import android.view.MenuItem
import android.view.View
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import java.time.LocalDate
import java.time.temporal.ChronoUnit
import java.util.concurrent.Executors

/**
 * Sucht auf dem Handy nach Apps, hinter denen typischerweise ein Abo steckt, und zeigt
 * dazu, wie lange sie nicht mehr benutzt wurden.
 *
 * Was hier NICHT passiert: die tatsächlichen Play-Store-Abos auslesen. Das kann keine
 * App — Google Play gibt nur der App selbst Auskunft über ihre eigenen Käufe. Deshalb
 * ist das hier ein begründeter Vorschlag, den man abhaken muss, keine Kontoabfrage.
 */
class ScanActivity : AppCompatActivity() {

    private lateinit var rv: RecyclerView
    private lateinit var tvKopf: TextView
    private var adapter: VorschlagAdapter? = null
    private val pool = Executors.newSingleThreadExecutor()
    private val ui = Handler(Looper.getMainLooper())

    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        setContentView(R.layout.activity_liste)
        supportActionBar?.setDisplayHomeAsUpEnabled(true)
        title = "Apps prüfen"

        rv = findViewById(R.id.rv)
        tvKopf = findViewById(R.id.tvKopf)
        rv.layoutManager = LinearLayoutManager(this)
        tvKopf.text = "Wird gesucht …"

        findViewById<View>(R.id.btnUebernehmen).setOnClickListener { uebernehmen() }

        pool.execute {
            val nutzung = runCatching { NutzungQuelle.messe(this) }.getOrDefault(emptyMap())
            val installiert = NutzungQuelle.installierteApps(this)
            ui.post { zeige(installiert, nutzung) }
        }
    }

    private fun zeige(
        installiert: List<NutzungQuelle.InstallierteApp>,
        nutzung: Map<String, Nutzung>
    ) {
        val vorhanden = Store.alle(this)
        val heute = LocalDate.now()
        val posten = ArrayList<VorschlagAdapter.Posten>()

        // 1) Bekannte Abo-Apps, die wirklich auf dem Gerät liegen
        val gefunden = installiert.mapNotNull { app ->
            val k = Katalog.zuPaket(app.paket) ?: return@mapNotNull null
            if (vorhanden.any { it.appPaket == app.paket }) null else k to app
        }
        if (gefunden.isNotEmpty()) {
            posten.add(VorschlagAdapter.Posten.Kopf("Auf dem Handy gefunden"))
            for ((k, app) in gefunden) {
                val n = nutzung[app.paket]
                posten.add(
                    VorschlagAdapter.Posten.Eintrag(
                        titel = k.name,
                        unter = nutzungsText(n, heute),
                        rechts = if (k.richtpreisCent > 0) Fmt.euro(k.richtpreisCent) else "",
                        gewaehlt = false,
                        daten = k
                    )
                )
            }
        }

        // 2) Abos ohne eigene App — die findet keine Messung, die muss man wissen
        val ohneApp = Katalog.eintraege.filter { k ->
            (k.paket.isBlank() || !NutzungQuelle.istInstalliert(this, k.paket)) &&
            vorhanden.none { it.name.equals(k.name, true) }
        }
        if (ohneApp.isNotEmpty()) {
            posten.add(VorschlagAdapter.Posten.Kopf("Häufige Abos ohne App auf dem Handy"))
            for (k in ohneApp) {
                posten.add(
                    VorschlagAdapter.Posten.Eintrag(
                        titel = k.name,
                        unter = k.anbieter,
                        rechts = if (k.richtpreisCent > 0) Fmt.euro(k.richtpreisCent) else "",
                        gewaehlt = false,
                        daten = k
                    )
                )
            }
        }

        adapter = VorschlagAdapter(posten)
        rv.adapter = adapter

        val ohneRecht = !NutzungQuelle.hatBerechtigung(this)
        tvKopf.text = buildString {
            append("${gefunden.size} Abo-App(en) auf dem Handy gefunden. ")
            append("Ankreuzen, was du wirklich bezahlst — Beträge lassen sich danach anpassen.")
            if (ohneRecht) append("\n\nOhne die Berechtigung „Nutzungsdaten“ steht hier keine " +
                "Nutzungsdauer. Einstellungen → Zugriff auf Nutzungsdaten.")
        }
    }

    private fun nutzungsText(n: Nutzung?, heute: LocalDate): String {
        if (n == null) return "keine Nutzungsdaten"
        val zuletzt = n.zuletzt ?: return "in 90 Tagen nie benutzt"
        val tage = ChronoUnit.DAYS.between(zuletzt, heute)
        val wie = when {
            tage <= 0 -> "heute benutzt"
            tage == 1L -> "gestern benutzt"
            else -> "vor $tage Tagen zuletzt benutzt"
        }
        return "$wie · ${n.minuten30} Min. in 30 Tagen"
    }

    private fun uebernehmen() {
        val gewaehlt = adapter?.gewaehlte.orEmpty()
        if (gewaehlt.isEmpty()) { finish(); return }
        for (e in gewaehlt) {
            val k = e.daten as? KatalogEintrag ?: continue
            val a = Store.neu().apply {
                name = k.name; anbieter = k.anbieter
                betragCent = k.richtpreisCent; intervall = k.intervall
                weg = k.weg; webUrl = k.webUrl
                appPaket = if (NutzungQuelle.istInstalliert(this@ScanActivity, k.paket)) k.paket else ""
                playPaket = k.paket
                naechsteZahlung = k.intervall.naechsterTermin(LocalDate.now())
                herkunft = "aus dem Dienst-Katalog übernommen – Betrag bitte prüfen"
            }
            Store.ersetze(this, a)
        }
        Fristen.plane(this)
        Toast.makeText(this, "${gewaehlt.size} Abo(s) übernommen – bitte Beträge prüfen",
            Toast.LENGTH_LONG).show()
        finish()
    }

    override fun onCreateOptionsMenu(menu: Menu): Boolean {
        menuInflater.inflate(R.menu.scan, menu); return true
    }

    override fun onOptionsItemSelected(item: MenuItem): Boolean = when (item.itemId) {
        R.id.mi_play -> { oeffnePlay(); true }
        android.R.id.home -> { finish(); true }
        else -> super.onOptionsItemSelected(item)
    }

    private fun oeffnePlay() {
        AlertDialog.Builder(this)
            .setTitle("Play-Abos vergleichen")
            .setMessage("Der Play Store zeigt alle Abos, die über Google abgerechnet werden. " +
                "Was dort steht, hier abhaken oder von Hand nachtragen.\n\n" +
                "Diese Liste kann keine App auslesen — Google gibt sie nicht heraus.")
            .setPositiveButton("Play Store öffnen") { _, _ ->
                val i = Intent(Intent.ACTION_VIEW,
                    Uri.parse("https://play.google.com/store/account/subscriptions"))
                runCatching { startActivity(i) }.onFailure {
                    Toast.makeText(this, "Kein Browser/Play Store gefunden", Toast.LENGTH_SHORT).show()
                }
            }
            .setNegativeButton("Abbrechen", null).show()
    }
}
