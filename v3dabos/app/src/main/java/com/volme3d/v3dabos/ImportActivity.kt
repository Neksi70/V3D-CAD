package com.volme3d.v3dabos

import android.content.ClipboardManager
import android.content.Context
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.google.android.material.textfield.TextInputEditText
import java.nio.charset.Charset

/**
 * Findet Abos im Kontoauszug. Der zuverlässigste Weg: was regelmäßig abgebucht wird,
 * ist ein Abo — egal ob es dazu eine App gibt oder nicht.
 */
class ImportActivity : AppCompatActivity() {

    private lateinit var etText: TextInputEditText
    private lateinit var rv: RecyclerView
    private var adapter: VorschlagAdapter? = null
    private var funde: List<Fund> = emptyList()

    private val dateiWahl = registerForActivityResult(
        ActivityResultContracts.OpenDocument()
    ) { uri: Uri? -> uri?.let { lade(it) } }

    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        setContentView(R.layout.activity_import)
        supportActionBar?.setDisplayHomeAsUpEnabled(true)
        title = "Kontoauszug auswerten"

        etText = findViewById(R.id.etText)
        rv = findViewById(R.id.rv)
        rv.layoutManager = LinearLayoutManager(this)

        findViewById<View>(R.id.btnDatei).setOnClickListener {
            // Bankexporte kommen als text/csv, text/plain oder application/octet-stream
            dateiWahl.launch(arrayOf("text/*", "application/csv", "application/octet-stream"))
        }
        findViewById<View>(R.id.btnEinfuegen).setOnClickListener { ausZwischenablage() }
        findViewById<View>(R.id.btnSuchen).setOnClickListener { suche() }
        findViewById<View>(R.id.btnUebernehmen).setOnClickListener { uebernehmen() }
    }

    private fun lade(uri: Uri) {
        val bytes = runCatching {
            contentResolver.openInputStream(uri)?.use { it.readBytes() }
        }.getOrNull()
        if (bytes == null) {
            Toast.makeText(this, "Datei konnte nicht gelesen werden", Toast.LENGTH_SHORT).show()
            return
        }
        // Deutsche Bankexporte sind oft Latin-1; an kaputten Umlauten erkennbar.
        var text = String(bytes, Charsets.UTF_8)
        if (text.contains('�')) text = String(bytes, Charset.forName("ISO-8859-1"))
        etText.setText(text)
        Toast.makeText(this, "${text.lines().size} Zeilen geladen", Toast.LENGTH_SHORT).show()
    }

    private fun ausZwischenablage() {
        val cb = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        val text = cb.primaryClip?.getItemAt(0)?.coerceToText(this)?.toString()
        if (text.isNullOrBlank()) {
            Toast.makeText(this, "Zwischenablage ist leer", Toast.LENGTH_SHORT).show()
        } else {
            etText.setText(text)
        }
    }

    private fun suche() {
        val roh = etText.text.toString()
        if (roh.isBlank()) {
            Toast.makeText(this, "Erst Umsätze einfügen oder eine CSV laden", Toast.LENGTH_SHORT).show()
            return
        }
        val buchungen = KontoParser.buchungen(roh)
        if (buchungen.isEmpty()) {
            Toast.makeText(this, "Keine Buchungen erkannt – Zeilen brauchen ein Datum und " +
                "einen Betrag", Toast.LENGTH_LONG).show()
            return
        }
        val vorhanden = Store.alle(this)
        funde = KontoParser.findeAbos(buchungen).filterNot { KontoParser.schonErfasst(it, vorhanden) }

        val posten = ArrayList<VorschlagAdapter.Posten>()
        val sicher = funde.filter { !it.unsicher }
        val unsicher = funde.filter { it.unsicher }

        if (sicher.isNotEmpty()) {
            posten.add(VorschlagAdapter.Posten.Kopf("Wiederkehrende Abbuchungen"))
            sicher.forEach { posten.add(zuPosten(it, true)) }
        }
        if (unsicher.isNotEmpty()) {
            posten.add(VorschlagAdapter.Posten.Kopf("Nur einmal gesehen – bekannter Dienst"))
            unsicher.forEach { posten.add(zuPosten(it, false)) }
        }
        if (posten.isEmpty()) {
            Toast.makeText(this, "${buchungen.size} Buchungen gelesen, aber nichts Neues " +
                "gefunden", Toast.LENGTH_LONG).show()
            return
        }

        adapter = VorschlagAdapter(posten)
        rv.adapter = adapter
        findViewById<TextView>(R.id.tvKopf).text =
            "${buchungen.size} Buchungen gelesen, ${funde.size} mögliche Abos gefunden. " +
            "Beträge stammen aus der letzten Buchung."
        findViewById<View>(R.id.svEingabe).visibility = View.GONE
        findViewById<View>(R.id.llErgebnis).visibility = View.VISIBLE
    }

    private fun zuPosten(f: Fund, vor: Boolean) = VorschlagAdapter.Posten.Eintrag(
        titel = f.name,
        unter = "${f.buchungen.size}× · ${f.intervall.anzeige} · zuletzt ${Fmt.datum(f.letzte)}",
        rechts = Fmt.euro(f.cent),
        gewaehlt = vor,
        daten = f
    )

    private fun uebernehmen() {
        val gewaehlt = adapter?.gewaehlte.orEmpty()
        if (gewaehlt.isEmpty()) { finish(); return }
        for (e in gewaehlt) {
            val f = e.daten as? Fund ?: continue
            val k = f.katalog
            val a = Store.neu().apply {
                name = f.name
                anbieter = k?.anbieter ?: ""
                betragCent = f.cent
                intervall = f.intervall
                naechsteZahlung = f.naechste
                vertragsbeginn = f.buchungen.first().datum
                weg = k?.weg ?: Weg.UNBEKANNT
                webUrl = k?.webUrl ?: ""
                appPaket = k?.paket?.takeIf {
                    it.isNotBlank() && NutzungQuelle.istInstalliert(this@ImportActivity, it)
                } ?: ""
                playPaket = k?.paket ?: ""
                herkunft = "aus dem Kontoauszug erkannt (${f.buchungen.size} Buchungen, " +
                    "zuletzt ${Fmt.datum(f.letzte)})"
            }
            Store.ersetze(this, a)
        }
        Fristen.plane(this)
        Toast.makeText(this, "${gewaehlt.size} Abo(s) übernommen", Toast.LENGTH_LONG).show()
        finish()
    }

    override fun onSupportNavigateUp(): Boolean { finish(); return true }
}
